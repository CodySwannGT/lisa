/**
 * `lisa controls install-carriers --agents`: a coding agent that writes a
 * file holding a violation is told the write does not pass
 * (CodySwannGT/lisa#4990).
 *
 * F-none is a small Python package: no `package.json`, no project type,
 * nothing from Lisa, and no plugin. A check is declared for the moment after
 * a file write, the command is run for one agent, and then the suite does
 * what that agent does after a write: it starts the hook the repository now
 * registers for it, with a write event on standard input. The event is made
 * up; everything it sets off is real.
 *
 * What a refusal looks like differs by agent, so each agent's is written
 * here by hand and not read from the code under test.
 * @module tests/integration/controls-install-carriers-agents
 */
import { rmSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CARRIER_RUNNER_PATH } from "../../src/controls/carrier-types.js";
import {
  agentWrites,
  deliver,
  deliverToOpencode,
  editRepository,
  editRuns,
  installForAgents,
  SHELL_AGENTS,
  shellAgent,
  type EditRepository,
} from "../support/carrier-agents.js";
import {
  CHECKED_FILE,
  LINT_SHAPE,
  operatorEnv,
  PLANTED,
  withoutNode,
} from "../support/carrier-install.js";

const CLEAN_LINE = "# a harmless comment";
const PLANTED_LINE = `# ${PLANTED}`;

/** The agents told of a failed write by exit status 2 and standard error. */
const EXIT_TWO = ["claude", "codex", "copilot", "devin"];

/** The agent told of a failed write in the context its hook prints. */
const CONTEXT = "cursor";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-none with a check declared after a file write, and install the
 * edit-time carrier for the named agents.
 * @param agents - The agents, as the flag names them
 * @returns The repository
 */
async function carried(agents: readonly string[]): Promise<EditRepository> {
  const built = editRepository();
  cleanups.push(built.repository.cleanup);
  if ((await installForAgents(built.root, agents)).code !== 0) {
    throw new Error(`install-carriers did not pass for ${agents.join(", ")}`);
  }
  return built;
}

/**
 * The context a hook printed for its agent.
 * @param stdout - What the hook wrote on standard output
 * @returns The text the agent adds to the conversation; empty when none
 */
function printedContext(stdout: string): string {
  if (stdout.trim() === "") return "";
  const answer = JSON.parse(stdout) as { additional_context?: unknown };
  return typeof answer.additional_context === "string"
    ? answer.additional_context
    : "";
}

describe("a write that holds a violation", () => {
  it.each(EXIT_TWO)(
    "is refused on %s with exit status 2 and the failure on standard error",
    async name => {
      const built = await carried([name]);
      const agent = shellAgent(name);
      const file = agentWrites(built.root, PLANTED_LINE);

      const hook = deliver(
        built.root,
        agent,
        agent.writeEvent(built.root, file)
      );

      expect(hook?.status).toBe(2);
      expect(hook?.stderr).toMatch(/^Write refused: /mu);
      expect(hook?.stderr).toContain(LINT_SHAPE);
      expect(editRuns(built.ran)).toHaveLength(1);
    }
  );

  it("is refused on cursor in the context the hook prints, with exit status 0", async () => {
    const built = await carried([CONTEXT]);
    const agent = shellAgent(CONTEXT);
    const file = agentWrites(built.root, PLANTED_LINE);

    const hook = deliver(built.root, agent, agent.writeEvent(built.root, file));

    expect(hook?.status).toBe(0);
    expect(printedContext(hook?.stdout ?? "")).toMatch(/^Write refused: /u);
    expect(printedContext(hook?.stdout ?? "")).toContain(LINT_SHAPE);
    expect(editRuns(built.ran)).toHaveLength(1);
  });

  it("is refused on opencode by an error thrown from its plugin", async () => {
    const built = await carried(["opencode"]);
    const file = agentWrites(built.root, PLANTED_LINE);

    const thrown = await deliverToOpencode(built.root, "write", file);

    expect(thrown).toMatch(/^Write refused: /u);
    expect(thrown).toContain(LINT_SHAPE);
    expect(editRuns(built.ran)).toHaveLength(1);
  });
});

describe("a clean write", () => {
  it.each(SHELL_AGENTS.map(agent => agent.agent))(
    "passes on %s, having run the declared check",
    async name => {
      const built = await carried([name]);
      const agent = shellAgent(name);
      const file = agentWrites(built.root, CLEAN_LINE);

      const hook = deliver(
        built.root,
        agent,
        agent.writeEvent(built.root, file)
      );

      expect(hook?.status).toBe(0);
      expect(printedContext(hook?.stdout ?? "")).toBe("");
      expect(editRuns(built.ran)).toHaveLength(1);
    }
  );

  it("passes on opencode, having run the declared check", async () => {
    const built = await carried(["opencode"]);
    const file = agentWrites(built.root, CLEAN_LINE);

    expect(await deliverToOpencode(built.root, "write", file)).toBeNull();
    expect(editRuns(built.ran)).toHaveLength(1);
  });
});

