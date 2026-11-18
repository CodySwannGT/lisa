/**
 * `lisa controls attest` against real repositories (CodySwannGT/lisa#4995).
 *
 * The command prints one result per control and exits 0 only when every one
 * passed. It plants its changes in a disposable copy, never in the
 * repository it is pointed at. What it writes in the repository is the
 * evidence, the control register and the verdict, and nothing else
 * (CodySwannGT/lisa#4998). In a folder the operator named with
 * `--workspace` it writes nothing at all: that run is a report, and
 * `attest-report-only.test.ts` holds it to that.
 * @module tests/unit/controls/attest-command
 */
import { mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ATTEST_EXIT,
  runAttest,
} from "../../../src/controls/commands/attest.js";
import type { ProofRun } from "../../../src/controls/proof-types.js";
import {
  buildFEmpty,
  runControlAuditGit,
} from "../../helpers/control-audit-fixtures.js";
import {
  ACCEPTS_EVERYTHING,
  checks,
  F_NONE_SOURCE,
  provedGates,
  REJECTS_EVERYTHING,
} from "../../helpers/control-proofs.js";
import { attest, attestAndRecord } from "./support/attest-run.js";
import { removeCopies, setting } from "./support/proof-run.js";
import { keep, removeFixtures } from "./support/report-check-run.js";

const WORKING = provedGates([{ command: checks(F_NONE_SOURCE) }]);
const BROKEN = {
  ...provedGates([{ command: ACCEPTS_EVERYTHING, name: "lint" }]),
  ...provedGates(
    [{ command: REJECTS_EVERYTHING, name: "lint" }],
    "test-correctness",
    ["push"]
  ),
};

/** What the command says about the files it wrote, after the table. */
const WRITTEN_DOWN = [
  expect.stringMatching(/^attest: Recorded \d+ evidence records? in /u),
  expect.stringMatching(/^attest: No audit report is at /u),
  expect.stringMatching(
    /^attest: Wrote \.lisa\/controls\/register\.json again /u
  ),
  expect.stringMatching(/^attest: Level 1 result: non-conforming\. /u),
] as const;

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("lisa controls attest", () => {
  it("prints a table and exits 0 when every control passed", async () => {
    const where = setting(WORKING);

    const run = await attestAndRecord(where);

    expect(run.code).toBe(ATTEST_EXIT.PASSED);
    expect(run.stderr).toEqual([]);
    expect(run.stdout).toEqual([
      "RESULT  ENTRY         MOMENT  HALVES",
      "passed  code-style@.  commit  violation rejected (exit 1); clean accepted (exit 0)",
      "        The check turned the violating change away with the declared failure text and let the clean change through.",
      ...WRITTEN_DOWN,
      "attest: PASS. 1 of 1 entry proved: 1 passed, 0 failed, 0 unproved, 0 unknown",
    ]);
  });

  it("names the half each failing control failed on, and exits 1", async () => {
    const where = setting(BROKEN);

    const run = await attestAndRecord(where);

    expect(run.code).toBe(ATTEST_EXIT.NOT_PASSED);
    expect(run.stdout.filter(line => line.startsWith("failed"))).toEqual([
      expect.stringMatching(/^failed \(violation\) {2}code-style@\. /u),
      expect.stringMatching(/^failed \(clean\) {6}test-correctness@\. /u),
    ]);
    expect(run.stderr).toEqual([
      "attest: FAIL. 0 of 2 entries proved: 0 passed, 2 failed, 0 unproved, 0 unknown. Every entry has to pass",
    ]);
  });

  it("prints one JSON document and nothing else with --json", async () => {
    const where = setting(BROKEN);

    const run = await attestAndRecord(where, { json: true });
    const document = JSON.parse(run.stdout.join("\n")) as ProofRun;

    expect(run.code).toBe(ATTEST_EXIT.NOT_PASSED);
    expect(run.stdout).toHaveLength(1);
    expect(document).toMatchObject({
      schema_version: 1,
      passed: false,
      counts: { passed: 0, failed: 2, unproved: 0, unknown: 0 },
    });
    expect(
      document.entries.map(entry => [entry.entry_id, entry.failed_halves])
    ).toEqual([
      ["code-style@.", ["violation"]],
      ["test-correctness@.", ["clean"]],
    ]);
  });

  it("prints only the JSON document when every control passed", async () => {
    const where = setting(WORKING);

    const run = await attestAndRecord(where, { json: true });

    expect(run.code).toBe(ATTEST_EXIT.PASSED);
    expect(run.stderr).toEqual([]);
    expect((JSON.parse(run.stdout.join("\n")) as ProofRun).passed).toBe(true);
  });

  it("writes its three files in the repository, and nothing in the copy", async () => {
    const where = setting(BROKEN);

    await attestAndRecord(where);

    expect(
      runControlAuditGit(where.repoPath, [
        "status",
        "--short",
        "--untracked-files=all",
      ])
        .trim()
        .split("\n")
    ).toEqual([
      "?? .lisa/controls/evidence.json",
      "?? .lisa/controls/register.json",
      "?? .lisa/controls/verdict.json",
    ]);
    expect(runControlAuditGit(where.workspace, ["status", "--short"])).toBe("");
  });

  it("resolves both paths from the directory it is run in", async () => {
    const where = setting(WORKING);

    const run = await attest(
      path.basename(where.repoPath),
      {
        workspace: path.relative(path.dirname(where.repoPath), where.workspace),
      },
      path.dirname(where.repoPath)
    );

    expect(run.code).toBe(ATTEST_EXIT.PASSED);
  });

  it("exits 1 without needing a copy when no control is declared", async () => {
    const { repoPath } = keep(buildFEmpty());

    const run = await attest(repoPath);

    expect(run.code).toBe(ATTEST_EXIT.NOT_PASSED);
    expect(run.stdout).toEqual(WRITTEN_DOWN);
    expect(run.stderr).toEqual([
      expect.stringContaining("The control register has no entries"),
    ]);
  });
});

