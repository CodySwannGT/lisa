/**
 * The integration tree is collected exactly ONCE per push.
 *
 * The push moment used to pay for it twice. The built-in fallback path in the
 * pre-push hook — the path a project with no `gates` block in
 * `.lisa.config.json` actually takes, because the gate runner exits
 * `NO_GATES` and the hook falls through — ran `test:cov` and then
 * `test:integration`. `test:cov` is force-pinned to `vitest run --coverage`
 * with no integration exclusion, so it collects `tests/integration/**` in
 * full; `test:integration` then collects the same tree again. Nothing seeds a
 * `gates` block into a consumer's config, so every consumer took that path.
 *
 * This asserts the property BEHAVIOURALLY, by executing the real hook and
 * counting the files vitest actually collects. A test that read the script
 * strings out of `package.lisa.json` and reasoned about them would pass
 * against a hook that still invoked the wrong one — the string is not the
 * behaviour. Here a stub package manager resolves each script the hook asks
 * for out of the fixture's real `package.json`, turns `vitest run` into
 * `vitest list --filesOnly` (which changes nothing about which files are
 * collected — every include, exclude and path filter is passed through), and
 * appends what vitest reports. The assertion counts occurrences.
 * @module tests/integration/push-collects-integration-tree-once
 */

import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { trackedHookCopies } from "../helpers/hook-roster.js";
import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";

// The bounded children below are handed a base that only fits under a case
// budget scaling with the same machine they do. Without this call the case
// budget is the flat one from `vitest.config.local.ts`, and the child's bound
// overtakes it from a slowdown of 4.0x up — a range measured on this box, in
// this tree, in the run that fixed CodySwannGT/lisa#3202.
useIoLatencyBudget();

const ROOT = process.cwd();

/**
 * Every pre-push hook this repository tracks. They carry the same test block,
 * and copies of one check cannot be kept aligned by intention — one had already
 * drifted a whole gate facade behind the others when this was written, and
 * still ran the same two suites over the same tree.
 *
 * Derived rather than listed: a roster typed here answers for the copies
 * whoever typed it remembered (CodySwannGT/lisa#2847).
 */
const HOOKS = [...trackedHookCopies("pre-push")];

const UNIT_FILE = "tests/unit/alpha.test.ts";
const INTEGRATION_FILE = "tests/integration/beta.test.ts";
const COV_UNIT = "test:cov:unit";

/** The scripts a consumer actually gets, read from the real pin file. */
const PINS = JSON.parse(
  readFileSync(
    path.join(ROOT, "typescript/package-lisa/package.lisa.json"),
    "utf8"
  )
) as {
  readonly force?: { readonly scripts?: Record<string, string> };
  readonly defaults?: { readonly scripts?: Record<string, string> };
};

const PINNED: Record<string, string> = {
  ...PINS.defaults?.scripts,
  ...PINS.force?.scripts,
};

/**
 * A stub `npm`. It resolves each requested script out of the fixture's real
 * `package.json`, asks vitest which files that script collects, and appends
 * the answer. `String.raw` so the regexes and escapes reach the file intact.
 *
 * It follows a `$npm_execpath run <name>` delegation the way a real package
 * manager does. A governed gate script ships as a PAIR — Lisa forces the
 * reserved `:lisa` base and merely defaults the host-facing name to invoke it
 * (CodySwannGT/lisa#2952, #3070) — so a stub that only understood a literal
 * `vitest run` would report the tree as collected ZERO times and read as a
 * hook that stopped running the suite.
 */
const STUB_NPM = String.raw`#!/usr/bin/env node
"use strict";
const { spawnSync } = require("node:child_process");
const { appendFileSync, readFileSync } = require("node:fs");
const [verb, name] = process.argv.slice(2);
if (verb === "audit") {
  process.stdout.write('{"vulnerabilities":{}}');
} else if (verb === "run") {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const resolve = (key, depth) => {
    const value = (pkg.scripts || {})[key];
    const hop = /^\$npm_execpath\s+run\s+(\S+)$/.exec(value || "");
    return hop && depth < 4 ? resolve(hop[1], depth + 1) : value;
  };
  const command = resolve(name, 0);
  // A pinned script may lead with environment assignments: test:cov:unit sets
  // LISA_COVERAGE_SCOPE=unit. They are kept in the listing so the run is the
  // same one, and skipped over when deciding this is a vitest invocation.
  // Managed templates insert the transparent lisa-test-run -- supervisor
  // between those assignments and Vitest. The collection probe removes only
  // that transport layer before converting run to list.
  const VITEST = /^((?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*)(?:lisa-test-run\s+--profile\s+[a-z][a-z0-9-]*\s+--adapter\s+vitest\s+--\s+)?vitest\s+run\b/;
  const match = command && VITEST.exec(command);
  if (match) {
    const listing = command.replace(VITEST, match[1] + "vitest list --filesOnly");
    const child = spawnSync("sh", ["-c", listing], { encoding: "utf8" });
    appendFileSync(
      process.env.LISA_COLLECT_LOG,
      "## " + name + "\n" + (child.stdout || "") + "\n"
    );
  }
}
`;

