/** Linked worktree routing for the installed edit-time carrier. @module */
import { rmSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AGENT_CARRIER_PROGRAM_PATH } from "../../src/controls/carrier-agent-script.js";
import {
  agentWrites,
  deliver,
  editRepository,
  editRuns,
  installForAgents,
  shellAgent,
  type EditRepository,
} from "../support/carrier-agents.js";
import {
  CHECKED_FILE,
  operatorEnv,
  PLANTED,
} from "../support/carrier-install.js";
import { linkedCarrierCheckout } from "../support/carrier-linked-worktree.js";

const CLEAN_LINE = "# a harmless comment";
const PLANTED_LINE = `# ${PLANTED}`;
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Install the carrier in a disposable fixture, then commit and link it.
 * @param agents - Which coding agents to carry
 * @returns The primary fixture and the path of its second checkout
 */
async function linkedFixture(
  agents: readonly string[]
): Promise<{ readonly built: EditRepository; readonly linked: string }> {
  const built = editRepository();
  try {
    const installed = await installForAgents(built.root, agents);
    if (installed.code !== 0) throw new Error(installed.said.join("\n"));
    const { peer, cleanup } = linkedCarrierCheckout(built.root);
    cleanups.push(cleanup, built.repository.cleanup);
    return { built, linked: peer };
  } catch (error) {
    built.repository.cleanup();
    throw error;
  }
}

describe("edit-time carrier checkout selection", () => {
  it("refuses a linked checkout that has no carrier", async () => {
    const { built, linked } = await linkedFixture(["claude"]);
    const agent = shellAgent("claude");
    const file = agentWrites(linked, CLEAN_LINE);
    rmSync(path.join(linked, AGENT_CARRIER_PROGRAM_PATH));

    const hook = deliver(built.root, agent, agent.writeEvent(linked, file), {
      ...operatorEnv(),
      CLAUDE_PROJECT_DIR: built.root,
    });

    expect(hook?.status, hook?.stderr).toBe(2);
    expect(hook?.stderr).toContain(
      "lisa controls install-carriers --agents=claude"
    );
    expect(editRuns(built.ran)).toEqual([]);
  });

  it("resolves a relative file against the event's working directory", async () => {
    const { built, linked } = await linkedFixture(["claude"]);
    const agent = shellAgent("claude");
    const file = agentWrites(linked, PLANTED_LINE);
    const event = {
      cwd: linked,
      tool_name: "Write",
      tool_input: { file_path: file },
    };

    const hook = deliver(built.root, agent, event, {
      ...operatorEnv(),
      CLAUDE_PROJECT_DIR: built.root,
    });

    expect(hook?.status, hook?.stderr).toBe(2);
    expect(editRuns(built.ran)).toEqual([file]);
  });

  it("refuses a single event that names files in two checkouts", async () => {
    const { built, linked } = await linkedFixture(["codex"]);
    const agent = shellAgent("codex");
    const event = {
      cwd: built.root,
      tool_name: "apply_patch",
      tool_input: {
        patch: [built.root, linked]
          .map(root => `*** Update File: ${path.join(root, CHECKED_FILE)}`)
          .join("\n"),
      },
    };

    const hook = deliver(built.root, agent, event);

    expect(hook?.status, hook?.stderr).toBe(2);
    expect(hook?.stderr).toContain("files in more than one checkout");
    expect(editRuns(built.ran)).toEqual([]);
  });
});
