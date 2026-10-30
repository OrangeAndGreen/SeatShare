// The "Summary" tab: President, Senate and House margins across elections for the nation
// or one state, the gap between votes and seats under them, and every state for one year.

import * as d3 from "d3";
import { officeColor, officeSwatch, SHORT, spreadLabels, SYMBOL } from "./compare";
import { formatGap, formatSeatGap, formatSeats, NATIONAL, officeName, type Row, type Summary } from "./shares";
import {
  COLUMNS, FEDERAL, formatMargin, seatMargin, sortLines, stateLines, summaryPoints, summaryYears, voteMargin,
  type Column, type Federal, type StateLine, type SummaryKey, type SummaryPoint,
} from "./summary-data";
import { cssVar, escapeHtml, hideTip, select, shade, SHADE, showTip } from "./ui";

export interface SummaryState {
  area: string;
  /** The years the state list adds up, the same year for one election. */
  from: number;
  to: number;
  sort: { key: SummaryKey; descending: boolean };
}

interface Series {
  label: string;
  office: Federal;
  /** Seats are drawn dashed with hollow markers, votes solid and filled. */
  seats: boolean;
  points: { year: number; value: number }[];
}

const seatWord = (o: Federal) => (o === "president" ? "electors" : "seats");

export function drawSummary(
  container: HTMLElement,
  summary: Summary,
  st: SummaryState,
  onChange: (st: SummaryState, redrawOnly?: boolean) => void,
): void {
  const years = summaryYears(summary);
  const areaName = st.area === NATIONAL
    ? "United States"
    : summary.states.find((s) => s.po === st.area)?.name ?? st.area;

  container.replaceChildren();
  const controls = document.createElement("div");
  controls.className = "controls";
  const areas = [{ value: NATIONAL, text: "United States" },
    ...summary.states.map((s) => ({ value: s.po, text: s.name }))];
  controls.append(select("Area", areas, st.area, (area) => onChange({ ...st, area })));

  const head = document.createElement("div");
  head.innerHTML = `<h2>Democratic minus Republican share: ${escapeHtml(areaName)}</h2>
    <p class="note">Each office's margin in the vote (solid) and in the ${st.area === NATIONAL ? "seats" : "seats or electors"}
    won (dashed), as one party's share less the other's. Senate seats are the seats up that year${
    st.area === NATIONAL ? ", about a third of the Senate" : ""}. Click a year to list the states for it alone.</p>`;
  const key = document.createElement("div");
  key.className = "series-key";
  const marginBox = document.createElement("div");
  const gapHead = document.createElement("div");
  gapHead.innerHTML = `<h2>Seat gap, in points</h2>
    <p class="note">How far each office's share of seats ran ahead of its share of the vote: half the distance between
    its two lines above. Above the line favours Democrats, below favours Republicans.</p>`;
  const gapBox = document.createElement("div");

  const one = st.from === st.to;
  const listHead = document.createElement("div");
  listHead.innerHTML = `<h2>Every state ${one ? `in ${st.from}` : `from ${st.from} to ${st.to}`}</h2>
    <p class="note">Margins are Democratic minus Republican share.${one ? "" : ` Each office's votes and seats are added
    up over its elections in these years, so the margins and gaps are for the period as a whole.`} Sort by any column:
    margins sort from most Democratic, the gaps by size whichever party they favour, and states with no race for an
    office go last. Click a state to draw it above.</p>`;
  const listControls = document.createElement("div");
  listControls.className = "controls";
  const yearOptions = [...years].reverse().map((y) => ({ value: String(y), text: String(y) }));
  // Moving one end past the other drags it along, so the range never runs backwards.
  listControls.append(
    select("From", yearOptions, String(st.from),
      (v) => onChange({ ...st, from: Number(v), to: Math.max(Number(v), st.to) })),
    select("To", yearOptions, String(st.to),
      (v) => onChange({ ...st, from: Math.min(Number(v), st.from), to: Number(v) })),
  );
  const listBox = document.createElement("div");

  container.append(controls, head, key, marginBox, gapHead, gapBox, listHead, listControls, listBox);

  const points = summaryPoints(summary, st.area);
  if (!points.length) {
    marginBox.innerHTML = `<p class="note">No results for ${escapeHtml(areaName)}.</p>`;
  } else {
    const onYear = (year: number) => onChange({ ...st, from: year, to: year });
    const pick = (o: Federal, f: (r: Row) => number) =>
      points.flatMap((p) => (p.rows[o] ? [{ year: p.year, value: f(p.rows[o]!) }] : []));
    const margins: Series[] = FEDERAL.flatMap((o) => [
      { label: `${SHORT[o]} votes`, office: o, seats: false, points: pick(o, voteMargin) },
      { label: `${SHORT[o]} ${seatWord(o)}`, office: o, seats: true, points: pick(o, seatMargin) },
    ]);
    const gaps: Series[] = FEDERAL.map((o) => ({ label: SHORT[o], office: o, seats: false, points: pick(o, (r) => r.gap) }));

    key.innerHTML = FEDERAL.map((o) => `<span>${officeSwatch(o)}${officeName(o)}</span>`).join("")
      + `<span>${lineSwatch(false)}Votes</span><span>${lineSwatch(true)}${st.area === NATIONAL ? "Seats" : "Seats, electors"}</span>`;
    drawLines(marginBox, points, margins, [st.from, st.to], 0.2, "Democratic minus Republican share of votes and seats by office and year", onYear);
    drawLines(gapBox, points, gaps, [st.from, st.to], 0.05, "Seat gap in points by office and year", onYear);
  }

  const renderList = (sort: SummaryState["sort"]) => drawList(listBox, summary, st.from, st.to, sort, (s) => {
    onChange({ ...st, sort: s }, true);
    renderList(s);
  }, (area) => {
    onChange({ ...st, area });
    window.scrollTo(0, 0);
  });
  renderList(st.sort);
}

