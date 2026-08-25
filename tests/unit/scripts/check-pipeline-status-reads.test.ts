/**
 * Tests for the pipe-shadowed gate-status sweep (CodySwannGT/lisa#3090).
 *
 * The load-bearing cases here are the last two. One points the real `sweep()`
 * at a REAL directory tree holding a REAL offending pipeline and asserts the
 * report NAMES it — a sweep proven only against hand-written strings would
 * demonstrate that it parses, not that it bites. The other points it at a tree
 * with nothing in it and asserts exit 2, because an empty inspection and a
 * clean tree otherwise print the same tick, and this repository has shipped
 * enough guards that reported success while inert to have a rule about it.
 *
 * The shell-semantics assertion is executed rather than asserted from memory:
 * it runs `sh` and reads what the pipeline actually reports.
 *
 * @module tests/unit/scripts/check-pipeline-status-reads
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedExecFileSync } from "../../helpers/io-latency-budget";

import {
  formatReport,
  inspectShellSource,
  markdownShellSources,
  netDepth,
  pipefailChange,
  pipelineStages,
  stageCommand,
  statusReadReason,
  sweep,
  workflowRunSources,
} from "../../../scripts/check-pipeline-status-reads.mjs";

/** The combined `set` spelling that a naive `-o` pattern fails to match. */
const SET_EUO_PIPEFAIL = "set -euo pipefail";

/** A workflow step piping a gate into `tee`, the shape #3090 was filed for. */
const GATE_PIPED_TO_TEE = "node gate.mjs | tee summary";

/** Path of the offending script the sweep is pointed at on disk. */
const GATE_READER_PATH = "scripts/read-the-gate.sh";

/** Temp trees created by a test, removed afterwards. */
const created: string[] = [];

/**
 * Create a throwaway directory tree for the sweep to walk.
 * @returns Absolute path of the new tree.
 */
function makeTree(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "lisa-test-pipe-sweep-"));
  created.push(root);
  return root;
}

/**
 * Write a file, creating parent directories.
 * @param root - Tree root.
 * @param relative - Path within the tree.
 * @param contents - File contents.
 */
function write(root: string, relative: string, contents: string): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
}

/**
 * Inspect one shell script body with the sweep's default assumptions.
 * @param text - Shell source.
 * @param overrides - Fields to override on the source descriptor.
 * @returns The inspection result.
 */
function inspect(
  text: string,
  overrides: Record<string, unknown> = {}
): { inspected: number; findings: { statement: string; reason: string }[] } {
  return inspectShellSource({
    text,
    file: "example.sh",
    location: "script body",
    statusAlwaysRead: false,
    pipefail: false,
    ...overrides,
  });
}

