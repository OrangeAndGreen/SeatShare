// The "Party lines" tab: how often each member of Congress voted with their party,
// ranked, for one Congress and chamber, with each party's average over time.

import * as d3 from "d3";
import { pct } from "./shares";
import { cssVar, escapeHtml, hideTip, partyColor, select, showTip } from "./ui";
import {
  CHAMBERS, congressLabel, extremes, filterParty, firstDescending, ordinal, PARTY_FILTERS, rankMembers, scoredParty,
  sortMembers, type Chamber, type ChamberSummary, type CongressEntry, type Member, type RankedMember, type UnityIndex,
  type UnitySortKey, type UnityState,
} from "./unity-data";

const PARTY_NAME = { D: "Democrats", R: "Republicans" } as const;

interface Column {
  key: UnitySortKey | null;
  label: string;
  cell: (m: RankedMember) => string;
}

function partyCell(m: Member): string {
  const p = scoredParty(m);
  const dot = `<span class="dot" style="background:${p ? `var(--${p === "D" ? "dem" : "rep"})` : "var(--ind)"}"></span>`;
  return dot + (m.p === "I" ? `I${m.c ? ` (${m.c})` : ""}` : m.p);
}

function scoreBar(m: RankedMember): string {
  const p = scoredParty(m);
  return `<span class="bar" aria-hidden="true"><span style="width:${m.score * 100}%;background:${
    p ? `var(--${p === "D" ? "dem" : "rep"})` : "var(--ind)"}"></span><span style="width:${(1 - m.score) * 100}%;background:var(--line)"></span></span>`;
}

const COLUMNS: Column[] = [
  { key: null, label: "Rank", cell: (m) => (m.rank === null ? `<span class="muted" title="Too few party-unity votes to rank">-</span>` : String(m.rank)) },
  {
    key: "name", label: "Member",
    cell: (m) => `<a href="https://voteview.com/person/${m.id}" target="_blank" rel="noopener">${escapeHtml(m.n)}</a>`,
  },
  { key: "party", label: "Party", cell: partyCell },
  { key: "seat", label: "State", cell: (m) => escapeHtml(m.s) },
  { key: "votes", label: "Votes counted", cell: (m) => String(m.v) },
  { key: "breaks", label: "Breaks", cell: (m) => String(m.breaks) },
  {
    key: "score", label: "Party unity",
    cell: (m) => (m.rank === null ? `<span class="muted">${pct(m.score)}</span>` : pct(m.score)) + scoreBar(m),
  },
];

export function drawUnity(
  container: HTMLElement,
  index: UnityIndex,
  st: UnityState,
  load: (chamber: Chamber, congress: number) => Promise<Member[]>,
  onChange: (st: UnityState, redrawOnly?: boolean) => void,
): void {
  const congresses = index.congresses.filter((c) => c[st.chamber]);
  const entry = congresses.find((c) => c.congress === st.congress) ?? congresses[congresses.length - 1];
  const summary = entry[st.chamber]!;
  const chamberText = st.chamber === "house" ? "House" : "Senate";

  container.replaceChildren();
  const controls = document.createElement("div");
  controls.className = "controls";
  controls.append(
    select("Congress", [...congresses].reverse().map((c) => ({ value: String(c.congress), text: congressLabel(c) })),
      String(entry.congress), (v) => onChange({ ...st, congress: Number(v) })),
    select("Chamber", CHAMBERS, st.chamber, (chamber) => onChange({ ...st, chamber })),
    select("Party", PARTY_FILTERS, st.party, (party) => onChange({ ...st, party })),
  );

  const headline = document.createElement("div");
  headline.className = "headline";
  const intro = document.createElement("p");
  intro.className = "note";
  intro.innerHTML = `${summary.unityVotes} of the ${chamberText}'s ${summary.rollcalls} roll calls in the
    ${ordinal(entry.congress)} Congress (${entry.start}-${entry.end}) were <b>party-unity votes</b>, where most voting
    Democrats voted against most voting Republicans. A member's party unity is the share of those votes, of the ones
    they cast, where they voted with their own party's majority. Breaks are the votes against it.${
      inProgress(entry, summary) ? ` This Congress is still sitting; votes to ${summary.lastVote}.` : ""}`;
  const tableHead = document.createElement("div");
  tableHead.innerHTML = `<h2>Members by party unity</h2>
    <p class="note">Sort by any column. Independents are measured against the party they voted with more often, shown
    in brackets. Members who voted on fewer than ${summary.minVotes} of the party-unity votes (a quarter) are listed
    last and not ranked: they served part of the Congress, or seldom voted. A member who changed party appears once
    for each. Names link to the member's page on Voteview.</p>`;
  const tableBox = document.createElement("div");
  tableBox.innerHTML = `<p class="loading">Loading members…</p>`;
  const chartHead = document.createElement("div");
  chartHead.innerHTML = `<h2>Average party unity, ${chamberText}, ${index.congresses[0].start}-${
    index.congresses[index.congresses.length - 1].end}</h2>
    <p class="note">The mean score of each party's ranked members, by Congress. Click a Congress to see its members.</p>`;
  const key = document.createElement("div");
  key.className = "series-key";
  const chartBox = document.createElement("div");
  container.append(controls, headline, intro, tableHead, tableBox, chartHead, key, chartBox);

  drawChart(chartBox, key, congresses, st.chamber, entry.congress, (congress) => onChange({ ...st, congress }));

  const wanted = `${st.chamber}${entry.congress}`;
  container.dataset.unity = wanted;
  load(st.chamber, entry.congress).then((members) => {
    if (container.dataset.unity !== wanted) return; // a newer view replaced this one
    const ranked = rankMembers(members, summary.minVotes);
    drawHeadline(headline, ranked, summary);
    const drawTable = (s: UnityState) => {
      const rows = sortMembers(filterParty(ranked, s.party), s.sort.key, s.sort.descending);
      renderTable(tableBox, rows, s, (sort) => {
        const next = { ...s, sort };
        onChange(next, true);
        drawTable(next);
      });
    };
    drawTable(st);
  }).catch(() => {
    tableBox.innerHTML = `<p class="error">Could not load the ${chamberText} members for this Congress.</p>`;
  });
}

