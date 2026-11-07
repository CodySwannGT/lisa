/**
 * Unit proof for the one-command release rollback (CodySwannGT/lisa#4605).
 *
 * The command exists to be run under pressure, by someone who may not know
 * npm, after a bad release. Three properties matter more than any other, and
 * the cases are weighted toward them:
 *
 * - It points `latest` at the RIGHT version: the highest published one below
 *   the bad release that is not itself deprecated. Pointing at a deprecated
 *   version, or at a prerelease, trades one bad install for another.
 * - It writes NOTHING unless it can finish: a dry run and a run without
 *   credentials must leave the registry and the release notes untouched.
 * - It does not trust its own exit codes: success is a registry read-back of
 *   both facts, so a verification miss is a non-zero exit.
 *
 * Every command runner and registry read is injected, so these cases never
 * reach the network or a real `npm`/`gh`.
 * @module tests/unit/scripts/lisa-rollback-release
 */
import { describe, expect, it } from "vitest";

import {
  deprecationNotice,
  formatCommand,
  main,
  packumentUrl,
  parseArgs,
  planCommands,
  resolveGoodVersion,
  rollback,
} from "../../../scripts/lisa-rollback-release.mjs";

const PACKAGE = "@codyswann/lisa";
const REGISTRY = "http://registry.test";
const REASON = "breaks apply";
const REGISTRY_FLAG = "--registry";
const DEPRECATE = "npm deprecate";

/** One version entry in a packument, optionally deprecated. */
const entry = (deprecated?: string) =>
  deprecated === undefined ? {} : { deprecated };

/** A packument with 4.89.9, a deprecated 4.90.0-rc, 4.90.0 and 4.90.1. */
const packument = (
  overrides: Readonly<Record<string, Record<string, string>>> = {},
  latest = "4.90.1"
) => ({
  name: PACKAGE,
  "dist-tags": { latest },
  versions: {
    "4.89.9": entry(),
    "4.90.0": entry(),
    "4.90.1-rc.1": entry(),
    "4.90.1": entry(),
    ...overrides,
  },
});

/** A command call the fake runner saw. */
interface Call {
  readonly command: string;
  readonly args: readonly string[];
}

/** Outcome a fake runner returns for one call. */
interface Outcome {
  readonly status: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

/**
 * A command runner that records every call and answers from a rule.
 * @param answer - Decides the outcome for one call
 * @returns The runner and its recorded calls
 */
function fakeRunner(answer: (call: Call) => Outcome = () => ({ status: 0 })) {
  const calls: Call[] = [];
  const run = (command: string, args: readonly string[]) => {
    const call = { command, args: [...args] };
    calls.push(call);
    const outcome = answer(call);
    return { stdout: "", stderr: "", ...outcome };
  };
  return { run, calls };
}

/**
 * Answers `gh release view` with a body and everything else with success.
 * @param body - The release notes the view returns
 * @returns A runner answer
 */
const ghServes =
  (body = "Original notes.") =>
  (call: Call): Outcome =>
    call.command === "gh" && call.args[1] === "view"
      ? { status: 0, stdout: JSON.stringify({ body }) }
      : { status: 0 };

/**
 * A fetch double that serves a sequence of packuments, last one repeating.
 * @param documents - Packuments to serve in order
 * @returns The fetch double and the URLs it was handed
 */
function fakeFetch(documents: readonly unknown[]) {
  const urls: string[] = [];
  const impl = (async (url: string) => {
    urls.push(String(url));
    const body = documents[Math.min(urls.length - 1, documents.length - 1)];
    return { ok: true, status: 200, json: async () => body };
  }) as unknown as typeof fetch;
  return { impl, urls };
}

/** A packument as it should read after a successful rollback. */
const rolledBack = packument({ "4.90.1": entry(REASON) }, "4.90.0");

/**
 * Collects output instead of writing to the terminal.
 * @returns Sinks and their contents
 */
function sinks() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    log: (line: string) => out.push(line),
    error: (line: string) => err.push(line),
  };
}

