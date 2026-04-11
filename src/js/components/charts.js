import Chart from 'chart.js/auto';

// Global config to match PostQode UI
Chart.defaults.color = '#a1a1aa';
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.plugins.tooltip.backgroundColor = '#18181b';
Chart.defaults.plugins.tooltip.titleColor = '#fafafa';
Chart.defaults.plugins.tooltip.bodyColor = '#a1a1aa';
Chart.defaults.plugins.tooltip.borderColor = '#3f3f46';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 6;
Chart.defaults.plugins.legend.labels.color = '#a1a1aa';
Chart.defaults.plugins.legend.labels.usePointStyle = true;

const THEME_COLORS = [
  'rgba(13, 148, 136, 1)',   // Teal (PostQode Accent)
  'rgba(59, 130, 246, 1)',   // Blue
  'rgba(168, 85, 247, 1)',   // Purple
  'rgba(245, 158, 11, 1)',   // Yellow
  'rgba(239, 68, 68, 1)',    // Red
  'rgba(6, 182, 212, 1)',    // Cyan
  'rgba(34, 197, 94, 1)',    // Green
];

/** Radar chart for model efficiency matrix */
export function renderRadarChart(canvasId, models) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  const topModels = models.slice(0, 5);
  const maxTasks = Math.max(...models.map(m => m.task_count), 1);
  const maxAvgCost = Math.max(...models.map(m => m.avg_cost || 0), 0.001);

  const datasets = topModels.map((m, i) => {
    const color = THEME_COLORS[i % THEME_COLORS.length];
    const completionRate = m.task_count ? (m.completed / m.task_count * 100) : 0;
    const cacheHit = (m.total_tokens_in + m.total_cache_reads) > 0
      ? (m.total_cache_reads / (m.total_tokens_in + m.total_cache_reads) * 100) : 0;
    const usage = (m.task_count / maxTasks) * 100;
    const reasoning = m.task_count ? (m.with_reasoning / m.task_count * 100) : 0;
    const costScore = 100 - ((m.avg_cost || 0) / maxAvgCost * 100);

    return {
      label: m.model_id.split('/').pop(),
      data: [completionRate, cacheHit, usage, reasoning, costScore],
      backgroundColor: color.replace('1)', '0.15)'),
      borderColor: color,
      borderWidth: 2,
      pointBackgroundColor: color,
    };
  });

  return new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Completion Rate', 'Cache Efficiency', 'Usage Frequency', 'Reasoning Rate', 'Cost Efficiency'],
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          angleLines: { color: '#27272a' },
          grid: { color: '#27272a' },
          pointLabels: { color: '#a1a1aa', font: { size: 11, weight: '500' } },
          ticks: { display: false, min: 0, max: 100 }
        }
      }
    }
  });
}

/** Error trend line chart — clicking a line drills into sessions */
export function renderErrorTrendChart(canvasId, overTimeData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !overTimeData.length) return;

  const dates = [...new Set(overTimeData.map(d => d.day))].sort();
  const categories = [...new Set(overTimeData.map(d => d.error_category))];

  const datasets = categories.map((cat, i) => {
    const color = THEME_COLORS[i % THEME_COLORS.length];
    return {
      label: cat,
      data: dates.map(day => {
        const match = overTimeData.find(d => d.day === day && d.error_category === cat);
        return match ? match.count : 0;
      }),
      borderColor: color,
      backgroundColor: color.replace('1)', '0.08)'),
      fill: true,
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 6,
      cursor: 'pointer',
    };
  });

  return new Chart(ctx, {
    type: 'line',
    data: { labels: dates, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      onClick: (e, elements, chart) => {
        if (!elements.length) return;
        const cat = chart.data.datasets[elements[0].datasetIndex].label;
        window.location.hash = `#/sessions?error_category=${encodeURIComponent(cat)}`;
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          grid: { color: '#27272a' },
          border: { display: false }
        }
      }
    }
  });
}

/** Horizontal bar chart for cost by model — clicking drills into sessions */
export function renderCostChart(canvasId, models, totalCost) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !models.length) return;

  const sorted = [...models].sort((a, b) => (b.total_cost || 0) - (a.total_cost || 0)).slice(0, 12);
  const labels = sorted.map(m => m.model_id.split('/').pop());
  const data   = sorted.map(m => +((m.total_cost || 0).toFixed(4)));
  const colors = sorted.map((_, i) => THEME_COLORS[i % THEME_COLORS.length]);

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Cost ($)',
        data,
        backgroundColor: colors.map(c => c.replace('1)', '0.75)')),
        borderColor: colors,
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ` $${ctx.raw.toFixed(4)}`
          }
        }
      },
      onClick: (e, elements, chart) => {
        if (!elements.length) return;
        const modelShort = chart.data.labels[elements[0].index];
        const full = sorted[elements[0].index].model_id;
        window.location.hash = `#/sessions?model_id=${encodeURIComponent(full)}`;
      },
      scales: {
        x: { grid: { color: '#27272a' }, border: { display: false }, ticks: { callback: v => `$${v}` } },
        y: { grid: { display: false }, ticks: { font: { family: "'JetBrains Mono', monospace", size: 11 } } }
      }
    }
  });
}

/** Horizontal bar chart for top tools — clicking drills into sessions */
export function renderToolsChart(canvasId, tools) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !tools.length) return;

  const sorted = [...tools].sort((a, b) => b.count - a.count).slice(0, 15);
  const labels = sorted.map(t => t.tool_name);
  const data   = sorted.map(t => t.count);

  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Calls',
        data,
        backgroundColor: 'rgba(59, 130, 246, 0.7)',
        borderColor: 'rgba(59, 130, 246, 1)',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      onClick: (e, elements, chart) => {
        if (!elements.length) return;
        const tool = sorted[elements[0].index].tool_name;
        window.location.hash = `#/sessions?tool_name=${encodeURIComponent(tool)}`;
      },
      scales: {
        x: { grid: { color: '#27272a' }, border: { display: false } },
        y: { grid: { display: false }, ticks: { font: { family: "'JetBrains Mono', monospace", size: 11 } } }
      }
    }
  });
}

/** Doughnut chart for categorical distribution (e.g. Models or Error Types) */
export function renderDoughnutChart(canvasId, labels, data) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !labels.length) return null;

  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: THEME_COLORS.map(c => c.replace('1)', '0.85)')),
        borderColor: '#18181b', // Match background
        borderWidth: 2,
        hoverOffset: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'right',
          labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } }
        }
      }
    }
  });
}
