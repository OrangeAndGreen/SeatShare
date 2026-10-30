import "./style.css";
import { drawCurrent, type CurrentState } from "./current";
import { isCurrentKey } from "./current-data";
import { drawList, SORT_KEYS, type ListState } from "./list";
import { COLOR_BY, drawMap, type ColorBy } from "./map";
import {
  buildRows, isLegislature, isOffice, OFFICES, formatGap, formatSeatGap, formatSeats, NATIONAL, nationalRow, pct, type District, type Office, type Row, type SortKey, type Summary,
} from "./shares";
import { drawState, isChartChamber, type ChartChamber } from "./state";
import { drawSummary, type SummaryState } from "./summary";
import { isSummaryKey, summaryYears } from "./summary-data";
import {
  COMPARE, formatOffices, isCompareMetric, METRICS, parseOffices, trendYears, type Metric,
} from "./trend-data";
import { drawTrends, type TrendState } from "./trends";
import { escapeHtml, select } from "./ui";
import { drawUnity } from "./unity";
import { chamberFile, readUnityParams, unityHash, type Chamber, type Member, type UnityIndex, type UnityState } from "./unity-data";

const app = document.getElementById("app")!;
const tabs = document.getElementById("tabs")!;
const dataUrl = (path: string) => `${import.meta.env.BASE_URL}data/${path}`;

let summary: Summary;
const districtCache = new Map<number, Promise<Record<string, District[]>>>();

// View state, mirrored in the URL hash: #/house/2024?by=gap&sort=gap-desc, #/state/MA/2024?chart=statehouse,
// #/summary?area=US&from=2016&to=2024&sort=house:seatGap-desc,
// #/current?sort=senate:votes-desc, #/trends?office=house&area=US&metric=seatGap&from=1976&to=2024, #/unity?congress=118&chamber=house&sort=score-desc
let office: Office = "house";
let year = 2024;
let colorBy: ColorBy = "seatGap";
let sort: ListState = { key: "seatGap", descending: true };
let chartChamber: ChartChamber = "house";
let trend: TrendState = { office: "house", offices: parseOffices(null), area: NATIONAL, metric: "seatGap", from: 1976, to: 2024 };
let overall: SummaryState = { area: NATIONAL, from: 0, to: 0, sort: { key: "house:seatGap", descending: true } };
let current: CurrentState = { sort: { key: "name", descending: false } };
let unity: UnityState = { congress: 0, chamber: "house", party: "all", sort: { key: "score", descending: true } };

// Party-line voting is a separate data set, loaded the first time its tab opens.
let unityIndex: Promise<UnityIndex> | undefined;
const unityCache = new Map<string, Promise<Member[]>>();

function loadJson<T>(path: string): Promise<T> {
  return fetch(dataUrl(path)).then((r) => {
    if (!r.ok) throw new Error(r.statusText);
    return r.json() as Promise<T>;
  });
}

function loadUnityIndex(): Promise<UnityIndex> {
  unityIndex ??= loadJson<UnityIndex>("unity/index.json").catch((e) => {
    unityIndex = undefined;
    throw e;
  });
  return unityIndex;
}

function loadUnityMembers(chamber: Chamber, congress: number): Promise<Member[]> {
  const file = chamberFile(chamber, congress);
  if (!unityCache.has(file)) unityCache.set(file, loadJson<Member[]>(file));
  return unityCache.get(file)!;
}

function unityTabHash(): string {
  return unity.congress ? unityHash(unity) : "#/unity";
}

function loadDistricts(y: number): Promise<Record<string, District[]>> {
  if (!districtCache.has(y)) {
    districtCache.set(y, fetch(dataUrl(`house/${y}.json`)).then((r) => {
      if (!r.ok) throw new Error(r.statusText);
      return r.json();
    }));
  }
  return districtCache.get(y)!;
}

function overviewHash(): string {
  return `#/${office}/${year}?by=${colorBy}&sort=${sort.key}-${sort.descending ? "desc" : "asc"}`;
}

function trendHash(t: TrendState): string {
  const offices = t.office === COMPARE ? formatOffices(t.offices) : "";
  return `#/trends?office=${t.office}${offices ? `&offices=${offices}` : ""}&area=${t.area}&metric=${t.metric}`
    + `&from=${t.from}&to=${t.to}`;
}

