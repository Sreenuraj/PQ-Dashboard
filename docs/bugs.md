# Bug Tracker — Phase 4 Agent Context

## Bug #1: Session page agent filter only shows "All Agents"
**Status:** Reopened
**Description:** The Sessions page has an agent filter dropdown (`f-agent`) but it only shows "All Agents" option. Individual agents are not listed in the dropdown.
**User Feedback:** Still not fixed, it's only showing 'All Agents'.

## Bug #2: Model stats page has no agent filter
**Status:** Fixed (commit 46d3b06)
**Description:** When user filters by agent on Overview page and clicks "View all" in Top Models, the Model Stats page doesn't apply that agent filter. The filter should persist across pages.
**User Feedback:** Still the model stats page does not have an agent filter.

## Bug #3: Metric tooltips show '?' but don't reveal anything
**Status:** Open
**Description:** In Model Performance Table, the headers TUE, RD, CE, ERR have a '?' icon for tooltips, but clicking/hovering doesn't show the full metric definition.
**User Feedback:** Why do we still need the '?' in the header? We should remove the '?' icon and make the header text itself trigger the tooltip.

## Bug #4: Same agent appearing multiple times in Sessions page
**Status:** Fixed (commit c8de087)
**Description:** In the Sessions page Agent(s) column, the same agent appears multiple times for a single session (e.g., web_agent shown twice).

## Bug #5: Errors by Agent not filtered by Models filter
**Status:** Reopened
**Description:** On the Errors page, the "By Agent" tab doesn't respect the agent filter selected on the Models page or Overview.
**User Feedback:** Still not fixed.

## Bug #6: Cost mismatch between Overview and Costs page
**Status:** Open
**Description:** Overview shows total cost as $98.14, but clicking on the Costs card shows $150 on the Costs page.

## Bug #7: Timeline Agent Timeline shows 0% for all agents
**Status:** Reopened
**Description:** In the Timeline page's "Agent Timeline" section, all agents show 0% regardless of actual usage.
**User Feedback:** Still not fixed.

## Bug #8: Tools page needs agent-wise filter
**Status:** Reopened
**Description:** The Tools page doesn't have an agent filter. Users can't see which tools were used by which agent.
**User Feedback:** Still not fixed, now it's throwing 'Error loading view: escHtml is not defined' in UI.

## Bug #9: SqliteError: near "WHERE": syntax error
**Status:** Fixed (commit 2997590)
**Description:** Clicking a number corresponding to the agent in Model × Agent Heatmap in model stat page throws:
`SqliteError: near "WHERE": syntax error` at `server/routes/analytics.js` line 130 and line 76.

## Bug #11: Sessions page ignores agent filter from URL query parameters
**Status:** Fixed (commit 5b56ca8)
**Description:** Clicking a cell in the Model × Agent Heatmap takes the user to the Sessions page with both `model_id` and `agent` filters in the URL, but the Sessions page ignores the `agent` filter and shows sessions for other agents too.
**Files:** `src/js/views/sessions.js`

## Bug #10: Overview page agent filter chips disappear
**Status:** Fixed (commit d7c9b75)
**Description:** In the agent filter in overview page, when selecting an agent (e.g., mobile_agent), all other agent chips disappear.
