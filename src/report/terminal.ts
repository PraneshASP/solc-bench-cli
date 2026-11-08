import { NEW_COMPILERS, SOLC_LATEST, SOLC_LATEST_VERSION } from "../types.ts";
import type { RepoResult, TestResult } from "../types.ts";
import { bar, c, repoLabel, table } from "../ui.ts";
import type { Align } from "../ui.ts";
import { candidatesIn, compare, fmtInt, pct } from "./compare.ts";

const COLORS: Record<string, (s: string) => string> = { solar: c.yellow, slang: c.magenta, solx: c.blue, oksolc: c.cyan, "solc-par": c.green, [SOLC_LATEST]: c.green };
const name = (v: string): string => (COLORS[v] ?? c.gray)(v);
const right = (n: number): Align[] => Array.from({ length: n }, (): Align => "r");
const dash = c.gray("–");

/** Signed percent, colored by the rounded value so -0.04% reads as a neutral 0.0%. */
function delta(p: number): string {
  const r = Math.round(p * 10) / 10;
  if (r === 0) return c.gray("0.0%");
  return (r < 0 ? c.green : c.red)(`${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}%`);
}

function speedup(ratio: number): string {
  return ratio >= 1 ? c.green(`${ratio.toFixed(1)}× faster`) : c.red(`${(1 / ratio).toFixed(1)}× slower`);
}

const testCell = (t?: TestResult): string =>
  !t ? dash : t.error ? c.red("error") : t.failed ? c.red(`${t.passed}/${t.passed + t.failed}`) : c.green(`${t.passed}/${t.passed}`);

function buildTable(r: RepoResult): string {
  const base = r.builds[r.baseline]?.median;
  const slowest = Math.max(...Object.values(r.builds).map((b) => b.median ?? 0));
  return table(
    "Build time",
    ["compiler", "median", "range", "", `vs ${r.baseline}`],
    Object.entries(r.builds).map(([v, b]) => {
      if (b.status !== "ok") {
        return [name(v), b.status === "skipped" ? c.yellow("skipped") : c.red("failed"), "", c.gray(b.note ?? ""), ""];
      }
      const m = b.median as number;
      const lo = Math.min(...b.times);
      const hi = Math.max(...b.times);
      return [
        name(v),
        `${m.toFixed(2)}s`,
        b.times.length > 1 ? c.gray(`${lo.toFixed(2)}–${hi.toFixed(2)}s`) : "",
        bar(slowest ? m / slowest : 0, 24, COLORS[v] ?? c.gray),
        v === r.baseline ? c.gray("baseline") : base ? speedup(base / m) : dash,
      ];
    }),
    ["l", "r", "r", "l", "r"],
  );
}

function sizeTable(r: RepoResult, top: number): string | null {
  const cands = candidatesIn(r).filter((v) => r.sizes[v]);
  const bs = r.sizes[r.baseline];
  if (!bs || !cands.length) return null;
  const contracts = Object.keys(bs).sort((a, b) => bs[b].runtime - bs[a].runtime).slice(0, top);
  return table(
    "Runtime bytecode",
    ["contract", r.baseline, ...cands.map(name)],
    contracts.map((k) => [
      k,
      fmtInt(bs[k].runtime),
      ...cands.map((v) => {
        const s = r.sizes[v][k];
        return s ? `${fmtInt(s.runtime)} ${delta(pct(s.runtime, bs[k].runtime))}` : dash;
      }),
    ]),
    ["l", ...right(cands.length + 1)],
  );
}

function gasTable(r: RepoResult, top: number): string | null {
  const cands = candidatesIn(r).filter((v) => r.gas[v]);
  const baseGas = r.gas[r.baseline];
  if (!baseGas || !cands.length) return null;
  const ranked = Object.entries(baseGas)
    .flatMap(([contract, g]) => Object.entries(g.functions).map(([sig, f]) => ({ contract, sig, calls: f.calls ?? 0, med: f.median })))
    .filter((f) => f.med)
    .sort((a, b) => b.calls - a.calls)
    .slice(0, top);
  if (!ranked.length) return null;
  return table(
    "Gas per call",
    ["function", r.baseline, ...cands.map(name)],
    ranked.map((f) => [
      `${c.gray(f.contract + ".")}${f.sig.split("(")[0]}`,
      fmtInt(f.med as number),
      ...cands.map((v) => {
        const x = r.gas[v][f.contract]?.functions[f.sig]?.median;
        return x !== null && x !== undefined ? `${fmtInt(x)} ${delta(pct(x, f.med as number))}` : dash;
      }),
    ]),
    ["l", ...right(cands.length + 1)],
  );
}

function failures(r: RepoResult): string | null {
  const lines: string[] = [];
  const baseFailures = new Set(r.tests[r.baseline]?.failures ?? []);
  for (const [v, t] of Object.entries(r.tests)) {
    if (t.error) lines.push(`  ${c.red("✗")} ${name(v)} ${c.gray(t.error)}`);
    const only = t.failures.filter((f) => v === r.baseline || !baseFailures.has(f));
    if (only.length) lines.push(`  ${c.red("✗")} ${name(v)} ${only.length} failing: ${c.gray(only.slice(0, 8).join(", "))}`);
  }
  return lines.length ? lines.join("\n") : null;
}

export function renderRepo(r: RepoResult, top: number): string {
  if (r.error) return `  ${c.red("✗")} ${repoLabel(r.name)}  ${c.red(r.error)}`;
  return [buildTable(r), sizeTable(r, top), gasTable(r, top), failures(r)].filter((s) => s !== null).join("\n\n");
}

function summaryTable(r: RepoResult, variants: string[], baseline: string, title: string, subtitle: string): string {
  const rows = variants.map((v) => {
    const b = r.builds[v];
    if (b.status !== "ok") return [name(v), b.status === "skipped" ? c.yellow("skipped") : c.red("build failed"), "", "", "", ""];
    const cmp = compare(r, v, baseline);
    return [
      name(v),
      cmp.buildRatio !== undefined ? speedup(cmp.buildRatio) : `${b.median?.toFixed(2)}s`,
      cmp.sizeDelta !== undefined ? delta(cmp.sizeDelta) : dash,
      cmp.callGasDelta !== undefined ? delta(cmp.callGasDelta) : dash,
      cmp.deployDelta !== undefined ? delta(cmp.deployDelta) : dash,
      testCell(cmp.tests),
    ];
  });
  return table(title, ["compiler", "build", "bytecode", "gas/call", "deploy", "tests"], rows, ["l", ...right(5)], subtitle);
}

export function renderSummary(results: RepoResult[]): string {
  const blocks = results.map((r) => {
    if (r.error) return `  ${c.bold(repoLabel(r.name))}  ${c.red(r.error)}`;
    const out = [summaryTable(r, candidatesIn(r), r.baseline, repoLabel(r.name), `${r.commit} · vs ${r.baseline}`)];
    // Same solc version and EVM target for every file: shows the compiler's own effect.
    if (r.builds[SOLC_LATEST]?.status === "ok") {
      const fresh = NEW_COMPILERS.filter((v) => r.builds[v]);
      if (fresh.length) out.push(summaryTable(r, fresh, SOLC_LATEST, "", `vs ${SOLC_LATEST} ${SOLC_LATEST_VERSION}`));
    }
    return out.join("\n\n");
  });
  return [
    `\n${c.green("◆")} ${c.bold("Summary")}\n`,
    blocks.join("\n\n"),
  ].join("\n");
}