/** Options for a rollback of 4.90.1 to whatever resolves. */
const options = (extra: Record<string, unknown> = {}) => ({
  bad: "4.90.1",
  reason: REASON,
  dryRun: false,
  registry: REGISTRY,
  packageName: PACKAGE,
  repo: "CodySwannGT/lisa",
  ...extra,
});

/**
 * Dependencies for a rollback, with a captured notes file.
 * @param run - The command runner
 * @param fetchImpl - The registry read
 * @returns Injected dependencies and the notes written
 */
function deps(
  run: ReturnType<typeof fakeRunner>["run"],
  fetchImpl: typeof fetch
) {
  const notes: string[] = [];
  const output = sinks();
  return {
    notes,
    output,
    injected: {
      run,
      fetchImpl,
      writeFile: (_path: string, text: string) => notes.push(text),
      makeTempDir: () => "/scratch/lisa-rollback-unit",
      removeDir: () => undefined,
      sleep: async () => undefined,
      log: output.log,
      error: output.error,
    },
  };
}

/** The write commands a runner saw, as `command subcommand`. */
const writes = (calls: readonly Call[]) =>
  calls
    .map(call => `${call.command} ${call.args[0]} ${call.args[1] ?? ""}`)
    .filter(
      line =>
        line.startsWith(DEPRECATE) ||
        line.startsWith("npm dist-tag add") ||
        line.startsWith("gh release edit")
    );

describe("parseArgs", () => {
  it("reads every flag", () => {
    expect(
      parseArgs(
        [
          "--bad",
          "4.90.1",
          "--to",
          "4.90.0",
          "--reason",
          REASON,
          "--dry-run",
          REGISTRY_FLAG,
          REGISTRY,
        ],
        {}
      )
    ).toEqual({
      bad: "4.90.1",
      to: "4.90.0",
      reason: REASON,
      dryRun: true,
      registry: REGISTRY,
      packageName: PACKAGE,
      repo: "CodySwannGT/lisa",
    });
  });

  it("defaults the registry to npm, or to LISA_NPM_REGISTRY", () => {
    const argv = ["--bad", "4.90.1", "--reason", REASON];
    expect(parseArgs(argv, {}).registry).toBe("https://registry.npmjs.org");
    expect(parseArgs(argv, { LISA_NPM_REGISTRY: REGISTRY }).registry).toBe(
      REGISTRY
    );
    expect(parseArgs(argv, {}).dryRun).toBe(false);
  });

  it("requires --bad and a non-empty --reason", () => {
    expect(() => parseArgs(["--reason", REASON], {})).toThrow(/--bad/);
    expect(() => parseArgs(["--bad", "4.90.1"], {})).toThrow(/--reason/);
    // An empty deprecation message UN-deprecates on npm, so it is refused.
    expect(() => parseArgs(["--bad", "4.90.1", "--reason", "  "], {})).toThrow(
      /--reason/
    );
  });

  it("refuses versions that are not exact semver", () => {
    expect(() =>
      parseArgs(["--bad", "latest", "--reason", REASON], {})
    ).toThrow(/--bad/);
    expect(() =>
      parseArgs(["--bad", "4.90.1", "--to", "^4", "--reason", REASON], {})
    ).toThrow(/--to/);
  });

  it("refuses unknown flags rather than ignoring them", () => {
    expect(() =>
      parseArgs(["--bad", "4.90.1", "--reason", REASON, "--force"], {})
    ).toThrow(/--force/);
  });
});