function inProgress(entry: CongressEntry, summary: ChamberSummary): boolean {
  return !!summary.lastVote && Number(summary.lastVote.slice(0, 4)) < entry.end
    && entry.end >= new Date().getFullYear();
}

function drawHeadline(box: HTMLElement, members: RankedMember[], summary: ChamberSummary): void {
  const names = (ms: RankedMember[]) => {
    const shown = ms.slice(0, 2).map((m) => escapeHtml(`${m.n} (${m.s})`)).join(", ");
    return ms.length > 2 ? `${shown} and ${ms.length - 2} more` : shown;
  };
  const stat = (k: string, v: string, s: string, cls = "") =>
    `<div class="stat${cls}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const avg = (p: "D" | "R") => (summary.average[p] === null ? "-" : pct(summary.average[p]!));
  let html = stat("Average party unity", `D ${avg("D")} · R ${avg("R")}`,
    `${summary.unityVotes} party-unity votes of ${summary.rollcalls}`, " wide");
  for (const p of ["D", "R"] as const) {
    const { least, most } = extremes(members, p);
    if (!least.length) continue;
    html += stat(`Least loyal of the ${PARTY_NAME[p]}`, pct(least[0].score),
      `${names(least)} · ${least[0].breaks} breaks in ${least[0].v}`);
    html += stat(`Most loyal of the ${PARTY_NAME[p]}`, pct(most[0].score),
      most.length > 2 ? `${most.length} members` : names(most));
  }
  box.innerHTML = html;
}

function renderTable(
  box: HTMLElement,
  rows: RankedMember[],
  st: UnityState,
  onSort: (sort: UnityState["sort"]) => void,
): void {
  const head = COLUMNS.map((c) => {
    if (!c.key) return `<th scope="col">${c.label}</th>`;
    const aria = c.key === st.sort.key ? (st.sort.descending ? "descending" : "ascending") : "none";
    return `<th scope="col" aria-sort="${aria}"><button data-key="${c.key}">${c.label}</button></th>`;
  }).join("");
  const body = rows.length
    ? rows.map((m) => `<tr${m.rank === null ? ` class="unranked"` : ""}>${COLUMNS.map((c) => `<td>${c.cell(m)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${COLUMNS.length}" class="muted">No members.</td></tr>`;
  box.innerHTML = `<div class="table-wrap unity-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  box.querySelectorAll<HTMLButtonElement>("th button").forEach((b) => {
    b.addEventListener("click", () => {
      const key = b.dataset.key as UnitySortKey;
      onSort(key === st.sort.key ? { key, descending: !st.sort.descending } : { key, descending: firstDescending(key) });
    });
  });
}

function drawChart(
  box: HTMLElement,
  key: HTMLElement,
  congresses: CongressEntry[],
  chamber: Chamber,
  current: number,
  onPick: (congress: number) => void,
): void {
  const width = 960;
  const height = 300;
  const m = { top: 14, right: 36, bottom: 28, left: 52 };
  const surface = cssVar("--bg");
  const points = congresses.filter((c) => c[chamber]);

  const x = d3.scaleBand<number>().domain(points.map((c) => c.congress))
    .range([m.left, width - m.right]).paddingInner(0.2).paddingOuter(0.1);
  const cx = (c: number) => x(c)! + x.bandwidth() / 2;
  const values = points.flatMap((c) => [c[chamber]!.average.D, c[chamber]!.average.R]).filter((v): v is number => v !== null);
  const low = Math.min(0.6, Math.floor((d3.min(values) ?? 0.6) * 20) / 20);
  const y = d3.scaleLinear().domain([low, 1]).range([height - m.bottom, m.top]);

  key.innerHTML = (["D", "R"] as const).map((p) =>
    `<span><svg width="12" height="12"><rect width="12" height="12" rx="6" fill="${partyColor(p)}"/></svg>${PARTY_NAME[p]}</span>`).join("");

  const svg = d3.select(box).append("svg")
    .attr("class", "chart")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img")
    .attr("aria-label", `Average party unity by Congress, ${chamber === "house" ? "House" : "Senate"}`);

  const ticks = y.ticks(5);
  svg.append("g").attr("class", "grid").selectAll("line").data(ticks).join("line")
    .attr("x1", m.left).attr("x2", width - m.right).attr("y1", (d) => y(d)).attr("y2", (d) => y(d));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${m.left - 6},0)`)
    .call(d3.axisLeft(y).tickValues(ticks).tickFormat((d) => pct(+d, 0)).tickSize(0));
  const every = Math.ceil(points.length / 14);
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - m.bottom + 8})`)
    .call(d3.axisBottom(x).tickValues(points.map((c) => c.congress).filter((_, i) => i % every === 0))
      .tickFormat((d) => String(congresses.find((c) => c.congress === d)?.start ?? d)).tickSize(0));

  // The chosen Congress, behind the lines.
  if (x(current) !== undefined) {
    svg.append("rect").attr("x", x(current)! - (x.step() - x.bandwidth()) / 2).attr("width", x.step())
      .attr("y", m.top).attr("height", height - m.top - m.bottom).attr("fill", cssVar("--mid"));
  }

  const g = svg.append("g");
  for (const p of ["D", "R"] as const) {
    const color = partyColor(p);
    const pts = points.filter((c) => c[chamber]!.average[p] !== null);
    const yOf = (c: CongressEntry) => y(c[chamber]!.average[p]!);
    const line = d3.line<CongressEntry>().x((c) => cx(c.congress)).y(yOf);
    g.append("path").attr("d", line(pts)).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2);
    g.append("g").selectAll("circle").data(pts).join("circle")
      .attr("cx", (c) => cx(c.congress)).attr("cy", yOf)
      .attr("r", (c) => (c.congress === current ? 5 : 3)).attr("fill", color)
      .attr("stroke", surface).attr("stroke-width", 1.5);
    const last = pts[pts.length - 1];
    if (last) {
      g.append("text").attr("x", cx(last.congress) + 8).attr("y", yOf(last)).attr("dy", "0.35em")
        .attr("font-size", 12).attr("fill", cssVar("--text-2")).text(p);
    }
  }

  svg.append("g").selectAll("rect").data(points).join("rect")
    .attr("x", (c) => x(c.congress)! - (x.step() - x.bandwidth()) / 2).attr("width", x.step())
    .attr("y", m.top).attr("height", height - m.top - m.bottom)
    .attr("fill", "transparent").style("cursor", "pointer")
    .on("mousemove", (event: MouseEvent, c) => showTip(tipHtml(c, c[chamber]!), event.clientX, event.clientY))
    .on("mouseleave", hideTip)
    .on("click", (_, c) => { hideTip(); onPick(c.congress); });
}

function tipHtml(c: CongressEntry, s: ChamberSummary): string {
  const avg = (p: "D" | "R") => (s.average[p] === null ? "-" : pct(s.average[p]!));
  const rows: [string, string][] = [
    ["Democrats", avg("D")],
    ["Republicans", avg("R")],
    ["Party-unity votes", `${s.unityVotes} of ${s.rollcalls} (${pct(s.rollcalls ? s.unityVotes / s.rollcalls : 0, 0)})`],
  ];
  return `<b>${escapeHtml(congressLabel(c))}</b>` + rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join("");
}
