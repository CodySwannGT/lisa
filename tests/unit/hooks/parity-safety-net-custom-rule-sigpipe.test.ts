/**
 * Regression for CodySwannGT/lisa#4564 finding 2.
 *
 * The project custom-rule check fed grep through `printf … | grep`. Under
 * `pipefail`, a grep that stops at its first match (`-q`, or GNU grep whose
 * stdout is /dev/null) closes the pipe while printf is still writing, printf
 * takes SIGPIPE, the pipeline reports 141, and the hook's `*)` arm announced a
 * MATCHING rule as "invalid regex … NOT enforced" and let the command through.
 *
 * The race is made deterministic here: a `grep` shim on PATH exits 0 the
 * moment it sees the marker rule, without reading stdin, and the command is
 * larger than any pipe buffer. With a pipe that reproduces SIGPIPE every time;
 * with a here-string there is no writer to kill.
 * @module tests/unit/hooks/parity-safety-net-custom-rule-sigpipe
 */
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createGuardHarness,
  EXIT_BLOCKED,
} from "../../helpers/safety-net-guard-harness.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const MARKER = "LISA_SIGPIPE_MARKER_4564";
/** Comfortably above the 64 KiB Linux and 16-64 KiB macOS pipe buffers. */
const PAYLOAD_BYTES = 256 * 1024;

const { runHook } = createGuardHarness(process.env);

/**
 * Finds the real grep on the inherited PATH.
 * @returns Absolute path to an executable grep.
 */
function realGrep(): string {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, "grep");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not in this PATH entry
    }
  }
  throw new Error("no grep on PATH");
}

