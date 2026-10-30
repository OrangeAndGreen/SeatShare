// The "Over time" tab: one metric across elections, for the nation or one state.

import * as d3 from "d3";
import {
  formatGap, formatSeatGap, formatSeats, NATIONAL, OFFICES, officeName, pct, type Office, type Party, type Row, type Summary,
} from "./shares";
import { drawCompare, officeSwatch } from "./compare";
import {
  clampRange, COMPARE, COMPARE_METRICS, compareSeries, gapValue, isCompareMetric, METRICS, PER_PARTY, partiesShown,
  partyValue, trendPoints, trendYears, type Metric, type TrendOffice, type TrendPoint,
} from "./trend-data";
import { cssVar, escapeHtml, hideTip, partyColor, select, shade, SHADE, showTip } from "./ui";

export interface TrendState {
  office: TrendOffice;
  /** The offices drawn when comparing. */
  offices: Office[];
  area: string;
  metric: Metric;
  from: number;
  to: number;
}

const PARTY_NAME: Record<Party, string> = { D: "Democrats", R: "Republicans", O: "Other" };

const PRESIDENT_LABEL: Partial<Record<Metric, string>> = {
  seatGap: "Elector gap, in electors",
  gap: "Elector gap, in points",
  seatShare: "Elector share",
  seats: "Electors won",
  split: "Elector split",
};

function metricLabel(metric: Metric, office: TrendOffice): string {
  if (office === COMPARE) return COMPARE_METRICS.find((m) => m.value === metric)!.text;
  return (office === "president" && PRESIDENT_LABEL[metric]) || METRICS.find((m) => m.value === metric)!.text;
}

const OFFICE_OPTIONS: { value: TrendOffice; text: string }[] = [...OFFICES, { value: COMPARE, text: "Compare offices" }];

export function drawTrends(
  container: HTMLElement,
  summary: Summary,
  st: TrendState,
  onChange: (st: TrendState) => void,
): void {
  const years = trendYears(summary, st.office, st.offices);
  const [from, to] = clampRange(years, st.from, st.to);
  const areaName = st.area === NATIONAL
    ? "United States"
    : summary.states.find((s) => s.po === st.area)?.name ?? st.area;
  const metrics = (st.office === COMPARE ? COMPARE_METRICS : METRICS)
    .map((m) => ({ value: m.value, text: metricLabel(m.value, st.office) }));
  const metricText = metricLabel(st.metric, st.office);

  container.replaceChildren();
  const controls = document.createElement("div");
  controls.className = "controls";
  const yearOptions = years.map((y) => ({ value: String(y), text: String(y) }));
  const areas = [{ value: NATIONAL, text: "United States" },
    ...summary.states.map((s) => ({ value: s.po, text: s.name }))];
  controls.append(
    select("Office", OFFICE_OPTIONS, st.office, (office) => {
      const ys = trendYears(summary, office, st.offices);
      const [f, t] = clampRange(ys, nearest(ys, from), nearest(ys, to));
      const metric = office === COMPARE && !isCompareMetric(st.metric) ? "gap" : st.metric;
      onChange({ ...st, office, metric, from: f, to: t });
    }),
    select("Area", areas, st.area, (area) => onChange({ ...st, area })),
    select("Metric", metrics, st.metric, (metric) => onChange({ ...st, metric })),
    select("From", yearOptions, String(from), (v) => onChange({ ...st, from: Number(v), to })),
    select("To", yearOptions, String(to), (v) => onChange({ ...st, from, to: Number(v) })),
  );
  container.append(controls);
  if (st.office === COMPARE) container.append(officeChecks(st, onChange));

  const officeText = st.office === COMPARE ? "offices compared" : officeName(st.office);
  const head = document.createElement("div");
  head.innerHTML = `<h2>${escapeHtml(metricText)}: ${escapeHtml(areaName)}, ${officeText}, ${from}-${to}</h2>
    <p class="note">${st.office === COMPARE ? compareNote(st.metric) : note(st.metric, st.office)}</p>`;
  const key = document.createElement("div");
  key.className = "series-key";
  const chartBox = document.createElement("div");
  const tableHead = document.createElement("h2");
  tableHead.textContent = "The numbers";
  const tableBox = document.createElement("div");
  container.append(head, key, chartBox, tableHead, tableBox);

  if (st.office === COMPARE) {
    const series = compareSeries(summary, st.offices, st.area, st.metric, from, to);
    const shown = years.filter((y) => y >= from && y <= to && series.some((s) => s.points.some((p) => p.year === y)));
    if (!shown.length) {
      chartBox.innerHTML = `<p class="note">No results for ${escapeHtml(areaName)} in these years.</p>`;
      return;
    }
    drawCompare(chartBox, tableBox, series, st.metric, shown);
    return;
  }

  const points = trendPoints(summary, st.office, st.area, from, to);
  if (!points.length) {
    chartBox.innerHTML = `<p class="note">No results for ${escapeHtml(areaName)} in these years.</p>`;
    return;
  }
  drawChart(chartBox, key, points, st.metric, st.office);
  drawTable(tableBox, points, st.office);
}

