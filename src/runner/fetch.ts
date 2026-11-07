// Phase 1 (network on): clone repos and cache the solc versions they need. Nothing from the repos is compiled.
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { RepoSpec } from "../spec.ts";
import { Board, repoLabel, section } from "../ui.ts";
import { SVM_DIR, repoDir } from "./env.ts";
import { installSolc, resolveSolc } from "./forge.ts";
import { clone } from "./git.ts";

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
      for (const v of versions) {
        if (existsSync(join(SVM_DIR, v, `solc-${v}`))) continue;
        board.update(id, `installing solc ${v}`);
        installSolc(v);
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
