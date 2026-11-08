// Phase 2 (no network): build each variant, run tests with a gas report, and write the results.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { renderRepo, renderSummary } from "../report/terminal.ts";
import type { RepoSpec } from "../spec.ts";
import { CANDIDATES, SOLC_LATEST, SOLC_LATEST_VERSION } from "../types.ts";
import type { BenchOptions, BuildResult, Meta, RepoResult, TestResult } from "../types.ts";
import { Board, c, keyValues, repoLabel, section, shortVersion } from "../ui.ts";
import { FUZZ_ENV, RESULTS_DIR, VARIANTS, WORK_DIR, repoDir } from "./env.ts";
import { firstLine, runCmd, tail, walk } from "./exec.ts";
import { collectSizes, forgeConfig, parseGas, parseTests, relaxPragmas, sourceFileNames } from "./forge.ts";
import { gitCommit } from "./git.ts";

function median(times: number[]): number {
  const s = [...times].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 1000) / 1000;
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function benchRepo(spec: RepoSpec, opts: BenchOptions, runDir: string, position: string): Promise<RepoResult> {
  const src = repoDir(spec);
  const logs = join(runDir, "logs", spec.name);
  const result: RepoResult = {
    name: spec.name,
    spec: spec.kind === "url" ? `${spec.url}${spec.ref ? `#${spec.ref}` : ""}` : spec.path,
    commit: "unknown",
    config: { viaIr: false, optimizer: null, optimizerRuns: null, evmVersion: "unknown" },
    sourceFiles: 0, baseline: "solc-legacy", pragmasRelaxed: 0, builds: {}, sizes: {}, tests: {}, gas: {},
  };
  const work = join(WORK_DIR, spec.name);
  const relaxed = join(WORK_DIR, `${spec.name}.relaxed`);
  const outDir = (v: string) => join(WORK_DIR, `${spec.name}.out-${v}`);
  const cacheDir = (v: string) => join(WORK_DIR, `${spec.name}.cache-${v}`);
  const rootFor = (v: string) => (VARIANTS[v].relaxPragmas ? relaxed : work);
  // via-IR builds are slow, so they use --via-ir-runs. solc-latest and solc-par follow the repo's own via_ir setting.
  const isViaIr = (v: string) => v === "solc-viair" || ((v === SOLC_LATEST || v === "solc-par") && result.config.viaIr);
  const runsFor = (v: string) => (isViaIr(v) ? opts.viaIrRuns : opts.runs);
  const totalFor = (v: string) => runsFor(v) + opts.warmup;

  console.log(section(repoLabel(spec.name), position) + "\n");
  const board = new Board();
  const prep = board.add("prepare workspace", 1);
  const buildIds: Record<string, number> = {};
  board.start();

  try {
    board.update(prep, "copying sources");
    rmSync(work, { recursive: true, force: true });
    cpSync(src, work, { recursive: true, verbatimSymlinks: true, filter: (p) => p !== join(src, "out") && p !== join(src, "cache") });
    const cfg = forgeConfig(work);
    result.commit = gitCommit(src);
    result.config = {
      viaIr: cfg.via_ir === true,
      optimizer: cfg.optimizer,
      optimizerRuns: cfg.optimizer_runs,
      evmVersion: String(cfg.evm_version ?? "unknown").toLowerCase(),
    };
    result.baseline = result.config.viaIr ? "solc-viair" : "solc-legacy";
    result.sourceFiles = walk(work).filter((f) => f.endsWith(".sol")).length;
    const srcFiles = sourceFileNames(join(work, String(cfg.src ?? "src")));

    const supported = (v: string) => VARIANTS[v].evmVersions?.has(result.config.evmVersion) ?? true;
    if (opts.variants.some((v) => VARIANTS[v].relaxPragmas && supported(v))) {
      board.update(prep, "preparing relaxed-pragma copy");
      rmSync(relaxed, { recursive: true, force: true });
      cpSync(work, relaxed, { recursive: true, verbatimSymlinks: true });
      result.pragmasRelaxed = relaxPragmas(relaxed);
    }
    board.finish(prep, "done", `${result.sourceFiles} .sol files, commit ${result.commit}, evm ${result.config.evmVersion}, baseline ${result.baseline}`);

    const planned: string[] = [];
    for (const v of opts.variants) {
      buildIds[v] = board.add(`build ${v}`, totalFor(v));
      if (supported(v)) {
        planned.push(v);
        result.builds[v] = { status: "ok", times: [] };
      } else {
        const note = `unsupported EVM version ${result.config.evmVersion}`;
        result.builds[v] = { status: "skipped", times: [], note };
        board.finish(buildIds[v], "skipped", note);
      }
    }

    // Each round builds every unfinished variant once, in a new random order, so no compiler always runs
    // first or last. The first `warmup` builds of each variant are not timed.
    const done: Record<string, number> = {};
    result.buildOrder = [];
    for (;;) {
      const round = shuffle(planned.filter((v) => result.builds[v].status === "ok" && (done[v] ?? 0) < totalFor(v)));
      if (!round.length) break;
      for (const v of round) {
        const id = buildIds[v];
        const build = result.builds[v];
        const i = (done[v] = (done[v] ?? 0) + 1);
        const warm = i <= opts.warmup;
        const root = rootFor(v);
        rmSync(outDir(v), { recursive: true, force: true });
        rmSync(cacheDir(v), { recursive: true, force: true });
        const logPath = join(logs, `build-${v}-${i}${warm ? "-warmup" : ""}.log`);
        board.update(id, warm ? "warm-up build" : `run ${i - opts.warmup}/${runsFor(v)}`);
        result.buildOrder.push(warm ? `${v} (warm-up)` : v);
        const res = await runCmd(
          ["forge", "build", "--no-lint", "--color", "never", "--root", root, "--out", outDir(v), "--cache-path", cacheDir(v), ...VARIANTS[v].flags],
          { cwd: root, logPath, timeoutMs: opts.timeoutMs, env: VARIANTS[v].env, onLine: (l) => board.update(id, l) },
        );
        if (res.code !== 0) {
          build.status = "failed";
          build.errorTail = tail(logPath);
          build.note = res.timedOut ? "timed out" : `exit ${res.code}, see logs/${spec.name}/${basename(logPath)}`;
          board.finish(id, "failed", build.note);
          continue;
        }
        if (!warm) build.times.push(Math.round(res.seconds * 1000) / 1000);
        board.advance(id, `${warm ? "warm-up" : `run ${i - opts.warmup}`}: ${res.seconds.toFixed(2)}s`);
        board.pause(id);
        if (i === totalFor(v)) {
          // Artifacts of the last build stay in outDir(v) and are reused by the test runs.
          build.median = median(build.times);
          result.sizes[v] = collectSizes(outDir(v), srcFiles, new Set(opts.contracts));
          const spread = build.times.length > 1 ? `, range ${Math.min(...build.times).toFixed(2)}-${Math.max(...build.times).toFixed(2)}s` : "";
          board.finish(id, "done", `median ${build.median.toFixed(2)}s${spread}`);
        }
      }
    }
    board.stop();

    if (!opts.skipTests) await testVariants(result, opts, { logs, rootFor, outDir, cacheDir, specName: spec.name });
  } catch (err) {
    board.stop();
    result.error = (err as Error).message;
  } finally {
    for (const p of [work, relaxed, ...opts.variants.flatMap((v) => [outDir(v), cacheDir(v)])]) rmSync(p, { recursive: true, force: true });
  }

  console.log("\n" + renderRepo(result, opts.top));
  return result;
}