/** A trivial suite. It is only ever listed, never executed. */
const FIXTURE_SUITE = String.raw`import { expect, it } from "vitest";
it("holds", () => {
  expect(1).toBe(1);
});
`;

/** No imports, so it resolves without the fixture owning a toolchain. */
const FIXTURE_VITEST_CONFIG =
  'export default { test: { include: ["tests/**/*.test.ts"] } };\n';

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Install the stub package manager into a fixture.
 * @param root - Fixture project root
 */
function stageStubPackageManager(root: string): void {
  const bin = path.join(root, "stub-bin");
  const stubPath = path.join(bin, "npm");
  mkdirSync(bin, { recursive: true });
  writeFileSync(stubPath, STUB_NPM);
  chmodSync(stubPath, 0o755);
}

/**
 * The environment a git command in the FIXTURE must run under.
 *
 * `GIT_*` is stripped rather than inherited. Vitest runs inside this
 * repository, and a leaked `GIT_DIR` or `GIT_INDEX_FILE` points a fixture's
 * git command at the REAL checkout — where it would succeed, against the wrong
 * repository, and the test would pass for a reason unrelated to what it checks.
 */
const FIXTURE_GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))
) as NodeJS.ProcessEnv;

/**
 * Runs one git command inside the fixture, refusing to continue on failure.
 *
 * @param root - The fixture repository root
 * @param args - Arguments after `git`
 * @throws {Error} When git exits non-zero, naming the command
 */
function fixtureGit(root: string, ...args: readonly string[]): void {
  // `boundedSpawnSync`, not a bare `spawnSync`: every synchronous child start
  // in this tree must carry a deadline, and `unbounded-spawn-conformance`
  // enforces it. `/usr/bin/env` rather than a bare `git` matches
  // `edit-time-copies-are-derived.test.ts` — resolving the binary through $PATH
  // directly trips `sonarjs/no-os-command-from-path`.
  const done = boundedSpawnSync({
    label: `fixture git ${args.join(" ")}`,
    command: "/usr/bin/env",
    args: ["git", ...args],
    baseMs: 15_000,
    cwd: root,
    env: FIXTURE_GIT_ENV,
  });
  if (done.status !== 0) {
    throw new Error(
      `fixture git ${args.join(" ")} failed (${String(done.status)}): ${done.stderr ?? ""}`
    );
  }
}

/**
 * A throwaway project on the Lisa TypeScript template, with no `gates` block —
 * the shape every consumer has, and the shape that takes the fallback path.
 * @param options - Fixture options
 * @param options.withCovUnit - Whether `package.json` carries `test:cov:unit`
 * @returns The project root and the path the collection log is written to
 */