describe("resolveGoodVersion", () => {
  it("picks the highest published version below the bad one", () => {
    expect(resolveGoodVersion(packument(), "4.90.1")).toBe("4.90.0");
  });

  it("skips deprecated versions and prereleases", () => {
    const document = packument({ "4.90.0": entry("also bad") });
    expect(resolveGoodVersion(document, "4.90.1")).toBe("4.89.9");
  });

  it("honours an explicit --to, prerelease included", () => {
    expect(resolveGoodVersion(packument(), "4.90.1", "4.89.9")).toBe("4.89.9");
    expect(resolveGoodVersion(packument(), "4.90.1", "4.90.1-rc.1")).toBe(
      "4.90.1-rc.1"
    );
  });

  it("refuses a --to that is unpublished, deprecated or the bad version", () => {
    expect(() => resolveGoodVersion(packument(), "4.90.1", "4.1.0")).toThrow(
      /not published/
    );
    const document = packument({ "4.90.0": entry("bad too") });
    expect(() => resolveGoodVersion(document, "4.90.1", "4.90.0")).toThrow(
      /deprecated/
    );
    expect(() => resolveGoodVersion(packument(), "4.90.1", "4.90.1")).toThrow(
      /same/
    );
  });

  it("refuses when the bad version is not published", () => {
    expect(() => resolveGoodVersion(packument(), "9.9.9")).toThrow(
      /9\.9\.9 is not published/
    );
  });

  it("refuses when nothing below the bad version is usable", () => {
    expect(() => resolveGoodVersion(packument(), "4.89.9")).toThrow(
      /No published, non-deprecated version below 4\.89\.9/
    );
  });
});

describe("planCommands and formatting", () => {
  it("orders deprecate, dist-tag, release edit — all against the registry", () => {
    const plan = planCommands({
      ...options(),
      good: "4.90.0",
      notesFile: "/scratch/notes.md",
    });
    expect(plan.map(formatCommand)).toEqual([
      `npm deprecate ${PACKAGE}@4.90.1 'breaks apply' --registry ${REGISTRY}`,
      `npm dist-tag add ${PACKAGE}@4.90.0 latest --registry ${REGISTRY}`,
      "gh release edit v4.90.1 --repo CodySwannGT/lisa --notes-file /scratch/notes.md",
    ]);
    // The reason is one argv element, never interpolated into a shell string.
    expect(plan[0]?.args).toContain(REASON);
  });

  it("builds the uncached packument URL", () => {
    expect(packumentUrl(`${REGISTRY}/`, PACKAGE)).toBe(
      `${REGISTRY}/@codyswann%2flisa?write=true`
    );
  });

  it("states the reason and where latest now points", () => {
    const notice = deprecationNotice(REASON, "4.90.0");
    expect(notice).toContain(REASON);
    expect(notice).toContain("npm latest now points to 4.90.0");
  });
});

describe("rollback — a real run", () => {
  it("writes in order, prepends the notice, verifies, exits 0", async () => {
    const runner = fakeRunner(ghServes());
    const registry = fakeFetch([packument(), rolledBack]);
    const { injected, notes } = deps(runner.run, registry.impl);

    expect(await rollback(options(), injected)).toBe(0);
    expect(writes(runner.calls)).toEqual([
      `${DEPRECATE} ${PACKAGE}@4.90.1`,
      "npm dist-tag add",
      "gh release edit",
    ]);
    expect(notes[0]?.startsWith(deprecationNotice(REASON, "4.90.0"))).toBe(
      true
    );
    expect(notes[0]).toContain("Original notes.");
    expect(registry.urls.every(url => url.endsWith("?write=true"))).toBe(true);
  });

  it("checks npm and gh sign-in before the first write", async () => {
    const runner = fakeRunner(ghServes());
    const { injected } = deps(
      runner.run,
      fakeFetch([packument(), rolledBack]).impl
    );
    await rollback(options(), injected);
    const order = runner.calls.map(c => `${c.command} ${c.args[0]}`);
    expect(order.indexOf("npm whoami")).toBeLessThan(order.indexOf(DEPRECATE));
    expect(order.indexOf("gh auth")).toBeLessThan(order.indexOf(DEPRECATE));
  });

  it("exits non-zero when the read-back does not show both facts", async () => {
    const runner = fakeRunner(ghServes());
    // The writes "succeed" but the registry still says latest = 4.90.1.
    const stale = packument({ "4.90.1": entry(REASON) });
    const { injected, output } = deps(
      runner.run,
      fakeFetch([packument(), stale]).impl
    );
    expect(await rollback(options(), injected)).toBe(1);
    expect(output.err.join("\n")).toMatch(/latest is 4\.90\.1, not 4\.90\.0/);
  });

  it("stops at the first failed write", async () => {
    const runner = fakeRunner(call =>
      call.args[0] === "deprecate"
        ? { status: 1, stderr: "E403" }
        : ghServes()(call)
    );
    const { injected, output } = deps(
      runner.run,
      fakeFetch([packument()]).impl
    );
    expect(await rollback(options(), injected)).toBe(1);
    expect(writes(runner.calls)).toEqual([`${DEPRECATE} ${PACKAGE}@4.90.1`]);
    expect(output.err.join("\n")).toContain("E403");
  });
});

