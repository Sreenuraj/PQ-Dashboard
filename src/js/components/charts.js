import Chart from 'chart.js/auto';

// Global config to match PostQode UI
Chart.defaults.color = '#a1a1aa'; // var(--text-2)
Chart.defaults.font.family = "'Inter', sans-serif";
Chart.defaults.plugins.tooltip.backgroundColor = '#18181b'; // var(--bg-3)
Chart.defaults.plugins.tooltip.titleColor = '#fafafa';
Chart.defaults.plugins.tooltip.bodyColor = '#a1a1aa';
Chart.defaults.plugins.tooltip.borderColor = '#3f3f46'; // var(--border-2)
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
];

export function renderRadarChart(canvasId, models) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;

  // Let's only take top 4 models to avoid clutter
  const topModels = models.slice(0, 4);

  // Normalize data for 0-100 scale on all axes
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
      backgroundColor: color.replace('1)', '0.2)'),
      borderColor: color,
      borderWidth: 2,
      pointBackgroundColor: color,
    };
  });

  return new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Completion Rate', 'Cache Efficiency', 'Usage Frequency', 'Reasoning Present', 'Cost Efficiency'],
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

export function renderErrorTrendChart(canvasId, overTimeData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !overTimeData.length) return;

  // Group by date
  const dates = [...new Set(overTimeData.map(d => d.day))].sort();
  const categories = [...new Set(overTimeData.map(d => d.error_category))];
  
  const datasets = categories.map((cat, i) => {
    const color = THEME_COLORS[i % THEME_COLORS.length];
    const data = dates.map(day => {
      const match = overTimeData.find(d => d.day === day && d.error_category === cat);
      return match ? match.count : 0;
    });
    return {
      label: cat,
      data,
      borderColor: color,
      backgroundColor: color.replace('1)', '0.1)'),
      fill: true,
      tension: 0.3,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
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
        const index = elements[0].datasetIndex;
        const cat = chart.data.datasets[index].label;
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