function stageProject(options: { readonly withCovUnit: boolean }): {
  readonly root: string;
  readonly log: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-push-once-"));
  const log = path.join(root, "collected.log");
  const scripts: Record<string, string> = {
    typecheck: "true",
    "test:cov": PINNED["test:cov"] ?? "",
    "test:integration": PINNED["test:integration"] ?? "",
    // The reserved base the host-facing name delegates to; a consumer receives
    // both, and staging only the delegation would collect nothing.
    "test:integration:lisa": PINNED["test:integration:lisa"] ?? "",
    ...(options.withCovUnit ? { [COV_UNIT]: PINNED[COV_UNIT] ?? "" } : {}),
  };
  const manifest = `${JSON.stringify({ name: "fixture", private: true, scripts }, null, 2)}\n`;

  // A PRE-PUSH hook runs in a repository that can be pushed, and until #3662
  // this fixture was a bare temp directory. The hook's work-item gate could not
  // compute a push range in it at all, and the ONLY thing keeping that green
  // was a self-dependency pinned two majors back: `pre-push` resolves the gate
  // from `node_modules/@codyswann/lisa` FIRST, and the 2.328.0 copy tolerated
  // the failure where 4.33.x fails closed. Failing closed is the correct
  // behaviour — a push gate that cannot tell what is being pushed should
  // refuse — so the bump did not break this test, it stopped a broken test
  // from passing.
  fixtureGit(root, "init", "--initial-branch=main");
  fixtureGit(root, "config", "user.email", "fixture@example.invalid");
  fixtureGit(root, "config", "user.name", "Fixture");
  dirs.push(root);
  writeFileSync(log, "");
  writeFileSync(path.join(root, "package.json"), manifest);
  writeFileSync(path.join(root, "vitest.config.js"), FIXTURE_VITEST_CONFIG);
  mkdirSync(path.join(root, "tests/unit"), { recursive: true });
  mkdirSync(path.join(root, "tests/integration"), { recursive: true });
  writeFileSync(path.join(root, UNIT_FILE), FIXTURE_SUITE);
  writeFileSync(path.join(root, INTEGRATION_FILE), FIXTURE_SUITE);
  // The real gate runner, so the fallback is reached the way a consumer
  // reaches it: NO_GATES, not a missing runner.
  cpSync(
    path.join(ROOT, "all/copy-overwrite/scripts"),
    path.join(root, "scripts"),
    { recursive: true }
  );
  // One commit, and an `origin/main` pointing AT it, so the push range is
  // empty. That is deliberate and worth stating rather than leaving to be
  // inferred: this suite measures how many times the hook collects the
  // integration tree, not whether work-item validation accepts a message. An
  // empty range keeps that gate out of the way HONESTLY — it really has
  // nothing to validate — instead of feeding it a trailer this fixture would
  // then be silently asserting things about.
  // The 4.33.x work-item gate also requires the project declaration every real
  // consumer has. No `gates` block, so the fallback path this suite exists to
  // exercise is still the one taken.
  writeFileSync(
    path.join(root, ".lisa.config.json"),
    `${JSON.stringify({ tracker: "github", github: { org: "fixture", repo: "fixture" } }, null, 2)}
`
  );
  fixtureGit(root, "add", "--all");
  fixtureGit(root, "commit", "--no-verify", "-m", "fixture: stage the project");
  fixtureGit(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(
    path.join(root, "scripts/lisa-work-item.mjs"),
    "process.exit(0);\n"
  );
  symlinkSync(
    path.join(ROOT, "node_modules"),
    path.join(root, "node_modules"),
    "dir"
  );
  stageStubPackageManager(root);
  return { root, log };
}

/**
 * Execute a real pre-push hook against the fixture and return what it
 * collected.
 * @param hook - Repo-relative path to the hook
 * @param options - Fixture options
 * @param options.withCovUnit - Whether `package.json` carries `test:cov:unit`
 * @returns The hook's exit status, the collection log, and its output
 */
function runHook(
  hook: string,
  options: { readonly withCovUnit: boolean }
): { readonly status: number; readonly log: string; readonly stdout: string } {
  const { root, log } = stageProject(options);
  const searchPath = [
    path.join(root, "stub-bin"),
    path.join(root, "node_modules/.bin"),
    process.env["PATH"] ?? "",
  ].join(":");
  const child = boundedSpawnSync({
    label: `the ${hook} pre-push hook`,
    command: "/bin/sh",
    args: [path.join(ROOT, hook), "origin"],
    // The hook fans out over the whole integration tree.
    baseMs: 30_000,
    cwd: root,
    env: { ...process.env, LISA_COLLECT_LOG: log, PATH: searchPath },
  });
  return {
    status: child.status ?? -1,
    log: readFileSync(log, "utf8"),
    stdout: `${child.stdout ?? ""}${child.stderr ?? ""}`,
  };
}

/**
 * How many times a path was collected across every run the hook made.
 * @param log - The collection log
 * @param needle - Path fragment to count
 * @returns Occurrence count
 */
function timesCollected(log: string, needle: string): number {
  return log
    .split("\n")
    .filter(line => !line.startsWith("##") && line.includes(needle)).length;
}

describe.each(HOOKS)("%s built-in fallback path", hook => {
  it(
    "collects the integration tree exactly once per push",
    () => {
      const result = runHook(hook, { withCovUnit: true });
      expect(result.status, result.stdout).toBe(0);
      expect(timesCollected(result.log, UNIT_FILE)).toBe(1);
      expect(
        timesCollected(result.log, INTEGRATION_FILE),
        `integration tree collected more than once:\n${result.log}`
      ).toBe(1);
    },
    ioLatencyBudgetMs(180_000)
  );

  it(
    "still runs the integration tree when the project predates test:cov:unit",
    () => {
      const result = runHook(hook, { withCovUnit: false });
      expect(result.status, result.stdout).toBe(0);
      expect(
        timesCollected(result.log, INTEGRATION_FILE)
      ).toBeGreaterThanOrEqual(1);
    },
    ioLatencyBudgetMs(180_000)
  );
});