describe("rollback — nothing is written when it should not be", () => {
  it("a dry run prints the commands and runs none of them", async () => {
    const runner = fakeRunner();
    const { injected, output, notes } = deps(
      runner.run,
      fakeFetch([packument()]).impl
    );
    expect(await rollback(options({ dryRun: true }), injected)).toBe(0);
    expect(runner.calls).toEqual([]);
    expect(notes).toEqual([]);
    const printed = output.out.join("\n");
    expect(printed).toContain(`npm deprecate ${PACKAGE}@4.90.1 'breaks apply'`);
    expect(printed).toContain(`npm dist-tag add ${PACKAGE}@4.90.0 latest`);
    expect(printed).toContain("gh release edit v4.90.1");
  });

  it("refuses without npm sign-in, naming it, before any write", async () => {
    const runner = fakeRunner(call =>
      call.args[0] === "whoami" ? { status: 1 } : { status: 0 }
    );
    const { injected, output } = deps(
      runner.run,
      fakeFetch([packument()]).impl
    );
    expect(await rollback(options(), injected)).toBe(1);
    expect(writes(runner.calls)).toEqual([]);
    expect(output.err.join("\n")).toMatch(/not signed in to npm/);
    expect(output.err.join("\n")).toContain("Nothing was changed");
  });

  it("refuses without gh sign-in, naming it, before any write", async () => {
    const runner = fakeRunner(call =>
      call.command === "gh" ? { status: 1 } : { status: 0 }
    );
    const { injected, output } = deps(
      runner.run,
      fakeFetch([packument()]).impl
    );
    expect(await rollback(options(), injected)).toBe(1);
    expect(writes(runner.calls)).toEqual([]);
    expect(output.err.join("\n")).toMatch(/GitHub CLI is not signed in/);
  });

  it("refuses when the version cannot be resolved", async () => {
    const runner = fakeRunner();
    const { injected, output } = deps(
      runner.run,
      fakeFetch([packument()]).impl
    );
    expect(await rollback(options({ bad: "4.89.9" }), injected)).toBe(1);
    expect(runner.calls).toEqual([]);
    expect(output.err.join("\n")).toMatch(/No published/);
  });
});

describe("main", () => {
  it("turns a usage error into a non-zero exit with the reason", async () => {
    const output = sinks();
    expect(await main(["--bad", "4.90.1"], { error: output.error })).toBe(1);
    expect(output.err.join("\n")).toMatch(/--reason/);
  });

  it("runs a dry run end to end through injected seams", async () => {
    const output = sinks();
    const code = await main(
      ["--bad", "4.90.1", "--reason", REASON, "--dry-run"],
      {
        env: { LISA_NPM_REGISTRY: REGISTRY },
        fetchImpl: fakeFetch([packument()]).impl,
        log: output.log,
        error: output.error,
      }
    );
    expect(code).toBe(0);
    expect(output.out.join("\n")).toContain(`--registry ${REGISTRY}`);
  });
});
