// Host-side resolution of a repo argument: an allow-listed https URL or a local directory (mounted read-only).
import { realpathSync, statSync } from "node:fs";
import { basename } from "node:path";

import { LOCAL_MOUNT_ROOT, isSafeName, parseUrlSpec } from "./spec.ts";

export interface ResolvedRepo {
  name: string;
  /** spec passed to the container */
  spec: string;
  /** docker -v arguments for local repos */
  mount: string[];
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function resolveRepo(arg: string, hosts: readonly string[]): ResolvedRepo {
  if (isDirectory(arg)) {
    const dir = realpathSync(arg);
    const name = basename(dir);
    if (!isSafeName(name)) throw new Error(`local directory name must match [A-Za-z0-9._-]: ${dir}`);
    if (dir.includes(":") || dir.includes(",")) throw new Error(`local path must not contain ':' or ',': ${dir}`);
    return { name, spec: `${LOCAL_MOUNT_ROOT}/${name}`, mount: ["-v", `${dir}:${LOCAL_MOUNT_ROOT}/${name}:ro`] };
  }
  return { name: parseUrlSpec(arg, hosts).name, spec: arg, mount: [] };
}

export function resolveRepos(args: string[], hosts: readonly string[]): ResolvedRepo[] {
  const seen = new Set<string>();
  return args.map((arg) => {
    const repo = resolveRepo(arg, hosts);
    if (seen.has(repo.name)) throw new Error(`duplicate repo: ${repo.name}`);
    seen.add(repo.name);
    return repo;
  });
}
