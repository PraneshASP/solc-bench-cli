import type { Meta, RepoResult } from "../types.ts";
import { candidatesIn, compare, fmtPct, pct, speed } from "./compare.ts";

const md = (s: string): string => s.replaceAll("|", "\\|");
const fence = (s: string): string => s.replaceAll("```", "'''");
const p = (x?: number): string => (x === undefined ? "-" : fmtPct(x));

function summary(results: RepoResult[]): string[] {
  const L = [
    "## Summary",
    "",
    "| Repo | Compiler | Build (median) | vs baseline | Runtime size | Call gas (median) | Deploy gas | Tests |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    if (r.error) {
      L.push(`| ${md(r.name)} | - | error | - | - | - | - | - |`);
      continue;
    }
    for (const v of candidatesIn(r)) {
      const b = r.builds[v];
      if (b.status !== "ok") {
        L.push(`| ${md(r.name)} | ${v} | ${b.status} | - | - | - | - | - |`);
        continue;
      }
      const cmp = compare(r, v);
      const t = cmp.tests;
      const tests = !t ? "-" : t.error ? "error" : `${t.passed}/${t.passed + t.failed}`;
      L.push(
        `| ${md(r.name)} | ${v} | ${b.median}s | ${cmp.buildRatio ? speed(cmp.buildRatio, 1) : "-"} | ${p(cmp.sizeDelta)} | ${p(cmp.callGasDelta)} | ${p(cmp.deployDelta)} | ${tests} |`,
      );
    }
  }
  return L;
}

function repoSection(r: RepoResult): string[] {
  const L = ["", `## ${md(r.name)}`, ""];
  if (r.error) return [...L, "```", fence(r.error), "```"];

  const base = r.baseline;
  const cands = candidatesIn(r);
  L.push(
    `Commit \`${r.commit}\`, ${r.sourceFiles} .sol files, via_ir=${r.config.viaIr}, evm_version=${r.config.evmVersion}, ` +
      `optimizer=${String(r.config.optimizer)} (runs ${String(r.config.optimizerRuns)}), baseline \`${base}\`` +
      (r.pragmasRelaxed ? `, ${r.pragmasRelaxed} pragmas relaxed for pinned-version compilers` : ""),
    "",
    "### Build time",
    "",
    "| Compiler | Status | Median (s) | Runs (s) | Note |",
    "|---|---|---|---|---|",
  );
  for (const [v, b] of Object.entries(r.builds)) {
    L.push(`| ${v} | ${b.status} | ${b.median ?? "-"} | ${b.times.join(", ")} | ${md(b.note ?? "")} |`);
  }

  const bs = r.sizes[base];
  const sizeCands = cands.filter((v) => r.sizes[v]);
  if (bs && sizeCands.length) {
    L.push("", "### Bytecode size (bytes, runtime / initcode)", "", `| Contract | ${base} | ${sizeCands.join(" | ")} |`,
      `|---|${"---|".repeat(sizeCands.length + 1)}`);
    for (const k of Object.keys(bs).sort()) {
      const cells = sizeCands.map((v) => {
        const s = r.sizes[v][k];
        return s ? `${s.runtime} / ${s.init} (${fmtPct(pct(s.runtime, bs[k].runtime))})` : "-";
      });
      L.push(`| ${md(k)} | ${bs[k].runtime} / ${bs[k].init} | ${cells.join(" | ")} |`);
    }
  }

  const bg = r.gas[base];
  const gasCands = cands.filter((v) => r.gas[v]);
  if (bg && gasCands.length) {
    const deployable = Object.keys(bg).filter((k) => bg[k].deployment).sort();
    if (deployable.length) {
      L.push("", "### Deployment gas", "", `| Contract | ${base} | ${gasCands.join(" | ")} |`, `|---|${"---|".repeat(gasCands.length + 1)}`);
      for (const k of deployable) {
        const b = bg[k].deployment as number;
        const cells = gasCands.map((v) => {
          const x = r.gas[v][k]?.deployment;
          return x ? `${x} (${fmtPct(pct(x, b))})` : "-";
        });
        L.push(`| ${md(k)} | ${b} | ${cells.join(" | ")} |`);
      }
    }
    L.push("", "### Median gas per call", "", `| Function | ${base} | ${gasCands.join(" | ")} | calls |`, `|---|${"---|".repeat(gasCands.length + 2)}`);
    for (const k of Object.keys(bg).sort()) {
      for (const sig of Object.keys(bg[k].functions).sort()) {
        const f = bg[k].functions[sig];
        if (!f.median) continue;
        const cells = gasCands.map((v) => {
          const x = r.gas[v][k]?.functions[sig]?.median;
          return x !== null && x !== undefined ? `${x} (${fmtPct(pct(x, f.median as number))})` : "-";
        });
        L.push(`| ${md(`${k}.${sig}`)} | ${f.median} | ${cells.join(" | ")} | ${f.calls ?? "-"} |`);
      }
    }
  }

  for (const [v, t] of Object.entries(r.tests)) {
    if (t.error) L.push("", `Test run error (${v}): \`${md(t.error)}\``);
    if (t.failures.length) L.push("", `Failing tests with ${v}: ${t.failures.map((f) => `\`${md(f)}\``).join(", ")}`);
  }
  for (const [v, b] of Object.entries(r.builds)) {
    if (b.status === "failed") L.push("", `Build failure (${v}):`, "```", fence(b.errorTail ?? ""), "```");
  }
  return L;
}

export function renderMarkdown(results: RepoResult[], meta: Meta): string {
  const L: string[] = [
    "# Compiler benchmark: Solar, Slang, solx and oksolc vs solc",
    "",
    `- Tool: ${meta.tool}`,
    `- Date: ${meta.date}`,
    ...Object.entries(meta.versions).map(([k, v]) => `- ${k}: \`${v}\``),
    `- Settings: ${meta.runs} clean builds per compiler (${meta.viaIrRuns} for solc via-IR), fuzz seed ${meta.fuzzSeed}`,
    "- Sandbox: container with no network, read-only root filesystem, all capabilities dropped, non-root, Node permission model",
    "",
    "Notes:",
    "",
    "- The baseline for each repo is its own solc pipeline (via-IR or legacy) and pinned solc versions.",
    "- Solar, Slang, solx and oksolc each compile every file with one language version. Slang, solx and oksolc report a fixed solc version, so `pragma solidity` lines are relaxed in their workspace copy only; Solar ignores pragmas itself.",
    "- oksolc (Zig reimplementation targeting solc 0.8.36) only supports the optimized via-IR pipeline, so it always runs with via_ir and the optimizer on.",
    "- Slang and solx support only cancun or newer EVM targets and ignore `viaIR` and solc optimizer settings (LLVM optimizes instead). They are skipped for repos targeting older EVM versions.",
    "- Solar codegen, the Slang preview, solx and oksolc are all pre-production. Do not deploy their output.",
    "",
    ...summary(results),
  ];
  for (const r of results) L.push(...repoSection(r));
  return L.join("\n") + "\n";
}
