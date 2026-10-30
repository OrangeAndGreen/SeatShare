// A state's page: Democratic share of votes and seats across the years and offices,
// a table of every election, and the House districts for one year.

import * as d3 from "d3";
import {
  formatGap, formatSeatGap, formatSeats, makeRow, margin, pct, shares, votesUnreliable,
  type District, type Row, type SenateRace, type StateInfo, type Summary,
} from "./shares";
import { cssVar, escapeHtml, hideTip, partyColor, select, shade, SHADE, showTip } from "./ui";

export interface YearPoint {
  year: number;
  house?: Row;
  senate?: Row;
  senateRaces?: SenateRace[];
  president?: Row;
  statehouse?: Row;
  statesenate?: Row;
}

/** The chambers the chart can draw as votes against seats. */
export type ChartChamber = "house" | "statehouse" | "statesenate";

export const CHART_CHAMBERS: { value: ChartChamber; text: string }[] = [
  { value: "house", text: "US House" },
  { value: "statehouse", text: "State House" },
  { value: "statesenate", text: "State Senate" },
];

export function isChartChamber(v: string | null | undefined): v is ChartChamber {
  return CHART_CHAMBERS.some((c) => c.value === v);
}

/** The chambers a state has results for, in menu order. */
export function chartChambers(points: YearPoint[]): ChartChamber[] {
  return CHART_CHAMBERS.map((c) => c.value).filter((c) => points.some((p) => p[c]));
}

/** The vote share drawn for a chamber in a year, or none when most of its seats have no votes. */
export function chartVotes(row: Row): number | undefined {
  return votesUnreliable(row) ? undefined : row.voteShare.D;
}

export function yearPoints(summary: Summary, po: string): YearPoint[] {
  const years = new Set(Object.values(summary.offices).flat());
  return [...years].sort((a, b) => a - b).map((year) => {
    const h = summary.results.house[year]?.[po];
    const s = summary.results.senate[year]?.[po];
    const p = summary.results.president[year]?.[po];
    const sh = summary.results.statehouse[year]?.[po];
    const ss = summary.results.statesenate[year]?.[po];
    return {
      year,
      house: h ? makeRow(po, "", h) : undefined,
      senate: s ? makeRow(po, "", s) : undefined,
      senateRaces: s?.races,
      president: p ? makeRow(po, "", p) : undefined,
      statehouse: sh ? makeRow(po, "", sh) : undefined,
      statesenate: ss ? makeRow(po, "", ss) : undefined,
    };
  });
}

export function drawState(
  container: HTMLElement,
  summary: Summary,
  state: StateInfo,
  districtYear: number,
  chamber: ChartChamber,
  loadDistricts: (year: number) => Promise<Record<string, District[]>>,
  onYear: (year: number) => void,
  onChamber: (chamber: ChartChamber) => void,
): void {
  const points = yearPoints(summary, state.po);
  const hasHouse = points.some((p) => p.house);
  const chambers = chartChambers(points);
  const shown = chambers.includes(chamber) ? chamber : chambers[0] ?? "house";
  const name = CHART_CHAMBERS.find((c) => c.value === shown)!.text;

  container.innerHTML = `
    <a class="back" href="#/">← All states</a>
    <h1 class="state-title">${escapeHtml(state.name)}</h1>
    <p class="note"><a href="#/trends?area=${state.po}">See ${escapeHtml(state.name)} over time</a></p>
    <h2>Democratic share of votes and seats</h2>
    <div class="controls chart-controls"></div>
    <p class="note">Each year: the share of the ${name} vote won by Democrats and the share of ${name} seats they took,
      joined by a line. US Senate and presidential vote shares are shown for comparison. Republicans are roughly the rest.${
      shown !== "house" ? " Where most seats had no votes recorded, only the seats are shown." : ""}${
      shown === "statesenate" ? " A senate with staggered terms counts only the seats up that year." : ""}</p>
    <div class="series-key"></div>
    <div class="chart-box"></div>
    <h2>Every election</h2>
    <div class="years"></div>
    ${hasHouse ? `<h2>House districts</h2><div class="controls district-controls"></div><div class="districts"></div>` : ""}`;

  if (chambers.length > 1) {
    container.querySelector(".chart-controls")!.append(
      select("Votes and seats for", CHART_CHAMBERS.filter((c) => chambers.includes(c.value)), shown, onChamber));
  }
  drawChart(container.querySelector(".chart-box")!, container.querySelector(".series-key")!, points, shown, name);
  drawYears(container.querySelector(".years")!, points, summary);

  if (hasHouse) {
    const years = summary.offices.house.filter((y) => summary.results.house[y]?.[state.po]).reverse();
    const year = years.includes(districtYear) ? districtYear : years[0];
    container.querySelector(".district-controls")!.append(
      select("Year", years.map((y) => ({ value: String(y), text: String(y) })), String(year),
        (v) => onYear(Number(v))),
    );
    const box = container.querySelector<HTMLElement>(".districts")!;
    box.innerHTML = `<p class="loading">Loading districts…</p>`;
    loadDistricts(year)
      .then((all) => drawDistricts(box, all[state.po] ?? []))
      .catch(() => { box.innerHTML = `<p class="error">Could not load the ${year} districts.</p>`; });
  }
}

