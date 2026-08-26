/**
 * Shared fixtures for the Sonar hook wrapper suites.
 *
 * Extracted when CodySwannGT/lisa#2905 added the resolver-deadline cases and
 * the suite crossed its `max-lines` ceiling. A ceiling is a threshold, and a
 * threshold is not raised to fit the work — the work is divided.
 *
 * Every fixture here starts the REAL generated shim under `/bin/bash`, so both
 * suites test the shipped artifact rather than a model of it.
 * @module tests/unit/hooks/support/sonar-secrets-fixtures
 */
import type { SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach } from "vitest";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  workerSpawnSlowdown,
} from "../../../helpers/io-latency-budget.js";

/** Absolute, so the interpreter is never resolved through a writeable PATH. */
export const BASH = "/bin/bash";

export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** The reviewed original, which the plugin ships. */
export const SOURCE = path.join(
  REPO_ROOT,
  "plugins",
  "src",
  "base",
  "hooks",
  "sonar-secrets.sh"
);

/** What `lisa apply` writes into a host checkout. */
export const SHIPPED = path.join(
  REPO_ROOT,
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-hooks",
  "sonar-secrets.sh"
);

export const INACTIVE = JSON.stringify({
  decision: "block",
  reason:
    "SonarQube secret scanning is inactive: not authenticated. Run 'sonar auth login'.",
});

export const FINDING = JSON.stringify({
  decision: "block",
  reason: "Sonar detected secrets in prompt",
});

/** The vendor event name the Claude prompt shim passes through. */
export const PROMPT_EVENT = "claude-prompt-submit";

/** The clause the stub CLI prints when no token ever reached it. */
export const INACTIVE_MARKER = "secret scanning is inactive";

/**
 * The resolver deadline these tests give the hook, in whole seconds.
 *
 * CodySwannGT/lisa#2905. The hook bounds its resolver with `read -t`, and the
 * shipped ten seconds is a product decision: it sits in front of every prompt
 * and every file read, so it must not hang a session. In THIS suite the
 * "provider" is a local `node` script, and the cost of starting one here is
 * unbounded under load — the read lost its entire ten seconds to a `node` spawn
 * at ~98 concurrent vitest workers, twice, on a rotating set of cases:
 *
 * | run | conditions | outcome |
 * | --- | --- | --- |
 * | A | 1-min load 44.7, 98 vitest processes | `passes a real finding through` FAILED at 63,947ms |
 * | B | load 43.9 -> 119.6, ~90 vitest processes | `resolves a provisioned token` FAILED at 39,812ms |
 *
 * No test-side budget can reach that. The bound the cases were losing to lives
 * INSIDE the code under test, and vitest cannot see it — CodySwannGT/lisa#2885's
 * Band B. What it produced was `expected '' to be '{"decision":"block"...'`: an
 * empty stdout standing in for a timing failure, describing the wrong cause.
 *
 * So the same base is scaled by the same measured slowdown the rest of the suite
 * uses. `ioLatencyBudgetMs` is clamped at 1 from below, so this can only ever
 * widen the shipped ten seconds, never tighten it, and on a quiet box it IS ten
 * seconds — a genuine hang still surfaces in about the time it always did.
 */
export const RESOLVER_DEADLINE_S = Math.ceil(ioLatencyBudgetMs(10_000) / 1_000);

/**
 * Budget for one whole hook run, quiet-box, in milliseconds.
 *
 * Three times {@link RESOLVER_DEADLINE_S}'s base, so the outer bound is always
 * looser than the inner one the hook enforces on itself — otherwise the child is
 * killed while still legitimately waiting and the case reports the outer kill
 * instead of the real answer. Both are scaled by the same factor, so the 3x
 * ratio holds on every machine. It stays 2x under the file's own case budget
 * (`useIoLatencyBudget()`'s 60,000ms base), so a hung `bash` dies before the
 * case does and names itself rather than arriving as an anonymous vitest
 * timeout.
 */
export const HOOK_RUN_BUDGET_MS = 30_000;

const temporaries: string[] = [];

/** Hard bounds for scanning one controlled resolver directory after SIGKILL. */
const RESOLVER_SCAN_ENTRY_LIMIT = 4_096;
const RESOLVER_SCAN_DEPTH_LIMIT = 64;
const RESOLVER_SCAN_FILE_BYTES = 1024 * 1024;

/**
 * Validate one controlled direct-child basename.
 * @param name - Direct-child basename
 */
function assertResolverBasename(name: string): void {
  if (Buffer.byteLength(name, "utf8") > 1_024) {
    throw new Error("Sonar resolver survivor name exceeds byte bound");
  }
}

/** Result of one immutable bounded subtree scan. */
interface ResolverScanResult {
  readonly entries: number;
  readonly found: boolean;
}

/**
 * Read one regular survivor file under its byte bound.
 * @param candidate - Exact regular-file path
 * @param size - Pinned file size
 * @param token - Resolver canary
 * @returns Whether the file contains the canary
 */
