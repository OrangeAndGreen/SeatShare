// A state's page: Democratic share of votes and seats across the years and offices,
// a table of every election, and the House districts for one year.

import * as d3 from "d3";
import {
  formatGap, formatSeatGap, formatSeats, makeRow, pct, shares, type District, type Row, type StateInfo, type Summary,
} from "./shares";
import { cssVar, escapeHtml, hideTip, partyColor, select, showTip } from "./ui";

interface YearPoint {
  year: number;
  house?: Row;
  president?: Row;
}

export function yearPoints(summary: Summary, po: string): YearPoint[] {
  const years = new Set([...summary.offices.house, ...summary.offices.president]);
  return [...years].sort((a, b) => a - b).map((year) => {
    const h = summary.results.house[year]?.[po];
    const p = summary.results.president[year]?.[po];
    return {
      year,
      house: h ? makeRow(po, "", h) : undefined,
      president: p ? makeRow(po, "", p) : undefined,
    };
  });
}

export function drawState(
  container: HTMLElement,
  summary: Summary,
  state: StateInfo,
  districtYear: number,
  loadDistricts: (year: number) => Promise<Record<string, District[]>>,
  onYear: (year: number) => void,
): void {
  const points = yearPoints(summary, state.po);
  const hasHouse = points.some((p) => p.house);

  container.innerHTML = `
    <a class="back" href="#/">← All states</a>
    <h1 class="state-title">${escapeHtml(state.name)}</h1>
    <p class="note"><a href="#/trends?area=${state.po}">See ${escapeHtml(state.name)} over time</a></p>
    <h2>Democratic share of votes and seats</h2>
    <p class="note">Each year: the share of the House vote won by Democrats and the share of House seats they took,
      joined by a line. Presidential vote share is shown for comparison. Republicans are roughly the rest.</p>
    <div class="series-key"></div>
    <div class="chart-box"></div>
    <h2>Every election</h2>
    <div class="years"></div>
    ${hasHouse ? `<h2>House districts</h2><div class="controls district-controls"></div><div class="districts"></div>` : ""}`;

  drawChart(container.querySelector(".chart-box")!, container.querySelector(".series-key")!, points);
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

function drawChart(box: HTMLElement, key: HTMLElement, points: YearPoint[]): void {
  const width = 960;
  const height = 320;
  const m = { top: 12, right: 12, bottom: 28, left: 44 };
  const dem = cssVar("--dem");
  const ink = cssVar("--text-2");
  const surface = cssVar("--bg");

  key.innerHTML = [
    `<span><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="${dem}"/></svg>House votes</span>`,
    `<span><svg width="12" height="12"><circle cx="6" cy="6" r="4" fill="${surface}" stroke="${dem}" stroke-width="2"/></svg>House seats</span>`,
    `<span><svg width="12" height="12"><rect x="2" y="2" width="8" height="8" fill="${ink}" transform="rotate(45 6 6)"/></svg>President votes</span>`,
  ].join("");

  const x = d3.scalePoint<number>().domain(points.map((p) => p.year)).range([m.left, width - m.right]).padding(0.5);
  const y = d3.scaleLinear().domain([0, 1]).range([height - m.bottom, m.top]);

  const svg = d3.select(box).append("svg")
    .attr("class", "chart")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", "Democratic share of House votes, House seats and presidential votes by year");

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

  const house = points.filter((p) => p.house);
  const g = svg.append("g");
  g.selectAll("line.gap").data(house).join("line")
    .attr("x1", (p) => x(p.year)!).attr("x2", (p) => x(p.year)!)
    .attr("y1", (p) => y(p.house!.voteShare.D)).attr("y2", (p) => y(p.house!.seatShare.D))
    .attr("stroke", (p) => partyColor(p.house!.gap >= 0 ? "D" : "R"))
    .attr("stroke-width", 2);
  g.selectAll("circle.votes").data(house).join("circle")
    .attr("cx", (p) => x(p.year)!).attr("cy", (p) => y(p.house!.voteShare.D))
    .attr("r", 5).attr("fill", dem).attr("stroke", surface).attr("stroke-width", 2);
  g.selectAll("circle.seats").data(house).join("circle")
    .attr("cx", (p) => x(p.year)!).attr("cy", (p) => y(p.house!.seatShare.D))
    .attr("r", 4.5).attr("fill", surface).attr("stroke", dem).attr("stroke-width", 2);
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
  if (p.president) {
    rows.push(["President", `D ${pct(p.president.voteShare.D)} · R ${pct(p.president.voteShare.R)}`]);
  }
  return `<b>${p.year}</b>` + rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join("");
}

function drawYears(box: HTMLElement, points: YearPoint[], summary: Summary): void {
  const cell = (r: Row | undefined, f: (r: Row) => string) => (r ? f(r) : `<span class="muted">-</span>`);
  const body = [...points].reverse().map((p) => {
    const nominees = summary.nominees[p.year];
    const presWinner = p.president
      ? (p.president.seats.D >= p.president.seats.R ? nominees?.D : nominees?.R) ?? ""
      : "";
    return `<tr>
      <td>${p.year}</td>
      <td>${cell(p.house, (r) => `${pct(r.voteShare.D)} / ${pct(r.voteShare.R)}`)}</td>
      <td>${cell(p.house, (r) => formatSeats(r.seats))}</td>
      <td>${cell(p.house, (r) => formatGap(r.gap))}</td>
      <td>${cell(p.house, (r) => formatSeatGap(r.seatGap))}</td>
      <td>${cell(p.house, (r) => (r.uncontested ? String(r.uncontested) : ""))}</td>
      <td>${cell(p.president, (r) => `${pct(r.voteShare.D)} / ${pct(r.voteShare.R)}`)}</td>
      <td>${cell(p.president, (r) => `${formatSeats(r.seats)} <span class="muted">${escapeHtml(presWinner)}</span>`)}</td>
    </tr>`;
  }).join("");
  box.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th scope="col">Year</th><th scope="col">House votes D / R</th><th scope="col">House seats</th>
      <th scope="col">Gap, points</th><th scope="col">Gap, seats</th><th scope="col">Uncontested</th>
      <th scope="col">President D / R</th><th scope="col">Electors</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
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
