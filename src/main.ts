import "./style.css";
import { drawList, SORT_KEYS, type ListState } from "./list";
import { COLOR_BY, drawMap, type ColorBy } from "./map";
import {
  buildRows, formatGap, formatSeatGap, formatSeats, NATIONAL, nationalRow, pct, type District, type Office, type Row, type SortKey, type Summary,
} from "./shares";
import { drawState } from "./state";
import { METRICS, type Metric } from "./trend-data";
import { drawTrends, type TrendState } from "./trends";
import { escapeHtml, select } from "./ui";

const OFFICES: { value: Office; text: string }[] = [
  { value: "house", text: "US House" },
  { value: "president", text: "President" },
];

const app = document.getElementById("app")!;
const tabs = document.getElementById("tabs")!;
const dataUrl = (path: string) => `${import.meta.env.BASE_URL}data/${path}`;

let summary: Summary;
const districtCache = new Map<number, Promise<Record<string, District[]>>>();

// View state, mirrored in the URL hash: #/house/2024?by=gap&sort=gap-desc, #/state/MA/2024,
// #/trends?office=house&area=US&metric=seatGap&from=1976&to=2024
let office: Office = "house";
let year = 2024;
let colorBy: ColorBy = "seatGap";
let sort: ListState = { key: "seatGap", descending: true };
let trend: TrendState = { office: "house", area: NATIONAL, metric: "seatGap", from: 1976, to: 2024 };

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
  return `#/trends?office=${t.office}&area=${t.area}&metric=${t.metric}&from=${t.from}&to=${t.to}`;
}

function go(hash: string): void {
  if (location.hash === hash) render();
  else location.hash = hash;
}

type Route = { view: "overview" } | { view: "trends" } | { view: "state"; po: string; year?: number };

function readHash(): Route {
  const [path, query = ""] = location.hash.replace(/^#\/?/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "trends") {
    readTrendParams(new URLSearchParams(query));
    return { view: "trends" };
  }
  if (parts[0] === "state" && parts[1]) {
    return { view: "state", po: parts[1].toUpperCase(), year: parts[2] ? Number(parts[2]) : undefined };
  }
  if (parts[0] === "house" || parts[0] === "president") office = parts[0];
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

function readTrendParams(params: URLSearchParams): void {
  const o = params.get("office");
  if (o === "house" || o === "president") trend.office = o;
  const area = params.get("area")?.toUpperCase();
  if (area && (area === NATIONAL || summary.states.some((s) => s.po === area))) trend.area = area;
  const metric = params.get("metric");
  if (metric && METRICS.some((m) => m.value === metric)) trend.metric = metric as Metric;
  const years = summary.offices[trend.office];
  const from = Number(params.get("from"));
  const to = Number(params.get("to"));
  trend.from = years.includes(from) ? from : years.includes(trend.from) ? trend.from : years[0];
  trend.to = years.includes(to) ? to : years.includes(trend.to) ? trend.to : years[years.length - 1];
}

function renderTabs(route: Route): void {
  const tab = (href: string, text: string, current: boolean) =>
    `<a href="${href}"${current ? ` aria-current="page"` : ""}>${text}</a>`;
  tabs.innerHTML = tab(overviewHash(), "By election", route.view === "overview")
    + tab(trendHash(trend), "Over time", route.view === "trends");
}

function render(): void {
  const route = readHash();
  renderTabs(route);
  if (route.view === "trends") {
    document.title = "Over time - SeatShare";
    drawTrends(app, summary, trend, (t) => go(trendHash(t)));
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
    drawState(app, summary, state, route.year ?? houseYears[houseYears.length - 1], loadDistricts,
      (y) => go(`#/state/${state.po}/${y}`));
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
  const seatWord = office === "house" ? "seats" : "electoral votes";
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
      : "") + "Click a state for its history.";
  const mapBox = document.createElement("div");
  mapBox.className = "map-wrap";

  const listHead = document.createElement("div");
  listHead.innerHTML = `<h2>Vote share against ${office === "house" ? "seat" : "elector"} share</h2>
    <p class="note">Sort by any column; the gaps sort by size, whichever party they favour. The gap in points is
    half the difference between the two parties' over- or under-representation. The gap in ${seatWord} is that times
    the state's ${seatWord}: how many a party won beyond a split in proportion to the vote.${office === "president"
      ? " Electors go almost entirely to the statewide winner, so every state's gap is large." : ""}</p>`;
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
