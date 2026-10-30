// Small DOM helpers shared by the views: colours, the tooltip, element building.

import * as d3 from "d3";
import type { Party } from "./shares";

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function partyColor(p: Party): string {
  return cssVar(p === "D" ? "--dem" : p === "R" ? "--rep" : "--ind");
}

/** Blue for Democrats, red for Republicans, through a neutral gray at 0. */
export function divergingScale(extent: number): d3.ScaleDiverging<string> {
  const interpolate = d3.piecewise(d3.interpolateLab, [
    cssVar("--rep-strong"), cssVar("--rep"), cssVar("--mid"), cssVar("--dem"), cssVar("--dem-strong"),
  ]);
  return d3.scaleDiverging(interpolate).domain([-extent, 0, extent]).clamp(true);
}

const tip = () => document.getElementById("tip") as HTMLDivElement;

export function showTip(html: string, x: number, y: number): void {
  const el = tip();
  el.innerHTML = html;
  el.hidden = false;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const left = x + 14 + w > window.innerWidth ? x - w - 14 : x + 14;
  const top = Math.min(y + 14, window.innerHeight - h - 8);
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.max(8, top)}px`;
}

export function hideTip(): void {
  tip().hidden = true;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function select<T extends string>(
  label: string,
  options: { value: T; text: string }[],
  value: T,
  onChange: (v: T) => void,
): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.textContent = label;
  const sel = document.createElement("select");
  for (const o of options) sel.add(new Option(o.text, o.value, false, o.value === value));
  sel.addEventListener("change", () => onChange(sel.value as T));
  wrap.append(sel);
  return wrap;
}

/** A two-segment bar of Democratic and Republican share, with a gap between. */
export function shareBar(d: number, r: number): string {
  const rest = Math.max(0, 1 - d - r);
  return `<span class="bar" aria-hidden="true">`
    + `<span style="width:${d * 100}%;background:var(--dem)"></span>`
    + (rest > 0.005 ? `<span style="width:${rest * 100}%;background:var(--line)"></span>` : "")
    + `<span style="width:${r * 100}%;background:var(--rep)"></span></span>`;
}

/** How deep a cell's shade runs, -1 (deepest R) to 1 (deepest D); 0 when the value is about even. */
export function shadeLevel(value: number, extent: number): number {
  const t = Math.max(-1, Math.min(1, value / extent));
  return Math.abs(t) < 0.02 ? 0 : t;
}

/**
 * A td's style shading it by a signed value: the panel colour at even, deepening to dark
 * blue (+) or red (-) at `extent`. The text turns light where the light theme's shade is darkest.
 */
export function shade(value: number, extent: number): string {
  const t = shadeLevel(value, extent);
  if (!t) return "";
  const mix = Math.round(Math.abs(t) * 100);
  return ` style="background:color-mix(in oklab, var(--${t > 0 ? "dem" : "rep"}-cell) ${mix}%, var(--panel))${
    mix >= 80 ? ";color:var(--shade-ink)" : ""}"`;
}

/** Where cell shades top out: vote and seat margins, and the gap in points. */
export const SHADE = { votes: 0.5, seats: 1, gap: 0.3 } as const;