describe("lisa controls attest refuses to run a proof", () => {
  /**
   * Expect a run to have refused, leaving the repository as it was.
   * @param run - What the command printed and returned
   * @param run.code - Its exit code
   * @param run.stdout - What it printed
   * @param run.stderr - What it reported
   * @param repoPath - The repository it was pointed at
   * @param saying - Text the refusal must contain
   */
  function expectRefusal(
    run: { code: number; stdout: readonly string[]; stderr: readonly string[] },
    repoPath: string,
    saying: string
  ): void {
    expect(run.code).toBe(ATTEST_EXIT.NOT_RUN);
    expect(run.stdout).toEqual([]);
    expect(run.stderr.join("\n")).toContain(saying);
    expect(run.stderr.at(-1)).toMatch(/^attest: FAIL\. /u);
    expect(runControlAuditGit(repoPath, ["status", "--short"])).toBe("");
  }

  it("when the copy it is given is the repository itself", async () => {
    const where = setting(WORKING);

    expectRefusal(
      await attest(where.repoPath, { workspace: where.repoPath }),
      where.repoPath,
      "is the repository itself"
    );
  });

  it("when the copy it is given is a link to the repository", async () => {
    const where = setting(WORKING);
    const link = path.join(where.workspace, "link-to-repository");
    symlinkSync(where.repoPath, link);

    expectRefusal(
      await attest(where.repoPath, { workspace: link }),
      where.repoPath,
      "is the repository itself"
    );
  });

  it("when the folder it is given holds the repository", async () => {
    const where = setting(WORKING);

    expectRefusal(
      await attest(where.repoPath, { workspace: path.dirname(where.repoPath) }),
      where.repoPath,
      "holds the repository"
    );
  });

  it("when the copy it is given is not a folder", async () => {
    const where = setting(WORKING);

    expectRefusal(
      await attest(where.repoPath, {
        workspace: path.join(where.workspace, "absent"),
      }),
      where.repoPath,
      "is not a folder"
    );
  });

  it("when the gates declaration is refused", async () => {
    const where = setting({ "code-style": { commit: "sometimes" } });

    expectRefusal(
      await attest(where.repoPath, { workspace: where.workspace }),
      where.repoPath,
      "so no proof was run"
    );
  });

  it("when the path it is pointed at is not a folder", async () => {
    const where = setting(WORKING);

    const run = await attest(path.join(where.repoPath, "absent"));

    expect(run.code).toBe(ATTEST_EXIT.NOT_RUN);
    expect(run.stderr.join("\n")).toContain("is not a folder");
  });
});

describe("the workspace lisa controls attest opens", () => {
  it("is asked for with the repository and the folder named, and closed once when the run is over", async () => {
    const where = setting(WORKING);
    const close = vi.fn();
    const opened: unknown[] = [];
    mkdirSync(path.join(where.workspace, "unrelated"));

    const code = await runAttest(
      where.repoPath,
      { workspace: where.workspace },
      {
        stdout: () => undefined,
        stderr: () => undefined,
        openWorkspace: async request => {
          opened.push({ root: request.root, named: request.named });
          const { directProofWorkspace } =
            await import("../../../src/controls/proof-workspace.js");
          return {
            problem: null,
            workspace: directProofWorkspace(where.workspace, request.tools),
            close,
          };
        },
      }
    );

    expect(code).toBe(ATTEST_EXIT.PASSED);
    expect(opened).toEqual([{ root: where.repoPath, named: where.workspace }]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("is closed even when the run cannot finish", async () => {
    const where = setting(WORKING);
    const close = vi.fn();
    const stderr: string[] = [];

    const code = await runAttest(
      where.repoPath,
      {},
      {
        stdout: () => undefined,
        stderr: line => {
          stderr.push(line);
        },
        loadTools: async () => ({
          start: () => ({ code: 0, output: "" }),
          folder: () => ({ directory: where.workspace }),
          judge: () => {
            throw new Error("the judge is broken");
          },
        }),
        openWorkspace: async () => ({
          problem: null,
          workspace: {
            root: where.workspace,
            apply: () => ({ problem: null }),
            trigger: () => ({
              command: ["check"],
              cwd: where.workspace,
              code: 0,
              output: "",
            }),
            restore: () => ({ problem: null }),
          },
          close,
        }),
      }
    );

    expect(code).toBe(ATTEST_EXIT.NOT_RUN);
    expect(stderr.join("\n")).toContain("the judge is broken");
    expect(close).toHaveBeenCalledOnce();
  });
});
