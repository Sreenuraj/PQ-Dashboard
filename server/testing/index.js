const crypto = require('crypto');
const { loadRules } = require('./rules');
const { runTIA } = require('./tia');
const { runBCV } = require('./bcv');
const { runMTV } = require('./mtv');
const { runBSE } = require('./bse');
const { runERC } = require('./erc');
const { runCEC } = require('./cec');
const { getPrimaryModel, toolEvents, parseToolTarget } = require('./shared');

function runTestSuite(db, taskId, baselineId = null, pattern = null, persist = true) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) {
    const err = new Error('Task not found');
    err.status = 404;
    throw err;
  }
  task.models = db.prepare('SELECT DISTINCT model_id, provider_id, mode FROM task_models WHERE task_id = ?').all(taskId);
  const events = db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY ts ASC').all(taskId);
  const baseline = baselineId ? getBaseline(db, baselineId) : null;
  const registry = getToolRegistry(db);
  const rules = loadRules();

  const runners = {
    tia: runTIA,
    bcv: runBCV,
    mtv: runMTV,
    bse: runBSE,
    erc: runERC,
    cec: runCEC,
  };

  const { countInterruptions, getCompletionMessage } = require('./shared');
  const { extractFailedTools } = require('../baselines/failed-tools');
  const interruptionCount = countInterruptions(events, task);
  const completionMessage = getCompletionMessage(events);
  const failedTools = extractFailedTools(events);

  const patterns = pattern ? [pattern] : Object.keys(runners);
  const results = patterns.map(key => runners[key](task, events, rules, baseline, registry));
  const baseScore = weightedScore(results, rules.weights || {});

  let penalty = 0;
  if (interruptionCount >= 6) penalty = 25;
  else if (interruptionCount >= 3) penalty = 15;
  else if (interruptionCount >= 1) penalty = 5;

  const ratingRow = db.prepare('SELECT user_rating FROM test_results WHERE task_id = ? AND user_rating IS NOT NULL ORDER BY run_ts DESC LIMIT 1').get(taskId);
  const userRating = ratingRow ? ratingRow.user_rating : null;

  const automatedScore = Math.max(0, baseScore - penalty);

  // Phase 3: Blend with user rating if available (70% automated, 30% human)
  let overallScore = automatedScore;
  if (userRating !== null && userRating !== undefined) {
    const ratingNormalized = (userRating / 5) * 100;
    overallScore = Math.round((automatedScore * 0.7) + (ratingNormalized * 0.3));
  }

  const suite = {
    id: makeResultId(taskId, baselineId, Date.now()),
    task_id: taskId,
    baseline_id: baselineId,
    run_ts: Date.now(),
    overall_score: overallScore,
    base_score: baseScore,
    interruption_count: interruptionCount,
    interruption_penalty: penalty,
    completion_message: completionMessage,
    user_rating: userRating,
    failed_tools: failedTools,
    results,
    task,
    baseline,
    tool_sequence: toolEvents(events).map((e, index) => ({ index, tool_name: e.tool_name, file_path: parseToolTarget(e), command: e.command_text || null })),
  };

  if (persist && !pattern) saveResult(db, suite);
  return suite;
}

function weightedScore(results, weights) {
  let total = 0;
  let weightTotal = 0;
  for (const r of results) {
    if (r.status === 'skip') continue;
    const weight = weights[r.pattern] || 1;
    total += r.score * weight;
    weightTotal += weight;
  }
  return weightTotal ? Math.round(total / weightTotal) : 0;
}

function getBaseline(db, id) {
  const row = db.prepare('SELECT * FROM baselines WHERE id = ?').get(id);
  if (!row) return null;
  const expectedTools = parse(row.expected_tools_json, []);
  const behaviorContract = parse(row.behavior_contract_json, {});
  // Phase 3: Backward compatibility — normalize legacy string arrays to objects
  const normalizedExpectedTools = expectedTools.map(t => typeof t === 'string' ? { name: t, is_essential: true } : t);
  const normalizedKeywords = (behaviorContract.output_keywords || []).map(k => typeof k === 'string' ? { word: k, is_essential: true } : k);
  const normalizedContract = { ...behaviorContract, output_keywords: normalizedKeywords };
  return {
    ...row,
    tags: parse(row.tags, []),
    prompts: parse(row.prompts_json, []),
    expected_tools: normalizedExpectedTools,
    excluded_tools: parse(row.excluded_tools_json, []),
    excluded_files: parse(row.excluded_files_json, []),
    tool_sequence: parse(row.tool_sequence_json, []),
    behavior_contract: normalizedContract,
    reference_metrics: parse(row.reference_metrics_json, {}),
    contributing_sessions: parse(row.contributing_sessions_json, []),
    failed_tools: parse(row.failed_tools_json, []),
  };
}

function getToolRegistry(db) {
  return db.prepare('SELECT DISTINCT tool_name FROM events WHERE tool_name IS NOT NULL AND tool_name != ? ORDER BY tool_name').all('unknown').map(r => r.tool_name);
}

function saveResult(db, suite) {
  const get = key => suite.results.find(r => r.pattern === key) || {};
  const task = suite.task;
  db.prepare(`
    INSERT OR REPLACE INTO test_results (
      id, task_id, baseline_id, model_id, model_version, run_ts, overall_score,
      tia_status, tia_score, tia_evidence_json,
      bcv_status, bcv_score, bcv_evidence_json,
      mtv_status, mtv_score, mtv_evidence_json,
      bse_status, bse_score, bse_evidence_json,
      erc_status, erc_score, erc_evidence_json,
      cec_status, cec_score, cec_evidence_json,
      task_cost, task_duration, task_tokens_in, task_tokens_out, task_errors, task_status,
      user_rating, completion_message, interruption_count
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    suite.id, suite.task_id, suite.baseline_id, getPrimaryModel(task), null, suite.run_ts, suite.overall_score,
    get('tia').status, get('tia').score, JSON.stringify(get('tia').evidence || []),
    get('bcv').status, get('bcv').score, JSON.stringify(get('bcv').evidence || []),
    get('mtv').status, get('mtv').score, JSON.stringify(get('mtv').evidence || []),
    get('bse').status, get('bse').score, JSON.stringify(get('bse').evidence || []),
    get('erc').status, get('erc').score, JSON.stringify(get('erc').evidence || []),
    get('cec').status, get('cec').score, JSON.stringify(get('cec').evidence || []),
    task.total_cost || 0, task.duration || 0, task.total_tokens_in || 0, task.total_tokens_out || 0, task.error_count || 0, task.status,
    suite.user_rating, suite.completion_message, suite.interruption_count
  );
}

function makeResultId(taskId, baselineId, ts) {
  return crypto.createHash('sha1').update(`${taskId}:${baselineId || 'none'}:${ts}`).digest('hex');
}

function parse(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

module.exports = { runTestSuite, getToolRegistry, getBaseline };
