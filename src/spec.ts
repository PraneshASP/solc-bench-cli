// Repo spec parsing shared by the host CLI and the in-container runner.
// Specs are untrusted input: only https URLs on an allow-listed host, or a mounted local dir.

export type RepoSpec =
  | { kind: "local"; path: string; name: string }
  | { kind: "url"; url: string; ref: string | null; name: string };

export const DEFAULT_ALLOWED_HOSTS = ["github.com"];
export const LOCAL_MOUNT_ROOT = "/src";

const SEGMENT_RE = /^[A-Za-z0-9._-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9._/-]{1,200}$/;

export function isSafeName(name: string): boolean {
  return SEGMENT_RE.test(name) && name !== "." && name !== "..";
}

export function parseUrlSpec(spec: string, allowedHosts: readonly string[]): RepoSpec {
  const hashAt = spec.indexOf("#");
  const rawUrl = hashAt === -1 ? spec : spec.slice(0, hashAt);
  const ref = hashAt === -1 ? null : spec.slice(hashAt + 1);

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`not a valid URL or local directory: ${spec}`);
  }
  if (url.protocol !== "https:") throw new Error(`only https URLs are allowed: ${spec}`);
  if (url.username || url.password || url.port || url.search) {
    throw new Error(`URL must not contain credentials, port or query: ${spec}`);
  }
  if (!allowedHosts.includes(url.hostname)) {
    throw new Error(`host ${url.hostname} is not allowed (allowed: ${allowedHosts.join(", ")}); use --allow-host`);
  }
  const parts = url.pathname.replace(/\/$/, "").replace(/\.git$/, "").split("/").slice(1);
  if (parts.length !== 2 || !parts.every(isSafeName)) {
    throw new Error(`URL path must be /<owner>/<repo>: ${spec}`);
  }
  if (ref !== null && (!REF_RE.test(ref) || ref.includes("..") || ref.startsWith("-") || ref.startsWith("/"))) {
    throw new Error(`invalid git ref: ${ref}`);
  }
  const [owner, repo] = parts;
  const name = `${owner}__${repo}` + (ref ? `@${ref.replaceAll("/", "_")}` : "");
  return { kind: "url", url: `https://${url.hostname}/${owner}/${repo}`, ref, name };
}

/** Parse a spec inside the container: `/src/<name>` for mounted local repos, otherwise a URL. */
export function parseContainerSpec(spec: string, allowedHosts: readonly string[]): RepoSpec {
  const prefix = `${LOCAL_MOUNT_ROOT}/`;
  if (spec.startsWith(prefix)) {
    const name = spec.slice(prefix.length);
    if (!isSafeName(name)) throw new Error(`invalid local repo name: ${name}`);
    return { kind: "local", path: spec, name };
  }
  return parseUrlSpec(spec, allowedHosts);
}

export function allowedHostsFromEnv(value: string | undefined): string[] {
  const hosts = (value ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  return hosts.length ? hosts : DEFAULT_ALLOWED_HOSTS;
}
