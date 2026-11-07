import { CANDIDATES } from "../types.ts";
import type { RepoResult, Sizes, TestResult } from "../types.ts";

export const pct = (next: number, prev: number): number => (prev ? ((next - prev) / prev) * 100 : 0);

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export const fmtInt = (n: number): string => n.toLocaleString("en-US");
export const fmtPct = (p: number): string => `${p > 0 ? "+" : ""}${p.toFixed(1)}%`;

export function speed(baseSecs: number, candSecs: number): string {
  const ratio = baseSecs / candSecs;
  return ratio >= 1 ? `${ratio.toFixed(1)}x faster` : `${(1 / ratio).toFixed(1)}x slower`;
}

export const candidatesIn = (r: RepoResult): string[] => CANDIDATES.filter((v) => r.builds[v]);

export interface GasRow {
  contract: string;
  sig: string;
  base: number;
  cand: number;
  calls: number;
}

export function gasRows(r: RepoResult, cand: string, baseline = r.baseline): GasRow[] {
  const base = r.gas[baseline] ?? {};
  const other = r.gas[cand] ?? {};
  const rows: GasRow[] = [];
  for (const contract of Object.keys(base).sort()) {
    const bf = base[contract].functions;
    const cf = other[contract]?.functions;
    if (!cf) continue;
    for (const sig of Object.keys(bf).sort()) {
      const b = bf[sig].median;
      const x = cf[sig]?.median;
      if (b && x !== null && x !== undefined) rows.push({ contract, sig, base: b, cand: x, calls: bf[sig].calls ?? 0 });
    }
  }
  return rows;
}

export interface Comparison {
  buildRatio?: number;
  sizeDelta?: number;
  callGasDelta?: number;
  deployDelta?: number;
  tests?: TestResult;
}

/** Aggregate one candidate against a baseline (default: the repo pipeline): summed sizes, median per-function gas delta, summed deploy gas. */
export function compare(r: RepoResult, cand: string, baseline = r.baseline): Comparison {
  const out: Comparison = {};
  const b = r.builds[baseline];
  const x = r.builds[cand];
  if (b?.median && x?.median) out.buildRatio = b.median / x.median;

  const bs = r.sizes[baseline] ?? {};
  const xs = r.sizes[cand] ?? {};
  const common = Object.keys(bs).filter((k) => k in xs);
  if (common.length) {
    const sum = (s: Sizes) => common.reduce((acc, k) => acc + s[k].runtime, 0);
    out.sizeDelta = pct(sum(xs), sum(bs));
  }

  const deltas = gasRows(r, cand, baseline).map((row) => pct(row.cand, row.base));
  if (deltas.length) out.callGasDelta = median(deltas);

  const bg = r.gas[baseline] ?? {};
  const xg = r.gas[cand] ?? {};
  const deps = Object.keys(bg)
    .filter((k) => bg[k].deployment && xg[k]?.deployment)
    .map((k) => [bg[k].deployment as number, xg[k].deployment as number]);
  if (deps.length) out.deployDelta = pct(deps.reduce((a, d) => a + d[1], 0), deps.reduce((a, d) => a + d[0], 0));

  if (r.tests[cand]) out.tests = r.tests[cand];
  return out;
}
