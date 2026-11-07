import { mkdirSync, renameSync, rmSync } from "node:fs";

import { runSync } from "./exec.ts";

// No system/global config, no prompts, no hooks, https-only transports (including submodules).
const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
const GIT = [
  "git",
  "-c", "protocol.allow=never",
  "-c", "protocol.https.allow=always",
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "safe.directory=*",
  "-c", "advice.detachedHead=false",
];

/** Shallow clone of one ref (or HEAD) with submodules into dest, atomically via a .partial dir. */
export function clone(url: string, ref: string | null, dest: string): void {
  const partial = `${dest}.partial`;
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  const steps = [
    [...GIT, "init", "-q"],
    [...GIT, "remote", "add", "origin", url],
    [...GIT, "fetch", "-q", "--depth", "1", "origin", ref ?? "HEAD"],
    [...GIT, "checkout", "-q", "FETCH_HEAD"],
    [...GIT, "submodule", "update", "-q", "--init", "--recursive", "--depth", "1", "--jobs", "8"],
  ];
  for (const step of steps) {
    const res = runSync(step, partial, GIT_ENV);
    if (!res.ok) {
      rmSync(partial, { recursive: true, force: true });
      throw new Error(`${step.slice(-3).join(" ")}: ${res.err.trim().slice(-400)}`);
    }
  }
  renameSync(partial, dest);
}

export function gitCommit(dir: string): string {
  const res = runSync([...GIT, "-C", dir, "rev-parse", "--short=12", "HEAD"], "/", GIT_ENV);
  return res.ok ? res.out.trim() : "unknown";
}