afterEach(() => {
  for (const root of created.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("the shell semantics the sweep exists for", () => {
  it("a pipeline reports the pager's status, not the failing command's", () => {
    // Executed, not recalled. `sh` is the shell this repository runs hooks
    // under, and it is the one with no `pipefail` to fall back on.
    const piped = boundedExecFileSync({
      label: "sh reading a pipeline's status",
      command: "/bin/sh",
      args: ["-c", 'false | tail -1 >/dev/null; printf "%s" "$?"'],
    });
    const redirected = boundedExecFileSync({
      label: "sh reading a redirected command's status",
      command: "/bin/sh",
      args: ["-c", 'false >/dev/null 2>&1; status=$?; printf "%s" "$status"'],
    });
    expect(piped).toBe("0");
    expect(redirected).toBe("1");
  });
});

describe("splitting shell text", () => {
  it("splits a pipeline into its stages", () => {
    expect(pipelineStages("node gate.mjs 2>&1 | tail -4")).toEqual([
      "node gate.mjs 2>&1 ",
      " tail -4",
    ]);
  });

  it("does not split a `|` inside quotes", () => {
    expect(pipelineStages("grep -E 'a|b' file")).toEqual([
      "grep -E 'a|b' file",
    ]);
  });

  it("does not split a `|` inside command substitution", () => {
    expect(pipelineStages('x="$(cmd | head -1)"')).toEqual([
      'x="$(cmd | head -1)"',
    ]);
  });

  it("does not split `2>&1` on its `&`", () => {
    // The regression this pins: `&` is a statement separator, but the `&` in a
    // redirection is not one. Splitting there tore the issue's own example into
    // `node gate.mjs 2>` and `1 | tail -4`, so every report named a fragment
    // and the leading `if`/`while` keyword was lost from the reason-finder.
    const result = inspect('node gate.mjs 2>&1 | tail -4; echo "exit=$?"');
    expect(result.findings[0]?.statement).toBe("node gate.mjs 2>&1 | tail -4");
  });

  it("still splits a genuine background `&`", () => {
    const result = inspect("node gate.mjs | tail -4 & echo started");
    expect(result.inspected).toBe(1);
  });

  it("reads the command name past env assignments and redirections", () => {
    expect(stageCommand(" FOO=1 2>/dev/null /usr/bin/tail -20 ")).toBe("tail");
  });

  it("counts unclosed command substitution so a continuation is skipped", () => {
    expect(netDepth("x=$(cmd \\")).toBe(1);
    expect(netDepth("  | head -1)")).toBe(-1);
    expect(netDepth("echo '(' \"(\"")).toBe(0);
  });
});

describe("pipefail detection", () => {
  it("reads the COMBINED spelling `set -euo pipefail`", () => {
    // The regression this pins: a pattern looking for a literal `-o` does not
    // match `-euo`, so every `set -euo pipefail` script reads as unprotected.
    expect(pipefailChange(SET_EUO_PIPEFAIL)).toBe(true);
  });

  it("reads the separated spelling and the disabling one", () => {
    expect(pipefailChange("set -o pipefail")).toBe(true);
    expect(pipefailChange("  set +o pipefail")).toBe(false);
    expect(pipefailChange("echo set -o pipefail")).toBeUndefined();
  });

  it("passes a pipeline that sits under pipefail", () => {
    const result = inspect(
      [SET_EUO_PIPEFAIL, 'node gate.mjs | tee "$SUMMARY"'].join("\n")
    );
    expect(result.inspected).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it("reports the same pipeline once pipefail is turned back off", () => {
    const result = inspect(
      [
        SET_EUO_PIPEFAIL,
        "set +o pipefail",
        'node gate.mjs | tee "$SUMMARY"',
      ].join("\n"),
      { statusAlwaysRead: true }
    );
    expect(result.findings).toHaveLength(1);
  });
});

describe("what counts as reading the status", () => {
  it("reports `cmd | tail; echo $?` and names the reason", () => {
    const result = inspect('node gate.mjs 2>&1 | tail -4; echo "exit=$?"');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.reason).toContain("$?");
  });

  it("reports an `if` condition", () => {
    const result = inspect("if node gate.mjs | head -1; then echo ok; fi");
    expect(result.findings[0]?.reason).toContain("`if` condition");
  });

  it("reports an `&&` join", () => {
    const result = inspect("node gate.mjs | tail -1 && echo passed");
    expect(result.findings[0]?.reason).toContain("`&&`");
  });

  it("reports a workflow `run:` step, where the status is the job's", () => {
    const result = inspect('node gate.mjs | tee "$GITHUB_STEP_SUMMARY"', {
      statusAlwaysRead: true,
    });
    expect(result.findings[0]?.reason).toContain("workflow");
  });

  it("does not report a pipeline whose status nothing acts on", () => {
    const result = inspect("node gate.mjs | tail -4\necho unrelated");
    expect(result.inspected).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it("does not report a status-bearing last stage", () => {
    // `grep -q` is the stage whose status you MEANT to read.
    const result = inspect("if node gate.mjs | grep -q FAIL; then echo x; fi");
    expect(result.findings).toEqual([]);
  });

  it("does not report a pipeline that only formats text already in hand", () => {
    const result = inspect('echo "$PAYLOAD" | head -20', {
      statusAlwaysRead: true,
    });
    expect(result.inspected).toBe(1);
    expect(result.findings).toEqual([]);
  });

  it("does not report a status read through PIPESTATUS", () => {
    const result = inspect("node gate.mjs | tail -4; status=${PIPESTATUS[0]}");
    expect(result.findings).toEqual([]);
  });

  it("counts a pipeline it passes, so `inspected` is not a findings count", () => {
    const result = inspect(
      [SET_EUO_PIPEFAIL, "a | b", "c | d | e", "f"].join("\n")
    );
    expect(result.inspected).toBe(2);
    expect(result.findings).toEqual([]);
  });

  it("prefers the tightest true reason", () => {
    expect(
      statusReadReason({
        statement: { text: "if node gate.mjs | head -1", operator: "" },
        next: undefined,
        followingLine: "",
        errexit: true,
        statusAlwaysRead: true,
      })
    ).toContain("`if` condition");
  });
});

describe("workflow run blocks", () => {
  const document = {
    jobs: {
      gate: {
        steps: [
          { uses: "actions/checkout@v6" },
          { name: "Default shell", run: GATE_PIPED_TO_TEE },
          {
            name: "Explicit bash",
            shell: "bash",
            run: GATE_PIPED_TO_TEE,
          },
        ],
      },
    },
  };

  it("treats the DEFAULT shell as having no pipefail", () => {
    // GitHub's default for `run:` is `bash -e {0}` — `-e` but no pipefail.
    const sources = workflowRunSources(document, "w.yml");
    expect(sources[0]?.pipefail).toBe(false);
    expect(sources[0]?.location).toContain("Default shell");
  });

  it("treats an explicit `shell: bash` as protected", () => {
    // `shell: bash` becomes `bash --noprofile --norc -eo pipefail {0}`.
    expect(workflowRunSources(document, "w.yml")[1]?.pipefail).toBe(true);
  });

  it("treats `shell: pwsh` as UNPROTECTED, because PowerShell has no pipefail", () => {
    // GitHub runs `pwsh -command \". '{0}'\"` with `$ErrorActionPreference =
    // 'stop'` prepended and `exit $LASTEXITCODE` appended. There is no
    // `pipefail` option in PowerShell to set, and `$LASTEXITCODE` carries the
    // status of the most recently finished NATIVE command — in `gate | tee`
    // that is `tee`. So the fix-up propagates the PAGER's success, which is
    // the exact defect this sweep exists to refuse.
    const withPwsh = {
      jobs: {
        gate: {
          steps: [{ name: "Pwsh", shell: "pwsh", run: GATE_PIPED_TO_TEE }],
        },
      },
    };
    expect(workflowRunSources(withPwsh, "w.yml")[0]?.pipefail).toBe(false);
  });

  it("treats `shell: sh` as unprotected too", () => {
    // `sh -e {0}`: errexit, and dash has no `pipefail` option at all.
    const withSh = {
      jobs: { gate: { steps: [{ shell: "sh", run: GATE_PIPED_TO_TEE }] } },
    };
    expect(workflowRunSources(withSh, "w.yml")[0]?.pipefail).toBe(false);
  });

  it("inherits a workflow-level defaults.run.shell", () => {
    const withDefaults = {
      defaults: { run: { shell: "bash" } },
      jobs: { gate: { steps: [{ run: GATE_PIPED_TO_TEE }] } },
    };
    expect(workflowRunSources(withDefaults, "w.yml")[0]?.pipefail).toBe(true);
  });

  it("yields nothing for a document that is not a workflow", () => {
    expect(workflowRunSources({ name: "not-a-workflow" }, "x.yml")).toEqual([]);
    expect(workflowRunSources(null, "x.yml")).toEqual([]);
  });
});

describe("fenced shell blocks in guidance documents", () => {
  const doc = [
    "# Skill",
    "",
    "Run the suite:",
    "",
    "```bash",
    'bun run test 2>&1 | tail -20; echo "exit=$?"',
    "```",
    "",
    "```json",
    '{ "note": "a | b" }',
    "```",
    "",
    "```",
    "cmd | tail -1 && echo ok",
    "```",
    "",
  ].join("\n");

  it("reads only fences tagged as a shell", () => {
    const sources = markdownShellSources(doc, "SKILL.md");
    expect(sources).toHaveLength(1);
    expect(sources[0]?.location).toBe("fenced shell block starting at line 6");
  });

  it("reports a line number in the FILE, not in the fence", () => {
    const source = markdownShellSources(doc, "SKILL.md")[0];
    const result = inspectShellSource(source as never);
    expect(result.findings).toHaveLength(1);
    expect((result.findings[0] as { line: number }).line).toBe(6);
  });

  it("NAMES the pipeline a skill document told an agent to run", () => {
    const root = makeTree();
    // The shape that shipped in six generated copies: the `||` fallback can
    // never fire, because `tail` succeeds whether or not the service exists.
    write(
      root,
      "plugins/src/rails/skills/ops/SKILL.md",
      [
        "```bash",
        'docker compose logs otel-collector 2>/dev/null | tail -20 || echo "No otel-collector"',
        "```",
        "",
      ].join("\n")
    );

    const report = sweep(root, ["plugins"]);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.statement).toContain("otel-collector");
    expect(report.findings[0]?.reason).toContain("`||`");
  });
});

describe("the sweep, against real trees on disk", () => {
  it("NAMES a pwsh step that pipes a gate into a pager", () => {
    // `shell: pwsh` was once on the protected list beside `bash`. It does not
    // belong there: PowerShell has no `pipefail`, and the `exit $LASTEXITCODE`
    // that GitHub appends carries the last NATIVE command's status, which in
    // `gate | tee` is the pager's. On the pre-fix source this step was passed
    // as protected and the sweep found nothing.
    const root = makeTree();
    write(
      root,
      ".github/workflows/pwsh.yml",
      [
        "name: pwsh gate",
        "jobs:",
        "  gate:",
        "    steps:",
        "      - name: Audit floors",
        "        shell: pwsh",
        "        run: |",
        '          node scripts/check-security-floors.mjs --strict | tee -a "$GITHUB_STEP_SUMMARY"',
        "",
      ].join("\n")
    );

    const report = sweep(root, [".github/workflows"]);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.file).toBe(".github/workflows/pwsh.yml");
    expect(report.findings[0]?.lastStage).toBe("tee");
  });

  it("NAMES a known offending pipeline in a workflow it walks", () => {
    const root = makeTree();
    write(
      root,
      ".github/workflows/gate.yml",
      [
        "name: gate",
        "jobs:",
        "  gate:",
        "    steps:",
        "      - name: Audit floors",
        "        run: |",
        '          node scripts/check-security-floors.mjs --strict | tee -a "$GITHUB_STEP_SUMMARY"',
        "",
      ].join("\n")
    );

    const report = sweep(root, [".github/workflows"]);

    expect(report.inspected).toBe(1);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.file).toBe(".github/workflows/gate.yml");
    expect(report.findings[0]?.statement).toContain(
      "check-security-floors.mjs"
    );
    expect(report.findings[0]?.lastStage).toBe("tee");
    expect(formatReport(report)).toContain("check-security-floors.mjs");
  });

  it("NAMES a known offending pipeline in a shell script it walks", () => {
    const root = makeTree();
    write(
      root,
      GATE_READER_PATH,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        'node scripts/plugin-parity-drift.mjs 2>&1 | tail -4; echo "exit=$?"',
        "",
      ].join("\n")
    );

    const report = sweep(root, ["scripts"]);

    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]?.file).toBe(GATE_READER_PATH);
    expect(report.findings[0]?.line).toBe(3);
    expect(report.findings[0]?.lastStage).toBe("tail");
  });

  it("passes the SAME script once the status is captured before the pipe", () => {
    const root = makeTree();
    write(
      root,
      GATE_READER_PATH,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        "node scripts/plugin-parity-drift.mjs >drift.log 2>&1; status=$?",
        'tail -4 drift.log; echo "exit=$status"',
        "",
      ].join("\n")
    );

    const report = sweep(root, ["scripts"]);

    expect(report.findings).toEqual([]);
  });

  it("reports ZERO inspected as a failure, never as an all-clear", () => {
    const root = makeTree();
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    write(root, "scripts/quiet.sh", "#!/bin/sh\necho hello\n");

    const report = sweep(root, ["scripts"]);

    expect(report.inspected).toBe(0);
    const text = formatReport(report);
    expect(text).toContain("ZERO pipelines inspected");
    expect(text).not.toContain("✔");
  });

  it("always states how many pipelines it inspected", () => {
    const root = makeTree();
    write(root, "scripts/a.sh", "set -euo pipefail\nls | head -1\n");

    expect(formatReport(sweep(root, ["scripts"]))).toMatch(
      /inspected 1 pipeline\(s\) across 1 file\(s\)/
    );
  });

  it("skips a root that does not exist rather than throwing", () => {
    const root = makeTree();
    expect(sweep(root, ["nope"]).inspected).toBe(0);
  });
});
