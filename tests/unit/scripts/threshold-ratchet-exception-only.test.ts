/**
 * Regression tests for CodySwannGT/lisa#5099 — a change that only records a
 * threshold exception must be able to land.
 *
 * The ratchet honours a `thresholdRatchet.allow` entry only from the baseline,
 * so the entry has to be merged in a change of its own before the threshold
 * moves. The check refused that first change too, in every layer, and told the
 * reader to land the entry "in its own human-approved change first" — the
 * change it had just refused. The exception route existed on paper only.
 *
 * What these tests hold in place:
 *   - an entry-only change with a reason and a day it ends is accepted, with a
 *     notice, at edit, at commit and against a base
 *   - the fence is untouched: an entry that arrives with any other finding is
 *     refused, and an entry exempts nothing until it is on the baseline
 *   - a malformed entry is refused and the refusal says what is missing
 *   - `humanGate.mode: "strict"` keeps the refusal it had, and the mode is read
 *     from the baseline so a change cannot relax it for itself
 *
 * The compare and families modules are imported statically and by relative
 * path for the reason threshold-ratchet.test.ts documents: the mutation gate
 * only sees modules that are in Vite's module graph.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  compareFile,
  formatReport,
  settleAddedExceptions,
} from "../../../plugins/src/base/hooks/threshold-ratchet-compare.mjs";
import {
  classifyAllowEntry,
  humanGateModeOf,
} from "../../../plugins/src/base/hooks/threshold-ratchet-families.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

/** Absolute git path, so the fixture does not resolve a command off `PATH`. */
const GIT = resolveGit();

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOKS_REL = "plugins/src/base/hooks";
const ENTRY = "threshold-ratchet.mjs";
const RATCHET_MODULES = [
  "threshold-ratchet-families.mjs",
  "threshold-ratchet-compare.mjs",
];
const ESLINT_FILE = "eslint.thresholds.json";
const LISA_CONFIG = ".lisa.config.json";
const ACCESS_ONLY = "access-only";
const STRICT = "strict";
const REASON =
  "Six bundled languages; resolved when translations load on demand.";
const LEGACY_REFUSAL = "Exceptions are a human decision";
const BLOCK_BANNER = "Quality gate weakened";
const ALLOW_ADDED = "allow-added";
const RECORDED = "new exception recorded";
const INERT_UNTIL_MERGED = "exempts nothing until this change is merged";
const NEEDS_UNTIL = 'needs an "until": "YYYY-MM-DD" day';
const NEEDS_REASON = "needs a reason saying what resolves it";
const HUMAN_APPROVED = "human-approved";

/** A fixed clock for the pure functions: noon UTC on 2026-06-15. */
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const TODAY = "2026-06-15";
const YESTERDAY = "2026-06-14";
const NEXT_WEEK = "2026-06-22";

/** An allow entry as a repository would write it. */
interface AllowEntry {
  readonly file: string;
  readonly key: string;
  readonly reason?: unknown;
  readonly until?: unknown;
}

/**
 * The findings for a `.lisa.config.json` that gains allow entries.
 * @param added - Entries present only on the current side
 * @returns What `compareFile` reports for that change
 */
function addedEntries(
  ...added: readonly AllowEntry[]
): ReturnType<typeof compareFile> {
  return compareFile(
    LISA_CONFIG,
    JSON.stringify({ thresholdRatchet: { allow: [] } }),
    JSON.stringify({ thresholdRatchet: { allow: added } })
  );
}

/** One `weakened` finding: an eslint ceiling raised from 10 to 25. */
function raisedCeiling(): ReturnType<typeof compareFile> {
  return compareFile(
    ESLINT_FILE,
    JSON.stringify({ maxWarnings: 10 }),
    JSON.stringify({ maxWarnings: 25 })
  );
}

/**
 * A well-formed, key-scoped entry for the eslint ceiling.
 * @param overrides - Fields to replace
 * @returns The entry
 */
function entry(overrides: Partial<AllowEntry> = {}): AllowEntry {
  return {
    file: ESLINT_FILE,
    key: "maxWarnings",
    reason: REASON,
    until: NEXT_WEEK,
    ...overrides,
  };
}

