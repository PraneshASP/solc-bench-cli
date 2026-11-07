export const NEW_COMPILERS = ["solar", "slang", "solx", "oksolc"] as const;
/** One recent solc for all files and the same EVM target as the new compilers. Separates compiler effects from version effects. */
export const SOLC_LATEST = "solc-latest";
export const SOLC_LATEST_VERSION = "0.8.38";
/** Variants compared with the repo baseline. */
export const CANDIDATES: readonly string[] = [...NEW_COMPILERS, SOLC_LATEST];
export const SOLC_VARIANTS = ["solc-legacy", "solc-viair"] as const;
export const ALL_VARIANTS: readonly string[] = [...CANDIDATES, ...SOLC_VARIANTS];

export interface BuildResult {
  status: "ok" | "failed" | "skipped";
  times: number[];
  median?: number;
  note?: string;
  errorTail?: string;
}

export type Sizes = Record<string, { init: number; runtime: number }>;

export interface TestResult {
  passed: number;
  failed: number;
  skipped: number;
  failures: string[];
  error?: string;
}

export interface GasFunction {
  median: number | null;
  calls: number | null;
}

export interface GasContract {
  deployment: number | null;
  functions: Record<string, GasFunction>;
}

export interface RepoResult {
  name: string;
  spec: string;
  commit: string;
  config: { viaIr: boolean; optimizer: unknown; optimizerRuns: unknown; evmVersion: string };
  sourceFiles: number;
  baseline: string;
  pragmasRelaxed: number;
  builds: Record<string, BuildResult>;
  sizes: Record<string, Sizes>;
  tests: Record<string, TestResult>;
  gas: Record<string, Record<string, GasContract>>;
  /** Order in which builds ran, shuffled per round. Includes warm-up builds. */
  buildOrder?: string[];
  error?: string;
}

export interface Meta {
  tool: string;
  date: string;
  versions: Record<string, string>;
  runs: number;
  viaIrRuns: number;
  warmup?: number;
  fuzzSeed: number;
  variants: string[];
}

export interface BenchOptions {
  runs: number;
  viaIrRuns: number;
  warmup: number;
  variants: string[];
  fuzzSeed: number;
  timeoutMs: number;
  skipTests: boolean;
  contracts: string[];
  top: number;
}
