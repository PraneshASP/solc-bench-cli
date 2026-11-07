// Dependency-free terminal output: live step board, section headers, minimal tables and bars.

const isTTY = process.stdout.isTTY === true;
const useColor = isTTY && !process.env.NO_COLOR;
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;
// Escape sequences other than SGR colors (OSC, cursor movement, ...) and C0/C1 control chars except tab/newline.
// ESC itself is excluded from the char class so the SGR exemption in the first branch holds.
const UNSAFE_RE = /\x1b(?!\[[0-9;]*m)(\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(\x07|\x1b\\)?|.)?|[\x00-\x08\x0b-\x1a\x1c-\x1f\x7f-\x9f]/g;

const wrap = (code: string) => (s: string): string => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  bold: wrap("1"),
  dim: wrap("2"),
  italic: wrap("3"),
  red: wrap("31"),
  green: wrap("32"),
  yellow: wrap("33"),
  blue: wrap("34"),
  magenta: wrap("35"),
  cyan: wrap("36"),
  gray: wrap("90"),
};

export const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");
/** Remove terminal control sequences that could come from untrusted repo output, keeping colors. */
export const sanitize = (s: string): string => s.replace(UNSAFE_RE, "");
export const visible = (s: string): number => [...stripAnsi(s)].length;
const termWidth = (): number => Math.max(60, process.stdout.columns || Number(process.env.COLUMNS) || 100);

export function truncate(s: string, max: number): string {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, Math.max(0, max - 1)).join("") + "…";
}

function pad(s: string, width: number, align: Align): string {
  const fill = " ".repeat(Math.max(0, width - visible(s)));
  return align === "r" ? fill + s : s + fill;
}

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Display form of a repo name: owner__repo@ref -> owner/repo@ref */
export const repoLabel = (name: string): string => name.replace("__", "/");

/** `◆ title  detail` section header. */
export function section(title: string, detail = ""): string {
  return `\n${c.cyan("◆")} ${c.bold(sanitize(title))}${detail ? "  " + c.gray(sanitize(detail)) : ""}`;
}

/** Aligned dim key/value lines under a section. */
export function keyValues(pairs: [string, string][]): string {
  const width = Math.max(...pairs.map(([k]) => k.length));
  return pairs.map(([k, v]) => `  ${c.gray(k.padEnd(width))}  ${truncate(sanitize(v), termWidth() - width - 6)}`).join("\n");
}

/** Horizontal bar for a 0..1 fraction. */
export function bar(fraction: number, width: number, color: (s: string) => string = c.cyan): string {
  const f = Math.max(0, Math.min(1, fraction));
  const full = Math.floor(f * width);
  const partial = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"][Math.round((f * width - full) * 7)] ?? "";
  const body = "█".repeat(full) + partial;
  return color(body || "▏") + " ".repeat(Math.max(0, width - [...(body || "▏")].length));
}

export type Align = "l" | "r";

/**
 * Borderless table:
 *   Title  subtitle
 *
 *   col       col
 *   ───────   ───
 *   cell      cell
 */
export function table(title: string, headers: string[], rows: string[][], align: Align[], subtitle = ""): string {
  const cells = rows.map((r) => r.map((x) => sanitize(x ?? "")));
  const keep = headers.map((h, i) => h !== "" || cells.some((r) => stripAnsi(r[i] ?? "").trim() !== ""));
  const cols = headers.map((_, i) => i).filter((i) => keep[i]);
  const widths = cols.map((i) => Math.max(visible(headers[i]), ...cells.map((r) => visible(r[i] ?? ""))));
  const line = (parts: string[]) => "  " + parts.map((p, j) => pad(p, widths[j], align[cols[j]] ?? "l")).join("   ").trimEnd();
  return [
    `  ${c.bold(sanitize(title))}${subtitle ? "  " + c.gray(sanitize(subtitle)) : ""}`,
    "",
    line(cols.map((i) => c.gray(headers[i]))),
    line(widths.map((w) => c.gray("─".repeat(w)))),
    ...cells.map((r) => line(cols.map((i) => r[i] ?? ""))),
  ].join("\n");
}