function summaryHash(s: SummaryState): string {
  return `#/summary?area=${s.area}&from=${s.from}&to=${s.to}&sort=${s.sort.key}-${s.sort.descending ? "desc" : "asc"}`;
}

function currentHash(c: CurrentState): string {
  return `#/current?sort=${c.sort.key}-${c.sort.descending ? "desc" : "asc"}`;
}

function go(hash: string): void {
  if (location.hash === hash) render();
  else location.hash = hash;
}

type Route = { view: "overview" } | { view: "summary" } | { view: "current" } | { view: "trends" } | { view: "unity"; query: string }
  | { view: "state"; po: string; year?: number };

function readHash(): Route {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "trends") {
    readTrendParams(new URLSearchParams(query));
    return { view: "trends" };
  }
  if (parts[0] === "summary") {
    readSummaryParams(new URLSearchParams(query));
    return { view: "summary" };
  }
  if (parts[0] === "current") {
    const s = new URLSearchParams(query).get("sort")?.match(/^([\w:]+)-(asc|desc)$/);
    if (s && isCurrentKey(s[1])) current = { sort: { key: s[1], descending: s[2] === "desc" } };
    return { view: "current" };
  }
  if (parts[0] === "unity") return { view: "unity", query };
  if (parts[0] === "state" && parts[1]) {
    const chart = new URLSearchParams(query).get("chart");
    chartChamber = isChartChamber(chart) ? chart : "house";
    return { view: "state", po: parts[1].toUpperCase(), year: parts[2] ? Number(parts[2]) : undefined };
  }
  if (isOffice(parts[0])) office = parts[0];
  const years = summary.offices[office];
  const y = Number(parts[1]);
  year = years.includes(y) ? y : years.includes(year) ? year : years[years.length - 1];
  const params = new URLSearchParams(query);
  const by = params.get("by");
  if (by && COLOR_BY.some((c) => c.value === by)) colorBy = by as ColorBy;
  const s = params.get("sort")?.match(/^(\w+)-(asc|desc)$/);
  if (s && SORT_KEYS.includes(s[1] as SortKey)) sort = { key: s[1] as SortKey, descending: s[2] === "desc" };
  return { view: "overview" };
}

function readSummaryParams(params: URLSearchParams): void {
  const area = params.get("area")?.toUpperCase();
  if (area && (area === NATIONAL || summary.states.some((s) => s.po === area))) overall.area = area;
  const years = summaryYears(summary);
  const pick = (v: number, kept: number) => (years.includes(v) ? v : years.includes(kept) ? kept : years[years.length - 1]);
  const from = pick(Number(params.get("from")), overall.from);
  const to = pick(Number(params.get("to")), overall.to);
  [overall.from, overall.to] = from <= to ? [from, to] : [to, from];
  const s = params.get("sort")?.match(/^([\w:]+)-(asc|desc)$/);
  if (s && isSummaryKey(s[1])) overall.sort = { key: s[1], descending: s[2] === "desc" };
}

function readTrendParams(params: URLSearchParams): void {
  const o = params.get("office") ?? undefined;
  if (isOffice(o) || o === COMPARE) trend.office = o;
  trend.offices = parseOffices(params.get("offices"));
  const area = params.get("area")?.toUpperCase();
  if (area && (area === NATIONAL || summary.states.some((s) => s.po === area))) trend.area = area;
  const metric = params.get("metric");
  if (metric && METRICS.some((m) => m.value === metric)) trend.metric = metric as Metric;
  if (trend.office === COMPARE && !isCompareMetric(trend.metric)) trend.metric = "gap";
  const years = trendYears(summary, trend.office, trend.offices);
  const from = Number(params.get("from"));
  const to = Number(params.get("to"));
  trend.from = years.includes(from) ? from : years.includes(trend.from) ? trend.from : years[0];
  trend.to = years.includes(to) ? to : years.includes(trend.to) ? trend.to : years[years.length - 1];
}