interface TestCtx {
  logs: string;
  specName: string;
  rootFor: (v: string) => string;
  outDir: (v: string) => string;
  cacheDir: (v: string) => string;
}

async function testVariants(result: RepoResult, opts: BenchOptions, ctx: TestCtx): Promise<void> {
  const variants = [...CANDIDATES, result.baseline].filter((v) => opts.variants.includes(v) && result.builds[v]?.status === "ok");
  const wanted = new Set([...Object.values(result.sizes).flatMap((s) => Object.keys(s)), ...opts.contracts]);
  const board = new Board();
  const ids = Object.fromEntries(variants.map((v) => [v, board.add(`test ${v}`, 2)]));
  board.start();
  for (const v of variants) {
    const id = ids[v];
    const root = ctx.rootFor(v);
    const base = [
      "forge", "test", "--root", root, "--out", ctx.outDir(v), "--cache-path", ctx.cacheDir(v),
      "--fuzz-seed", String(opts.fuzzSeed), ...VARIANTS[v].flags,
    ];
    // Pass/fail uses the repo's own fuzz settings. The gas report uses fuzz inputs that do not depend on bytecode.
    const env = { ...VARIANTS[v].env, NO_COLOR: "1" };
    const gasEnv = { ...env, ...FUZZ_ENV };
    const testsJson = join(ctx.logs, `test-${v}.json`);
    const gasJson = join(ctx.logs, `gas-${v}.json`);
    const onLine = (l: string) => board.update(id, l);

    board.update(id, "running tests");
    await runCmd([...base, "--json"], { cwd: root, logPath: join(ctx.logs, `test-${v}.log`), timeoutMs: opts.timeoutMs, env, stdoutPath: testsJson, onLine });
    let tr: TestResult;
    try {
      tr = parseTests(testsJson);
    } catch (err) {
      tr = { passed: 0, failed: 0, skipped: 0, failures: [], error: `could not parse test output (${(err as Error).message}); see logs/${ctx.specName}/test-${v}.log` };
    }
    result.tests[v] = tr;
    board.advance(id, "collecting gas report");

    await runCmd([...base, "--gas-report", "--json"], { cwd: root, logPath: join(ctx.logs, `gas-${v}.log`), timeoutMs: opts.timeoutMs, env: gasEnv, stdoutPath: gasJson, onLine });
    try {
      result.gas[v] = parseGas(gasJson, wanted);
    } catch {
      result.gas[v] = {};
    }
    if (tr.error) board.finish(id, "failed", tr.error);
    else board.finish(id, tr.failed ? "failed" : "done", `${tr.passed} passed, ${tr.failed} failed, ${tr.skipped} skipped`);
  }
  board.stop();
}

