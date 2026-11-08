// Container paths and compiler variant definitions. Only used inside the sandbox image.
import { homedir } from "node:os";
import { join } from "node:path";

import type { RepoSpec } from "../spec.ts";
import { SOLC_LATEST, SOLC_LATEST_VERSION } from "../types.ts";

export const REPOS_DIR = "/repos";
export const WORK_DIR = "/work";
export const RESULTS_DIR = "/results";
export const SVM_DIR = join(homedir(), ".svm");
export const PAR_HOME_DIR = join(SVM_DIR, "par-home");

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
  // Shards each --standard-json compile across concurrent stock solc processes.
  "solc-par": { flags: [], env: { HOME: PAR_HOME_DIR, XDG_CACHE_HOME: "/tmp" }, relaxPragmas: false, versionCmd: ["echo", "0.1.2"] },
  // One recent solc for every file, with the repo's own via_ir and optimizer settings.
  [SOLC_LATEST]: { flags: ["--use", SOLC_LATEST_VERSION], env: {}, relaxPragmas: true },
  "solc-legacy": { flags: [], env: { FOUNDRY_VIA_IR: "false" }, relaxPragmas: false },
  "solc-viair": { flags: [], env: { FOUNDRY_VIA_IR: "true" }, relaxPragmas: false },
};

/**
 * Applied to the gas report run only. By default Foundry seeds fuzz inputs with constants found in the compiled
 * bytecode, so different compilers would get different inputs. Pass/fail runs keep the default, because some
 * fuzz tests need those constants to find inputs that pass their `vm.assume` checks.
 */
export const FUZZ_ENV = { FOUNDRY_FUZZ_INCLUDE_PUSH_BYTES: "false", FOUNDRY_INVARIANT_INCLUDE_PUSH_BYTES: "false" };