describe("what the declared check is told", () => {
  it.each(SHELL_AGENTS.map(agent => agent.agent))(
    "is the file %s wrote, as the event names it",
    async name => {
      const built = await carried([name]);
      const agent = shellAgent(name);
      const file = agentWrites(built.root, CLEAN_LINE);

      deliver(built.root, agent, agent.writeEvent(built.root, file));

      expect(editRuns(built.ran).map(told => path.basename(told))).toEqual([
        path.basename(CHECKED_FILE),
      ]);
    }
  );

  it("is nothing when the event cannot be read, and the check still runs", async () => {
    const built = await carried(["claude"]);
    agentWrites(built.root, PLANTED_LINE);

    const hook = deliver(built.root, shellAgent("claude"), "not an event");

    expect(hook?.status).toBe(2);
    expect(editRuns(built.ran)).toEqual([""]);
  });
});

describe("an event that is not a file write", () => {
  it("runs nothing on copilot, whose hook runs after every tool", async () => {
    const built = await carried(["copilot"]);
    agentWrites(built.root, PLANTED_LINE);

    const hook = deliver(built.root, shellAgent("copilot"), {
      toolArgs: JSON.stringify({ command: "ls" }),
      toolName: "bash",
    });

    expect(hook?.status).toBe(0);
    expect(editRuns(built.ran)).toEqual([]);
  });

  it("runs nothing on opencode, whose hook runs after every tool", async () => {
    const built = await carried(["opencode"]);
    agentWrites(built.root, PLANTED_LINE);

    expect(
      await deliverToOpencode(built.root, "bash", CHECKED_FILE)
    ).toBeNull();
    expect(editRuns(built.ran)).toEqual([]);
  });
});

describe("a carrier that cannot run the checks", () => {
  it.each(EXIT_TWO)(
    "refuses the write on %s and names Node when only Node is off PATH",
    async name => {
      const built = await carried([name]);
      const agent = shellAgent(name);
      const file = agentWrites(built.root, CLEAN_LINE);
      const nodeFree = withoutNode(operatorEnv());
      cleanups.push(nodeFree.cleanup);

      const hook = deliver(
        built.root,
        agent,
        agent.writeEvent(built.root, file),
        nodeFree.env
      );

      expect(hook?.status).toBe(2);
      expect(hook?.stderr).toMatch(/^Write refused: Node\.js is missing/mu);
      expect(editRuns(built.ran)).toEqual([]);
    }
  );

  it("refuses the write on cursor and names Node when only Node is off PATH", async () => {
    const built = await carried([CONTEXT]);
    const agent = shellAgent(CONTEXT);
    const file = agentWrites(built.root, CLEAN_LINE);
    const nodeFree = withoutNode(operatorEnv());
    cleanups.push(nodeFree.cleanup);

    const hook = deliver(
      built.root,
      agent,
      agent.writeEvent(built.root, file),
      nodeFree.env
    );

    expect(hook?.status).toBe(0);
    expect(printedContext(hook?.stdout ?? "")).toMatch(
      /^Write refused: Node\.js is missing/u
    );
  });

  it.each(SHELL_AGENTS.map(agent => agent.agent))(
    "refuses the write on %s when the carrier is no longer in the checkout",
    async name => {
      const built = await carried([name]);
      const agent = shellAgent(name);
      const file = agentWrites(built.root, CLEAN_LINE);
      rmSync(path.join(built.root, ".lisa/hooks"), { recursive: true });

      const hook = deliver(
        built.root,
        agent,
        agent.writeEvent(built.root, file)
      );
      const said = `${hook?.stderr ?? ""}${printedContext(hook?.stdout ?? "")}`;

      expect(hook?.status).toBe(name === CONTEXT ? 0 : 2);
      expect(said).toContain("Write refused: ");
      expect(said).toContain(`--agents=${name}`);
      expect(editRuns(built.ran)).toEqual([]);
    }
  );

  it("refuses the write when the gate runner is no longer in the checkout", async () => {
    const built = await carried(["claude"]);
    const agent = shellAgent("claude");
    const file = agentWrites(built.root, CLEAN_LINE);
    rmSync(path.join(built.root, CARRIER_RUNNER_PATH));

    const hook = deliver(built.root, agent, agent.writeEvent(built.root, file));

    expect(hook?.status).toBe(2);
    expect(hook?.stderr).toContain(`${CARRIER_RUNNER_PATH} is missing`);
  });
});