function regularFileContainsToken(
  candidate: string,
  size: number,
  token: string
): boolean {
  if (size > RESOLVER_SCAN_FILE_BYTES) {
    throw new Error("Sonar resolver survivor file exceeds byte bound");
  }
  return readFileSync(candidate, "utf8").includes(token);
}

/**
 * Recursively scan one candidate without following links.
 * @param candidate - Exact controlled candidate
 * @param token - Resolver canary
 * @param depth - Current traversal depth
 * @param entries - Entries already visited
 * @returns Updated bounded scan result
 */
function scanResolverCandidate(
  candidate: string,
  token: string,
  depth: number,
  entries: number
): ResolverScanResult {
  const nextEntries = entries + 1;
  if (nextEntries > RESOLVER_SCAN_ENTRY_LIMIT) {
    throw new Error("Sonar resolver survivor scan exceeds entry bound");
  }
  if (depth > RESOLVER_SCAN_DEPTH_LIMIT) {
    throw new Error("Sonar resolver survivor scan exceeds depth bound");
  }
  const stat = lstatSync(candidate);
  if (stat.isSymbolicLink()) return { entries: nextEntries, found: false };
  if (stat.isFile()) {
    return {
      entries: nextEntries,
      found: regularFileContainsToken(candidate, stat.size, token),
    };
  }
  if (!stat.isDirectory()) return { entries: nextEntries, found: false };
  return readdirSync(candidate).reduce<ResolverScanResult>(
    (result, name) => {
      if (result.found) return result;
      assertResolverBasename(name);
      return scanResolverCandidate(
        path.join(candidate, name),
        token,
        depth + 1,
        result.entries
      );
    },
    { entries: nextEntries, found: false }
  );
}

/**
 * Search regular files beneath one exact resolver root without following links.
 * @param root - Controlled resolver directory returned by the fixture allocator
 * @param token - Canary emitted only by the killed resolver
 * @returns Whether any bounded regular file contains the canary
 */
export function resolverRootContainsToken(
  root: string,
  token: string
): boolean {
  return scanResolverCandidate(root, token, 0, 0).found;
}