export async function benchRepos(specs: RepoSpec[], opts: BenchOptions, tool: string): Promise<number> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const runDir = join(RESULTS_DIR, stamp);
  mkdirSync(runDir, { recursive: true });
  const versions: Record<string, string> = { forge: firstLine(["forge", "--version"]) };
  for (const v of CANDIDATES) {
    const cmd = VARIANTS[v].versionCmd;
    if (cmd && opts.variants.includes(v)) versions[v] = firstLine(cmd);
    if (v === SOLC_LATEST && opts.variants.includes(v)) versions[v] = SOLC_LATEST_VERSION;
  }
  const meta: Meta = {
    tool, date: new Date().toISOString(), versions,
    runs: opts.runs, viaIrRuns: opts.viaIrRuns, warmup: opts.warmup, fuzzSeed: opts.fuzzSeed, variants: opts.variants,
  };
  console.log(section("bench"));
  console.log(keyValues(Object.entries(versions).map(([k, v]) => [k, shortVersion(k, v)])));
  console.log(c.gray(`  ${opts.runs} run(s) per compiler · via-IR ${opts.viaIrRuns} · warm-up ${opts.warmup} · fuzz seed ${opts.fuzzSeed}`));

  const results: RepoResult[] = [];
  for (const [i, spec] of specs.entries()) {
    results.push(await benchRepo(spec, opts, runDir, `repo ${i + 1} of ${specs.length}`));
  }

  writeFileSync(join(runDir, "results.json"), JSON.stringify({ meta, repos: results }, null, 2));
  console.log(renderSummary(results));
  console.log(`\n${c.green("✓")} saved ${c.bold(stamp)}  ${c.gray("results.json · logs/")}`);
  return results.some((r) => r.error) ? 1 : 0;
}
