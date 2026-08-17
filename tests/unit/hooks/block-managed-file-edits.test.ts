/**
 * Tests the guard that refuses agent writes to Lisa-managed templates.
 *
 * The load-bearing case is `.lisaignore`. `lisa apply` SKIPS an ignored path —
 * it reports `Kept (.lisaignore)` rather than overwriting — so the file is the
 * project's, its edits survive, and refusing them would lock someone out of
 * their own file. The guard shipped without consulting that list, which a peer
 * caught against two real files in one repository pointing opposite ways:
 * `scripts/bdd/render.mjs`, where local fixes revert and the change belongs
 * upstream, and `scripts/classify-maestro-failures.mjs`, a deliberate fork that
 * must be edited locally and never upstreamed.
 *
 * Both are copy-overwrite. Only `.lisaignore` distinguishes them, and without
 * it the guard gave the fork exactly the wrong instruction.
 * @module tests/unit/hooks/block-managed-file-edits
 */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const GUARD = path.join(
  REPO_ROOT,
  "plugins",
  "src",
  "base",
  "hooks",
  "block-managed-file-edits.sh"
);

/** Absolute interpreter path; resolving `bash` through PATH is not permitted. */
const BASH = "/bin/bash";

/** A copy-overwrite template used across the cases. */
const MANAGED = "scripts/classify-maestro-failures.mjs";

let project: string;

/**
 * Run the guard against a tool payload.
 * @param filePath - Target the tool would write
 * @returns Exit status; 2 means refused
 */
function runGuard(filePath: string): number {
  try {
    execFileSync(BASH, [GUARD], {
      input: JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: filePath },
      }),
      env: { ...process.env, CLAUDE_PROJECT_DIR: project },
      stdio: "pipe",
    });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

/**
 * Write a `.lisaignore` for the fixture project.
 * @param body - File contents
 * @returns Nothing.
 */
const ignoreFile = (body: string): void =>
  writeFileSync(path.join(project, ".lisaignore"), body, "utf8");

beforeEach(() => {
  project = mkdtempSync(path.join(tmpdir(), "lisa-guard-"));
  const shipped = path.join(
    project,
    "node_modules/@codyswann/lisa/all/copy-overwrite/scripts"
  );
  mkdirSync(shipped, { recursive: true });
  writeFileSync(path.join(shipped, "classify-maestro-failures.mjs"), "x");
  writeFileSync(path.join(shipped, "render.mjs"), "y");
  // Only the first is hash-tracked, which is what the refusal branches on.
  const ledgerDir = path.join(
    project,
    "node_modules/@codyswann/lisa/dist/core"
  );
  mkdirSync(ledgerDir, { recursive: true });
  writeFileSync(
    path.join(ledgerDir, "lisa-owned-hash-ledger.js"),
    `const L={"scripts/classify-maestro-failures.mjs":true};\n`
  );
  mkdirSync(
    path.join(
      project,
      "node_modules/@codyswann/lisa/typescript/copy-overwrite"
    ),
    { recursive: true }
  );
  writeFileSync(
    path.join(
      project,
      "node_modules/@codyswann/lisa/typescript/copy-overwrite/.lintstagedrc.json"
    ),
    "{}"
  );
  mkdirSync(
    path.join(project, "node_modules/@codyswann/lisa/typescript/create-only"),
    {
      recursive: true,
    }
  );
  writeFileSync(
    path.join(
      project,
      "node_modules/@codyswann/lisa/typescript/create-only/eslint.config.local.ts"
    ),
    "z"
  );
  writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ name: "host-project" })
  );
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe("what the guard refuses", () => {
  it("refuses a copy-overwrite template", () => {
    expect(runGuard(MANAGED)).toBe(2);
  });

  it("allows a create-only file, which the host owns", () => {
    expect(runGuard("eslint.config.local.ts")).toBe(0);
  });

  it("allows a file Lisa does not ship", () => {
    expect(runGuard("src/app.ts")).toBe(0);
  });
});

