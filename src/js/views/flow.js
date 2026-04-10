import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import { api } from '../api.js';

export async function renderFlow(container, dateRange = {}) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Generating Flow Diagram...</p></div>`;
  const params = {};
  if (dateRange.from) params.from = dateRange.from;
  if (dateRange.to)   params.to   = dateRange.to;
  
  const data = await api.flow(params);

  if (!data.nodes || !data.links || data.nodes.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⑃</div><p>No task flow data available</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Activity Flow</h1>
        <p class="view-subtitle">Task transitions from start to completion · <span style="color:var(--accent-2);font-size:11px">Click any node to see matching sessions ↗</span></p>
      </div>
      <!-- date picker injected here -->
    </div>
    
    <div class="panel" style="overflow-x: auto; overflow-y: hidden;">
      <div id="sankey-container" style="min-width: 800px; height: 500px;"></div>
    </div>
  `;

  setTimeout(() => drawSankey('sankey-container', data), 50);
}

function drawSankey(containerId, data) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const width = container.clientWidth;
  const height = container.clientHeight;
  const margin = { top: 20, right: 30, bottom: 20, left: 30 };

  const svg = d3.select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const sankeyGen = sankey()
    .nodeWidth(20)
    .nodePadding(30)
    .extent([[0, 0], [width - margin.left - margin.right, height - margin.top - margin.bottom]]);

  const { nodes, links } = sankeyGen({
    nodes: data.nodes.map(d => ({ ...d })),
    links: data.links.map(d => ({ ...d }))
  });

  const colorMap = {
    'Task Start': 'var(--text-3)',
    'Reasoning': 'var(--purple)',
    'No Reasoning': 'var(--border-2)',
    'Tools Used': 'var(--blue)',
    'No Tools': 'var(--border-2)',
    'Completed': 'var(--green)',
    'Interrupted': 'var(--yellow)',
    'Error': 'var(--red)',
    'Has API Errors': 'var(--red)'
  };

  function getNodeColor(name) {
    return colorMap[name] || 'var(--accent)';
  }

  // Draw links
  const link = svg.append("g")
    .attr("fill", "none")
    .attr("stroke-opacity", 0.4)
    .selectAll("g")
    .data(links)
    .enter().append("g")
    .style("mix-blend-mode", "screen"); // good for dark mode

  link.append("path")
    .attr("d", sankeyLinkHorizontal())
    .attr("stroke", d => getNodeColor(d.target.name))
    .attr("stroke-width", d => Math.max(1, d.width));

  // Tooltip for links
  link.append("title")
    .text(d => `${d.source.name} → ${d.target.name}\n${d.value} tasks`);

  // Draw nodes
  const node = svg.append("g")
    .selectAll("g")
    .data(nodes)
    .enter().append("g");

  node.append("rect")
    .attr("x", d => d.x0)
    .attr("y", d => d.y0)
    .attr("height", d => d.y1 - d.y0)
    .attr("width", sankeyGen.nodeWidth())
    .attr("fill", d => getNodeColor(d.name))
    .attr("rx", 4)
    .attr("ry", 4)
    .style("cursor", "pointer")
    .on("click", (event, d) => {
      // Map Sankey node name to a sessions drilldown URL
      const name = d.name;
      let q = '';
      if (name === 'Completed')         q = '?status=completed';
      else if (name === 'Interrupted')  q = '?status=interrupted';
      else if (name.includes('Error') || name === 'Has API Errors') q = '?status=error';
      else if (name === 'Reasoning')    q = '?hasReasoning=true';
      else if (name === 'No Reasoning') q = '?hasReasoning=false';
      else if (name === 'Tools Used')   q = '?hasErrors=false';
      if (q) window.location.hash = `#/sessions${q}`;
    })
    .append("title")
    .text(d => `${d.name}\n${d.value} tasks\nClick to view sessions`);

  // Node labels
  node.append("text")
    .attr("x", d => d.x0 < width / 2 ? d.x1 + 8 : d.x0 - 8)
    .attr("y", d => (d.y1 + d.y0) / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", d => d.x0 < width / 2 ? "start" : "end")
    .text(d => d.name)
    .attr("fill", "var(--text)")
    .attr("font-family", "Inter")
    .attr("font-size", "12px")
    .attr("font-weight", "500");
}