describe("humanGateModeOf (#5099)", () => {
  it.each([
    ["no config at all", undefined],
    ["a config that could not be parsed", null],
    ["a config with no humanGate block", {}],
    ["a humanGate block with no mode", { humanGate: {} }],
  ])("is access-only for %s", (_name, config) => {
    expect(humanGateModeOf(config)).toBe(ACCESS_ONLY);
  });

  it.each([
    ["strict", STRICT, STRICT],
    ["strict with stray spaces and capitals", "  Strict ", STRICT],
    ["access-only", ACCESS_ONLY, ACCESS_ONLY],
    ["access-only with capitals", "Access-Only", ACCESS_ONLY],
  ])("reads a declared %s", (_name, mode, expected) => {
    expect(humanGateModeOf({ humanGate: { mode } })).toBe(expected);
  });

  it.each([
    ["a misspelt mode", "acess-only"],
    ["an empty string", ""],
    ["null", null],
    ["a number", 1],
    ["a boolean", true],
  ])("fails safe to strict for %s", (_name, mode) => {
    expect(humanGateModeOf({ humanGate: { mode } })).toBe(STRICT);
  });
});

describe("settleAddedExceptions (#5099)", () => {
  it("carries the entry on the finding so it can be judged", () => {
    const [finding] = addedEntries(entry());

    expect(finding?.type).toBe(ALLOW_ADDED);
    expect(finding?.entry).toEqual(entry());
  });

  it("accepts an entry-only change and says what the entry is", () => {
    const settled = settleAddedExceptions(
      addedEntries(entry()),
      ACCESS_ONLY,
      NOW
    );

    expect(settled.refused).toEqual([]);
    expect(settled.rest).toEqual([]);
    expect(settled.accepted).toHaveLength(1);
    const notice = settled.accepted[0]?.message ?? "";
    expect(notice).toContain(
      `thresholdRatchet.allow entry ${ESLINT_FILE} → maxWarnings (key-scoped)`
    );
    expect(notice).toContain(REASON);
    expect(notice).toContain(NEXT_WEEK);
    expect(notice).toContain(INERT_UNTIL_MERGED);
  });

  it("says a file-wide entry is file-wide", () => {
    const settled = settleAddedExceptions(
      addedEntries(entry({ key: "*" })),
      ACCESS_ONLY,
      NOW
    );

    expect(settled.accepted[0]?.message).toContain("file-wide");
  });

  it("accepts every entry of a change that adds several", () => {
    const settled = settleAddedExceptions(
      addedEntries(entry(), entry({ key: "maxComplexity" })),
      ACCESS_ONLY,
      NOW
    );

    expect(settled.accepted).toHaveLength(2);
    expect(settled.refused).toEqual([]);
  });

  it("accepts an entry that ends today and refuses one that ended yesterday", () => {
    const today = settleAddedExceptions(
      addedEntries(entry({ until: TODAY })),
      ACCESS_ONLY,
      NOW
    );
    const yesterday = settleAddedExceptions(
      addedEntries(entry({ until: YESTERDAY })),
      ACCESS_ONLY,
      NOW
    );

    expect(today.accepted).toHaveLength(1);
    expect(yesterday.accepted).toEqual([]);
    expect(yesterday.refused).toHaveLength(1);
    expect(yesterday.refused[0]?.message).toContain(
      `its "until" day ${YESTERDAY} has passed`
    );
    expect(yesterday.refused[0]?.message).not.toContain(LEGACY_REFUSAL);
  });

  it.each([
    ["no until", { until: undefined }, NEEDS_UNTIL],
    ["an until nothing can read", { until: "soon" }, NEEDS_UNTIL],
    ["no reason", { reason: undefined }, NEEDS_REASON],
    ["a blank reason", { reason: "   " }, NEEDS_REASON],
    ["a reason that is not text", { reason: 7 }, NEEDS_REASON],
  ])(
    "refuses an entry with %s and says what is missing",
    (_name, overrides, missing) => {
      const settled = settleAddedExceptions(
        addedEntries(entry(overrides)),
        ACCESS_ONLY,
        NOW
      );

      expect(settled.accepted).toEqual([]);
      expect(settled.refused).toHaveLength(1);
      expect(settled.refused[0]?.type).toBe(ALLOW_ADDED);
      expect(settled.refused[0]?.message).toContain("new threshold exception");
      expect(settled.refused[0]?.message).toContain(missing);
      expect(settled.refused[0]?.message).not.toContain(LEGACY_REFUSAL);
    }
  );

  it("names both gaps when an entry has neither a reason nor an end", () => {
    const settled = settleAddedExceptions(
      addedEntries(entry({ reason: undefined, until: undefined })),
      ACCESS_ONLY,
      NOW
    );

    const message = settled.refused[0]?.message ?? "";
    expect(message).toContain(NEEDS_REASON);
    expect(message).toContain(NEEDS_UNTIL);
  });

  it("refuses a malformed entry without dropping a sound one beside it", () => {
    const settled = settleAddedExceptions(
      addedEntries(entry(), entry({ key: "maxComplexity", until: undefined })),
      ACCESS_ONLY,
      NOW
    );

    expect(settled.accepted).toHaveLength(1);
    expect(settled.refused).toHaveLength(1);
    expect(settled.refused[0]?.key).toContain("maxComplexity");
  });

  it("refuses an entry that arrives with a threshold change", () => {
    const settled = settleAddedExceptions(
      [...addedEntries(entry()), ...raisedCeiling()],
      ACCESS_ONLY,
      NOW
    );

    expect(settled.accepted).toEqual([]);
    expect(settled.rest).toEqual(raisedCeiling());
    expect(settled.refused).toHaveLength(1);
    const message = settled.refused[0]?.message ?? "";
    expect(message).toContain("new threshold exception");
    expect(message).toContain(
      `thresholdRatchet.allow entry ${ESLINT_FILE} → maxWarnings (key-scoped)`
    );
    expect(message).toContain("Merge this entry in a change of its own first");
    expect(message).not.toContain(LEGACY_REFUSAL);
  });

  it("keeps the refusal it had under strict, however sound the entry", () => {
    const findings = addedEntries(entry());
    const settled = settleAddedExceptions(findings, STRICT, NOW);

    expect(settled.accepted).toEqual([]);
    expect(settled.rest).toEqual([]);
    expect(settled.refused).toHaveLength(1);
    expect(settled.refused[0]?.type).toBe(ALLOW_ADDED);
    expect(settled.refused[0]?.message).toContain(findings[0]?.message);
    expect(settled.refused[0]?.message).toContain(LEGACY_REFUSAL);
  });

  it("passes findings that are not new exceptions through untouched", () => {
    const settled = settleAddedExceptions(raisedCeiling(), ACCESS_ONLY, NOW);

    expect(settled.accepted).toEqual([]);
    expect(settled.refused).toEqual([]);
    expect(settled.rest).toEqual(raisedCeiling());
  });

  it("reads the clock when none is injected", () => {
    const tomorrow = new Date(Date.now() + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const settled = settleAddedExceptions(
      addedEntries(entry({ until: tomorrow })),
      ACCESS_ONLY
    );

    expect(settled.accepted).toHaveLength(1);
  });
});

describe("the ratchet's texts under the default policy (#5099)", () => {
  it("describes a way to an exception that the check accepts", () => {
    const report = formatReport(raisedCeiling());

    expect(report).toContain("thresholdRatchet.allow");
    expect(report).toContain("merge it in a change of its own first");
    expect(report).not.toContain(HUMAN_APPROVED);
    expect(report).not.toContain("a human decides");
  });

  it("keeps the strict wording for a strict repository", () => {
    const report = formatReport(raisedCeiling(), STRICT);

    expect(report).toContain("separate human-approved change");
  });

  it("does not send an expired entry's owner to a human-approved entry", () => {
    const { detail } = classifyAllowEntry(entry({ until: YESTERDAY }), NOW);

    expect(detail).toContain("record a fresh entry naming the new condition");
    expect(detail).not.toContain(HUMAN_APPROVED);
  });
});

/** Fixture repositories created by the CLI tests, removed after each one. */
const fixtures: string[] = [];

afterEach(() => {
  fixtures.splice(0).forEach(dir => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

/**
 * Run git in a repository, throwing on failure so a broken fixture cannot
 * masquerade as a passing test.
 * @param cwd - Repository directory
 * @param args - Git arguments
 */
function git(cwd: string, ...args: readonly string[]): void {
  const result = boundedSpawnSync({
    label: `git ${args[0] ?? ""}`,
    command: GIT,
    args: ["-c", "user.email=t@t", "-c", "user.name=t", ...args],
    cwd,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }
}

/**
 * Serialize a `.lisa.config.json`.
 * @param allow - Allow entries to record
 * @param mode - A `humanGate.mode` to declare, when the fixture needs one
 * @returns The file's text
 */
function configText(allow: readonly object[], mode?: string): string {
  return `${JSON.stringify(
    {
      ...(mode === undefined ? {} : { humanGate: { mode } }),
      thresholdRatchet: { allow },
    },
    undefined,
    2
  )}\n`;
}

/**
 * Write a file in a fixture repository.
 * @param dir - Repository directory
 * @param name - File name
 * @param text - File text
 */
function write(dir: string, name: string, text: string): void {
  fs.writeFileSync(path.join(dir, name), text, "utf-8");
}

/**
 * Create a repository whose `main` holds the baseline: an eslint ceiling of 10
 * warnings and no recorded exceptions.
 * @param mode - A `humanGate.mode` the baseline declares
 * @returns Absolute path to the repository
 */
function baselineRepo(mode?: string): string {
  // realpath, because the script only runs main() when argv[1] resolves to its
  // own module URL, and on macOS os.tmpdir() is a symlink.
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lisa-ratchet-exception-"))
  );
  fixtures.push(dir);
  git(dir, "init", "-q", "-b", "main");
  for (const module of [ENTRY, ...RATCHET_MODULES]) {
    fs.copyFileSync(
      path.join(REPO_ROOT, HOOKS_REL, module),
      path.join(dir, module)
    );
  }
  write(dir, LISA_CONFIG, configText([], mode));
  write(dir, ESLINT_FILE, `${JSON.stringify({ maxWarnings: 10 })}\n`);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "baseline");
  return dir;
}

/**
 * A day some weeks from now, so an exception written with it is still live
 * whenever the suite runs.
 * @returns The day as `YYYY-MM-DD`
 */
function aDayStillAhead(): string {
  return new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The entry the CLI fixtures record: sound, and live whenever the suite runs.
 * @param overrides - Fields to replace
 * @returns The entry
 */
function liveEntry(overrides: Partial<AllowEntry> = {}): AllowEntry {
  return entry({ until: aDayStillAhead(), ...overrides });
}

/** What one run of the ratchet produced. */
interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the ratchet in a fixture repository.
 * @param dir - Repository directory
 * @param args - Mode arguments
 * @param input - Text for stdin (hook mode)
 * @returns Exit status and both streams
 */
function ratchet(dir: string, args: readonly string[], input?: string): Run {
  const result = boundedSpawnSync({
    label: `the threshold ratchet ${args.join(" ")}`,
    command: process.execPath,
    args: [path.join(dir, ENTRY), ...args],
    cwd: dir,
    ...(input === undefined ? {} : { input }),
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

/**
 * The tool-use event an agent runtime sends after editing a file.
 * @param dir - Repository directory
 * @returns The event as JSON text
 */
function editEvent(dir: string): string {
  return JSON.stringify({
    tool_name: "Edit",
    tool_input: { file_path: path.join(dir, LISA_CONFIG) },
  });
}

describe("an exception-only change through the ratchet (#5099)", () => {
  it("is accepted at commit, with a notice", () => {
    const dir = baselineRepo();
    write(dir, LISA_CONFIG, configText([liveEntry()]));
    git(dir, "add", "-A");

    const result = ratchet(dir, ["--staged"]);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(RECORDED);
    expect(result.stdout).toContain(
      `thresholdRatchet.allow entry ${ESLINT_FILE} → maxWarnings (key-scoped)`
    );
    expect(result.stdout).toContain(REASON);
    expect(result.stdout).toContain(aDayStillAhead());
    expect(result.stdout).toContain(INERT_UNTIL_MERGED);
  });

  it("is accepted against a base, with the same notice", () => {
    const dir = baselineRepo();
    git(dir, "checkout", "-qb", "topic");
    write(dir, LISA_CONFIG, configText([liveEntry()]));
    git(dir, "commit", "-qam", "record the exception");

    const result = ratchet(dir, ["--base", "main"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(RECORDED);
    expect(result.stdout).toContain(INERT_UNTIL_MERGED);
  });

  it("does not refuse the edit, and hands the agent the notice", () => {
    const dir = baselineRepo();
    write(dir, LISA_CONFIG, configText([liveEntry()]));

    const result = ratchet(dir, ["--hook"], editEvent(dir));

    expect(result.status).toBe(0);
    const reply = JSON.parse(result.stdout) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(reply.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(reply.hookSpecificOutput.additionalContext).toContain(RECORDED);
    expect(reply.hookSpecificOutput.additionalContext).toContain(
      INERT_UNTIL_MERGED
    );
  });

  it("still refuses a change that grants itself the exception", () => {
    const dir = baselineRepo();
    git(dir, "checkout", "-qb", "topic");
    write(dir, LISA_CONFIG, configText([liveEntry()]));
    write(dir, ESLINT_FILE, `${JSON.stringify({ maxWarnings: 25 })}\n`);
    git(dir, "add", "-A");
    const staged = ratchet(dir, ["--staged"]);
    git(dir, "commit", "-qm", "raise the ceiling and excuse it");
    const based = ratchet(dir, ["--base", "main"]);

    for (const result of [staged, based]) {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(BLOCK_BANNER);
      expect(result.stderr).toContain("maxWarnings");
      expect(result.stderr).toContain(
        "Merge this entry in a change of its own first"
      );
      expect(result.stderr).not.toContain(LEGACY_REFUSAL);
      expect(result.stdout).not.toContain(RECORDED);
    }
  });

  it("honours the exception once it is on the base", () => {
    const dir = baselineRepo();
    write(dir, LISA_CONFIG, configText([liveEntry()]));
    git(dir, "commit", "-qam", "record the exception");
    git(dir, "checkout", "-qb", "topic");
    write(dir, ESLINT_FILE, `${JSON.stringify({ maxWarnings: 25 })}\n`);
    git(dir, "commit", "-qam", "raise the ceiling");

    const result = ratchet(dir, ["--base", "main"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `allowed by thresholdRatchet.allow entry ${ESLINT_FILE} → maxWarnings (key-scoped)`
    );
  });

  it("refuses a malformed entry at commit and at edit", () => {
    const dir = baselineRepo();
    write(dir, LISA_CONFIG, configText([liveEntry({ until: undefined })]));
    const edited = ratchet(dir, ["--hook"], editEvent(dir));
    git(dir, "add", "-A");
    const staged = ratchet(dir, ["--staged"]);

    expect(staged.status).toBe(1);
    expect(edited.status).toBe(2);
    for (const result of [staged, edited]) {
      expect(result.stderr).toContain(NEEDS_UNTIL);
      expect(result.stderr).not.toContain(LEGACY_REFUSAL);
      expect(result.stderr).not.toContain(HUMAN_APPROVED);
    }
  });

  it("is refused as before in a strict repository", () => {
    const dir = baselineRepo(STRICT);
    write(dir, LISA_CONFIG, configText([liveEntry()], STRICT));
    git(dir, "add", "-A");

    const result = ratchet(dir, ["--staged"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(LEGACY_REFUSAL);
    expect(result.stderr).toContain("separate human-approved change");
    expect(result.stdout).not.toContain(RECORDED);
  });

  it("does not let a change relax the mode for itself", () => {
    const dir = baselineRepo(STRICT);
    write(dir, LISA_CONFIG, configText([liveEntry()], ACCESS_ONLY));
    git(dir, "add", "-A");

    const result = ratchet(dir, ["--staged"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(LEGACY_REFUSAL);
  });
});
