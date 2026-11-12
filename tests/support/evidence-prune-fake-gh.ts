/**
 * An in-memory GitHub, served through the same `run(cmd, args, opts)` shape the
 * evidence-prune CLI uses for its real `gh` child, so the prune is exercised end
 * to end without touching the network (CodySwannGT/lisa#4720).
 *
 * Every call is recorded, which is what lets a test prove a dry run made zero
 * writes and that an archive copy was confirmed before its original was
 * deleted. Faults (a truncated listing, a corrupt read-back, a missing digest)
 * are switched on per test through {@link FakeOptions}.
 * @module tests/support/evidence-prune-fake-gh
 */
import { createHash } from "node:crypto";

export const REPOSITORY = "acme/code";
const ROOT = `repos/${REPOSITORY}`;
const UPLOAD_PREFIX = `https://uploads.github.com/${ROOT}/releases/`;
const NOT_FOUND = { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
const OK = "";
const PAGE = 100;
/** What GitHub answers an upload whose body length it was not told. */
const BAD_LENGTH = {
  status: 1,
  stdout: "",
  stderr: "gh: Bad Content-Length (HTTP 400)",
};

/**
 * Whether an upload carries the headers GitHub's upload host requires:
 * `Content-Length` equal to the stdin byte count, and an octet-stream type.
 * Measured against the real host: without the length it answers HTTP 400.
 * @param args - The `gh api` arguments.
 * @param input - Bytes on stdin.
 * @returns True when both headers are present and correct.
 */
function uploadHeadersMatch(args: string[], input: Buffer): boolean {
  const headers = args.filter((_, index) => args[index - 1] === "--header");
  return (
    headers.includes(`Content-Length: ${input.length}`) &&
    headers.includes("Content-Type: application/octet-stream")
  );
}

/** One stored release asset. */
export interface FakeAsset {
  id: number;
  name: string;
  size: number;
  created_at: string;
  digest?: string | null;
  bytes: Buffer;
  /** GitHub's upload state; a half-finished upload is not `uploaded`. */
  state?: string;
}

/** One stored release. */
interface FakeRelease {
  id: number;
  tag: string;
  assets: FakeAsset[];
}

/** Faults and access a test switches on. */
export interface FakeOptions {
  authenticated?: boolean;
  push?: boolean;
  /** Drop the last page of a listing, as a cut-off pagination would. */
  truncateListing?: boolean;
  /** Store different bytes than were uploaded, so the read-back mismatches. */
  corruptUploads?: boolean;
  /** Omit the `digest` field from every asset, forcing a download-and-hash. */
  noDigests?: boolean;
  /** Drop the last page of the repository's release listing. */
  truncateReleases?: boolean;
  /**
   * Store different bytes than were uploaded while reporting the uploaded
   * bytes' digest, so only a read-back that downloads catches it.
   */
  forgeDigest?: boolean;
  /** `gh` is not installed: the child never starts. */
  ghMissing?: boolean;
  /** Every asset delete fails. */
  failDelete?: boolean;
  /** Runs after each archive upload, to stage a concurrent publisher. */
  onUpload?: () => void;
}

/** One recorded `gh` invocation. */
export interface FakeCall {
  args: string[];
  write: boolean;
}

/** The fake's whole mutable world. */
interface FakeState {
  releases: Map<string, FakeRelease>;
  calls: FakeCall[];
  counter: { next: number };
  options: FakeOptions;
}

/** What the fake `gh` returns, shaped like a spawn result. */
interface FakeResult {
  status: number | null;
  stdout: string | Buffer;
  stderr: string;
  error?: Error;
}

/**
 * The sha256 of some bytes, as lowercase hex.
 * @param bytes - Content to hash.
 * @returns Hex digest.
 */
export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A successful JSON answer.
 * @param value - Payload.
 * @returns Spawn-shaped result.
 */
function json(value: unknown): FakeResult {
  return { status: 0, stdout: JSON.stringify(value), stderr: OK };
}

/**
 * Create an empty release.
 * @param state - Fake world.
 * @param tag - Release tag.
 * @returns The release.
 */
function addRelease(state: FakeState, tag: string): FakeRelease {
  const release = { id: state.counter.next++, tag, assets: [] };
  state.releases.set(tag, release);
  return release;
}

/**
 * Store one asset, creating its release when absent.
 * @param state - Fake world.
 * @param tag - Release tag.
 * @param name - Asset name.
 * @param createdAt - Upload time.
 * @param content - Asset bytes.
 * @returns The stored asset.
 */
function addAsset(
  state: FakeState,
  tag: string,
  name: string,
  createdAt: string,
  content: string | Buffer = `bytes of ${name}`
): FakeAsset {
  const release = state.releases.get(tag) ?? addRelease(state, tag);
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const asset: FakeAsset = {
    id: state.counter.next++,
    name,
    size: bytes.length,
    created_at: createdAt,
    digest: `sha256:${sha256(bytes)}`,
    bytes,
  };
  release.assets.push(asset);
  return asset;
}

/**
 * Native-shaped metadata for one asset.
 * @param state - Fake world.
 * @param asset - The asset.
 * @param release - Its release.
 * @returns Metadata as GitHub reports it.
 */
function metadata(state: FakeState, asset: FakeAsset, release: FakeRelease) {
  return {
    id: asset.id,
    name: asset.name,
    size: asset.size,
    state: asset.state ?? "uploaded",
    created_at: asset.created_at,
    browser_download_url: `https://github.com/${REPOSITORY}/releases/download/${release.tag}/${asset.name}`,
    ...(state.options.noDigests ? {} : { digest: asset.digest ?? null }),
  };
}

/**
 * A release's listing: all pages slurped, or one explicit page.
 * @param state - Fake world.
 * @param id - Release id.
 * @param page - One-based page number, when one page was asked for.
 * @returns Spawn-shaped result.
 */
function listing(state: FakeState, id: number, page?: number): FakeResult {
  const release = [...state.releases.values()].find(row => row.id === id);
  if (!release) return NOT_FOUND;
  const rows = release.assets.map(asset => metadata(state, asset, release));
  if (page !== undefined)
    return json(rows.slice((page - 1) * PAGE, page * PAGE));
  const pages = Array.from(
    { length: Math.max(1, Math.ceil(rows.length / PAGE)) },
    (_, index) => rows.slice(index * PAGE, index * PAGE + PAGE)
  );
  return json(state.options.truncateListing ? pages.slice(0, -1) : pages);
}

/**
 * Accept an upload to `uploads.github.com`.
 * @param state - Fake world.
 * @param url - Upload URL naming the release id and asset name.
 * @param input - Uploaded bytes.
 * @returns Spawn-shaped result carrying the new asset.
 */
function upload(state: FakeState, url: string, input: Buffer): FakeResult {
  const match = /releases\/(\d+)\/assets\?name=(.+)$/.exec(url);
  const release = [...state.releases.values()].find(
    row => row.id === Number(match?.[1])
  );
  if (!match || !release) return NOT_FOUND;
  const corrupt = state.options.corruptUploads || state.options.forgeDigest;
  const stored = corrupt ? Buffer.concat([input, Buffer.from("!")]) : input;
  const asset = addAsset(
    state,
    release.tag,
    decodeURIComponent(match[2] ?? ""),
    "2026-11-09T00:00:00Z",
    stored
  );
  if (state.options.forgeDigest) asset.digest = `sha256:${sha256(input)}`;
  state.options.onUpload?.();
  return json(metadata(state, asset, release));
}

/**
 * The repository's release listing: all pages slurped, or one explicit page.
 * @param state - Fake world.
 * @param page - One-based page number, when one page was asked for.
 * @returns Spawn-shaped result.
 */
function releaseListing(state: FakeState, page?: number): FakeResult {
  const rows = [...state.releases.values()].map(release => ({
    id: release.id,
    tag_name: release.tag,
  }));
  if (page !== undefined)
    return json(rows.slice((page - 1) * PAGE, page * PAGE));
  const pages = Array.from(
    { length: Math.max(1, Math.ceil(rows.length / PAGE)) },
    (_, index) => rows.slice(index * PAGE, index * PAGE + PAGE)
  );
  return json(state.options.truncateReleases ? pages.slice(0, -1) : pages);
}

/**
 * Read, download or delete one asset by id.
 * @param state - Fake world.
 * @param id - Asset id.
 * @param args - The `gh api` arguments.
 * @returns Spawn-shaped result.
 */
function assetCall(state: FakeState, id: number, args: string[]): FakeResult {
  const release = [...state.releases.values()].find(row =>
    row.assets.some(asset => asset.id === id)
  );
  const asset = release?.assets.find(row => row.id === id);
  if (!release || !asset) return NOT_FOUND;
  if (args.includes("DELETE")) {
    if (state.options.failDelete)
      return { status: 1, stdout: "", stderr: "gh: Server Error (HTTP 500)" };
    release.assets = release.assets.filter(row => row.id !== id);
    return json("");
  }
  if (args.includes("Accept: application/octet-stream"))
    return { status: 0, stdout: asset.bytes, stderr: OK };
  return json(metadata(state, asset, release));
}

/**
 * Route one `gh api` call.
 * @param state - Fake world.
 * @param args - The `gh api` arguments.
 * @param input - Bytes on stdin, for an upload.
 * @returns Spawn-shaped result.
 */
function api(state: FakeState, args: string[], input?: Buffer): FakeResult {
  const path =
    args.find(arg => arg.startsWith(ROOT) || arg.startsWith("https://")) ?? "";
  if (path === ROOT)
    return json({
      full_name: REPOSITORY,
      default_branch: "main",
      permissions: { pull: true, push: state.options.push ?? true },
    });
  if (path.startsWith(UPLOAD_PREFIX))
    return uploadHeadersMatch(args, input ?? Buffer.alloc(0))
      ? upload(state, path, input ?? Buffer.alloc(0))
      : BAD_LENGTH;
  return releaseCall(state, path) ?? assetPathCall(state, path, args);
}

/**
 * The repository release listing, or one release by tag.
 * @param state - Fake world.
 * @param path - The API path.
 * @returns Spawn-shaped result, or undefined when the path is not one of these.
 */
function releaseCall(state: FakeState, path: string): FakeResult | undefined {
  const releases = /\/releases\?per_page=100(?:&page=(\d+))?$/.exec(path);
  if (releases)
    return releaseListing(state, releases[1] ? Number(releases[1]) : undefined);
  const tag = /\/releases\/tags\/(.+)$/.exec(path)?.[1];
  if (!tag) return undefined;
  const release = state.releases.get(decodeURIComponent(tag));
  return release ? json({ id: release.id, tag_name: release.tag }) : NOT_FOUND;
}

/**
 * A release's asset listing, or one asset by id.
 * @param state - Fake world.
 * @param path - The API path.
 * @param args - The `gh api` arguments.
 * @returns Spawn-shaped result.
 */
function assetPathCall(
  state: FakeState,
  path: string,
  args: string[]
): FakeResult {
  const list = /\/releases\/(\d+)\/assets\?per_page=100(?:&page=(\d+))?$/.exec(
    path
  );
  if (list)
    return listing(
      state,
      Number(list[1]),
      list[2] ? Number(list[2]) : undefined
    );
  const one = /\/releases\/assets\/(\d+)$/.exec(path);
  return one ? assetCall(state, Number(one[1]), args) : NOT_FOUND;
}

/**
 * The fake `gh` executable.
 * @param state - Fake world.
 * @param command - Executable name.
 * @param args - Its arguments.
 * @param input - Bytes on stdin.
 * @returns Spawn-shaped result.
 */
function gh(
  state: FakeState,
  command: string,
  args: string[],
  input?: Buffer
): FakeResult {
  const write =
    args.includes("POST") || args.includes("DELETE") || args[0] === "release";
  state.calls.push({ args: [...args], write });
  if (command !== "gh" || state.options.ghMissing)
    return {
      status: null,
      stdout: "",
      stderr: "",
      error: Object.assign(new Error("spawnSync gh ENOENT"), {
        code: "ENOENT",
      }),
    };
  if (args[0] === "auth")
    return state.options.authenticated === false
      ? { status: 1, stdout: "", stderr: "You are not logged in" }
      : { status: 0, stdout: "", stderr: OK };
  if (args[0] === "repo") return json({ nameWithOwner: REPOSITORY });
  if (args[0] === "release" && args[1] === "create") {
    addRelease(state, args[2] ?? "");
    return { status: 0, stdout: "", stderr: OK };
  }
  if (args[0] === "api") return api(state, args, input);
  return { status: 1, stdout: "", stderr: `unhandled gh ${args.join(" ")}` };
}

/**
 * A stateful fake GitHub with releases, assets and a call log.
 * @param options - Faults and access for this test.
 * @returns The fake's state, its `run` stub and helpers to seed it.
 */
export function fakeGitHub(options: FakeOptions = {}) {
  const state: FakeState = {
    releases: new Map(),
    calls: [],
    counter: { next: 1000 },
    options,
  };
  return {
    run: (command: string, args: string[], opts: { input?: Buffer } = {}) =>
      gh(state, command, args, opts.input),
    calls: state.calls,
    releases: state.releases,
    addRelease: (tag: string) => addRelease(state, tag),
    addAsset: (
      tag: string,
      name: string,
      createdAt: string,
      content?: string | Buffer
    ) => addAsset(state, tag, name, createdAt, content),
    names: (tag: string) =>
      state.releases.get(tag)?.assets.map(row => row.name) ?? [],
    writes: () => state.calls.filter(call => call.write),
  };
}