describe(".lisaignore declares project ownership", () => {
  it("allows an ignored template, because apply will not overwrite it", () => {
    // The fork case. Without this the guard told a deliberate fork to go
    // upstream, which is the one place its change must never go.
    ignoreFile(`${MANAGED}\n`);
    expect(runGuard(MANAGED)).toBe(0);
  });

  it("still refuses a DIFFERENT managed file in the same project", () => {
    // The two-directions case: one file forked, one not, in one repository.
    ignoreFile(`${MANAGED}\n`);
    expect(runGuard("scripts/render.mjs")).toBe(2);
  });

  it.each([
    ["a directory pattern", "scripts/\n"],
    ["a glob", "*.mjs\n"],
    ["a bare basename", "classify-maestro-failures.mjs\n"],
  ])("honours %s", (_label, body) => {
    ignoreFile(body);
    expect(runGuard(MANAGED)).toBe(0);
  });

  // `!` is now real gitignore negation on both sides. It previously was not:
  // the TS matcher handed patterns to minimatch, which negates by default and
  // combined them with `.some()`, so one `!x` line reported every OTHER path as
  // ignored — including `tsconfig.json`. An ignored path is not an apply
  // candidate, so a single stray line switched Lisa off for the whole project.
  // This guard punted on it deliberately and allowed the write. Both sides now
  // implement last-match-wins, and these pin them to the same answers.
  describe("negation, in parity with matchesAnyPattern", () => {
    it("re-includes a path an earlier pattern ignored, so the guard refuses", () => {
      ignoreFile(`scripts/\n!${MANAGED}\n`);
      expect(runGuard(MANAGED)).toBe(2);
    });

    it("keeps the earlier ignore for paths the negation does not name", () => {
      ignoreFile("scripts/\n!scripts/something-else.mjs\n");
      expect(runGuard(MANAGED)).toBe(0);
    });

    it("does not let a lone negation claim the whole project", () => {
      // The severe case. Before the fix this allowed every write.
      ignoreFile("!scripts/something-else.mjs\n");
      expect(runGuard(MANAGED)).toBe(2);
    });

    it("applies last-match-wins rather than first-match-wins", () => {
      ignoreFile(`scripts/\n!${MANAGED}\n${MANAGED}\n`);
      expect(runGuard(MANAGED)).toBe(0);
    });

    it("keeps a bare ! inert instead of matching everything", () => {
      ignoreFile("!\n");
      expect(runGuard(MANAGED)).toBe(2);
    });
  });

  it.each([
    ["comments and blank lines only", "# nothing here\n\n"],
    ["an unrelated entry", "scripts/other.mjs\n"],
  ])("still refuses with %s", (_label, body) => {
    // The exemption has to be earned. A `.lisaignore` that exists but does not
    // name this path must not read as blanket ownership.
    ignoreFile(body);
    expect(runGuard(MANAGED)).toBe(2);
  });
});

