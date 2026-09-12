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
 *
 * THE GATES INSIDE THIS RUN ARE LIVE, and that is a separate property from the
 * one above. Every case here also asserts the hook exits `0`, which a reader
 * takes as an end-to-end statement about a push. Until CodySwannGT/lisa#3797 it
 * was not one: the work-item traceability arm was switched off THREE times over
 * inside the fixture, so `status === 0` survived whatever that gate did.
 *
 *   1. The push range was empty by construction — `refs/remotes/origin/main`
 *      was pointed at `HEAD`, so the gate passed by having nothing to look at.
 *   2. `scripts/lisa-work-item.mjs` was then overwritten with `process.exit(0)`.
 *   3. And neither of those was even the reason it was green. The fixture
 *      symlinked this repository's whole `node_modules` in, and the hook
 *      resolves `node_modules/@codyswann/lisa/...` BEFORE `scripts/` — so the
 *      gate that actually ran was the INSTALLED self-dependency and the stub in
 *      (2) was never reached at all. That copy is whatever `bun install` last
 *      put on the machine, which is not this tree's source and on the box this
 *      was found on was two majors behind the declared pin. A suite whose
 *      verdict depends on when somebody last installed is not a suite about
 *      the shipped hook. `stageNodeModules` withholds exactly that one entry.
 *
 * Replacing the shipped gate with `process.exit(0)` moved none of it. It now
 * turns six of the nine cases red, and the third case in each group is the
 * control that says so directly: a pushed commit carrying no `Work-Item:`
 * trailer must be REFUSED here.
 *
 * SIBLING SCAN (#3797). Every suite under `tests/integration/` that executes a
 * real hook from this repository and asserts a zero exit status:
 *
 *   - this one — the subject, repaired above.
 *   - `seeded-gates-preserve-hook-outcomes.test.ts` — LEGITIMATE. It supplies
 *     empty stdin and a stub over `scripts/lisa-work-item.mjs` too, but its
 *     subject is WHICH built-in steps run before and after a `gates` block is
 *     seeded, read off `LISA-RAN:` tokens. Every prover in it is a stub by
 *     design, so the stub is the instrument rather than a disabled gate, and
 *     its zeros are asserted as an equality between two runs rather than as a
 *     clean bill of health for either.
 *   - `push-destination-inheritance.test.ts` — clean. It writes its own hook,
 *     copies the REAL work-item script in, and carries a negative control that
 *     asserts a non-zero push status.
 *
 * Every other suite that mentions a hook reads its TEXT or runs a shipped
 * script directly; none of them executes a hook, so none can report one as
 * passing.
 * @module tests/integration/push-collects-integration-tree-once
 */

import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
import { cleanGitEnv } from "../support/git-executable.js";

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

/**
 * The work item the fixture's pushed commit declares.
 *
 * It matches the fixture's own `github` block, so the trailer canonicalizes
 * against the contract this fixture actually declares rather than borrowing a
 * real project's identity.
 */
const WORK_ITEM_REF = "fixture/fixture#1";

/** The subject line of the commit the fixture actually pushes. */
const PUSHED_SUBJECT = "feat: the change this push carries";

/** The npm scope this package publishes under. */
const SELF_SCOPE = "@codyswann";

/** The one package inside that scope the fixture must NOT inherit. */
const SELF_PACKAGE = "lisa";

/** Paths a real project keeps out of git, and this fixture must too. */
const FIXTURE_GITIGNORE = "node_modules/\nstub-bin/\ncollected.log\n";

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
 * The fixture's `node_modules`, with the self-dependency deliberately absent.
 *
 * The pre-push hook resolves both `lisa-work-item.mjs` and `lisa-gates.mjs`
 * from `node_modules/@codyswann/lisa/...` FIRST, falling back to `scripts/`
 * only when that file does not exist. This repository depends on itself, and
 * that installed copy is two majors behind what this tree ships — so a fixture
 * that symlinked the whole of `node_modules` in was running the OLD gate and
 * the OLD registry, and the shipped copies it took the trouble to `cpSync` into
 * `scripts/` were never reached at all (CodySwannGT/lisa#3797).
 *
 * Every other package is symlinked through unchanged, so vitest and everything
 * the hook shells out to resolve exactly as they did. Only `@codyswann/lisa` is
 * withheld, and only from the fixture — nothing on disk is modified. A consumer
 * has no self-dependency, so its `scripts/` copy is what runs; withholding this
 * one entry is what makes the fixture that consumer rather than this checkout.
 * @param root - Fixture project root
 */
function stageNodeModules(root: string): void {
  const source = path.join(ROOT, "node_modules");
  const target = path.join(root, "node_modules");
  const sourceScope = path.join(source, SELF_SCOPE);
  const targetScope = path.join(target, SELF_SCOPE);
  mkdirSync(targetScope, { recursive: true });
  for (const entry of readdirSync(source)) {
    if (entry === SELF_SCOPE) continue;
    symlinkSync(path.join(source, entry), path.join(target, entry), "dir");
  }
  // The scope survives; only the self-dependency inside it does not. The other
  // packages under it are ordinary workspace dependencies with no bearing on
  // which gate script the hook resolves.
  for (const entry of readdirSync(sourceScope)) {
    if (entry === SELF_PACKAGE) continue;
    symlinkSync(
      path.join(sourceScope, entry),
      path.join(targetScope, entry),
      "dir"
    );
  }
}

/**
 * The environment a git command in the FIXTURE must run under.
 *
 * `GIT_*` is stripped rather than inherited. Vitest runs inside this
 * repository, and a leaked `GIT_DIR` or `GIT_INDEX_FILE` points a fixture's
 * git command at the REAL checkout — where it would succeed, against the wrong
 * repository, and the test would pass for a reason unrelated to what it checks.
 */
// `LISA_PUSHED_REFS_FILE` is stripped alongside them by `cleanGitEnv`. It is
// not git's, but the same pre-push hook injects it and it carries the same
// hazard: it names the REAL push's refs, so a fixture that inherits it runs a
// push guard against a range nobody gave this test (CodySwannGT/lisa#3874).
const FIXTURE_GIT_ENV: NodeJS.ProcessEnv = cleanGitEnv();

/**
 * Runs one git command inside the fixture, refusing to continue on failure.
 * @param root - The fixture repository root
 * @param args - Arguments after `git`
 * @returns Trimmed stdout, for the commands asked a question
 * @throws {Error} When git exits non-zero, naming the command
 */
function fixtureGit(root: string, ...args: readonly string[]): string {
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
  return (done.stdout ?? "").trim();
}

/**
 * Commit everything git can see, and answer with the commit's object id.
 * @param root - The fixture repository root
 * @param message - The whole commit message, trailers included
 * @returns The new commit's object id
 */
function commitAll(root: string, message: string): string {
  fixtureGit(root, "add", "--all");
  // `--no-verify` because this fixture's own hooks are not the subject and it
  // has none installed; the hook under test is invoked directly, by hand.
  fixtureGit(root, "commit", "--no-verify", "-m", message);
  return fixtureGit(root, "rev-parse", "HEAD");
}

/**
 * A base the remote already has, then the commit this push actually carries.
 *
 * Until CodySwannGT/lisa#3797 the fixture stopped at the base and pointed
 * `origin/main` AT it, so the range the traceability gate validates held zero
 * commits. The range is real now, and `traceable` is what makes it a control:
 * `true` gives the pushed commit the `Work-Item:` trailer a real push carries
 * and the gate accepts it; `false` withholds it and the gate must REFUSE. A
 * fixture that can only produce the first answer has proved nothing by
 * producing it.
 *
 * `main -> main` on purpose. The destination guard refuses a differently named
 * branch resolving onto a deploy branch and explicitly allows this shape, and
 * this fixture is about the traceability arm rather than that one.
 * @param root - The fixture repository root
 * @param traceable - Whether the pushed commit declares a work item
 * @returns The pre-push stdin line git would feed the hook
 */
function stagePushedRange(root: string, traceable: boolean): string {
  const message = traceable
    ? `${PUSHED_SUBJECT}\n\nWork-Item: ${WORK_ITEM_REF}`
    : PUSHED_SUBJECT;
  const base = commitAll(root, "fixture: stage the project");
  fixtureGit(root, "update-ref", "refs/remotes/origin/main", base);
  writeFileSync(path.join(root, "src.txt"), "the change being pushed\n");
  return `refs/heads/main ${commitAll(root, message)} refs/heads/main ${base}\n`;
}

/**
 * A throwaway project on the Lisa TypeScript template, with no `gates` block —
 * the shape every consumer has, and the shape that takes the fallback path.
 * @param options - Fixture options
 * @param options.withCovUnit - Whether `package.json` carries `test:cov:unit`
 * @param options.traceable - Whether the pushed commit declares a work item
 * @returns The project root, the collection log path, and the pushed-refs line
 */
function stageProject(options: {
  readonly withCovUnit: boolean;
  readonly traceable: boolean;
}): {
  readonly root: string;
  readonly log: string;
  readonly pushedRefs: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-push-once-"));
  const log = path.join(root, "collected.log");
  const scripts: Record<string, string> = {
    typecheck: "true",
    "test:cov": PINNED["test:cov"] ?? "",
    "test:integration": PINNED["test:integration"] ?? "",
    // The reserved base each host-facing name delegates to; a consumer receives
    // both, and staging only the delegation would collect nothing. Every
    // host-facing test script is a governed pair now, not just this one.
    "test:cov:lisa": PINNED["test:cov:lisa"] ?? "",
    "test:integration:lisa": PINNED["test:integration:lisa"] ?? "",
    ...(options.withCovUnit
      ? {
          [COV_UNIT]: PINNED[COV_UNIT] ?? "",
          [`${COV_UNIT}:lisa`]: PINNED[`${COV_UNIT}:lisa`] ?? "",
        }
      : {}),
  };
  const manifest = `${JSON.stringify({ name: "fixture", private: true, scripts }, null, 2)}\n`;

  // A PRE-PUSH hook runs in a repository that can be pushed, and until #3662
  // this fixture was a bare temp directory. The hook's work-item gate could not
  // compute a push range in it at all, and the ONLY thing keeping that green
  // was the INSTALLED self-dependency: `pre-push` resolves the gate from
  // `node_modules/@codyswann/lisa` first, and the old copy there tolerated the
  // failure where 4.33.x fails closed. Failing closed is the correct behaviour
  // — a push gate that cannot tell what is being pushed should refuse — so the
  // bump did not break this test, it stopped a broken test from passing.
  // `stageNodeModules` now withholds that copy outright, so the gate this
  // fixture runs is the one this tree ships rather than the one last installed.
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
  // The 4.33.x work-item gate requires the project declaration every real
  // consumer has. No `gates` block, so the fallback path this suite exists to
  // exercise is still the one taken.
  writeFileSync(
    path.join(root, ".lisa.config.json"),
    `${JSON.stringify({ tracker: "github", github: { org: "fixture", repo: "fixture" } }, null, 2)}
`
  );
  writeFileSync(path.join(root, ".gitignore"), FIXTURE_GITIGNORE);
  stageNodeModules(root);
  stageStubPackageManager(root);
  return { root, log, pushedRefs: stagePushedRange(root, options.traceable) };
}

/**
 * Execute a real pre-push hook against the fixture and return what it
 * collected.
 * @param hook - Repo-relative path to the hook
 * @param options - Fixture options
 * @param options.withCovUnit - Whether `package.json` carries `test:cov:unit`
 * @param options.traceable - Whether the pushed commit declares a work item
 * @returns The hook's exit status, the collection log, and its output
 */
function runHook(
  hook: string,
  options: { readonly withCovUnit: boolean; readonly traceable?: boolean }
): { readonly status: number; readonly log: string; readonly stdout: string } {
  const { root, log, pushedRefs } = stageProject({
    withCovUnit: options.withCovUnit,
    traceable: options.traceable ?? true,
  });
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
    // Git feeds the refs being pushed on stdin, and that is the only thing
    // that tells the traceability gate WHICH range to judge. Without it the
    // gate falls back to the pusher's local `HEAD` and says so — an answer
    // about a range nobody asked about (CodySwannGT/lisa#3874).
    input: pushedRefs,
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
      // The zero above is only worth reading because the gates inside the run
      // were live. This one says the traceability arm judged the pushed range
      // rather than an empty one: one commit, named as examined.
      expect(result.stdout).toContain("1 commit(s)");
      expect(result.stdout).toContain(WORK_ITEM_REF);
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

  it(
    "refuses the push when the pushed commit names no work item",
    () => {
      // THE NEGATIVE CONTROL for the two assertions above, and the reason this
      // case exists at all. A fixture that reports a hook as passing has said
      // nothing until something proves the same fixture can report one as
      // failing — and against the pre-#3797 fixture this case could not fail:
      // the range held no commit to reject, and the gate had been overwritten
      // with `process.exit(0)` besides.
      const result = runHook(hook, { withCovUnit: true, traceable: false });

      expect(result.status, result.stdout).not.toBe(0);
      expect(result.stdout).toContain("gate 3 (commit trailer)");
    },
    ioLatencyBudgetMs(180_000)
  );
});
