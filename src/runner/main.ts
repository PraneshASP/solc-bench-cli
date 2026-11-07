// Container entry point. Never run on the host: `solc-bench` launches it inside the sandbox.
//   fetch <specs...>            network on, clone and cache solc
//   bench [options] <specs...>  network off, build/test/report
import { parseArgs } from "node:util";

import { BENCH_FLAGS, VERSION, parseBenchOptions } from "../options.ts";
import { allowedHostsFromEnv, parseContainerSpec } from "../spec.ts";
import type { RepoSpec } from "../spec.ts";
import { c } from "../ui.ts";
import { benchRepos } from "./bench.ts";
import { fetchRepos } from "./fetch.ts";

function parseSpecs(positionals: string[]): RepoSpec[] {
  if (!positionals.length) throw new Error("no repos given");
  const hosts = allowedHostsFromEnv(process.env.BENCH_ALLOWED_HOSTS);
  const specs = positionals.map((p) => parseContainerSpec(p, hosts));
  const names = new Set<string>();
  for (const s of specs) {
    if (names.has(s.name)) throw new Error(`duplicate repo: ${s.name}`);
    names.add(s.name);
  }
  return specs;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: BENCH_FLAGS });
  const specs = parseSpecs(positionals);
  if (command === "fetch") return fetchRepos(specs);
  if (command === "bench") return benchRepos(specs, parseBenchOptions(values), `solc-bench ${VERSION}`);
  throw new Error(`unknown command: ${command}`);
}

main().then(
  (code) => process.exit(code),
  (err: Error) => {
    if (process.stdout.isTTY) process.stdout.write("\x1b[?25h");
    console.error(c.red(`error: ${err.message}`));
    process.exit(2);
  },
);
