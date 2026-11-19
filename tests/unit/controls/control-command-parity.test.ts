/**
 * The four control commands (audit, configure, enforce, attest) on all seven
 * coding agents (CodySwannGT/lisa#5002).
 *
 * `check-plugins-sync.sh` proves the built plugins reproduce from their
 * source. It cannot prove this: a skill dropped from the source, or withheld
 * from one agent by its generator, regenerates just as faithfully as one that
 * is there. So the question "is each of the four commands on each of the
 * seven agents, and can an operator start it there" is asked directly, by
 * `scripts/lib/control-command-parity.mjs`, against the recorded facts in
 * `parity/control-commands.json`.
 *
 * The repository as built passes, so a suite that only asserted that would
 * prove nothing. Every rule below is paired with a case that breaks one thing
 * in a COPY of the built files and asserts the check names that agent and
 * that skill. What the skills say about agents that differ is in
 * `./control-command-differences.test.ts`, and the command an operator and CI
 * run is in `./control-command-parity-cli.test.ts`.
 * @module tests/unit/controls/control-command-parity
 */
import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  auditControlCommandParity,
  CONTROL_COMMANDS,
  formatControlCommandParity,
  REPO_ROOT,
  skillNameOf,
  SUPPORTED_AGENTS,
  VIOLATION,
} from "../../../scripts/lib/control-command-parity.mjs";
import { CODING_AGENTS } from "../../../src/controls/coding-agents.js";

import {
  commandFileOf,
  materializeControlCommands,
  recordedFixture,
  rewrite,
  rewriteFixture,
  skillFileOf,
} from "./support/control-command-fixture.js";

/** The skill the acceptance scenario removes. */
const ATTEST = "attest";
const ATTEST_SKILL = "lisa-attest";

/** What an operator types for the audit on an agent with command files. */
const SLASH_COMMAND = "/lisa:audit";

/** Agents that are given the built files of another agent's folder. */
const SHARES_SOURCE: Readonly<Record<string, readonly string[]>> = {
  claude: ["Claude Code", "OpenCode"],
  opencode: ["Claude Code", "OpenCode"],
};

/** Per-test copies, removed after each test. */
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Audit a copy, after asserting nothing is wrong with it yet.
 * @returns The copy's root
 */
function cleanCopy(): string {
  const root = materializeControlCommands(tempRoots);
  const before = auditControlCommandParity({ root });
  expect(before.problems).toEqual([]);
  expect(before.violations).toEqual([]);
  return root;
}

/**
 * What the check says is wrong, as `kind agent skill`.
 * @param root - The root to audit
 * @returns One line per violation
 */
function wrong(root: string): readonly string[] {
  return auditControlCommandParity({ root }).violations.map(
    violation => `${violation.kind} ${violation.agent} ${violation.skill}`
  );
}

describe("the four control commands on the built plugins", () => {
  const result = auditControlCommandParity();

  it("are in place on every agent", () => {
    expect(result.problems).toEqual([]);
    expect(result.violations).toEqual([]);
  });

  it("are checked for all seven agents Lisa supports", () => {
    expect(new Set(SUPPORTED_AGENTS)).toEqual(new Set(CODING_AGENTS));
    expect(SUPPORTED_AGENTS).toHaveLength(CODING_AGENTS.length);
    expect(result.agents.map(agent => agent.id)).toEqual(
      recordedFixture().agents.map(agent => agent.id)
    );
    expect(result.agents).toHaveLength(7);
  });

  it("are all four listed for each agent, with how to start each", () => {
    expect(CONTROL_COMMANDS).toEqual(["audit", "configure", "enforce", ATTEST]);
    for (const agent of result.agents) {
      expect(agent.commands.map(row => row.skill)).toEqual(
        CONTROL_COMMANDS.map(skillNameOf)
      );
      expect(agent.commands.filter(row => !row.present)).toEqual([]);
      expect(agent.commands.filter(row => row.files.length === 0)).toEqual([]);
    }
  });

  it("are started the way the repository documents for each agent", () => {
    expect(
      Object.fromEntries(
        result.agents.map(agent => [agent.id, agent.commands[0]?.invocation])
      )
    ).toEqual({
      agy: SLASH_COMMAND,
      claude: SLASH_COMMAND,
      codex: "$lisa-audit",
      copilot: SLASH_COMMAND,
      cursor: SLASH_COMMAND,
      devin: "/lisa:lisa-audit",
      opencode: SLASH_COMMAND,
    });
  });

  it("prints the four skills under each of the seven agents", () => {
    const report = formatControlCommandParity(result);

    for (const agent of result.agents) {
      const section = report.slice(report.indexOf(`  ${agent.name} `));
      for (const row of agent.commands) {
        expect(section).toContain(row.skill);
        expect(section).toContain(row.invocation);
      }
    }
    expect(report).toContain("4 commands on 7 coding agents");
  });

  it("gives an agent with no command files the skill under its own name", () => {
    const aliasOnly = result.agents.filter(
      agent => agent.surface === "skill-alias"
    );

    expect(aliasOnly.map(agent => agent.id)).toEqual(["codex", "devin"]);
    for (const agent of aliasOnly) {
      for (const row of agent.commands) {
        expect(
          fs.readFileSync(path.join(REPO_ROOT, row.files[0] ?? ""), "utf8")
        ).toMatch(new RegExp(`^name: ${row.skill}$`, "mu"));
      }
    }
  });
});