describe("parity-safety-net.sh custom rules survive an early-exiting grep (#4564)", () => {
  let workRoot: string;
  let projectDir: string;
  let shimDir: string;
  let rulesPath: string;

  beforeAll(() => {
    workRoot = mkdtempSync(path.join(tmpdir(), "lisa-safety-sigpipe-"));
    projectDir = path.join(workRoot, "project");
    shimDir = path.join(workRoot, "bin");
    mkdirSync(projectDir);
    mkdirSync(shimDir);
    writeFileSync(
      path.join(shimDir, "grep"),
      [
        "#!/bin/bash",
        // Exit on the marker rule the way a first-match grep does: without
        // draining stdin. Every other grep call is the real one.
        `for a in "$@"; do [ "$a" = "${MARKER}" ] && exit 0; done`,
        `exec "${realGrep()}" "$@"`,
        "",
      ].join("\n"),
      { mode: 0o755 }
    );
    rulesPath = path.join(workRoot, "custom-rules.txt");
    writeFileSync(rulesPath, `${MARKER}\n`);
  });

  afterAll(() => {
    rmSync(workRoot, { recursive: true, force: true });
  });

  it("blocks a matching rule instead of reporting it as an invalid regex", () => {
    const command = `echo ${MARKER} ${"x".repeat(PAYLOAD_BYTES)}`;
    const { status, stderr } = runHook(command, {
      cwd: projectDir,
      env: {
        SAFETY_NET_RULES_FILE: rulesPath,
        PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });
    expect(stderr).not.toContain("NOT enforced");
    // The refusal must come from the custom rule itself, not from an earlier
    // fail-closed path (a missing jq, a malformed payload) that also exits 2.
    expect(stderr).toContain(
      `matched a project custom safety rule (custom-rules.txt): ${MARKER}`
    );
    expect(status, stderr.slice(0, 2000)).toBe(EXIT_BLOCKED);
  });
});

/**
 * The custom-rule evaluation exactly as the shipped hook spells it, from
 * its `trap '' XFSZ` through the line that records a staging failure.
 * @returns The bash source of that step.
 */
function shippedRuleStep(): string {
  const hook = readFileSync(
    path.resolve("plugins/lisa/hooks/parity-safety-net.sh"),
    "utf8"
  );
  const step =
    /^ *trap '' XFSZ\n *rule_status=0\n[\s\S]*?\|\| rule_status=unstaged$/m.exec(
      hook
    );
  if (!step) throw new Error("custom-rule step not found in the shipped hook");
  return step[0];
}

/**
 * Runs one rule step with here-document staging made to fail: a zero
 * file-size limit, and a body large enough that every Bash stages it in a
 * temp file rather than a pipe. SIGXFSZ is ignored by the harness only when
 * `ignoreXfsz` is set; otherwise its disposition is whatever the step leaves.
 * @param step - Bash source that sets `rule_status`.
 * @param ignoreXfsz - Whether the harness ignores SIGXFSZ before the step.
 * @returns What the step recorded in `rule_status`, and the shell's status.
 */
function stagingFailure(
  step: string,
  ignoreXfsz: boolean
): { stdout: string; status: number | null } {
  const script = [
    "set -euo pipefail",
    'rule="NEVER_MATCHES_4564"',
    `custom_command_str="$(printf '%*s' ${PAYLOAD_BYTES} '')"`,
    ...(ignoreXfsz ? ["trap '' XFSZ"] : []),
    "ulimit -f 0",
    step,
    'printf "%s" "$rule_status"',
  ].join("\n");
  const result = boundedSpawnSync({
    label: "the custom-rule staging probe",
    command: "/bin/bash",
    args: ["-c", script],
  });
  return { stdout: result.stdout, status: result.status };
}

/**
 * {@link stagingFailure} with SIGXFSZ ignored by the harness.
 * @param step - Bash source that sets `rule_status`.
 * @returns What the step recorded in `rule_status`.
 */
function statusWhenStagingFails(step: string): string {
  return stagingFailure(step, true).stdout;
}

describe("parity-safety-net.sh custom rules fail closed when staging fails (#4564)", () => {
  it("a bare here-string reports a staging failure as no-match (the hazard)", () => {
    const bare =
      'rule_status=0\ngrep -qEi -- "$rule" <<<"$custom_command_str" || rule_status=$?';
    expect(statusWhenStagingFails(bare)).toBe("1");
  });

  it("the shipped step tells a staging failure apart from no-match", () => {
    expect(statusWhenStagingFails(shippedRuleStep())).toBe("unstaged");
  });

  it("the shipped step reaches `unstaged` with SIGXFSZ at its default (#4571)", () => {
    // No harness trap: the hook itself must ignore SIGXFSZ, or a write the
    // limit refuses kills the shell before `unstaged` can run.
    const { stdout, status } = stagingFailure(shippedRuleStep(), false);
    expect({ stdout, status }).toEqual({ stdout: "unstaged", status: 0 });
  });
});

const XFSZ_MARKER = "LISA_XFSZ_MARKER_4571";
/**
 * A custom rule long enough that block()'s message, which quotes it, cannot
 * fit under {@link LIMIT_KIB}. Kept well under what BSD grep accepts: it
 * rejects a ~96 KB ERE, and a rejected rule is reported as not enforced.
 */
const LONG_RULE = `${XFSZ_MARKER}|${"y".repeat(8 * 1024)}`;
/** Room for the hook's startup heredocs (about 1.5 KB), not for the refusal. */
const LIMIT_KIB = 4;

/**
 * Runs the whole shipped hook under `ulimit -f` with one custom rule.
 * @param command - The Bash command the tool call carries.
 * @param projectDir - Working and project directory for the hook.
 * @param rulesPath - The custom rules file.
 * @returns The hook's exit status and stderr.
 */
function runUnderFileSizeLimit(
  command: string,
  projectDir: string,
  rulesPath: string
): { status: number | null; stderr: string } {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
  const result = boundedSpawnSync({
    label: "the safety-net hook under a file-size limit",
    command: "/bin/bash",
    args: [
      "-c",
      'ulimit -f "$1" || exit 99; exec /bin/bash "$2"',
      "bash",
      String(LIMIT_KIB),
      path.resolve("plugins/lisa/hooks/parity-safety-net.sh"),
    ],
    cwd: projectDir,
    env: {
      ...env,
      CLAUDE_PROJECT_DIR: projectDir,
      SAFETY_NET_RULES_FILE: rulesPath,
    },
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
  });
  return { status: result.status, stderr: result.stderr };
}

/**
 * The verdict, end to end. Reaching `unstaged` is not enough on its own: the
 * refusal still has to leave the hook as exit 2. block() used to write its
 * message through a heredoc, which Bash 3.2 stages in a temp file that the
 * same limit refuses, so a rule that matched, or a command that could not be
 * staged, ended the hook with 1 (CodySwannGT/lisa#4571). This discriminates
 * on Bash 3.2, the macOS /bin/bash; a Bash that stages small heredocs in a
 * pipe passes either way.
 */
describe("parity-safety-net.sh refuses with exit 2 under a file-size limit (#4571)", () => {
  let workRoot: string;
  let projectDir: string;
  let rulesPath: string;

  beforeAll(() => {
    workRoot = mkdtempSync(path.join(tmpdir(), "lisa-safety-xfsz-"));
    projectDir = path.join(workRoot, "project");
    mkdirSync(projectDir);
    rulesPath = path.join(workRoot, "rules.txt");
    writeFileSync(rulesPath, `${LONG_RULE}\n`);
  });

  afterAll(() => {
    rmSync(workRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });

  it.each([
    {
      name: "a rule that matched",
      command: `echo ${XFSZ_MARKER}`,
      reason: "matched a project custom safety rule (rules.txt)",
    },
    {
      name: "a command too large to stage",
      command: `echo ${XFSZ_MARKER} ${"x".repeat(PAYLOAD_BYTES)}`,
      reason:
        "could not stage the command to check project custom safety rule (rules.txt)",
    },
  ])("refuses $name", ({ command, reason }) => {
    const { status, stderr } = runUnderFileSizeLimit(
      command,
      projectDir,
      rulesPath
    );
    expect(stderr).toContain(`Blocked by safety-net: ${reason}`);
    expect(status, stderr.slice(0, 2000)).toBe(EXIT_BLOCKED);
  });
});