/** A checkbox per office; the last one checked can't be cleared. */
function officeChecks(st: TrendState, onChange: (st: TrendState) => void): HTMLElement {
  const box = document.createElement("fieldset");
  box.className = "office-checks";
  box.innerHTML = `<legend>Offices</legend>`;
  for (const o of OFFICES) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = st.offices.includes(o.value);
    input.disabled = input.checked && st.offices.length === 1;
    input.addEventListener("change", () => {
      const offices = OFFICES.map((x) => x.value)
        .filter((v) => (v === o.value ? input.checked : st.offices.includes(v)));
      onChange({ ...st, offices });
    });
    label.append(input);
    label.insertAdjacentHTML("beforeend", `${officeSwatch(o.value)}${o.text}`);
    box.append(label);
  }
  return box;
}

function compareNote(metric: Metric): string {
  const missing = " A state legislature is left out of a year when most of its seats had no votes recorded.";
  switch (metric) {
    case "gap":
      return "How far each office's share of seats ran ahead of its share of the vote, in percentage points. Above the line favours Democrats, below favours Republicans." + missing;
    case "voteShare":
      return "The Democratic share of all votes cast for each office." + missing;
    default:
      return "The Democratic share of each office's seats, or of the electors for President. State senates with staggered terms count only the seats up that year.";
  }
}

function note(metric: Metric, office: Office): string {
  const seats = office !== "president" ? "seats" : "electoral votes";
  switch (metric) {
    case "seatGap":
      return `How many more ${seats} a party won than a split in proportion to its vote would give it. Bars above the line favour Democrats, below favour Republicans.`;
    case "gap":
      return `How far a party's share of ${seats} ran ahead of its share of the vote, in percentage points: half the difference between the two parties' over- or under-representation.`;
    case "voteShare":
      return "Each party's share of all votes cast.";
    case "seatShare":
      return `Each party's share of the ${seats}.`;
    case "seats":
      return `${office !== "president" ? "Seats" : "Electoral votes"} won by each party.`;
    case "split":
      return `How the ${seats} divided between the parties.`;
  }
}

function axisFormat(metric: Metric): (v: number) => string {
  if (metric === "voteShare" || metric === "seatShare") return (v) => pct(v, 0);
  if (metric === "gap") return (v) => (v === 0 ? "Even" : `${v > 0 ? "D" : "R"} +${Math.round(Math.abs(v) * 100)}`);
  if (metric === "seatGap") return (v) => (v === 0 ? "Even" : `${v > 0 ? "D" : "R"} +${Math.abs(v)}`);
  return (v) => String(v);
}