describe("a missing command fails the check, naming the agent and the skill", () => {
  it.each(recordedFixture().agents)(
    "lisa-attest removed from what $name is given",
    agent => {
      const root = cleanCopy();
      fs.rmSync(path.dirname(skillFileOf(root, agent.id, ATTEST)), {
        recursive: true,
      });

      const named = SHARES_SOURCE[agent.id] ?? [agent.name];
      expect(wrong(root)).toEqual(
        named.map(name => `${VIOLATION.SKILL_MISSING} ${name} ${ATTEST_SKILL}`)
      );
      const report = formatControlCommandParity(
        auditControlCommandParity({ root })
      );
      for (const name of named) {
        expect(report).toContain(`${name}: ${ATTEST_SKILL}`);
      }
    }
  );

  it("a command file removed from an agent that has command files", () => {
    const root = cleanCopy();
    fs.rmSync(commandFileOf(root, "cursor", "enforce"));

    expect(wrong(root)).toEqual([
      `${VIOLATION.COMMAND_MISSING} Cursor lisa-enforce`,
    ]);
  });

  it("a command file that no longer hands over to its skill", () => {
    const root = cleanCopy();
    rewrite(commandFileOf(root, "copilot", "configure"), text =>
      text.replaceAll("lisa-configure", "lisa-something-else")
    );

    expect(wrong(root)).toEqual([
      `${VIOLATION.COMMAND_NOT_WIRED} Copilot lisa-configure`,
    ]);
  });

  it("a skill that no longer goes by the name the agent starts it with", () => {
    const root = cleanCopy();
    rewrite(skillFileOf(root, "codex", "audit"), text =>
      text.replace("name: lisa-audit", "name: lisa-review")
    );

    expect(wrong(root)).toEqual([
      `${VIOLATION.ALIAS_MISNAMED} Codex lisa-audit`,
    ]);
  });

  it("an empty skill file", () => {
    const root = cleanCopy();
    fs.writeFileSync(skillFileOf(root, "agy", "configure"), "");

    expect(wrong(root)).toEqual([
      `${VIOLATION.SKILL_MISSING} Antigravity lisa-configure`,
    ]);
  });

  it("an agent left out of the recorded facts", () => {
    const root = cleanCopy();
    rewriteFixture(root, fixture => {
      fixture.agents = fixture.agents.filter(agent => agent.id !== "devin");
      fixture.differences = fixture.differences
        .map(difference => ({
          ...difference,
          agents: difference.agents.filter(agent => agent !== "devin"),
        }))
        .filter(difference => difference.agents.length > 0);
    });

    expect(
      wrong(root).filter(line => line.startsWith(VIOLATION.AGENT_NOT_RECORDED))
    ).toEqual(
      CONTROL_COMMANDS.map(
        command =>
          `${VIOLATION.AGENT_NOT_RECORDED} devin ${skillNameOf(command)}`
      )
    );
  });
});

describe("how each agent starts a command is stated in the skill itself", () => {
  it.each([
    ["devin", "Devin", "`/lisa:lisa-attest`", "`/lisa:attest`"],
    ["codex", "Codex", "`$lisa-attest`", "`/lisa:attest`"],
    ["cursor", "Cursor", "Cursor, ", ""],
  ])("fails when %s's form is gone", (id, name, from, to) => {
    const root = cleanCopy();
    rewrite(skillFileOf(root, id, ATTEST), text => text.replace(from, to));

    expect(wrong(root)).toEqual([
      `${VIOLATION.INVOCATION_NOT_STATED} ${name} ${ATTEST_SKILL}`,
    ]);
  });

  it("fails when an agent's copy no longer says how to run it at all", () => {
    const root = cleanCopy();
    rewrite(skillFileOf(root, "copilot", "enforce"), text =>
      text.replace("**Running it.**", "**Starting.**")
    );

    expect(wrong(root)).toEqual([
      `${VIOLATION.INVOCATION_NOT_STATED} Copilot lisa-enforce`,
    ]);
  });
});
