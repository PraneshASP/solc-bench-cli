// Interactive mode: asks for repos and settings, then returns the equivalent CLI arguments.
import { cancel, confirm, intro, isCancel, multiselect, note, outro, text } from "@clack/prompts";

import { VERSION } from "./options.ts";
import { resolveRepo } from "./repos.ts";
import { DEFAULT_ALLOWED_HOSTS } from "./spec.ts";
import { ALL_VARIANTS } from "./types.ts";
import { c } from "./ui.ts";

const HINTS: Record<string, string> = {
  solar: "Paradigm, Rust",
  slang: "Nomic, Slang + LLVM, cancun+ only",
  solx: "Nomic, solc + LLVM, cancun+ only",
  oksolc: "Zig reimplementation, via-IR",
  "solc-latest": "solc 0.8.38 for all files, isolates compiler effects",
  "solc-legacy": "baseline for non via-IR repos",
  "solc-viair": "baseline for via-IR repos, slowest",
};

class Cancelled extends Error {}

function answer<T>(value: T): Exclude<T, symbol> {
  if (isCancel(value)) throw new Cancelled();
  return value as Exclude<T, symbol>;
}

const quote = (s: string): string => (/^[A-Za-z0-9_@%+=:,./#-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`);

/** Returns CLI arguments, or null if the user cancelled. */
export async function interactive(): Promise<string[] | null> {
  intro(`${c.bold("solc-bench")} ${c.dim(VERSION)}`);
  try {
    const repos: string[] = [];
    const names = new Set<string>();
    do {
      const repo = answer(await text({
        message: repos.length ? "Next repo" : "Repo to benchmark",
        placeholder: "https://github.com/owner/repo#ref or ./local/path",
        validate: (value) => {
          const v = (value ?? "").trim();
          if (!v) return "Enter a GitHub URL or a local directory";
          try {
            const { name } = resolveRepo(v, DEFAULT_ALLOWED_HOSTS);
            if (names.has(name)) return `Already added: ${name}`;
          } catch (err) {
            return (err as Error).message;
          }
          return undefined;
        },
      })).trim();
      repos.push(repo);
      names.add(resolveRepo(repo, DEFAULT_ALLOWED_HOSTS).name);
    } while (answer(await confirm({ message: "Add another repo?", initialValue: false })));

    const variants = answer(await multiselect({
      message: "Compilers",
      options: ALL_VARIANTS.map((v) => ({ value: v, label: v, hint: HINTS[v] })),
      initialValues: [...ALL_VARIANTS],
      required: true,
    }));

    const runs = answer(await text({
      message: "Clean builds per compiler",
      initialValue: "3",
      validate: (value) => (/^([1-9]|[1-9][0-9])$/.test((value ?? "").trim()) ? undefined : "Enter a number from 1 to 99"),
    })).trim();

    const tests = answer(await confirm({ message: "Run tests and gas report?", initialValue: true }));

    const args = [
      "--runs", runs,
      ...(variants.length === ALL_VARIANTS.length ? [] : ["--variants", variants.join(",")]),
      ...(tests ? [] : ["--skip-tests"]),
      ...repos,
    ];
    if (!variants.includes("solc-viair") && !variants.includes("solc-legacy")) {
      note("No solc variant selected: comparisons need the repo's baseline (solc-viair or solc-legacy).", "Heads up");
    }
    note(c.dim(["solc-bench", ...args].map(quote).join(" ")), "Equivalent command");

    if (!answer(await confirm({ message: "Start?", initialValue: true }))) throw new Cancelled();
    outro("Starting sandboxed benchmark");
    return args;
  } catch (err) {
    if (err instanceof Cancelled) {
      cancel("Cancelled");
      return null;
    }
    throw err;
  }
}
