// Forge invocation helpers and artifact/report parsers.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import type { GasContract, Sizes, TestResult } from "../types.ts";
import { runSync, walk } from "./exec.ts";

const MIN_RUNTIME_BYTES = 100;
const SKIP_SRC_DIRS = new Set(["test", "tests", "mock", "mocks"]);
const PRAGMA_RE = /^([ \t]*)pragma[ \t]+solidity\b[^;]*;/gm;
const SOLC_VERSION_RE = /^\d+\.\d+\.\d+$/;

export function forgeConfig(root: string): Record<string, unknown> {
  const res = runSync(["forge", "config", "--json"], root);
  if (!res.ok) throw new Error(`forge config failed: ${res.err.trim().slice(-400)}`);
  return JSON.parse(res.out) as Record<string, unknown>;
}

/** solc versions the repo needs. forge 1.9.0 resolves nothing with --root from another dir, so run it in the repo. */
export function resolveSolc(root: string): string[] {
  const res = runSync(["forge", "compiler", "resolve", "--json"], root);
  if (!res.ok) throw new Error(`forge compiler resolve failed: ${res.err.trim().slice(-400)}`);
  const parsed = JSON.parse(res.out || "{}") as { Solidity?: { version?: unknown }[] };
  return (parsed.Solidity ?? []).map((v) => String(v.version)).filter((v) => SOLC_VERSION_RE.test(v));
}

/** Let forge download and verify one solc version into the svm cache by compiling an empty contract. */
export function installSolc(version: string): void {
  if (!SOLC_VERSION_RE.test(version)) throw new Error(`invalid solc version: ${version}`);
  const dir = `/tmp/solc-warm-${version}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "W.sol"), `pragma solidity ${version};\ncontract W {}\n`);
  const res = runSync(["forge", "build", "--no-lint", "--color", "never"], dir);
  rmSync(dir, { recursive: true, force: true });
  if (!res.ok) throw new Error(`solc ${version} install failed: ${(res.err || res.out).trim().slice(-400)}`);
}

/** Replace every `pragma solidity ...;` with a permissive one. Only ever applied to a throwaway copy. */
export function relaxPragmas(root: string): number {
  let changed = 0;
  for (const file of walk(root)) {
    if (!file.endsWith(".sol") || !lstatSync(file).isFile()) continue;
    const text = readFileSync(file, "utf8");
    const next = text.replace(PRAGMA_RE, "$1pragma solidity >=0.0.0;");
    if (next !== text) {
      writeFileSync(file, next);
      changed++;
    }
  }
  return changed;
}

/** File names of non-test, non-mock sources; artifacts are grouped by source file name in out/. */
export function sourceFileNames(srcDir: string): Set<string> {
  const names = new Set<string>();
  for (const file of walk(srcDir)) {
    if (!file.endsWith(".sol") || file.endsWith(".t.sol")) continue;
    const dirs = relative(srcDir, file).split(sep).slice(0, -1);
    if (dirs.some((d) => SKIP_SRC_DIRS.has(d))) continue;
    names.add(basename(file));
  }
  return names;
}

export function collectSizes(outDir: string, srcFiles: Set<string>, extra: Set<string>): Sizes {
  const sizes: Sizes = {};
  if (!existsSync(outDir)) return sizes;
  for (const dir of readdirSync(outDir)) {
    const full = join(outDir, dir);
    if (!lstatSync(full).isDirectory()) continue;
    for (const file of readdirSync(full)) {
      if (!file.endsWith(".json")) continue;
      const contract = file.split(".")[0];
      if (!srcFiles.has(dir) && !extra.has(contract)) continue;
      try {
        const data = JSON.parse(readFileSync(join(full, file), "utf8")) as {
          abi?: unknown[];
          bytecode?: { object?: string };
          deployedBytecode?: { object?: string };
        };
        const init = (data.bytecode?.object ?? "").replace(/^0x/, "");
        const runtime = (data.deployedBytecode?.object ?? "").replace(/^0x/, "");
        // Interfaces and internal-only library stubs are not meaningful to compare.
        if (!Array.isArray(data.abi) || data.abi.length === 0 || runtime.length / 2 < MIN_RUNTIME_BYTES) continue;
        sizes[contract] = { init: init.length / 2, runtime: runtime.length / 2 };
      } catch {
        continue;
      }
    }
  }
  return sizes;
}

export function parseTests(path: string): TestResult {
  const data = JSON.parse(readFileSync(path, "utf8")) as Record<string, { test_results?: Record<string, { status?: string }> }>;
  const r: TestResult = { passed: 0, failed: 0, skipped: 0, failures: [] };
  for (const [suite, body] of Object.entries(data)) {
    for (const [test, res] of Object.entries(body.test_results ?? {})) {
      if (res.status === "Success") r.passed++;
      else if (res.status === "Skipped") r.skipped++;
      else {
        r.failed++;
        r.failures.push(`${suite.split(":").pop()}::${test}`);
      }
    }
  }
  return r;
}

type GasEntry = { contract?: string; deployment?: { gas?: unknown }; functions?: Record<string, { median?: unknown; calls?: unknown }> };

export function parseGas(path: string, wanted: Set<string>): Record<string, GasContract> {
  const data = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(data)) throw new Error("gas report is not an array");
  const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const gas: Record<string, GasContract> = {};
  for (const entry of data as GasEntry[]) {
    const name = String(entry.contract ?? "").split(":").pop() ?? "";
    if (!wanted.has(name)) continue;
    const functions: GasContract["functions"] = {};
    for (const [sig, f] of Object.entries(entry.functions ?? {})) functions[sig] = { median: num(f.median), calls: num(f.calls) };
    gas[name] = { deployment: num(entry.deployment?.gas), functions };
  }
  return gas;
}
