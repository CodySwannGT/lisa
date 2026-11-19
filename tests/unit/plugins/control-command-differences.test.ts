/**
 * What an agent cannot do the way a control skill describes is written down
 * twice, and the two must agree (CodySwannGT/lisa#5002).
 *
 * Each of the four skills has a "Where coding agents differ" list, and
 * `parity/control-commands.json` records the same differences for the parity
 * check. A difference recorded and not stated, or stated and not recorded,
 * fails the check naming the agent and the skill, so a gap can never be
 * dropped from one place silently. The differences about what runs after an
 * agent writes a file are also held against the table the carriers command
 * installs from, so the record cannot go on saying something the code no
 * longer does.
 * @module tests/unit/plugins/control-command-differences
 */
import fs from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  auditControlCommandParity,
  DIFFERENCES_HEADING,
  VIOLATION,
} from "../../../scripts/lib/control-command-parity.mjs";
import {
  AGENT_SURFACES,
  type AgentHookSurface,
  type NoAgentHookSurface,
} from "../../../src/controls/carrier-agent-surfaces.js";
import { CODING_AGENTS } from "../../../src/controls/coding-agents.js";

import {
  materializeControlCommands,
  recordedFixture,
  rewrite,
  rewriteFixture,
  skillFileOf,
} from "./support/control-command-fixture.js";

/** The skill whose step installs what runs after an agent writes a file. */
const ENFORCE = "lisa-enforce";

/** Per-test copies, removed after each test. */
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A copy with nothing wrong in it yet.
 * @returns The copy's root
 */
function cleanCopy(): string {
  const root = materializeControlCommands(tempRoots);
  expect(auditControlCommandParity({ root }).violations).toEqual([]);
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

/**
 * Put agent ids in one order, so two lists can be compared.
 * @param ids - The ids, in any order
 * @returns The same ids, sorted by name
 */
function inOrder(ids: readonly string[]): readonly string[] {
  return [...ids].sort((left, right) => left.localeCompare(right));
}

/**
 * The agents a recorded difference names.
 * @param id - The difference's id
 * @returns Its agents, sorted
 */
function recordedFor(id: string): readonly string[] {
  const difference = recordedFixture().differences.find(
    entry => entry.id === id
  );
  return inOrder(difference?.agents ?? []);
}

/**
 * The agents whose row in the carriers table satisfies a condition.
 * @param holds - The condition
 * @returns Those agents, sorted
 */
function agentsWhere(
  holds: (surface: AgentHookSurface | NoAgentHookSurface) => boolean
): readonly string[] {
  return inOrder(CODING_AGENTS.filter(agent => holds(AGENT_SURFACES[agent])));
}

describe("the differences recorded for the control skills", () => {
  const { differences } = recordedFixture();

  it("each name a step, what differs, and the words the skill uses", () => {
    expect(differences.length).toBeGreaterThan(0);
    expect(
      differences.filter(
        difference =>
          difference.agents.length === 0 ||
          difference.skills.length === 0 ||
          difference.stated_as.trim() === ""
      )
    ).toEqual([]);
  });

  it("cover every agent that starts the skill with no command file", () => {
    expect(recordedFor("arguments-not-passed")).toEqual(
      inOrder(
        recordedFixture()
          .agents.filter(agent => agent.command === null)
          .map(agent => agent.id)
      )
    );
  });

  it("say which agents cannot refuse a file write", () => {
    expect(recordedFor("edit-time-no-refusal")).toEqual(
      agentsWhere(surface => !surface.refuses)
    );
  });

  it("say where a refusal is assumed and not measured", () => {
    expect(recordedFor("edit-time-refusal-assumed")).toEqual(
      agentsWhere(surface => surface.refuses && surface.evidence === "assumed")
    );
  });

  it("say which agents are told of a failure instead of being refused", () => {
    expect(recordedFor("edit-time-told-not-refused")).toEqual(
      agentsWhere(
        surface => surface.refuses && surface.refusal === "additional-context"
      )
    );
  });

  it("say where the hook is a whole file Lisa owns", () => {
    expect(recordedFor("edit-time-lisa-owned-file")).toEqual(
      agentsWhere(
        surface => surface.refuses && surface.registration.kind === "placed"
      )
    );
  });

  it("say that Codex runs a repository's hooks only once approved", () => {
    expect(recordedFor("edit-time-needs-approval")).toEqual(["codex"]);
  });
});

describe("a difference can be dropped from neither place silently", () => {
  it("fails when a skill no longer states a recorded difference", () => {
    const root = cleanCopy();
    rewrite(skillFileOf(root, "agy", "enforce"), text =>
      text
        .split("\n")
        .filter(line => !line.startsWith("- **Antigravity:**"))
        .join("\n")
    );

    expect(wrong(root)).toEqual([
      `${VIOLATION.DIFFERENCE_NOT_STATED} Antigravity ${ENFORCE}`,
    ]);
  });

  it("fails when a skill has no list of differences at all", () => {
    const root = cleanCopy();
    rewrite(skillFileOf(root, "devin", "configure"), text =>
      text.replace(DIFFERENCES_HEADING, "**Notes.**")
    );

    expect(wrong(root)).toEqual([
      `${VIOLATION.DIFFERENCE_NOT_STATED} Devin lisa-configure`,
    ]);
  });

  it("fails when a skill states a difference nothing records", () => {
    const root = cleanCopy();
    rewrite(skillFileOf(root, "cursor", "attest"), text =>
      text.replace(
        `${DIFFERENCES_HEADING}`,
        `${DIFFERENCES_HEADING}\n\n- **Cursor:** it cannot open a second window.`
      )
    );

    expect(wrong(root)).toEqual([
      `${VIOLATION.DIFFERENCE_NOT_RECORDED} Cursor lisa-attest`,
    ]);
  });

  it("fails when the record loses a difference the skills still state", () => {
    const root = cleanCopy();
    rewriteFixture(root, fixture => {
      fixture.differences = fixture.differences.filter(
        difference => difference.id !== "edit-time-needs-approval"
      );
    });

    expect([...new Set(wrong(root))]).toEqual([
      `${VIOLATION.DIFFERENCE_NOT_RECORDED} Codex ${ENFORCE}`,
    ]);
  });

  it("fails when a difference is stated for an agent Lisa does not support", () => {
    const root = cleanCopy();
    rewrite(skillFileOf(root, "claude", "audit"), text =>
      text.replace("- **Codex, Devin:**", "- **Codex, Devin, Zed:**")
    );

    expect([...new Set(wrong(root))]).toEqual([
      `${VIOLATION.DIFFERENCE_NOT_RECORDED} Zed lisa-audit`,
    ]);
  });
});