function lineSwatch(dashed: boolean): string {
  const ink = cssVar("--text-2");
  return `<svg width="22" height="12"><line x1="1" x2="21" y1="6" y2="6" stroke="${ink}" stroke-width="2"${
    dashed ? ` stroke-dasharray="4 3"` : ""}/></svg>`;
}

const axisFormat = (v: number) => (v === 0 ? "Even" : formatMargin(v, 0));

function drawLines(
  box: HTMLElement, points: SummaryPoint[], series: Series[], [from, to]: [number, number],
  floor: number, aria: string, onYear: (year: number) => void,
): void {
  const width = 960;
  const height = 320;
  const m = { top: 14, right: 96, bottom: 28, left: 52 };
  const surface = cssVar("--bg");
  const years = points.map((p) => p.year);
  const drawn = series.filter((s) => s.points.length);

  const x = d3.scalePoint<number>().domain(years).range([m.left, width - m.right]).padding(0.5);
  const ext = d3.max(drawn, (s) => d3.max(s.points, (p) => Math.abs(p.value))) ?? 0;
  const e = Math.min(1, Math.max(ext * 1.1, floor));
  const y = d3.scaleLinear().domain([-e, e]).nice().range([height - m.bottom, m.top]);

  const svg = d3.select(box).append("svg")
    .attr("class", "chart")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", aria);

  const ticks = y.ticks(6);
  svg.append("g").attr("class", "grid").selectAll("line").data(ticks).join("line")
    .attr("x1", m.left).attr("x2", width - m.right)
    .attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left - 6},0)`)
    .call(d3.axisLeft(y).tickValues(ticks).tickFormat((d) => axisFormat(+d)).tickSize(0));
  const every = years.length > 16 ? 2 : 1;
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom + 8})`)
    .call(d3.axisBottom(x).tickValues(years.filter((_, i) => i % every === 0))
      .tickFormat((d) => String(d)).tickSize(0));
  svg.append("line").attr("stroke", cssVar("--muted"))
    .attr("x1", m.left).attr("x2", width - m.right).attr("y1", y(0)).attr("y2", y(0));

  // The years listed below, as a band behind the lines.
  const inRange = years.filter((y) => y >= from && y <= to);
  if (inRange.length) {
    const left = x(inRange[0])! - x.step() / 2;
    svg.append("rect").attr("fill", cssVar("--mid"))
      .attr("x", left).attr("width", x(inRange[inRange.length - 1])! + x.step() / 2 - left)
      .attr("y", m.top).attr("height", height - m.top - m.bottom);
  }

  const g = svg.append("g");
  for (const s of drawn) {
    const color = officeColor(s.office);
    const line = d3.line<Series["points"][number]>().x((p) => x(p.year)!).y((p) => y(p.value));
    g.append("path").attr("d", line(s.points)).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2)
      .attr("stroke-dasharray", s.seats ? "5 4" : null);
    g.append("g").selectAll("path").data(s.points).join("path")
      .attr("d", d3.symbol(SYMBOL[s.office], s.seats ? 44 : 64))
      .attr("transform", (p) => `translate(${x(p.year)},${y(p.value)})`)
      .attr("fill", s.seats ? surface : color).attr("stroke", s.seats ? color : surface).attr("stroke-width", 2);
  }

  const ends = drawn.map((s) => s.points[s.points.length - 1]);
  const labelYs = spreadLabels(ends.map((p) => y(p.value)), 14);
  drawn.forEach((s, i) => {
    svg.append("text")
      .attr("x", x(years[years.length - 1])! + 12).attr("y", labelYs[i])
      .attr("dy", "0.35em").attr("font-size", 12).attr("fill", cssVar("--text-2"))
      .text(s.label);
  });

  svg.append("g").selectAll("rect").data(points).join("rect")
    .attr("x", (p) => x(p.year)! - x.step() / 2).attr("width", x.step())
    .attr("y", m.top).attr("height", height - m.top - m.bottom)
    .attr("fill", "transparent").style("cursor", "pointer")
    .on("mousemove", (event: MouseEvent, p) => showTip(tipHtml(p), event.clientX, event.clientY))
    .on("mouseleave", hideTip)
    .on("click", (_, p) => { hideTip(); onYear(p.year); });
}

