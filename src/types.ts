export const CANDIDATES = ["solar", "slang", "solx", "oksolc"] as const;
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
  error?: string;
}

export interface Meta {
  tool: string;
  date: string;
  versions: Record<string, string>;
  runs: number;
  viaIrRuns: number;
  fuzzSeed: number;
  variants: string[];
}

export interface BenchOptions {
  runs: number;
  viaIrRuns: number;
  variants: string[];
  fuzzSeed: number;
  timeoutMs: number;
  skipTests: boolean;
  contracts: string[];
  top: number;
}