afterEach(() => {
  for (const dir of temporaries.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A directory holding a stub `sonar`, to be prepended to PATH.
 *
 * The stub models the one behaviour that matters: the real CLI is inactive
 * until a token reaches it, and reports that inactivity as a block verdict
 * rather than as an error or a non-zero exit.
 * @param whenAuthed What the stub prints once a token is in its environment.
 * @returns Path to the directory containing the stub.
 */
export function stubSonar(whenAuthed: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-sonar-bin-"));
  const stub = path.join(dir, "sonar");

  temporaries.push(dir);
  writeFileSync(
    stub,
    [
      "#!/bin/bash",
      "cat >/dev/null",
      'if [ -n "${SONARQUBE_CLI_TOKEN:-}" ]; then',
      `  printf '%s' ${JSON.stringify(whenAuthed)}`,
      "else",
      `  printf '%s' ${JSON.stringify(INACTIVE)}`,
      "fi",
      "exit 0",
    ].join("\n")
  );
  chmodSync(stub, 0o755);
  return dir;
}

/**
 * Install a Linux-shaped `mktemp -d` beside the stub scanner.
 *
 * Linux honors TMPDIR while Darwin's native utility does not. Accepting only
 * the hook's explicit Lisa template and logging the result makes that Linux
 * lifecycle visible on every platform without granting cleanup authority over
 * unrelated roots.
 * @param bin - Existing fixture bin directory prepended to PATH
 * @returns Reader for the exact roots allocated by the stub
 */
export function stubLinuxMktemp(bin: string): () => readonly string[] {
  const log = path.join(bin, "mktemp-roots.log");
  const stub = path.join(bin, "mktemp");
  writeFileSync(
    stub,
    [
      "#!/bin/sh",
      'if [ "$#" -ne 2 ] || [ "$1" != "-d" ]; then exit 64; fi',
      'if [ "$2" != "${TMPDIR:-/tmp}/lisa-sonar-resolver.XXXXXXXX" ]; then exit 64; fi',
      'root=$(/usr/bin/mktemp -d "$2") || exit $?',
      `printf '%s\\n' "$root" >> ${JSON.stringify(log)}`,
      "printf '%s\\n' \"$root\"",
    ].join("\n")
  );
  chmodSync(stub, 0o755);
  return () =>
    existsSync(log)
      ? readFileSync(log, "utf8").split("\n").filter(Boolean)
      : [];
}

/**
 * Wait until the Linux-shaped allocator records the resolver root.
 *
 * Process startup can exceed a fixed sleep when the suite and artifact parity
 * checks run together. Waiting for the allocation itself keeps the SIGKILL
 * regression synchronized with the lifecycle event it is intended to test.
 * @param allocatedRoots - Reader returned by {@link stubLinuxMktemp}
 * @returns The first non-empty allocation snapshot
 * @throws When the resolver never reaches allocation within the bounded wait
 */
export async function waitForStubLinuxMktempRoot(
  allocatedRoots: () => readonly string[]
): Promise<readonly string[]> {
  const deadline = Date.now() + ioLatencyBudgetMs(10_000);
  while (Date.now() < deadline) {
    const roots = allocatedRoots();
    if (roots.length > 0) return roots;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Sonar resolver did not allocate its fixture root");
}

/**
 * Remove only exact resolver roots allocated by {@link stubLinuxMktemp}.
 * @param roots - Logged allocator results
 * @throws When a result is outside the active temp root or changes type
 */
export function removeStubLinuxMktempRoots(roots: readonly string[]): void {
  const parent = path.resolve(tmpdir());
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) !== parent ||
      !/^lisa-sonar-resolver\.[A-Za-z0-9]{8}$/u.test(path.basename(resolved))
    ) {
      throw new Error(`Refusing cleanup outside the Sonar fixture: ${root}`);
    }
    if (!existsSync(resolved)) continue;
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Refusing changed Sonar fixture root: ${root}`);
    }
    rmSync(resolved, { recursive: true });
  }
}

/**
 * A checkout carrying a stub secrets resolver at one of the searched paths.
 * @param token What `resolve-secret.mjs get` should emit, or "" for nothing.
 * @returns Path to the fake project root.
 */
export function projectWithResolver(token: string): string {
  return checkoutWithResolver(
    `process.stdout.write(${JSON.stringify(token)});\n`,
    "lisa-sonar-proj-"
  );
}

/**
 * The first path the wrapper's resolver search checks, inside a fake checkout.
 * @param root The fake checkout.
 * @returns Absolute path to where `resolve-secret.mjs` must be planted.
 */
export function resolverScriptPath(root: string): string {
  return path.join(
    root,
    ".claude",
    "skills",
    "lisa-secrets-access",
    "scripts",
    "resolve-secret.mjs"
  );
}

/**
 * A fresh checkout carrying a stub resolver with the given body.
 * @param body Node source for the stub resolver.
 * @param prefix Temp-directory prefix, so a failing run names itself.
 * @returns Path to the fake checkout.
 */
export function checkoutWithResolver(body: string, prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  const script = resolverScriptPath(root);

  temporaries.push(root);
  mkdirSync(path.dirname(script), { recursive: true });
  writeFileSync(script, body);
  return root;
}

/**
 * Run the wrapper the way a generated shim does.
 * @param options How to stage the run.
 * @param options.bin Directory holding a stub `sonar`, prepended to PATH.
 * @param options.projectDir Checkout the resolver search starts from.
 * @param options.env Extra environment variables for the run.
 * @returns The completed process.
 */
export function run(options: {
  readonly bin?: string;
  readonly projectDir?: string;
  readonly env?: Readonly<Record<string, string>>;
}): SpawnSyncReturns<string> {
  const pathEntries = [options.bin, process.env.PATH].filter(Boolean);

  return boundedSpawnSync({
    label: "the sonar hook wrapper",
    command: BASH,
    args: [SOURCE, PROMPT_EVENT],
    baseMs: HOOK_RUN_BUDGET_MS,
    input: JSON.stringify({ prompt: "hello" }),
    env: {
      ...process.env,
      PATH: pathEntries.join(path.delimiter),
      // Scaled, and overridable per case: the deadline is the whole subject of
      // CodySwannGT/lisa#2905, and one case deliberately shrinks it to stage a
      // hang. Placed before the spread so a case's own value still wins.
      LISA_SONAR_RESOLVER_TIMEOUT_S: String(RESOLVER_DEADLINE_S),
      ...(options.projectDir === undefined
        ? {}
        : { CLAUDE_PROJECT_DIR: options.projectDir }),
      ...options.env,
    },
  });
}

/**
 * Fail with the resolution failure when the hook took its warn path.
 *
 * Three cases in this file require a token to ARRIVE. When it does not, the
 * stub CLI reports inactive, the hook correctly warns, and the case's own
 * assertion then compares an empty string to a JSON blob and says nothing about
 * why — the exact "control that fails while describing the wrong cause" this
 * ticket is about. Called before the content assertions so the real cause wins
 * the race to report.
 * @param result - A completed hook run.
 */
export function assertResolverDelivered(
  result: SpawnSyncReturns<string>
): void {
  if (!result.stderr.includes(INACTIVE_MARKER)) return;
  throw new Error(
    `the secret resolver delivered nothing within its ${RESOLVER_DEADLINE_S}s ` +
      `deadline, so the hook took its warn path. That deadline is the shipped ` +
      `10s scaled by a measured ${workerSpawnSlowdown().toFixed(2)}x spawn ` +
      `slowdown (LISA_SONAR_RESOLVER_TIMEOUT_S). The stub CLI reports inactive ` +
      `precisely when no token reached it, so this is a resolution failure — ` +
      `not a disagreement about two strings. See ` +
      `plugins/src/base/hooks/sonar-secrets.sh.`
  );
}
