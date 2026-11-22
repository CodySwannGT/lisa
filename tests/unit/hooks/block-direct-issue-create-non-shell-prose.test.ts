/** Classify executed files and candidate commands without executing any of them. */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../../helpers/io-latency-budget.js";
import { opencodeVerdicts } from "../opencode/support/filing-parity.js";
import {
  bash,
  CONTAINER_DECLARATION,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  GATE_MARKER,
  projectWithTracker,
  runHook,
} from "./support/direct-issue-create.js";

useIoLatencyBudget();

const REPO = "fixture-owner/fixture-repo";
const ISSUE_PATH = `repos/${REPO}/issues/1`;
const CREATE_ENDPOINT = `https://api.github.com/repos/${REPO}/issues`;
const PROSE =
  "const note = `The caller's reference is repos/fixture-owner/fixture-repo/issues/1.`;\nconsole.log(note);\n";
const CONFIG = {
  tracker: "github",
  github: {
    org: "fixture-owner",
    repo: "fixture-repo",
    labels: { build: { ready: "status:ready" } },
  },
};

const PROSE_CASES = [
  ["JavaScript prose with both an apostrophe and the issue-read path", PROSE],
  [
    "the same read path without the apostrophe",
    PROSE.replace("caller's", "caller"),
  ],
  [
    "the same apostrophe without an issue endpoint",
    PROSE.replace(ISSUE_PATH, "plain/example"),
  ],
] as const;

const CREATE_CASES = [
  ["a direct GitHub CLI create", "gh issue create --title fixture"],
  [
    "a direct GitHub HTTP create",
    `curl -X POST ${CREATE_ENDPOINT} --data '{}'`,
  ],
] as const;

/**
 * Write an owned fixture. Its invocation is passed to hooks exclusively as data.
 * @param filename - The script name inside the test directory
 * @param source - The exact source read by the hook
 * @param interpreter - Command whose script operand the hook should inspect
 * @returns The proposed command and its fixture directory
 */
function scriptCase(filename: string, source: string, interpreter: string) {
  const dir = projectWithTracker(CONFIG);
  const file = path.join(dir, filename);
  writeFileSync(file, source);
  return { dir, command: `${interpreter} ${file}` };
}

describe("issue-read prose inside a non-shell file", () => {
  it.each(PROSE_CASES)("allows %s", (_name, source) => {
    const { dir, command } = scriptCase(
      "harmless.mjs",
      source,
      process.execPath
    );
    expect(runHook(bash(command), { cwd: dir })).toEqual({
      status: EXIT_ALLOWED,
      stderr: "",
    });
  });

  it("keeps the fallback for an unrecognized issue route and for the collection", () => {
    for (const endpoint of [
      `repos/${REPO}/issues`,
      `repos/${REPO}/issues/unknown`,
    ]) {
      const { dir, command } = scriptCase(
        "unknown.mjs",
        PROSE.replace(ISSUE_PATH, endpoint),
        process.execPath
      );
      const verdict = runHook(bash(command), { cwd: dir });
      expect(verdict.status).toBe(EXIT_BLOCKED);
      expect(verdict.stderr).toContain(
        "an unparseable command that reads as a tracker creation"
      );
    }
  });

  it.each(CREATE_CASES)(
    "refuses %s both directly and inside an executed file",
    (_name, command) => {
      const { dir, command: nested } = scriptCase(
        "create.sh",
        `${command}\n`,
        "bash"
      );
      for (const proposed of [command, nested]) {
        const verdict = runHook(bash(proposed), { cwd: dir });
        expect(verdict.status).toBe(EXIT_BLOCKED);
        expect(verdict.stderr).toContain("declares no readiness");
      }
    }
  );

  it.each([
    ["ready", "gh issue create --title fixture --label status:ready"],
    ["human gate", `gh issue create --title fixture --body '${GATE_MARKER}'`],
    [
      "container",
      `gh issue create --title fixture --body '## Target Backend Environment\n${CONTAINER_DECLARATION}'`,
    ],
  ])("allows a declared %s filing shape", (_name, command) => {
    expect(runHook(bash(command), { cwd: projectWithTracker(CONFIG) })).toEqual(
      { status: EXIT_ALLOWED, stderr: "" }
    );
  });

  it("preserves the same read and creation distinction in the OpenCode plugin", () => {
    const cases = [
      ...PROSE_CASES.map(([, source]) =>
        scriptCase("harmless.mjs", source, process.execPath)
      ),
      ...CREATE_CASES.map(([, source]) =>
        scriptCase("create.sh", `${source}\n`, "bash")
      ),
    ];
    expect(opencodeVerdicts(cases)).toEqual([
      "allow",
      "allow",
      "allow",
      "deny",
      "deny",
    ]);
  });
});
