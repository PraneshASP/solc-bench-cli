// Benchmark options: defined once, validated on the host and again inside the container.
import { readFileSync } from "node:fs";

import { ALL_VARIANTS } from "./types.ts";
import type { BenchOptions } from "./types.ts";

export const BENCH_FLAGS = {
  runs: { type: "string" },
  "via-ir-runs": { type: "string" },
  warmup: { type: "string" },
  variants: { type: "string" },
  "fuzz-seed": { type: "string" },
  timeout: { type: "string" },
  contracts: { type: "string" },
  top: { type: "string" },
  "skip-tests": { type: "boolean" },
} as const;

type BenchValues = { [K in keyof typeof BENCH_FLAGS]?: (typeof BENCH_FLAGS)[K]["type"] extends "boolean" ? boolean : string };

function int(name: string, value: string | undefined, fallback: number, min: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!/^\d{1,7}$/.test(value) || n < min) throw new Error(`--${name} must be an integer >= ${min}`);
  return n;
}

const list = (s: string | undefined): string[] => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export function parseBenchOptions(values: BenchValues): BenchOptions {
  const variants = [...new Set(values.variants === undefined ? ALL_VARIANTS : list(values.variants))];
  const bad = variants.filter((v) => !ALL_VARIANTS.includes(v));
  if (!variants.length || bad.length) throw new Error(`unknown variants: ${bad.join(", ") || "(none)"} (allowed: ${ALL_VARIANTS.join(", ")})`);
  const contracts = list(values.contracts);
  if (contracts.some((n) => !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(n))) throw new Error("--contracts must be Solidity identifiers");
  const runs = int("runs", values.runs, 3, 1);
  return {
    runs,
    viaIrRuns: int("via-ir-runs", values["via-ir-runs"], runs, 1),
    warmup: int("warmup", values.warmup, 1, 0),
    variants,
    fuzzSeed: int("fuzz-seed", values["fuzz-seed"], 1, 0),
    timeoutMs: int("timeout", values.timeout, 3600, 1) * 1000,
    skipTests: values["skip-tests"] === true,
    contracts,
    top: int("top", values.top, 12, 1),
  };
}

/** Serialize validated options back into flags for the container. */
export function benchArgs(o: BenchOptions): string[] {
  return [
    "--runs", String(o.runs), "--via-ir-runs", String(o.viaIrRuns), "--warmup", String(o.warmup), "--variants", o.variants.join(","),
    "--fuzz-seed", String(o.fuzzSeed), "--timeout", String(o.timeoutMs / 1000), "--top", String(o.top),
    ...(o.contracts.length ? ["--contracts", o.contracts.join(",")] : []),
    ...(o.skipTests ? ["--skip-tests"] : []),
  ];
}

export const VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
})();
