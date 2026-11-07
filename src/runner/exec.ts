import { spawn, spawnSync } from "node:child_process";
import { closeSync, createWriteStream, mkdirSync, openSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { stripAnsi } from "../ui.ts";

export interface CmdResult {
  code: number | null;
  seconds: number;
  timedOut: boolean;
}

export interface CmdOptions {
  cwd: string;
  logPath: string;
  timeoutMs: number;
  env?: Record<string, string>;
  stdoutPath?: string;
  onLine?: (line: string) => void;
}

/** Run a command without a shell, tee output to a log and report the latest output line. */
export function runCmd(cmd: string[], opts: CmdOptions): Promise<CmdResult> {
  mkdirSync(dirname(opts.logPath), { recursive: true });
  const log = createWriteStream(opts.logPath);
  log.write(`$ ${cmd.join(" ")}\n`);
  const stdoutFd = opts.stdoutPath ? openSync(opts.stdoutPath, "w") : null;
  const started = process.hrtime.bigint();

  return new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", stdoutFd ?? "pipe", "pipe"],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    const pending: Record<string, string> = {};
    const onData = (key: string) => (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      log.write(text);
      const lines = ((pending[key] ?? "") + text).split(/\r?\n|\r/);
      pending[key] = lines.pop() ?? "";
      const last = lines.map((l) => stripAnsi(l).trim()).filter(Boolean).pop();
      if (last && opts.onLine) opts.onLine(last);
    };
    child.stdout?.on("data", onData("out"));
    child.stderr?.on("data", onData("err"));

    child.on("close", (code) => {
      clearTimeout(timer);
      if (stdoutFd !== null) closeSync(stdoutFd);
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      if (timedOut) log.write(`\n[runner] killed after ${opts.timeoutMs / 1000}s timeout\n`);
      log.end(() => resolve({ code, seconds, timedOut }));
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (stdoutFd !== null) closeSync(stdoutFd);
      log.end(`\n[runner] failed to start: ${err.message}\n`, () => resolve({ code: -1, seconds: 0, timedOut: false }));
    });
  });
}

export function runSync(cmd: string[], cwd: string, env: Record<string, string> = {}): { ok: boolean; out: string; err: string } {
  const res = spawnSync(cmd[0], cmd.slice(1), { cwd, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: res.status === 0, out: res.stdout ?? "", err: (res.stderr ?? "") + (res.error ? res.error.message : "") };
}

export function firstLine(cmd: string[]): string {
  return runSync(cmd, "/").out.split("\n")[0]?.trim() || "unknown";
}

export function tail(path: string, n = 15): string {
  try {
    return readFileSync(path, "utf8").split("\n").slice(-n).join("\n");
  } catch {
    return "";
  }
}

export function walk(dir: string): string[] {
  try {
    return (readdirSync(dir, { recursive: true }) as string[]).map((p) => join(dir, p));
  } catch {
    return [];
  }
}
