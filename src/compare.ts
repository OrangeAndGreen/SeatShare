// The "Over time" comparison: one line per office for the Democratic vote share, seat
// share or seat gap in points, which don't depend on how many seats an office has.

import * as d3 from "d3";
import { formatGap, officeName, pct, type Office } from "./shares";
import type { CompareSeries, Metric } from "./trend-data";
import { cssVar, hideTip, shade, SHADE, showTip } from "./ui";

// Office colours avoid the party blue and red. Each office also has its own marker
// shape and an end label, since lines cross and some colours are close for colour blindness.
export const SYMBOL: Record<Office, d3.SymbolType> = {
  house: d3.symbolCircle,
  senate: d3.symbolTriangle,
  president: d3.symbolDiamond,
  statehouse: d3.symbolSquare,
  statesenate: d3.symbolWye,
};

export const SHORT: Record<Office, string> = {
  house: "House", senate: "Senate", president: "Pres", statehouse: "St House", statesenate: "St Sen",
};

export function officeColor(office: Office): string {
  return cssVar(`--office-${office}`);
}

/** A 12px legend swatch: the office's marker in its colour. */
export function officeSwatch(office: Office): string {
  const path = d3.symbol(SYMBOL[office], 70)();
  return `<svg width="14" height="14" viewBox="-7 -7 14 14"><path d="${path}" fill="${officeColor(office)}"/></svg>`;
}

export function formatCompare(value: number, metric: Metric): string {
  return metric === "gap" ? formatGap(value) : pct(value);
}

/** Moves labels apart vertically so none sits within `gap` px of the next. */
export function spreadLabels(ys: number[], gap: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) {
    order[k].y = Math.max(order[k].y, order[k - 1].y + gap);
  }
  const out = new Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}

/** The office checkboxes above the chart, each with its marker, are its legend. */
export function drawCompare(
  box: HTMLElement, tableBox: HTMLElement,
  series: CompareSeries[], metric: Metric, years: number[],
): void {
  const width = 960;
  const height = 360;
  const m = { top: 14, right: 72, bottom: 28, left: 52 };
  const surface = cssVar("--bg");
  const drawn = series.filter((s) => s.points.length);

  const x = d3.scalePoint<number>().domain(years).range([m.left, width - m.right]).padding(0.5);
  const values = drawn.flatMap((s) => s.points.map((p) => p.value));
  let y: d3.ScaleLinear<number, number>;
  if (metric === "gap") {
    const e = Math.max((d3.max(values, Math.abs) ?? 0) * 1.1, 0.05);
    y = d3.scaleLinear().domain([-e, e]).nice();
  } else {
    const lo = Math.max(0, Math.min(0.4, (d3.min(values) ?? 0.5) - 0.05));
    const hi = Math.min(1, Math.max(0.6, (d3.max(values) ?? 0.5) + 0.05));
    y = d3.scaleLinear().domain([lo, hi]).nice();
  }
  y.range([height - m.bottom, m.top]);
  const fmt = metric === "gap"
    ? (v: number) => (v === 0 ? "Even" : `${v > 0 ? "D" : "R"} +${Math.round(Math.abs(v) * 100)}`)
    : (v: number) => pct(v, 0);

  const svg = d3.select(box).append("svg")
    .attr("class", "chart")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", `${metric === "gap" ? "Seat gap in points" : metric === "voteShare"
      ? "Democratic vote share" : "Democratic seat share"} by office and election year`);

  const ticks = y.ticks(5);
  svg.append("g").attr("class", "grid").selectAll("line").data(ticks).join("line")
    .attr("x1", m.left).attr("x2", width - m.right)
    .attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left - 6},0)`)
    .call(d3.axisLeft(y).tickValues(ticks).tickFormat((d) => fmt(+d)).tickSize(0));
  const every = years.length > 16 ? 2 : 1;
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom + 8})`)
    .call(d3.axisBottom(x).tickValues(years.filter((_, i) => i % every === 0))
      .tickFormat((d) => String(d)).tickSize(0));
  svg.append("line").attr("class", "ref")
    .attr("x1", m.left).attr("x2", width - m.right)
    .attr("y1", y(metric === "gap" ? 0 : 0.5)).attr("y2", y(metric === "gap" ? 0 : 0.5));

  const g = svg.append("g");
  for (const s of drawn) {
    const color = officeColor(s.office);
    const line = d3.line<CompareSeries["points"][number]>().x((p) => x(p.year)!).y((p) => y(p.value));
    g.append("path").attr("d", line(s.points)).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2);
    g.append("g").selectAll("path").data(s.points).join("path")
      .attr("d", d3.symbol(SYMBOL[s.office], 64))
      .attr("transform", (p) => `translate(${x(p.year)},${y(p.value)})`)
      .attr("fill", color).attr("stroke", surface).attr("stroke-width", 2);
  }

  // End labels in text ink, beside each line's last point, kept apart.
  const ends = drawn.map((s) => s.points[s.points.length - 1]);
  const labelYs = spreadLabels(ends.map((p) => y(p.value)), 14);
  drawn.forEach((s, i) => {
    svg.append("text")
      .attr("x", x(years[years.length - 1])! + 12).attr("y", labelYs[i])
      .attr("dy", "0.35em").attr("font-size", 12).attr("fill", cssVar("--text-2"))
      .text(SHORT[s.office]);
  });

  // One hover column per year, listing every office that has a value.
  svg.append("g").selectAll("rect").data(years).join("rect")
    .attr("x", (yr) => x(yr)! - x.step() / 2).attr("width", x.step())
    .attr("y", m.top).attr("height", height - m.top - m.bottom)
    .attr("fill", "transparent")
    .on("mousemove", (event: MouseEvent, yr) => showTip(tipHtml(yr, series, metric), event.clientX, event.clientY))
    .on("mouseleave", hideTip);

  drawTable(tableBox, series, metric, years);
}

function valueIn(s: CompareSeries, year: number): number | undefined {
  return s.points.find((p) => p.year === year)?.value;
}

function tipHtml(year: number, series: CompareSeries[], metric: Metric): string {
  const rows = series.flatMap((s) => {
    const v = valueIn(s, year);
    return v === undefined ? [] : [`<div class="row"><span>${officeSwatch(s.office)} ${officeName(s.office)}</span>`
      + `<span>${formatCompare(v, metric)}</span></div>`];
  });
  return `<b>${year}</b>` + (rows.join("") || `<div class="row"><span>No results</span></div>`);
}

function drawTable(box: HTMLElement, series: CompareSeries[], metric: Metric, years: number[]): void {
  const body = [...years].reverse().map((yr) => `<tr><td>${yr}</td>${series.map((s) => {
    const v = valueIn(s, yr);
    if (v === undefined) return `<td><span class="muted">-</span></td>`;
    // A share shades by how far it sits from half, as a margin would.
    const tint = metric === "gap" ? shade(v, SHADE.gap)
      : shade(2 * v - 1, metric === "seatShare" ? SHADE.seats : SHADE.votes);
    return `<td${tint}>${formatCompare(v, metric)}</td>`;
  }).join("")}</tr>`).join("");
  box.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th scope="col">Year</th>${series.map((s) => `<th scope="col">${officeName(s.office)}</th>`).join("")}</tr></thead>
    <tbody>${body}</tbody></table></div>`;
}
