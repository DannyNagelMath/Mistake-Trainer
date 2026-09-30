// acpl.ts: Step 8. The eval chart under the board: White's winning chances after every move, with
// an orange line at the move on the board. Click it to jump to that move. From lila's
// ui/chart/src/acpl.ts, with the helpers it uses from ui/chart/src/index.ts (master, commit 27ffc8b).
// Every change from lila's version is marked with a comment starting "Trim:".

import {
  type ChartConfiguration,
  type ChartDataset,
  type ChartOptions,
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

import { renderEval } from './components';
import { i18n } from './i18n';
import type { TreeNode } from './tree';
import { povChances } from './winningChances';

// Trim: lila also registers chartjs-plugin-datalabels, for the labels on the game-phase lines.
Chart.register(LineController, LinearScale, PointElement, LineElement, Tooltip, Filler);

// lila's AcplChart: a chart with two more functions.
export interface AcplChart extends Chart<'line'> {
  selectPly(ply: number, isMainline: boolean): void;
}

// ---------- From ui/chart/src/index.ts ----------

// Add a slight offset so the graph doesn't get cutoff when eval = mate.
const chartYMax = 1.05;
const chartYMin = -chartYMax;

// Trim: lila picks lighter colors for the light theme; this page is always dark.
const orangeAccent = '#d85000';
const whiteFill = 'rgb(255 255 255 / 0.3)';
const blackFill = 'rgb(0 0 0 / 1)';
const fontColor = 'hsl(0 0% 73%)';
const tooltipBgColor = 'rgb(22 21 18 / 0.85)';
const zeroLineColor = '#676664';

const axisOpts = (xmin: number, xmax: number): ChartOptions<'line'>['scales'] => ({
  x: {
    display: false,
    type: 'linear',
    min: xmin,
    max: xmax,
    offset: false,
  },
  y: {
    // Set equidistant max and min to center the graph at y=0.
    min: chartYMin,
    max: chartYMax,
    border: { display: false },
    ticks: { display: false },
    grid: {
      color: ctx => (ctx.tick.value === 0 ? zeroLineColor : undefined),
    },
  },
});

function fontFamily(size?: number, weight?: 'bold') {
  return {
    family: "'Noto Sans', 'Lucida Grande', 'Lucida Sans Unicode', Verdana, Arial, Helvetica, sans-serif",
    size: size ?? 12,
    weight,
  };
}

/**  Instead of using the annotation plugin, create a dataset to plot as a pseudo-annotation
 *  @returns a vertical line from {ply,-1.05} to {ply,+1.05}.
 * */
function plyLine(ply: number, mainline = true): ChartDataset<'line'> {
  return {
    xAxisID: 'x',
    type: 'line',
    label: 'ply',
    data: [
      { x: ply, y: chartYMin },
      { x: ply, y: chartYMax },
    ],
    borderColor: orangeAccent,
    pointRadius: 0,
    pointHoverRadius: 0,
    borderWidth: 1,
    animation: false,
    segment: !mainline ? { borderDash: [5] } : undefined,
    order: 0,
  };
}

// Moves the orange line to `ply`; dashed when the board is on a variation.
function selectPly(this: Chart<'line'>, ply: number, onMainline: boolean): void {
  const index = this.data.datasets.findIndex(dataset => dataset.label === 'ply');
  this.data.datasets[index] = plyLine(ply, onMainline);
  this.update('none');
}

// ---------- From ui/chart/src/acpl.ts ----------

type Advice = 'blunder' | 'mistake' | 'inaccuracy';
const glyphProperties = (node: TreeNode): { advice?: Advice; color?: string } => {
  if (node.glyphs?.some(g => g.id === 4)) return { advice: 'blunder', color: '#db3031' };
  else if (node.glyphs?.some(g => g.id === 2)) return { advice: 'mistake', color: '#e69d00' };
  else if (node.glyphs?.some(g => g.id === 6)) return { advice: 'inaccuracy', color: '#4da3d5' };
  else return { advice: undefined, color: undefined };
};

// Trim: lila's takes the game data, for the game phases and for "blurs" (moves made while the
// window was in the background, which moderators see). And it's async, because lila loads the
// chart code only when needed. `onClick` replaces lila's pubsub message 'analysis.chart.click'.
export function acplChart(el: HTMLCanvasElement, mainline: TreeNode[], onClick: (index: number) => void): AcplChart {
  const ply = plyLine(0);
  const firstPly = mainline[0].ply;

  const moveLabels: string[] = [];
  const winChances: { x: number; y: number }[] = [];
  mainline.slice(1).map(node => {
    const isWhite = (node.ply & 1) === 1;
    let cp: number | undefined = node.eval && 0;
    if (node.eval?.mate) cp = node.eval.mate > 0 ? Infinity : -Infinity;
    else if (node.san?.includes('#')) cp = isWhite ? Infinity : -Infinity;
    else if (node.eval?.cp) cp = node.eval.cp; // Trim: lila first flips mates in Antichess.
    const turn = Math.floor((node.ply - 1) / 2) + 1; // lila's plyToTurn
    const dots = isWhite ? '.' : '...';
    const winchance = povChances('white', { cp });
    // Plot winchance because logarithmic but display the corresponding cp.eval from AnalyseData in the tooltip
    winChances.push({ x: node.ply, y: winchance });

    const { advice } = glyphProperties(node);
    const label = turn + dots + ' ' + node.san;
    const annotation = advice ? ` [${i18n.site[advice]}]` : '';
    moveLabels.push(label + annotation);
  });

  const acpl: ChartDataset<'line'> = {
    label: i18n.site.advantage,
    data: winChances,
    borderWidth: 1,
    fill: {
      target: 'origin',
      below: blackFill,
      above: whiteFill,
    },
    pointRadius: 0,
    pointHoverRadius: 5,
    pointHitRadius: 100,
    borderColor: orangeAccent,
    pointBackgroundColor: orangeAccent,
    hoverBackgroundColor: orangeAccent,
    order: 5,
  };

  // Trim: lila also draws lines where the opening, middlegame, and endgame start (division.ts).
  // The game export only has them when asked for (division=true).
  const config: ChartConfiguration<'line'> = {
    type: 'line',
    data: {
      labels: moveLabels.map((_, index) => index),
      datasets: [acpl, ply],
    },
    options: {
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false,
      },
      scales: axisOpts(firstPly + 1, mainline.length + firstPly),
      animation: false,
      maintainAspectRatio: false,
      responsive: true,
      plugins: {
        tooltip: {
          borderColor: fontColor,
          borderWidth: 1,
          backgroundColor: tooltipBgColor,
          bodyColor: fontColor,
          titleColor: fontColor,
          titleFont: fontFamily(14, 'bold'),
          bodyFont: fontFamily(13),
          caretPadding: 10,
          displayColors: false,
          filter: item => item.datasetIndex === 0,
          callbacks: {
            label: item => {
              const ev = mainline[item.dataIndex + 1]?.eval;
              if (!ev) return ''; // Pos is mate
              return i18n.site.advantage + ': ' + (ev.mate !== undefined ? '#' + ev.mate : renderEval(ev.cp!));
            },
            title: items => (items[0] ? moveLabels[items[0].dataIndex] : ''),
          },
        },
      },
      onClick(_event, elements) {
        const data = elements[elements.findIndex(element => element.datasetIndex === 0)];
        if (data) onClick(data.index);
      },
    },
  };
  const chart = new Chart(el, config) as AcplChart;
  chart.selectPly = selectPly.bind(chart);
  // Trim: lila also highlights the moves on the chart when you hover over a count in the advice
  // summary ("christmasTree"), and can update the chart while a server analysis is in progress.
  return chart;
}