function renderTabs(route: Route): void {
  const tab = (href: string, text: string, current: boolean) =>
    `<a href="${href}"${current ? ` aria-current="page"` : ""}>${text}</a>`;
  tabs.innerHTML = tab(overviewHash(), "By election", route.view === "overview")
    + tab(summaryHash(overall.to ? overall : { ...overall, from: summaryYears(summary).at(-1)!, to: summaryYears(summary).at(-1)! }), "Summary", route.view === "summary")
    + tab(currentHash(current), "Current", route.view === "current")
    + tab(trendHash(trend), "Over time", route.view === "trends")
    + tab(unityTabHash(), "Party lines", route.view === "unity");
}

function render(): void {
  const route = readHash();
  renderTabs(route);
  if (route.view === "trends") {
    document.title = "Over time - SeatShare";
    drawTrends(app, summary, trend, (t) => go(trendHash(t)));
    return;
  }
  if (route.view === "summary") {
    document.title = "Summary - SeatShare";
    drawSummary(app, summary, overall, (s, redrawOnly) => {
      overall = s;
      if (redrawOnly) history.replaceState(null, "", summaryHash(s));
      else go(summaryHash(s));
    });
    return;
  }
  if (route.view === "current") {
    document.title = "Current - SeatShare";
    drawCurrent(app, summary, current, (c) => {
      current = c;
      history.replaceState(null, "", currentHash(c));
    });
    return;
  }
  if (route.view === "unity") {
    document.title = "Party lines - SeatShare";
    renderUnity(route.query);
    return;
  }
  if (route.view === "state") {
    const state = summary.states.find((s) => s.po === route.po);
    if (!state) {
      app.innerHTML = `<p class="error">No state "${escapeHtml(route.po)}". <a href="#/">All states</a></p>`;
      return;
    }
    document.title = `${state.name} - SeatShare`;
    const houseYears = summary.offices.house;
    const year = route.year ?? houseYears[houseYears.length - 1];
    const stateHash = (y: number, chamber: ChartChamber) =>
      `#/state/${state.po}/${y}${chamber === "house" ? "" : `?chart=${chamber}`}`;
    drawState(app, summary, state, year, chartChamber, loadDistricts,
      (y) => go(stateHash(y, chartChamber)), (chamber) => go(stateHash(year, chamber)));
    window.scrollTo(0, 0);
    return;
  }
  document.title = "SeatShare";
  renderOverview();
}

