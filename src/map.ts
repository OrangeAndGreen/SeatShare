// The state map, coloured by vote margin, seat margin or the gap between them.

import * as d3 from "d3";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import us from "us-atlas/states-albers-10m.json";
import { formatGap, formatSeatGap, formatSeats, margin, pct, type Office, type Row } from "./shares";
import { divergingScale, escapeHtml, hideTip, showTip } from "./ui";

export type ColorBy = "votes" | "seats" | "gap" | "seatGap";

export const COLOR_BY: { value: ColorBy; text: string }[] = [
  { value: "seatGap", text: "Seat gap, in seats" },
  { value: "gap", text: "Seat gap, in points" },
  { value: "votes", text: "Vote margin" },
  { value: "seats", text: "Seat margin" },
];

const EXTENT: Record<ColorBy, number> = { votes: 0.5, seats: 1, gap: 0.3, seatGap: 4 };

const topo = us as unknown as Topology<{ states: GeometryCollection<{ name: string }> }>;
const states = feature(topo, topo.objects.states).features;

export function value(row: Row, by: ColorBy): number {
  if (by === "votes") return margin(row.voteShare);
  if (by === "seats") return margin(row.seatShare);
  if (by === "seatGap") return row.seatGap;
  return row.gap;
}

function valueText(row: Row, by: ColorBy): string {
  if (by === "seatGap") return `${formatSeatGap(row.seatGap)} seats`;
  const m = value(row, by);
  if (Math.abs(m) < 0.0005) return "Even";
  return `${m > 0 ? "D" : "R"} +${(Math.abs(m) * 100).toFixed(1)}`;
}

export function legendText(by: ColorBy, office: Office): [string, string] {
  if (by === "seatGap") {
    const unit = office === "house" ? "seats" : "electors";
    return [`R +${EXTENT[by]} ${unit} or more`, `D +${EXTENT[by]}`];
  }
  const e = EXTENT[by] * 100;
  return by === "gap"
    ? [`R seats ahead of votes by ${e}+ pts`, `D by ${e}+`]
    : [`R +${e}`, `D +${e}`];
}

export function tipHtml(row: Row, office: Office): string {
  const seatWord = office === "house" ? "Seats" : "Electors";
  const lines = [
    ["Votes", `D ${pct(row.voteShare.D)} · R ${pct(row.voteShare.R)}`],
    [seatWord, formatSeats(row.seats) || "-"],
    ["Seat gap", `${formatGap(row.gap)} pts`],
    ["Seat gap", `${formatSeatGap(row.seatGap)} ${seatWord.toLowerCase()}`],
  ];
  if (row.uncontested) lines.push(["Uncontested", String(row.uncontested)]);
  return `<b>${escapeHtml(row.name)}</b>`
    + lines.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join("");
}

export function drawMap(
  container: HTMLElement,
  rows: Row[],
  fipsOf: Record<string, string>,
  by: ColorBy,
  office: Office,
  onPick: (po: string) => void,
): void {
  const byFips = new Map<string, Row>();
  for (const r of rows) if (fipsOf[r.po]) byFips.set(fipsOf[r.po], r);

  const color = divergingScale(EXTENT[by]);
  const path = d3.geoPath();
  container.replaceChildren();

  const svg = d3.select(container).append("svg")
    .attr("class", "map")
    .attr("viewBox", "0 0 975 610")
    .attr("role", "img")
    .attr("aria-label", `Map of states coloured by ${COLOR_BY.find((c) => c.value === by)!.text.toLowerCase()}`);

  svg.append("g").selectAll("path")
    .data(states)
    .join("path")
    .attr("class", "state")
    .attr("d", path)
    .attr("fill", (f) => {
      const r = byFips.get(String(f.id));
      return r ? color(value(r, by)) : "var(--line)";
    })
    .attr("tabindex", (f) => (byFips.has(String(f.id)) ? 0 : null))
    .attr("aria-label", (f) => {
      const r = byFips.get(String(f.id));
      return r ? `${r.name}: ${valueText(r, by)}` : f.properties.name;
    })
    .on("mousemove", (event: MouseEvent, f) => {
      const r = byFips.get(String(f.id));
      if (r) showTip(tipHtml(r, office), event.clientX, event.clientY);
    })
    .on("mouseleave", hideTip)
    .on("click", (_e, f) => {
      const r = byFips.get(String(f.id));
      if (r) {
        hideTip();
        onPick(r.po);
      }
    })
    .on("keydown", (event: KeyboardEvent, f) => {
      const r = byFips.get(String(f.id));
      if (r && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        onPick(r.po);
      }
    });

  const [lo, hi] = legendText(by, office);
  const ramp = d3.range(0, 1.0001, 0.1).map((t) => color(-EXTENT[by] + t * 2 * EXTENT[by]));
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = `<span>${lo}</span><span class="ramp" style="background:linear-gradient(90deg,${ramp.join(",")})"></span><span>${hi}</span>`;
  container.append(legend);
}
