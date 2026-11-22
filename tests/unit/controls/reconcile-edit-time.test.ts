/** Reconcile the edit-time hook files in a disposable repository. @module */
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_CARRIER_PATH,
  AGENT_CARRIER_START,
} from "../../../src/controls/carrier-agent-script.js";
import type { CodingAgent } from "../../../src/controls/coding-agents.js";
import { fakeGithubToken } from "../../helpers/fake-credentials.js";
import {
  editGates,
  editRepository,
  EDIT_GATE,
  installForAgents,
  type EditRepository,
} from "../../support/carrier-agents.js";
import { installCarriers } from "../../support/carrier-install.js";
import {
  missingPoints,
  reconcile,
  resultOf,
  undeclared,
  type ReconcileCommandRun,
} from "../../support/reconcile-run.js";
import { repositoryState } from "../../support/repository-state.js";

const CLAUDE = ".claude/settings.json";
const CODEX = ".codex/hooks.json";
const COPILOT = ".github/hooks/lisa-controls.json";
const RECORD = ".lisa/controls/carriers.json";
const POST_TOOL = "post-tool";
const NOT_VERIFIABLE = "not-verifiable";
const NEVER_RUN = "node scripts/never-run.mjs --staged";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build a repository with declared edit-time, Git, deployment and scheduled points.
 * @param agents - Agents to configure, if any
 * @returns The repository and the marker its declared command would write
 */
async function fixture(
  agents: readonly CodingAgent[] = []
): Promise<EditRepository> {
  const built = editRepository(ran => {
    const gates = editGates(ran);
    const edit = gates[EDIT_GATE];
    if (typeof edit !== "object" || edit === null) {
      throw new Error("Fixture did not declare an edit-time gate");
    }
    return JSON.stringify({
      gates: {
        [EDIT_GATE]: {
          ...edit,
          commit: "required",
          "pre-deploy:production": "required",
        },
        "dependency-vulnerability": {
          "continuous:staging": "required",
        },
      },
    });
  });
  const installed =
    agents.length === 0
      ? installCarriers(built.root)
      : installForAgents(built.root, agents);
  cleanups.push(built.repository.cleanup);
  expect((await installed).code).toBe(0);
  return built;
}

/**
 * Run the comparison and verify the repository and command marker stay untouched.
 * @param built - The fixture repository
 * @returns The finished comparison
 */
async function readOnly(built: EditRepository): Promise<ReconcileCommandRun> {
  const state = repositoryState(built.root);
  const gitFolder = path.join(built.root, ".git");
  const gitBytes = () =>
    readdirSync(gitFolder, { withFileTypes: true, recursive: true })
      .filter(entry => entry.isFile())
      .map(entry => path.join(entry.parentPath, entry.name))
      .sort((left, right) => left.localeCompare(right))
      .map(file => [file, readFileSync(file)]);
  const before = gitBytes();
  const run = await reconcile(built.root);
  expect(run.code, run.said.join("\n")).toBe(0);
  expect(gitBytes()).toEqual(before);
  expect(repositoryState(built.root)).toEqual(state);
  expect(existsSync(built.ran)).toBe(false);
  return run;
}

/**
 * Get the result for the declared edit-time rule.
 * @param run - The finished comparison
 * @returns Its edit-time point, if reported
 */
function pointOf(run: ReconcileCommandRun) {
  return resultOf(run).enforcement_points.find(
    point => point.moment === POST_TOOL
  );
}