function renderOverview(): void {
  const results = summary.results[office][year] ?? {};
  const rows = buildRows(summary.states, results);
  const national = nationalRow(rows);
  const fips = Object.fromEntries(summary.states.map((s) => [s.po, s.fips]));
  const seatWord = office !== "president" ? "seats" : "electoral votes";
  const nominees = summary.nominees[year] ?? {};

  app.replaceChildren();
  const controls = document.createElement("div");
  controls.className = "controls";
  controls.append(
    select("Office", OFFICES, office, (v) => {
      office = v;
      if (!summary.offices[office].includes(year)) year = nearest(summary.offices[office], year);
      go(overviewHash());
    }),
    select("Year", [...summary.offices[office]].reverse().map((y) => ({ value: String(y), text: String(y) })),
      String(year), (v) => { year = Number(v); go(overviewHash()); }),
  );

  const headline = document.createElement("div");
  headline.className = "headline";
  const names = office === "president" && nominees.D
    ? `<div class="s">${escapeHtml(nominees.D)} (D) · ${escapeHtml(nominees.R ?? "")} (R)</div>` : "";
  headline.innerHTML = `
    <div class="stat"><div class="k">Share of the vote</div>
      <div class="v">D ${pct(national.voteShare.D)} · R ${pct(national.voteShare.R)}</div>${names}</div>
    <div class="stat"><div class="k">Share of ${seatWord}</div>
      <div class="v">D ${pct(national.seatShare.D)} · R ${pct(national.seatShare.R)}</div>
      <div class="s">${formatSeats(national.seats)} of ${national.totalSeats}</div></div>
    <div class="stat"><div class="k">Seat gap, nationally</div>
      <div class="v">${formatSeatGap(national.seatGap)} ${seatWord}</div>
      <div class="s">${formatGap(national.gap)} points of ${seatWord} beyond vote share</div></div>`;

  const mapHead = document.createElement("div");
  mapHead.innerHTML = `<h2>Map</h2>`;
  const mapControls = document.createElement("div");
  mapControls.className = "controls";
  mapControls.append(select("Colour by", COLOR_BY, colorBy, (v) => { colorBy = v; go(overviewHash()); }));
  const mapNote = document.createElement("p");
  mapNote.className = "note";
  mapNote.textContent = (colorBy === "seatGap"
    ? `Seat gap in ${seatWord}: how many more ${seatWord} a party won than a split in proportion to the vote would give it. `
    : colorBy === "gap"
      ? `Seat gap in points: how far a party's share of ${seatWord} ran ahead of its share of the vote. `
      : "") + (office === "senate" ? "Hatched states had no Senate race that year. " : "")
    + (isLegislature(office)
      ? "Hatched: no partisan election (Nebraska's legislature is nonpartisan; Louisiana isn't in yet), or, "
        + "except when colouring by seats, more than half the seats up had no votes recorded. "
      : "")
    + "Click a state for its history.";
  const mapBox = document.createElement("div");
  mapBox.className = "map-wrap";

  const listHead = document.createElement("div");
  listHead.innerHTML = `<h2>Vote share against ${office !== "president" ? "seat" : "elector"} share</h2>
    <p class="note">Sort by any column; the gaps sort by size, whichever party they favour. The gap in points is
    half the difference between the two parties' over- or under-representation. The gap in ${seatWord} is that times
    the state's ${seatWord}: how many a party won beyond a split in proportion to the vote.${office === "president"
      ? " Electors go almost entirely to the statewide winner, so every state's gap is large."
      : office === "senate"
        ? " Only states with a race that year are listed. With one seat up, the winner takes it all, so a state's gap is large; the national row is where Senate gaps mean most."
        : isLegislature(office) ? LEGISLATURE_NOTE : ""}</p>`;
  const listBox = document.createElement("div");

  app.append(controls, headline, mapHead, mapControls, mapNote, mapBox, listHead, listBox);
  drawMap(mapBox, rows, fips, colorBy, office, (po) => go(`#/state/${po}`));
  renderList(listBox, rows, national);
}

// Sorting redraws only the list, so the map and scroll position stay put.
function renderList(box: HTMLElement, rows: Row[], national: Row): void {
  drawList(box, rows, national, office, sort, (s) => {
    sort = s;
    history.replaceState(null, "", overviewHash());
    renderList(box, rows, national);
  });
}

const LEGISLATURE_NOTE = ` Seats are the seats up that year, so a senate with staggered terms counts about
  half its seats. A third of state legislative seats are uncontested, and Arkansas, Florida, Oklahoma and Hawaii
  leave uncontested races off the ballot, so those seats add no votes and pull the winners' vote share down.
  In a district electing several members each voter's votes count once. Virginia, New Jersey and Mississippi vote in
  odd years, which count for the next even year. Data: Carl Klarner's State Legislative Election Returns, 1968-2022.`;

function renderUnity(query: string): void {
  app.innerHTML = `<p class="loading">Loading roll calls…</p>`;
  const at = location.hash;
  loadUnityIndex().then((index) => {
    if (location.hash !== at) return; // the reader moved on while it loaded
    unity = readUnityParams(new URLSearchParams(query), index, unity);
    const hash = unityHash(unity);
    if (location.hash !== hash) history.replaceState(null, "", hash);
    renderTabs({ view: "unity", query });
    drawUnity(app, index, unity, loadUnityMembers, (st, redrawOnly) => {
      unity = st;
      if (redrawOnly) history.replaceState(null, "", unityHash(st));
      else go(unityHash(st));
    });
  }).catch(() => {
    app.innerHTML = `<p class="error">Could not load the roll-call data.</p>`;
  });
}

function nearest(years: number[], y: number): number {
  return years.reduce((best, v) => (Math.abs(v - y) < Math.abs(best - y) ? v : best), years[0]);
}

async function start(): Promise<void> {
  try {
    const r = await fetch(dataUrl("summary.json"));
    if (!r.ok) throw new Error(r.statusText);
    summary = await r.json();
  } catch {
    app.innerHTML = `<p class="error">Could not load the election data.</p>`;
    return;
  }
  window.addEventListener("hashchange", render);
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);
  render();
}

start();
