#!/usr/bin/env node
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { BENCH_FLAGS, VERSION, benchArgs, parseBenchOptions } from "./options.ts";
import { renderRepo, renderSummary } from "./report/terminal.ts";
import { IMAGE, buildImage, clean, ensureDocker, runBench, runFetch } from "./sandbox.ts";
import { resolveRepos } from "./repos.ts";
import { DEFAULT_ALLOWED_HOSTS } from "./spec.ts";
import type { Meta, RepoResult } from "./types.ts";
import { ALL_VARIANTS } from "./types.ts";
import { c, keyValues, repoLabel, section, shortDate, shortVersion } from "./ui.ts";

const HELP = `${c.bold("solc-bench")} ${c.dim(VERSION)}
Benchmark Solidity compilers (Solar, Slang, solx, oksolc) against solc on Foundry repos, in a sandbox.

${c.bold("usage")}
  solc-bench                         interactive mode (in a terminal)
  solc-bench [options] <repo>...     benchmark one or more repos
  solc-bench report <run-dir|json>   print a saved run as terminal tables
  solc-bench clean                   remove the sandbox image and cache volumes

  repo: https://github.com/<owner>/<repo>[#ref] or a local directory

${c.bold("benchmark")}
  --runs N            clean builds per compiler (3)
  --via-ir-runs N     clean builds for slow via-IR solc builds (--runs)
  --warmup N          untimed builds per compiler before timing (1)
  --variants LIST     ${ALL_VARIANTS.join(",")} (all)
  --fuzz-seed N       fuzz seed shared by all compilers (1)
  --timeout SECS      per forge command (3600)
  --contracts LIST    extra contract names to report, e.g. from dependencies
  --top N             rows per terminal table (12)
  --skip-tests        builds and bytecode size only
  --out DIR           results directory (./solc-bench-results)

${c.bold("sandbox")}
  --allow-host HOST   allow cloning from another https host (repeatable; github.com)
  --cpus N            CPU limit (all)
  --memory SIZE       memory limit (8g)
  --work-size SIZE    in-memory workspace size (6g)
  --no-build          reuse the existing image

  -h, --help          show this help
  -v, --version       show version`;

const SIZE_RE = /^\d{1,5}[kmg]$/i;
const CPUS_RE = /^\d{1,3}(\.\d{1,2})?$/;
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

function report(target: string): number {
  const file = statSync(target).isDirectory() ? join(target, "results.json") : target;
  const data = JSON.parse(readFileSync(file, "utf8")) as { meta?: Meta; repos?: RepoResult[] };
  check(Array.isArray(data.repos), `${file} is not an solc-bench results file`);
  const repos = data.repos as RepoResult[];
  console.log(section("solc-bench report", data.meta ? shortDate(String(data.meta.date)) : file));
  if (data.meta?.versions) console.log(keyValues(Object.entries(data.meta.versions).map(([k, v]) => [k, shortVersion(k, String(v))])));
  for (const r of repos) console.log(`${section(repoLabel(r.name), r.commit)}\n\n${renderRepo(r, 12)}`);
  console.log(renderSummary(repos));
  return 0;
}

async function bench(values: Record<string, unknown>, positionals: string[]): Promise<number> {
  const opts = parseBenchOptions(values);
  const hosts = [...DEFAULT_ALLOWED_HOSTS, ...((values["allow-host"] as string[] | undefined) ?? []).map((h) => h.toLowerCase())];
  for (const h of hosts) check(HOST_RE.test(h), `invalid host: ${h}`);
  const memory = (values.memory as string | undefined) ?? "8g";
  const workSize = (values["work-size"] as string | undefined) ?? "6g";
  const cpus = values.cpus as string | undefined;
  check(SIZE_RE.test(memory), `invalid --memory: ${memory}`);
  check(SIZE_RE.test(workSize), `invalid --work-size: ${workSize}`);
  check(cpus === undefined || CPUS_RE.test(cpus), `invalid --cpus: ${cpus}`);

  const repos = resolveRepos(positionals, hosts);
  const specs = repos.map((r) => r.spec);
  const mounts = repos.flatMap((r) => r.mount);

  const resultsDir = resolve((values.out as string | undefined) ?? "solc-bench-results");
  mkdirSync(resultsDir, { recursive: true });

  console.log(section(`solc-bench ${VERSION}`, `${specs.length} repo(s) · ${opts.variants.join(" · ")}`) + "\n");
  ensureDocker();
  if (!values["no-build"]) await buildImage();

  const cfg = { hosts, mounts, resultsDir, memory, cpus, workSize };
  if ((await runFetch(cfg, specs)) !== 0) console.error(c.yellow(" fetch reported failures; affected repos will show errors"));
  const code = await runBench(cfg, specs, benchArgs(opts));
  console.log(c.gray(`  in ${resultsDir}  ·  view again: solc-bench report <run-dir>\n`));
  return code;
}

async function main(): Promise<number> {
  let args = process.argv.slice(2);
  if (!args.length && process.stdin.isTTY && process.stdout.isTTY) {
    const { interactive } = await import("./interactive.ts");
    const answers = await interactive();
    if (!answers) return 130;
    args = answers;
  }
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      ...BENCH_FLAGS,
      out: { type: "string" },
      "allow-host": { type: "string", multiple: true },
      cpus: { type: "string" },
      memory: { type: "string" },
      "work-size": { type: "string" },
      "no-build": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (values.version) {
    console.log(VERSION);
    return 0;
  }
  if (values.help || !positionals.length) {
    console.log(HELP);
    return values.help ? 0 : 2;
  }

  const [command, ...rest] = positionals;
  if (command === "report") {
    check(rest.length === 1, "usage: solc-bench report <run-dir|results.json>");
    return report(rest[0]);
  }
  if (command === "clean" && rest.length === 0) {
    ensureDocker();
    clean();
    console.log(c.green(` removed ${IMAGE.split(":")[0]} images and cache volumes`));
    return 0;
  }
  return bench(values, positionals);
}

main().then(
  (code) => process.exit(code),
  (err: Error) => {
    if (process.stdout.isTTY) process.stdout.write("\x1b[?25h");
    console.error(c.red(`error: ${err.message}`));
    process.exit(2);
  },
);
