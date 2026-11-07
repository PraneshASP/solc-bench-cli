// Host side: build the sandbox image and run the two container phases with hardened docker flags.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { VERSION } from "./options.ts";
import { Board } from "./ui.ts";

export const IMAGE = `solc-bench:${VERSION}`;
export const VOLUMES = { repos: "solc-bench-repo-cache", svm: "solc-bench-solc-cache" } as const;
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const UID = "10001";

export interface SandboxConfig {
  hosts: string[];
  mounts: string[];
  resultsDir: string;
  memory: string;
  cpus?: string;
  workSize: string;
}

function docker(args: string[], onLine?: (line: string) => void): Promise<{ code: number; tail: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: onLine ? ["ignore", "pipe", "pipe"] : "inherit" });
    let tail = "";
    const onData = (chunk: Buffer) => {
      tail = (tail + chunk.toString("utf8")).slice(-4000);
      const last = chunk.toString("utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
      if (last) onLine?.(last);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (err) => reject(new Error(`cannot run docker: ${err.message}`)));
    child.on("close", (code) => resolve({ code: code ?? 1, tail }));
  });
}

export function ensureDocker(): void {
  if (spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0) return;
  // OrbStack is the expected runtime on macOS; start it if the daemon is down.
  if (spawnSync("orb", ["start"], { stdio: "inherit" }).status !== 0 || spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    throw new Error("docker is not running (start OrbStack or Docker Desktop)");
  }
}

export async function buildImage(): Promise<void> {
  const board = new Board();
  const id = board.add("sandbox image", 1);
  board.start();
  board.update(id, `building ${IMAGE} (first build compiles oksolc, takes a few minutes)`);
  const res = await docker(["build", "--progress=plain", "-t", IMAGE, PACKAGE_ROOT], (l) => board.update(id, l));
  if (res.code !== 0) {
    board.finish(id, "failed", "docker build failed");
    board.stop();
    throw new Error(`image build failed:\n${res.tail}`);
  }
  board.finish(id, "done", IMAGE);
  board.stop();
}

function hardened(cfg: SandboxConfig): string[] {
  return [
    "run", "--rm", "--init", ...(process.stdout.isTTY ? ["-t"] : []),
    "--user", `${UID}:${UID}`,
    "--read-only",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", "1024",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=1g",
    "--tmpfs", `/home/bench/.foundry:rw,noexec,nosuid,nodev,size=256m,uid=${UID},gid=${UID}`,
    "-e", `TERM=${/^[A-Za-z0-9-]{1,40}$/.test(process.env.TERM ?? "") ? process.env.TERM : "xterm-256color"}`,
    "-e", `COLUMNS=${process.stdout.columns || 120}`,
    "-e", `BENCH_ALLOWED_HOSTS=${cfg.hosts.join(",")}`,
    ...(process.env.NO_COLOR ? ["-e", "NO_COLOR=1"] : []),
  ];
}

/** Phase 1: network on. Writes only to the clone and solc cache volumes; nothing from the repos is compiled. */
export async function runFetch(cfg: SandboxConfig, specs: string[]): Promise<number> {
  const res = await docker([
    ...hardened(cfg),
    "-v", `${VOLUMES.repos}:/repos`,
    "-v", `${VOLUMES.svm}:/home/bench/.svm`,
    ...cfg.mounts,
    IMAGE, "fetch", ...specs,
  ]);
  return res.code;
}

/** Phase 2: no network, sources and compilers read-only; the results dir is the only writable host path. */
export async function runBench(cfg: SandboxConfig, specs: string[], args: string[]): Promise<number> {
  const res = await docker([
    ...hardened(cfg),
    "--network", "none",
    "--memory", cfg.memory, "--memory-swap", cfg.memory,
    ...(cfg.cpus ? ["--cpus", cfg.cpus] : []),
    "--tmpfs", `/work:rw,noexec,nosuid,nodev,size=${cfg.workSize},uid=${UID},gid=${UID}`,
    "-e", "FOUNDRY_OFFLINE=true",
    "-v", `${VOLUMES.repos}:/repos:ro`,
    "-v", `${VOLUMES.svm}:/home/bench/.svm:ro`,
    "-v", `${cfg.resultsDir}:/results`,
    ...cfg.mounts,
    IMAGE, "bench", ...args, ...specs,
  ]);
  return res.code;
}

/** Remove this tool's image(s) and cache volumes. */
export function clean(): void {
  const images = spawnSync("docker", ["images", "-q", "solc-bench"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  if (images.length) spawnSync("docker", ["image", "rm", "-f", ...new Set(images)], { stdio: "inherit" });
  spawnSync("docker", ["volume", "rm", VOLUMES.repos, VOLUMES.svm], { stdio: "inherit" });
}