describe("the refusal states the consequence that actually applies", () => {
  /**
   * Capture the refusal text for a target.
   * @param filePath - Target the tool would write
   * @returns stderr from the guard
   */
  function refusalFor(filePath: string): string {
    try {
      execFileSync(BASH, [GUARD], {
        input: JSON.stringify({
          tool_name: "Write",
          tool_input: { file_path: filePath },
        }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: project },
        stdio: "pipe",
      });
      return "";
    } catch (error) {
      return String((error as { stderr?: Buffer }).stderr ?? "");
    }
  }

  // Measured by mutating four copy-overwrite files in a scratch project and
  // running a real `lisa apply`: ALL FOUR survived, across ledger-tracked .mjs,
  // untracked JSON, and untracked plain text. Summary: `Overwritten: 0 files`.
  // copy-overwrite refreshes an unmodified copy; it does not replace an edited
  // one. Two earlier versions of this guard claimed otherwise, so these tests
  // pin the measured outcome — no refusal may tell a reader their edit is lost.
  const LOSS_CLAIMS = ["REPLACES it", "vanishes", "replaced wholesale"];

  it.each([MANAGED, ".lintstagedrc.json"])(
    "never tells %s that its edit will be lost",
    target => {
      const text = refusalFor(target);
      for (const claim of LOSS_CLAIMS) expect(text).not.toContain(claim);
      expect(text).toContain("KEEP your edit");
      expect(text).toContain("FORKS");
    }
  );

  it("quotes the provenance verdict a hash-tracked guard actually gets", () => {
    // The distinction that survives is the MESSAGE, not the outcome: tracked
    // files get a verdict naming the fork, untracked ones a bare warning.
    expect(refusalFor(MANAGED)).toContain("Kept yours");
    expect(refusalFor(".lintstagedrc.json")).toContain("Out of date");
  });

  it("steers a hash-tracked fork AWAY from .lisaignore", () => {
    // Ignoring a tracked guard buys nothing (the ledger already preserves it)
    // and silences the standoff doctor reports — replacing a true warning with
    // a false statement of conformance.
    expect(refusalFor(MANAGED)).toContain("Do NOT add it to");
  });
});

describe("the refusal explains the fork route", () => {
  it("names .lisaignore, so a genuine fork is not told to go upstream", () => {
    let stderr = "";
    try {
      execFileSync(BASH, [GUARD], {
        input: JSON.stringify({
          tool_name: "Write",
          tool_input: { file_path: MANAGED },
        }),
        env: { ...process.env, CLAUDE_PROJECT_DIR: project },
        stdio: "pipe",
      });
    } catch (error) {
      stderr = String((error as { stderr?: Buffer }).stderr ?? "");
    }
    expect(stderr).toContain(".lisaignore");
    expect(stderr).toContain("LISA_ALLOW_MANAGED_FILE_WRITE");
  });
});

/**
 * `lisa apply` GENERATES some paths rather than copying them, and the two fail
 * in opposite directions. A guard that gives one answer is wrong for half the
 * files it covers:
 *
 *   copy-overwrite, host-edited -> PRESERVED. Silently forks, keeps looking
 *                                  current, stops receiving upstream fixes.
 *   generated                   -> REBUILT. The edit works locally, CI agrees
 *                                  because CI regenerates too, and the next
 *                                  install reverts it with nothing reporting it.
 *
 * Reported by a consumer session that correctly declined to patch
 * `.lisa/lisa-oxlint/base.json` locally BECAUSE it is generated — they reached
 * the right answer without a guard telling them. The next agent may not.
 * CodySwannGT/lisa#2632.
 */
describe("generated paths get the opposite consequence", () => {
  it("names the generated set from the installed package, not from a copy here", () => {
    // The prefixes live in dist/migrations/generated-paths.js, which the
    // vendoring migration also imports. A list restated inside the hook would
    // be a second place to update that nobody updates — the same defect this
    // file documents for copy-overwrite, one step along.
    expect(hookText()).toContain("dist/migrations/generated-paths.js");
    expect(hookText()).not.toContain('".lisa/lisa-oxlint"');
  });

  it("tells a generated file its edit is REGENERATED away", () => {
    expect(hookText()).toContain("REGENERATES this file");
  });

  it("keeps the two consequences distinct in the refusal text", () => {
    // If these ever collapse into one message, the guard has started lying to
    // one of its two populations.
    const text = hookText();
    expect(text).toContain("REGENERATES this file");
    expect(text).toContain("KEEP your edit");
  });
});

/**
 * Read the shipped hook source once for the assertions above.
 * @returns The hook's text.
 */
function hookText(): string {
  return readFileSync(
    path.join(process.cwd(), "plugins/lisa/hooks/block-managed-file-edits.sh"),
    "utf8"
  );
}
