// Container paths and compiler variant definitions. Only used inside the sandbox image.
import { homedir } from "node:os";
import { join } from "node:path";

import type { RepoSpec } from "../spec.ts";

export const REPOS_DIR = "/repos";
export const WORK_DIR = "/work";
export const RESULTS_DIR = "/results";
export const SVM_DIR = join(homedir(), ".svm");

export const repoDir = (spec: RepoSpec): string => (spec.kind === "local" ? spec.path : join(REPOS_DIR, spec.name));

export interface Variant {
  /** forge flags selecting the compiler */
  flags: string[];
  /** env overrides applied to forge */
  env: Record<string, string>;
  /** compiler reports one fixed solc version, so pinned pragmas must be relaxed in a separate copy */
  relaxPragmas: boolean;
  /** supported evm_version values; undefined means any */
  evmVersions?: ReadonlySet<string>;
  /** command printing a one-line version */
  versionCmd?: string[];
}

const CANCUN_PLUS = new Set(["cancun", "prague", "osaka"]);

export const VARIANTS: Record<string, Variant> = {
  solar: { flags: ["--use", "solar"], env: {}, relaxPragmas: false, versionCmd: ["solar", "--version"] },
  slang: {
    flags: ["--use", "/usr/local/bin/slang"], env: {}, relaxPragmas: true, evmVersions: CANCUN_PLUS,
    versionCmd: ["/usr/local/bin/slang", "--version"],
  },
  solx: {
    flags: ["--use", "/usr/local/bin/solx"], env: {}, relaxPragmas: true, evmVersions: CANCUN_PLUS,
    versionCmd: ["/usr/local/bin/solx", "--version"],
  },
  // oksolc only supports the optimized via-IR pipeline.
  oksolc: {
    flags: ["--use", "/usr/local/bin/oksolc"], env: { FOUNDRY_VIA_IR: "true", FOUNDRY_OPTIMIZER: "true" }, relaxPragmas: true,
    versionCmd: ["/usr/local/bin/oksolc", "version"],
  },
  "solc-legacy": { flags: [], env: { FOUNDRY_VIA_IR: "false" }, relaxPragmas: false },
  "solc-viair": { flags: [], env: { FOUNDRY_VIA_IR: "true" }, relaxPragmas: false },
};