function tipHtml(p: SummaryPoint): string {
  const rows = FEDERAL.flatMap((o) => {
    const r = p.rows[o];
    return r ? [`<div class="row"><span>${officeSwatch(o)} ${officeName(o)}</span><span></span></div>`
      + `<div class="row"><span>Votes</span><span>${formatMargin(voteMargin(r))}</span></div>`
      + `<div class="row"><span>${o === "president" ? "Electors" : "Seats"}</span><span>${formatSeats(r.seats) || "-"}</span></div>`
      + `<div class="row"><span>Seat gap</span><span>${formatGap(r.gap)} pts</span></div>`] : [];
  });
  return `<b>${p.year}</b>` + rows.join("");
}

const COLUMN_LABEL: Record<Column, (o: Federal) => string> = {
  votes: () => "Votes",
  seats: (o) => (o === "president" ? "Electors" : "Seats"),
  gap: () => "Gap, pts",
  seatGap: () => "Gap, seats",
};

function cell(row: Row | undefined, column: Column): string {
  if (!row) return `<span class="muted">-</span>`;
  switch (column) {
    case "votes": return formatMargin(voteMargin(row));
    case "seats": return `<span title="${formatMargin(seatMargin(row))}">${formatSeats(row.seats) || "-"}</span>`;
    case "gap": return formatGap(row.gap);
    case "seatGap": return formatSeatGap(row.seatGap);
  }
}

/**
 * The vote margin shades by its size, both gaps by the gap in points, so a big state's seats don't swamp it.
 * Seats stay plain: winner-take-all electors and a state's senators would be solid colour.
 */
export function tint(row: Row | undefined, column: Column): string {
  if (!row) return "";
  switch (column) {
    case "votes": return shade(voteMargin(row), SHADE.votes);
    case "seats": return "";
    case "gap":
    case "seatGap": return shade(row.gap, SHADE.gap);
  }
}

function drawList(
  box: HTMLElement, summary: Summary, from: number, to: number, sort: SummaryState["sort"],
  onSort: (s: SummaryState["sort"]) => void, onArea: (area: string) => void,
): void {
  const { national, states } = stateLines(summary, from, to);
  const sorted = sortLines(states, sort.key, sort.descending);
  const offices = FEDERAL.filter((o) => national.rows[o]);
  const th = (k: SummaryKey, label: string, cls = "") => {
    const aria = k === sort.key ? (sort.descending ? "descending" : "ascending") : "none";
    return `<th scope="col" class="${cls}" aria-sort="${aria}"><button data-key="${k}">${label}</button></th>`;
  };
  const groups = `<tr><th></th>${offices.map((o) =>
    `<th scope="colgroup" colspan="${COLUMNS[o].length}" class="group">${officeSwatch(o)} ${officeName(o)}</th>`).join("")}</tr>`;
  const cols = `<tr>${th("name", "State")}${offices.map((o) =>
    COLUMNS[o].map((c, i) => th(`${o}:${c}`, COLUMN_LABEL[c](o), i === 0 ? "first" : "")).join("")).join("")}</tr>`;
  const line = (l: StateLine, cls = "") => `<tr class="${cls}"><td>${l.po === NATIONAL ? l.name
    : `<a href="#" data-area="${l.po}">${escapeHtml(l.name)}</a>`}</td>${offices.map((o) =>
    COLUMNS[o].map((c, i) => `<td${i === 0 ? ` class="first"` : ""}${tint(l.rows[o], c)}>${cell(l.rows[o], c)}</td>`).join("")).join("")}</tr>`;

  box.innerHTML = `<div class="table-wrap"><table class="summary-table">
    <thead>${groups}${cols}</thead>
    <tbody>${line(national, "national")}${sorted.map((l) => line(l)).join("")}</tbody>
  </table></div>`;

  box.querySelectorAll<HTMLButtonElement>("th button").forEach((b) => {
    b.addEventListener("click", () => {
      const key = b.dataset.key as SummaryKey;
      onSort(key === sort.key ? { key, descending: !sort.descending } : { key, descending: key !== "name" });
    });
  });
  box.querySelectorAll<HTMLAnchorElement>("a[data-area]").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      onArea(a.dataset.area!);
    });
  });
}
