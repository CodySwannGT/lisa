/**
 * The command that checks the four control commands on all seven coding
 * agents, as an operator and CI run it (CodySwannGT/lisa#5002).
 *
 * `scripts/check-control-command-parity.mjs` is what `bun run check:plugins`
 * runs at its end. This suite runs the real program: on the built plugins it
 * must exit 0 and list the four skills under each of the seven agents, and on
 * a copy with one skill removed it must exit 1 naming the agent and the skill.
 * The removal is always made in a copy, never in the working tree.
 * @module tests/unit/controls/control-command-parity-cli
 */
import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { declaredFailure } from "../../../all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs";
import {
  CONTROL_COMMANDS,
  FAILURE_HEADING,
  PARITY_FIXTURE,
  REPO_ROOT,
  skillNameOf,
} from "../../../scripts/lib/control-command-parity.mjs";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import {
  materializeControlCommands,
  recordedFixture,
  skillFileOf,
} from "./support/control-command-fixture.js";

/** The program, from the repository root. */
const PROGRAM = "scripts/check-control-command-parity.mjs";

/** The check that runs it, and the gate that runs that check before a push. */
const SYNC_CHECK = "scripts/check-plugins-sync.sh";
const SYNC_GATE = "x-plugin-artifact-sync";

/** Per-test copies, removed after each test. */
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Run the program.
 * @param args - Its arguments
 * @returns Exit status and both streams
 */
function run(args: readonly string[]): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const child = boundedSpawnSync({
    args: [path.join(REPO_ROOT, PROGRAM), ...args],
    command: process.execPath,
    cwd: REPO_ROOT,
    label: `${PROGRAM} ${args.join(" ")}`,
  });
  return { status: child.status, stderr: child.stderr, stdout: child.stdout };
}

describe("check-control-command-parity", () => {
  it("passes on the built plugins and lists four skills for seven agents", () => {
    const { status, stdout, stderr } = run([]);

    expect(stderr).toBe("");
    expect(status).toBe(0);
    for (const agent of recordedFixture().agents) {
      expect(stdout).toContain(`  ${agent.name} `);
    }
    for (const command of CONTROL_COMMANDS) {
      expect(stdout.split(` ${skillNameOf(command)} `).length - 1).toBe(7);
    }
    expect(stdout).toContain("4 commands on 7 coding agents");
  });

  it("fails naming the agent and the skill when one is removed", () => {
    const root = materializeControlCommands(tempRoots);
    expect(run(["--root", root]).status).toBe(0);
    fs.rmSync(path.dirname(skillFileOf(root, "devin", "attest")), {
      recursive: true,
    });

    const { status, stdout, stderr } = run(["--root", root]);

    expect(status).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain(FAILURE_HEADING);
    expect(stderr).toContain("Devin: lisa-attest");
    expect(stderr).toContain("plugins/lisa-devin/skills/lisa-attest/SKILL.md");
  });

  it("prints the same result as JSON when asked", () => {
    const { status, stdout } = run(["--json"]);
    const document = JSON.parse(stdout) as {
      agents: { id: string; commands: { skill: string }[] }[];
      violations: unknown[];
    };

    expect(status).toBe(0);
    expect(document.violations).toEqual([]);
    expect(document.agents).toHaveLength(7);
    expect(
      document.agents.filter(agent => agent.commands.length !== 4)
    ).toEqual([]);
  });

  it("refuses to pass when it cannot read the recorded facts", () => {
    const root = materializeControlCommands(tempRoots);
    fs.rmSync(path.join(root, PARITY_FIXTURE));

    const { status, stderr } = run(["--root", root]);

    expect(status).toBe(2);
    expect(stderr).toContain(PARITY_FIXTURE);
    expect(stderr).not.toContain(FAILURE_HEADING);
  });

  it("refuses an option it does not know", () => {
    const { status, stderr } = run(["--quiet"]);

    expect(status).toBe(2);
    expect(stderr).toContain("--quiet");
  });
});

describe("where the check runs", () => {
  it("is run by the plugin-artifact check, on this repository's own tree", () => {
    const check = fs.readFileSync(path.join(REPO_ROOT, SYNC_CHECK), "utf8");

    expect(check).toContain(`node "$ROOT_DIR/${PROGRAM}" --root "$ROOT_DIR"`);
    expect(check).toContain(`"$ROOT_DIR/${PARITY_FIXTURE}"`);
    expect(fs.existsSync(path.join(REPO_ROOT, PROGRAM))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, PARITY_FIXTURE))).toBe(true);
  });

  it("has its failure declared on the gate, so a push reports it as a failure", () => {
    const config = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, ".lisa.config.json"), "utf8")
    ) as {
      gates: Record<string, { push?: { failure_shape?: string[] } }>;
    };
    const shape = config.gates[SYNC_GATE]?.push?.failure_shape ?? [];
    const root = materializeControlCommands(tempRoots);
    fs.rmSync(path.dirname(skillFileOf(root, "cursor", "audit")), {
      recursive: true,
    });

    // The program's real output on a real failure, read the way the gate
    // runner reads it: a declared shape is what makes the run a failure of
    // the code rather than a run nobody could interpret.
    const verdict = declaredFailure(run(["--root", root]).stderr, [
      { gate: SYNC_GATE, shape },
    ]);

    expect(shape).toContain(FAILURE_HEADING);
    expect(verdict?.evidence).toEqual([FAILURE_HEADING]);
  });
});
