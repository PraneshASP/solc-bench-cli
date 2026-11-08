// Phase 1 (network on): clone repos and cache the solc versions they need. Nothing from the repos is compiled.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { RepoSpec } from "../spec.ts";
import { SOLC_LATEST_VERSION } from "../types.ts";
import { Board, repoLabel, section } from "../ui.ts";
import { PAR_HOME_DIR, SVM_DIR, repoDir } from "./env.ts";
import { installSolc, resolveSolc } from "./forge.ts";
import { clone } from "./git.ts";

function ensureParSvm(v: string): void {
  const dir = join(PAR_HOME_DIR, ".svm", v);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `solc-${v}`), `#!/bin/sh\nSOLC_PAR_SOLC="${join(SVM_DIR, v, `solc-${v}`)}" exec /usr/local/bin/solc-par "$@"\n`, { mode: 0o755 });
}

export function fetchRepos(specs: RepoSpec[]): number {
  console.log(section("fetch") + "\n");
  const board = new Board();
  const ids = specs.map((s) => board.add(repoLabel(s.name), 3));
  board.start();
  let failures = 0;
  for (const [i, spec] of specs.entries()) {
    const id = ids[i];
    const dir = repoDir(spec);
    try {
      if (spec.kind === "url") {
        if (existsSync(join(dir, ".git"))) {
          board.advance(id, "reusing cached clone");
        } else {
          board.update(id, `cloning ${spec.url}${spec.ref ? `#${spec.ref}` : ""}`);
          clone(spec.url, spec.ref, dir);
          board.advance(id, "cloned");
        }
      } else {
        if (!existsSync(dir)) throw new Error(`local path not mounted: ${dir}`);
        board.advance(id, "local repo");
      }

      board.update(id, "resolving solc versions");
      const versions = resolveSolc(dir);
      board.advance(id, `needs solc ${versions.join(", ") || "none"}`);
      // The solc-latest variant compiles every repo with one fixed version.
      for (const v of new Set([...versions, SOLC_LATEST_VERSION])) {
        if (!existsSync(join(SVM_DIR, v, `solc-${v}`))) {
          board.update(id, `installing solc ${v}`);
          installSolc(v);
        }
        ensureParSvm(v);
      }
      board.finish(id, "done", `solc ${versions.join(", ") || "none"} cached`);
    } catch (err) {
      failures++;
      board.finish(id, "failed", (err as Error).message);
    }
  }
  board.stop();
  return failures ? 1 : 0;
}