function drawChart(box: HTMLElement, key: HTMLElement, points: YearPoint[], chamber: ChartChamber, name: string): void {
  const width = 960;
  const height = 320;
  const m = { top: 12, right: 12, bottom: 28, left: 44 };
  const dem = cssVar("--dem");
  const ink = cssVar("--text-2");
  const surface = cssVar("--bg");

  key.innerHTML = [
    `<span><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="${dem}"/></svg>${name} votes</span>`,
    `<span><svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="${surface}" stroke="${dem}" stroke-width="2"/></svg>${name} seats</span>`,
    `<span><svg width="12" height="12"><path d="M6 1.5L11 10.5H1Z" fill="${surface}" stroke="${ink}" stroke-width="1.5"/></svg>Senate votes</span>`,
    `<span><svg width="12" height="12"><rect x="2" y="2" width="8" height="8" fill="${ink}" transform="rotate(45 6 6)"/></svg>President votes</span>`,
  ].join("");

  const x = d3.scalePoint<number>().domain(points.map((p) => p.year)).range([m.left, width - m.right]).padding(0.5);
  const y = d3.scaleLinear().domain([0, 1]).range([height - m.bottom, m.top]);

  const svg = d3.select(box).append("svg")
    .attr("class", "chart")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", `Democratic share of ${name} votes, ${name} seats, Senate votes and presidential votes by year`);

  svg.append("g").attr("class", "grid")
    .selectAll("line").data([0, 0.25, 0.75, 1]).join("line")
    .attr("x1", m.left).attr("x2", width - m.right)
    .attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
  svg.append("line").attr("class", "ref")
    .attr("x1", m.left).attr("x2", width - m.right).attr("y1", y(0.5)).attr("y2", y(0.5));

  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left - 6},0)`)
    .call(d3.axisLeft(y).tickValues([0, 0.25, 0.5, 0.75, 1]).tickFormat((d) => pct(+d, 0)).tickSize(0));
  const every = points.length > 16 ? 2 : 1;
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom + 8})`)
    .call(d3.axisBottom(x).tickValues(points.map((p) => p.year).filter((_, i) => i % every === 0))
      .tickFormat((d) => String(d)).tickSize(0));

  const pairs = points.filter((p) => p[chamber]).map((p) => ({ year: p.year, row: p[chamber]! }));
  const voted = pairs.filter((p) => chartVotes(p.row) !== undefined);
  const g = svg.append("g");
  g.selectAll("line.gap").data(voted).join("line")
    .attr("x1", (p) => x(p.year)!).attr("x2", (p) => x(p.year)!)
    .attr("y1", (p) => y(p.row.voteShare.D)).attr("y2", (p) => y(p.row.seatShare.D))
    .attr("stroke", (p) => partyColor(p.row.gap >= 0 ? "D" : "R"))
    .attr("stroke-width", 2);
  g.selectAll("circle.votes").data(voted).join("circle")
    .attr("cx", (p) => x(p.year)!).attr("cy", (p) => y(p.row.voteShare.D))
    .attr("r", 5).attr("fill", dem).attr("stroke", surface).attr("stroke-width", 2);
  g.selectAll("circle.seats").data(pairs).join("circle")
    .attr("cx", (p) => x(p.year)!).attr("cy", (p) => y(p.row.seatShare.D))
    .attr("r", 4.5).attr("fill", surface).attr("stroke", dem).attr("stroke-width", 2);
  g.selectAll("path.senate").data(points.filter((p) => p.senate)).join("path")
    .attr("d", "M0,-5L5,4H-5Z")
    .attr("transform", (p) => `translate(${x(p.year)},${y(p.senate!.voteShare.D)})`)
    .attr("fill", surface).attr("stroke", ink).attr("stroke-width", 1.5);
  g.selectAll("rect.pres").data(points.filter((p) => p.president)).join("rect")
    .attr("x", -4).attr("y", -4).attr("width", 8).attr("height", 8)
    .attr("transform", (p) => `translate(${x(p.year)},${y(p.president!.voteShare.D)}) rotate(45)`)
    .attr("fill", ink).attr("stroke", surface).attr("stroke-width", 1.5);

  // One hover column per year, wider than the marks.
  const band = x.step();
  svg.append("g").selectAll("rect").data(points).join("rect")
    .attr("x", (p) => x(p.year)! - band / 2).attr("width", band)
    .attr("y", m.top).attr("height", height - m.top - m.bottom)
    .attr("fill", "transparent")
    .on("mousemove", (event: MouseEvent, p) => showTip(yearTip(p), event.clientX, event.clientY))
    .on("mouseleave", hideTip);
}