describe("reconcile edit-time carrier registrations", () => {
  it("confirms both intact registrations after a repeat install without an agent list", async () => {
    const built = await fixture(["codex", "claude"]);
    await installCarriers(built.root);
    await installForAgents(built.root, ["codex"]);

    const run = await readOnly(built);

    expect(pointOf(run)).toMatchObject({
      state: "wired",
      agent_verdicts: [
        { agent: "claude", state: "wired" },
        { agent: "codex", state: "wired" },
      ],
    });
    expect(resultOf(run)).toMatchObject({ outcome: "in-step", findings: [] });
    for (const moment of ["pre-deploy:production", "continuous:staging"]) {
      expect(
        resultOf(run).enforcement_points.find(point => point.moment === moment)
          ?.state
      ).toBe(NOT_VERIFIABLE);
    }
  });

  it("reports a removed Claude Code hook", async () => {
    const built = await fixture(["claude"]);
    writeFileSync(path.join(built.root, CLAUDE), "{}\n");

    const run = await readOnly(built);

    expect(pointOf(run)?.state).toBe("not-wired");
    expect(missingPoints(run)).toEqual([
      expect.objectContaining({
        agent: "claude",
        entry_id: `${EDIT_GATE}@.`,
        message: expect.stringContaining("Claude Code"),
      }),
    ]);
    expect(resultOf(run).outcome).toBe("findings");
  });

  it("reports an edited command both as a missing registration and as undeclared", async () => {
    const built = await fixture(["claude"]);
    const file = path.join(built.root, CLAUDE);
    const config = JSON.parse(readFileSync(file, "utf8")) as {
      hooks: { PostToolUse: Array<{ hooks: Array<{ command: string }> }> };
    };
    const [entry] = config.hooks.PostToolUse;
    const [hook] = entry?.hooks ?? [];
    if (hook === undefined)
      throw new Error("Fixture did not install the Claude hook");
    hook.command = NEVER_RUN;
    writeFileSync(file, JSON.stringify(config, null, 2));

    const run = await readOnly(built);

    expect(missingPoints(run)).toEqual([
      expect.objectContaining({ agent: "claude" }),
    ]);
    expect(undeclared(run)).toEqual([
      expect.objectContaining({ command: NEVER_RUN, path: CLAUDE, line: 9 }),
    ]);
  });

  it("removes credential-shaped text from both outputs about an agent hook", async () => {
    const built = await fixture(["claude"]);
    const token = fakeGithubToken();
    const file = path.join(built.root, CLAUDE);
    const config = {
      hooks: {
        PostToolUse: [
          { hooks: [{ type: "command", command: `${NEVER_RUN} ${token}` }] },
        ],
      },
    };
    writeFileSync(file, JSON.stringify(config, null, 2));

    const run = await readOnly(built);

    expect(run.printed.includes(token)).toBe(false);
    expect(run.said.some(line => line.includes(token))).toBe(false);
    expect(undeclared(run)).toEqual([
      expect.objectContaining({
        command: `${NEVER_RUN} [REDACTED:GITHUB_TOKEN]`,
        path: CLAUDE,
      }),
    ]);
    expect(
      run.said.some(line => line.includes("[REDACTED:GITHUB_TOKEN]"))
    ).toBe(true);
  });

  it("reports an extra command beside an intact Claude Code carrier", async () => {
    const built = await fixture(["claude"]);
    const file = path.join(built.root, CLAUDE);
    const config = JSON.parse(readFileSync(file, "utf8")) as {
      hooks: {
        PostToolUse: Array<{ hooks: Array<{ type: string; command: string }> }>;
      };
    };
    const [entry] = config.hooks.PostToolUse;
    if (entry === undefined)
      throw new Error("Fixture did not install the Claude hook");
    entry.hooks.push({ type: "command", command: NEVER_RUN });
    writeFileSync(file, JSON.stringify(config, null, 2));

    const run = await readOnly(built);

    expect(pointOf(run)?.state).toBe("wired");
    expect(missingPoints(run)).toEqual([]);
    expect(undeclared(run)).toEqual([
      expect.objectContaining({ command: NEVER_RUN, path: CLAUDE }),
    ]);
  });

  it("also reads commands in the GitHub Copilot registration", async () => {
    const built = await fixture(["copilot"]);
    const file = path.join(built.root, COPILOT);
    const config = JSON.parse(readFileSync(file, "utf8")) as {
      hooks: { postToolUse: Array<{ type: string; bash: string }> };
    };
    config.hooks.postToolUse.push({ type: "command", bash: NEVER_RUN });
    writeFileSync(file, JSON.stringify(config, null, 2));

    const run = await readOnly(built);

    expect(pointOf(run)?.state).toBe("wired");
    expect(undeclared(run)).toEqual([
      expect.objectContaining({ command: NEVER_RUN, path: COPILOT }),
    ]);
  });

  it("reports only Codex if Claude is still wired", async () => {
    const built = await fixture(["claude", "codex"]);
    rmSync(path.join(built.root, CODEX));

    const run = await readOnly(built);

    expect(pointOf(run)).toMatchObject({
      state: "not-wired",
      agent_verdicts: [
        { agent: "claude", state: "wired" },
        { agent: "codex", state: "not-wired" },
      ],
    });
    expect(missingPoints(run)).toEqual([
      expect.objectContaining({
        agent: "codex",
        message: expect.stringContaining("Codex"),
      }),
    ]);
  });

  it("retains the register's Antigravity limit alongside a wired agent", async () => {
    const built = await fixture(["agy", "claude"]);

    const run = await readOnly(built);

    expect(pointOf(run)).toMatchObject({
      state: "wired",
      unenforceable_on: ["agy"],
      agent_verdicts: [{ agent: "claude", state: "wired" }],
    });
    expect(missingPoints(run)).toEqual([]);
  });

  it("identifies a legacy carrier record that has no roster", async () => {
    const built = await fixture(["claude"]);
    const file = path.join(built.root, RECORD);
    const { agents, ...record } = JSON.parse(readFileSync(file, "utf8")) as {
      agents: string[];
    };
    expect(agents).toEqual(["claude"]);
    writeFileSync(file, JSON.stringify(record));

    const run = await readOnly(built);

    expect(pointOf(run)).toMatchObject({
      state: NOT_VERIFIABLE,
      reason: expect.stringContaining("install-carriers --agents"),
    });
    expect(missingPoints(run)).toEqual([]);
  });

  it("reports a different reason when no edit-time carrier is installed", async () => {
    const run = await readOnly(await fixture());

    expect(pointOf(run)).toMatchObject({
      state: NOT_VERIFIABLE,
      reason: expect.stringContaining("No edit-time agent carrier"),
    });
    expect(missingPoints(run)).toEqual([]);
  });

  it("reports a custom command inserted inside the shared shell carrier", async () => {
    const built = await fixture(["claude"]);
    const file = path.join(built.root, AGENT_CARRIER_PATH);
    const original = readFileSync(file, "utf8");
    writeFileSync(
      file,
      original.replace(
        AGENT_CARRIER_START,
        `${NEVER_RUN}\n${AGENT_CARRIER_START}`
      )
    );

    const run = await readOnly(built);

    expect(pointOf(run)?.state).toBe("wired");
    expect(undeclared(run)).toEqual([
      expect.objectContaining({ command: NEVER_RUN, path: AGENT_CARRIER_PATH }),
    ]);
    expect(resultOf(run).outcome).toBe("findings");
  });
});