export type StepState = "queued" | "running" | "done" | "failed" | "skipped";

interface Step {
  label: string;
  total: number;
  done: number;
  state: StepState;
  status: string;
  startedAt: number | null;
  endedAt: number | null;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BAR_WIDTH = 12;

/** Live-updating list of steps. Redraws in place on a TTY; prints one line per finished step otherwise. */
export class Board {
  private steps: Step[] = [];
  private renderedLines = 0;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (isTTY) {
      process.stdout.write("\x1b[?25l");
      this.timer = setInterval(() => this.render(), 80);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (isTTY) {
      this.render();
      process.stdout.write("\x1b[?25h");
    }
    this.renderedLines = 0;
  }

  add(label: string, total: number): number {
    this.steps.push({ label: sanitize(label), total, done: 0, state: "queued", status: "", startedAt: null, endedAt: null });
    return this.steps.length - 1;
  }

  update(id: number, status: string): void {
    const step = this.steps[id];
    if (step.state === "queued") {
      step.state = "running";
      step.startedAt = Date.now();
    }
    step.status = sanitize(status);
  }

  advance(id: number, status: string): void {
    this.update(id, status);
    this.steps[id].done = Math.min(this.steps[id].total, this.steps[id].done + 1);
  }

  finish(id: number, state: Exclude<StepState, "queued" | "running">, status: string): void {
    const step = this.steps[id];
    step.startedAt ??= Date.now();
    step.endedAt = Date.now();
    step.state = state;
    step.status = sanitize(status);
    if (state === "done") step.done = step.total;
    if (!isTTY) {
      const tag = state === "done" ? "ok  " : state === "failed" ? "FAIL" : "skip";
      console.log(`  ${tag} ${step.label}: ${stripAnsi(step.status)}`);
    }
  }

  private line(step: Step, labelWidth: number): string {
    const icon =
      step.state === "running" ? c.cyan(SPINNER[this.frame % SPINNER.length])
      : step.state === "done" ? c.green("✓")
      : step.state === "failed" ? c.red("✗")
      : step.state === "skipped" ? c.yellow("○")
      : c.gray("·");
    const text = pad(truncate(step.label, labelWidth), labelWidth, "l");
    const label = step.state === "queued" ? c.gray(text) : text;
    const progress =
      step.state === "running" && step.total > 1
        ? bar(step.done / step.total, BAR_WIDTH, c.cyan) + " "
        : step.state === "running" ? c.gray("·".repeat(BAR_WIDTH)) + " " : "";
    const elapsed = step.startedAt ? c.gray(formatDuration((step.endedAt ?? Date.now()) - step.startedAt).padStart(5)) : "     ";
    const fixed = `  ${icon} ${label}  ${elapsed}  ${progress}`;
    const status = truncate(stripAnsi(step.status), Math.max(10, termWidth() - visible(fixed) - 1));
    const colored =
      step.state === "failed" ? c.red(status)
      : step.state === "skipped" ? c.yellow(status)
      : step.state === "done" ? status
      : c.gray(status);
    return fixed + colored;
  }

  private render(): void {
    this.frame++;
    const labelWidth = Math.min(36, Math.max(...this.steps.map((s) => visible(s.label))));
    let out = this.renderedLines ? `\x1b[${this.renderedLines}A` : "";
    for (const step of this.steps) out += `\x1b[2K${this.line(step, labelWidth)}\n`;
    process.stdout.write(out);
    this.renderedLines = this.steps.length;
  }
}

/** "forge Version: 1.9.0" -> "1.9.0", "slang v0.2.0, LLVM-based ..." -> "v0.2.0" */
export function shortVersion(name: string, line: string): string {
  return line.replace(/^\S+ Version:\s*/, "").replace(new RegExp(`^${name}\\s+`), "").split(",")[0].trim();
}

/** ISO timestamp -> "2026-11-06 15:18 UTC" */
export const shortDate = (iso: string): string => (/^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(iso) ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso);