function yearTip(p: YearPoint): string {
  const rows: [string, string][] = [];
  if (p.house) {
    rows.push(["House votes", `D ${pct(p.house.voteShare.D)} · R ${pct(p.house.voteShare.R)}`]);
    rows.push(["House seats", formatSeats(p.house.seats)]);
    rows.push(["Seat gap", `${formatGap(p.house.gap)} pts · ${formatSeatGap(p.house.seatGap)} seats`]);
  }
  if (p.senate) {
    rows.push(["Senate votes", `D ${pct(p.senate.voteShare.D)} · R ${pct(p.senate.voteShare.R)}`]);
    rows.push(["Senate", senateWinners(p.senateRaces)]);
  }
  if (p.president) {
    rows.push(["President", `D ${pct(p.president.voteShare.D)} · R ${pct(p.president.voteShare.R)}`]);
  }
  for (const [label, r] of [["State House", p.statehouse], ["State Senate", p.statesenate]] as const) {
    if (r) rows.push([label, `${formatSeats(r.seats)} · votes ${legislatureVotes(r)}`]);
  }
  return `<b>${p.year}</b>` + rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join("");
}

/** "Jon Ossoff (D); Raphael Warnock (D, special)". */
export function senateWinners(races: SenateRace[] | undefined): string {
  return (races ?? [])
    .map((r) => `${r.winner} (${r.party === "O" ? "Ind" : r.party}${r.special ? ", special" : ""})`)
    .join("; ");
}