function drawChart(box: HTMLElement, key: HTMLElement, points: TrendPoint[], metric: Metric, office: Office): void {
  const width = 960;
  const height = 360;
  const m = { top: 14, right: 36, bottom: 28, left: 52 };
  const surface = cssVar("--bg");
  const fmt = axisFormat(metric);

  const x = d3.scaleBand<number>().domain(points.map((p) => p.year))
    .range([m.left, width - m.right]).paddingInner(0.35).paddingOuter(0.2);
  const cx = (year: number) => x(year)! + x.bandwidth() / 2;

  let y: d3.ScaleLinear<number, number>;
  let parties: Party[] = [];
  if (PER_PARTY.includes(metric)) {
    parties = partiesShown(points, metric);
    const max = metric === "seats" ? d3.max(points, (p) => d3.max(parties, (q) => partyValue(p.row, metric, q)))! : 1;
    y = d3.scaleLinear().domain([0, max || 1]).nice();
  } else if (metric === "split") {
    parties = partiesShown(points, "seats");
    y = d3.scaleLinear().domain([0, d3.max(points, (p) => p.row.totalSeats) || 1]).nice();
  } else {
    const ext = d3.max(points, (p) => Math.abs(gapValue(p.row, metric)))!;
    const floor = metric === "gap" ? 0.05 : 1;
    const e = Math.max(ext * 1.1, floor);
    y = d3.scaleLinear().domain([-e, e]).nice();
  }
  y.range([height - m.bottom, m.top]);

  key.innerHTML = metric === "gap" || metric === "seatGap"
    ? ["D", "R"].map((p) => `<span><svg width="12" height="12"><rect width="12" height="12" rx="2" fill="${partyColor(p as Party)}"/></svg>Favours ${PARTY_NAME[p as Party]}</span>`).join("")
    : parties.map((p) => `<span><svg width="12" height="12"><rect width="12" height="12" rx="${metric === "split" ? 2 : 6}" fill="${partyColor(p)}"/></svg>${PARTY_NAME[p]}</span>`).join("");

  const svg = d3.select(box).append("svg")
    .attr("class", "chart")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", `${metricLabel(metric, office)} by election year`);

  const ticks = y.ticks(5);
  svg.append("g").attr("class", "grid").selectAll("line").data(ticks).join("line")
    .attr("x1", m.left).attr("x2", width - m.right)
    .attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left - 6},0)`)
    .call(d3.axisLeft(y).tickValues(ticks).tickFormat((d) => fmt(+d)).tickSize(0));
  const every = points.length > 16 ? 2 : 1;
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom + 8})`)
    .call(d3.axisBottom(x).tickValues(points.map((p) => p.year).filter((_, i) => i % every === 0))
      .tickFormat((d) => String(d)).tickSize(0));

  if (metric === "voteShare" || metric === "seatShare") {
    svg.append("line").attr("class", "ref")
      .attr("x1", m.left).attr("x2", width - m.right).attr("y1", y(0.5)).attr("y2", y(0.5));
  }
  if (metric === "gap" || metric === "seatGap") {
    svg.append("line").attr("stroke", cssVar("--muted"))
      .attr("x1", m.left).attr("x2", width - m.right).attr("y1", y(0)).attr("y2", y(0));
  }

  const g = svg.append("g");
  if (PER_PARTY.includes(metric)) {
    for (const party of parties) {
      const color = partyColor(party);
      const line = d3.line<TrendPoint>().x((p) => cx(p.year)).y((p) => y(partyValue(p.row, metric, party)));
      g.append("path").attr("d", line(points)).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2);
      g.append("g").selectAll("circle").data(points).join("circle")
        .attr("cx", (p) => cx(p.year)).attr("cy", (p) => y(partyValue(p.row, metric, party)))
        .attr("r", 4).attr("fill", color).attr("stroke", surface).attr("stroke-width", 2);
      const last = points[points.length - 1];
      g.append("text")
        .attr("x", cx(last.year) + 8).attr("y", y(partyValue(last.row, metric, party)))
        .attr("dy", "0.35em").attr("font-size", 12).attr("fill", cssVar("--text-2"))
        .text(party === "O" ? "Oth" : party);
    }
  } else if (metric === "split") {
    for (const p of points) {
      let base = 0;
      for (const party of parties) {
        const n = p.row.seats[party];
        if (n > 0) {
          g.append("rect")
            .attr("x", x(p.year)!).attr("width", x.bandwidth())
            .attr("y", y(base + n)).attr("height", y(base) - y(base + n))
            .attr("fill", partyColor(party)).attr("stroke", surface).attr("stroke-width", 1);
        }
        base += n;
      }
    }
  } else {
    g.selectAll("path").data(points).join("path")
      .attr("d", (p) => roundedBar(x(p.year)!, x.bandwidth(), y(0), y(gapValue(p.row, metric))))
      .attr("fill", (p) => partyColor(gapValue(p.row, metric) >= 0 ? "D" : "R"));
  }

  // Over the bars: a majority line for the split, when every year has the same number of seats.
  const totals = new Set(points.map((p) => p.row.totalSeats));
  if (metric === "split" && totals.size === 1) {
    const half = points[0].row.totalSeats / 2;
    svg.append("line").attr("class", "ref")
      .attr("x1", m.left).attr("x2", width - m.right).attr("y1", y(half)).attr("y2", y(half));
  }

  // One hover column per year, wider than the marks.
  svg.append("g").selectAll("rect").data(points).join("rect")
    .attr("x", (p) => x(p.year)! - (x.step() - x.bandwidth()) / 2).attr("width", x.step())
    .attr("y", m.top).attr("height", height - m.top - m.bottom)
    .attr("fill", "transparent")
    .on("mousemove", (event: MouseEvent, p) => showTip(tipHtml(p, office), event.clientX, event.clientY))
    .on("mouseleave", hideTip);
}

