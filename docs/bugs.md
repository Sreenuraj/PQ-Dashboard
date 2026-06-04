# Bug Tracker — Phase 4 Agent Context

## Bug #1: Session page agent filter only shows "All Agents"
**Status:** Open
**Description:** The Sessions page has an agent filter dropdown (`f-agent`) but it only shows "All Agents" option. Individual agents are not listed in the dropdown.
**Expected:** Dropdown should list all available agents (web_agent, agent, plan, mobile_agent, etc.) with a "Multi-agent only" option.
**Files:** `src/js/views/sessions.js`

## Bug #2: Model stats page has no agent filter
**Status:** Open
**Description:** When user filters by agent on Overview page and clicks "View all" in Top Models, the Model Stats page doesn't apply that agent filter. The filter should persist across pages.
**Expected:** Clicking "View all" from a filtered Overview should open Models page with the same agent filter applied.
**Files:** `src/js/views/models.js`, `src/js/views/overview.js`

## Bug #3: Metric tooltips show '?' but don't reveal anything
**Status:** Open
**Description:** In Model Performance Table, the headers TUE, RD, CE, ERR have a '?' icon for tooltips, but clicking/hovering doesn't show the full metric definition.
**Expected:** Hovering or clicking '?' should show the full metric name and definition (e.g., "Tool Use Efficacy" instead of just "TUE").
**Files:** `src/js/views/models.js`, `src/js/components/metric-tooltip.js`

## Bug #4: Same agent appearing multiple times in Sessions page
**Status:** Open
**Description:** In the Sessions page Agent(s) column, the same agent appears multiple times for a single session (e.g., web_agent shown twice).
**Expected:** Each agent should appear only once per session, with a count if it was used in multiple phases.
**Files:** `src/js/views/sessions.js`, `server/routes/tasks.js`

## Bug #5: Errors by Agent not filtered by Models filter
**Status:** Open
**Description:** On the Errors page, the "By Agent" tab doesn't respect the agent filter selected on the Models page or Overview.
**Expected:** Agent filter should compose across pages - selecting an agent on Models should filter Errors by Agent too.
**Files:** `src/js/views/errors.js`, `server/routes/analytics.js`

## Bug #6: Cost mismatch between Overview and Costs page
**Status:** Open
**Description:** Overview shows total cost as $98.14, but clicking on the Costs card shows $150 on the Costs page.
**Expected:** Both pages should show the same total cost.
**Files:** `server/routes/analytics.js`, `src/js/views/costs.js` (or equivalent)

## Bug #7: Timeline Agent Timeline shows 0% for all agents
**Status:** Open
**Description:** In the Timeline page's "Agent Timeline" section, all agents show 0% regardless of actual usage.
**Expected:** Each agent should show the correct percentage of events/time it handled.
**Files:** `src/js/views/timeline.js`

## Bug #8: Tools page needs agent-wise filter
**Status:** Open
**Description:** The Tools page doesn't have an agent filter. Users can't see which tools were used by which agent.
**Expected:** Add agent filter chips or dropdown to Tools page, similar to Overview.
**Files:** `src/js/views/tools.js` (or equivalent), `server/routes/analytics.js`