function drawYears(box: HTMLElement, points: YearPoint[], summary: Summary): void {
  const cell = (r: Row | undefined, f: (r: Row) => string) => (r ? f(r) : `<span class="muted">-</span>`);
  // Cells shaded by their margin or gap, left plain where the votes are mostly missing.
  const td = (r: Row | undefined, f: (r: Row) => string, by?: "votes" | "gap") => {
    const value = !r || !by || votesUnreliable(r) ? 0 : by === "votes" ? margin(r.voteShare) : r.gap;
    return `<td${by ? shade(value, SHADE[by]) : ""}>${cell(r, f)}</td>`;
  };
  const body = [...points].reverse().map((p) => {
    const nominees = summary.nominees[p.year];
    const presWinner = p.president
      ? (p.president.seats.D >= p.president.seats.R ? nominees?.D : nominees?.R) ?? ""
      : "";
    return `<tr>
      <td>${p.year}</td>
      ${td(p.house, (r) => `${pct(r.voteShare.D)} / ${pct(r.voteShare.R)}`, "votes")}
      ${td(p.house, (r) => formatSeats(r.seats))}
      ${td(p.house, (r) => formatGap(r.gap), "gap")}
      ${td(p.house, (r) => formatSeatGap(r.seatGap), "gap")}
      ${td(p.house, (r) => (r.uncontested ? String(r.uncontested) : ""))}
      ${td(p.senate, (r) => `${pct(r.voteShare.D)} / ${pct(r.voteShare.R)}`, "votes")}
      <td style="text-align:left">${cell(p.senate, () => escapeHtml(senateWinners(p.senateRaces)))}</td>
      ${td(p.president, (r) => `${pct(r.voteShare.D)} / ${pct(r.voteShare.R)}`, "votes")}
      ${td(p.president, (r) => `${formatSeats(r.seats)} <span class="muted">${escapeHtml(presWinner)}</span>`)}
      ${td(p.statehouse, legislatureVotes, "votes")}
      ${td(p.statehouse, (r) => formatSeats(r.seats))}
      ${td(p.statehouse, legislatureGap, "gap")}
      ${td(p.statesenate, legislatureVotes, "votes")}
      ${td(p.statesenate, (r) => formatSeats(r.seats))}
      ${td(p.statesenate, legislatureGap, "gap")}
    </tr>`;
  }).join("");
  box.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th scope="col">Year</th><th scope="col">House votes D / R</th><th scope="col">House seats</th>
      <th scope="col">Gap, points</th><th scope="col">Gap, seats</th><th scope="col">Uncontested</th>
      <th scope="col">Senate D / R</th><th scope="col" style="text-align:left">Senate winner</th>
      <th scope="col">President D / R</th><th scope="col">Electors</th>
      <th scope="col">State House D / R</th><th scope="col">State House seats</th><th scope="col">Gap, seats</th>
      <th scope="col">State Senate D / R</th><th scope="col">State Senate seats up</th><th scope="col">Gap, seats</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

/** Vote share, or a dash with the reason when most seats have no votes recorded. */
export function legislatureVotes(r: Row): string {
  return votesUnreliable(r)
    ? `<span class="muted" title="${r.noVotes} of ${r.totalSeats} seats have no votes recorded">no votes</span>`
    : `${pct(r.voteShare.D)} / ${pct(r.voteShare.R)}`;
}

/** The gap in seats, greyed out when it rests on votes mostly missing. */
export function legislatureGap(r: Row): string {
  return votesUnreliable(r) ? `<span class="muted">${formatSeatGap(r.seatGap)}</span>` : formatSeatGap(r.seatGap);
}

function drawDistricts(box: HTMLElement, districts: District[]): void {
  if (!districts.length) {
    box.innerHTML = `<p class="note">No districts recorded.</p>`;
    return;
  }
  const body = districts.map((d) => {
    const s = shares(d.votes);
    const label = d.district === 0 ? "At large" : String(d.district);
    return `<tr>
      <td>${label}</td>
      <td style="text-align:left"><span class="dot" style="background:${partyColor(d.party)}"></span>${escapeHtml(d.winner)}
        <span class="muted">${d.party === "O" ? "Ind/other" : d.party}</span></td>
      <td>${pct(s.D)}</td><td>${pct(s.R)}</td><td>${pct(s.O)}</td>
      <td>${d.uncontested ? "Uncontested" : ""}</td>
    </tr>`;
  }).join("");
  box.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th scope="col">District</th><th scope="col" style="text-align:left">Winner</th>
      <th scope="col">D</th><th scope="col">R</th><th scope="col">Other</th><th scope="col"></th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}