/** A bar from the zero line, its far end rounded 4px. */
function roundedBar(x: number, w: number, y0: number, y1: number): string {
  const h = Math.abs(y1 - y0);
  const r = Math.min(4, h, w / 2);
  if (h < 0.5) return "";
  if (y1 < y0) {
    return `M${x},${y0}V${y1 + r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + r}V${y0}Z`;
  }
  return `M${x},${y0}V${y1 - r}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 - r}V${y0}Z`;
}

function tipHtml(p: TrendPoint, office: Office): string {
  const r = p.row;
  const seats = office !== "president" ? "seats" : "electors";
  const rows: [string, string][] = [
    ["Votes", `D ${pct(r.voteShare.D)} · R ${pct(r.voteShare.R)}`],
    [office !== "president" ? "Seats" : "Electors", formatSeats(r.seats) || "-"],
    ["Seat share", `D ${pct(r.seatShare.D)} · R ${pct(r.seatShare.R)}`],
    ["Seat gap", `${formatGap(r.gap)} pts · ${formatSeatGap(r.seatGap)} ${seats}`],
  ];
  return `<b>${p.year}</b>` + rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join("");
}

function drawTable(box: HTMLElement, points: TrendPoint[], office: Office): void {
  const seats = office !== "president" ? "seats" : "electors";
  const line = (year: number, r: Row) => `<tr>
    <td>${year}</td>
    <td>${pct(r.voteShare.D)}</td><td>${pct(r.voteShare.R)}</td>
    <td>${pct(r.seatShare.D)}</td><td>${pct(r.seatShare.R)}</td>
    <td>${formatSeats(r.seats)}</td>
    <td${shade(r.gap, SHADE.gap)}>${formatGap(r.gap)}</td><td${shade(r.gap, SHADE.gap)}>${formatSeatGap(r.seatGap)}</td>
    ${office !== "president" ? `<td>${r.uncontested || ""}</td>` : ""}
  </tr>`;
  box.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th scope="col">Year</th><th scope="col">D votes</th><th scope="col">R votes</th>
      <th scope="col">D ${seats}</th><th scope="col">R ${seats}</th><th scope="col">Split</th>
      <th scope="col">Gap, points</th><th scope="col">Gap, ${seats}</th>
      ${office !== "president" ? `<th scope="col">Uncontested</th>` : ""}</tr></thead>
    <tbody>${[...points].reverse().map((p) => line(p.year, p.row)).join("")}</tbody></table></div>`;
}

function nearest(years: number[], y: number): number {
  return years.reduce((best, v) => (Math.abs(v - y) < Math.abs(best - y) ? v : best), years[0]);
}
