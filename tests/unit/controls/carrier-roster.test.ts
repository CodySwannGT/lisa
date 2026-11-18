/**
 * Which coding agents `lisa controls install-carriers --agents` carries.
 *
 * The roster is read from the repository's `harness` setting or named on the
 * flag, and it is never guessed: a roster that cannot be read gives no result
 * and says how to name the agents (CodySwannGT/lisa#4990).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  agentSelectionOf,
  resolveRoster,
  type RosterRead,
} from "../../../src/controls/carrier-roster.js";
import {
  AGENT_MOMENTS,
  CODING_AGENTS,
  EDIT_TIME_MOMENT,
  inAgentOrder,
} from "../../../src/controls/coding-agents.js";
import { HARNESS_VALUES } from "../../../src/core/config.js";

const EVERY_AGENT = [
  "claude",
  "codex",
  "cursor",
  "agy",
  "copilot",
  "opencode",
  "devin",
];

/** The form of the flag every refusal points to. */
const HOW_TO_NAME = "--agents=<names>";

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { force: true, recursive: true });
  }
});

/**
 * A folder holding the given `.lisa.config.json`.
 * @param config - The file's content, or `null` for no file
 * @returns The folder
 */
function repositoryWith(config: string | null): string {
  const folder = mkdtempSync(path.join(tmpdir(), "lisa-roster-"));
  folders.push(folder);
  if (config !== null) {
    writeFileSync(path.join(folder, ".lisa.config.json"), config);
  }
  return folder;
}

/**
 * Resolve the roster the flag names.
 * @param flag - The text given to `--agents`
 * @returns The roster, or the problems
 */
function named(flag: string): Promise<RosterRead> {
  return resolveRoster(repositoryWith(null), agentSelectionOf(flag));
}

/**
 * Resolve the roster of a repository's `harness` setting.
 * @param config - The content of `.lisa.config.json`, or `null` for no file
 * @returns The roster, or the problems
 */
function fromHarness(config: string | null): Promise<RosterRead> {
  return resolveRoster(repositoryWith(config), agentSelectionOf(true));
}

describe("the coding agents Lisa names", () => {
  it("are the values of the harness setting that name one agent", () => {
    expect(CODING_AGENTS).toEqual(EVERY_AGENT);
    expect([...CODING_AGENTS, "fleet"]).toEqual(HARNESS_VALUES);
  });

  it("are written in one order, each once", () => {
    expect(inAgentOrder(["devin", "claude", "devin"])).toEqual([
      "claude",
      "devin",
    ]);
  });

  it("carry the edit-time moment among the moments an agent's hooks carry", () => {
    expect(AGENT_MOMENTS).toContain(EDIT_TIME_MOMENT);
  });
});

describe("agents named on the flag", () => {
  it("are carried in Lisa's order, whatever order they are named in", async () => {
    expect(await named("devin, claude ,agy")).toEqual({
      problems: null,
      roster: {
        agents: ["claude", "agy", "devin"],
        harness: null,
        source: "named",
      },
    });
  });

  it.each(["fleet", "all", "claude,fleet"])(
    "are every agent for %s",
    async flag => {
      expect(await named(flag)).toMatchObject({
        roster: { agents: EVERY_AGENT, source: "named" },
      });
    }
  );

  it.each([
    ["an agent Lisa does not know", "emacs"],
    ["a name with a capital", "Claude"],
    ["a folder", "some/repo"],
  ])("give no roster for %s, and say which names work", async (_name, flag) => {
    const read = await named(`claude,${flag}`);

    expect(read.problems?.[0]).toContain(JSON.stringify(flag));
    expect(read.problems?.[0]).toContain(EVERY_AGENT.join(", "));
    expect(read.problems?.at(-1)).toContain(HOW_TO_NAME);
  });

  it.each(["", " , "])("give no roster for an empty list %j", async flag => {
    expect((await named(flag)).problems?.[0]).toContain(
      "names no coding agent"
    );
  });
});

describe("agents read from the harness setting", () => {
  it.each(EVERY_AGENT)("are the one agent for %s", async agent => {
    expect(await fromHarness(JSON.stringify({ harness: agent }))).toEqual({
      problems: null,
      roster: { agents: [agent], harness: agent, source: "harness" },
    });
  });

  it.each(["fleet", "all", "both"])("are every agent for %s", async harness => {
    expect(await fromHarness(JSON.stringify({ harness }))).toEqual({
      problems: null,
      roster: { agents: EVERY_AGENT, harness: "fleet", source: "harness" },
    });
  });

  it.each([
    ["there is no .lisa.config.json", null],
    ["the file has no harness setting", '{ "gates": {} }'],
  ])("give no roster when %s, and are not guessed", async (_name, config) => {
    const read = await fromHarness(config);

    expect(read.problems).toHaveLength(1);
    expect(read.problems?.[0]).toContain('"harness" setting');
    expect(read.problems?.[0]).toContain(HOW_TO_NAME);
  });

  it.each([
    ["names no agent", '{ "harness": "emacs" }', '"emacs"'],
    ["is not text", '{ "harness": 7 }', "7"],
  ])("give no roster when the setting %s", async (_name, config, quoted) => {
    const read = await fromHarness(config);

    expect(read.problems?.[0]).toContain(`is ${quoted}`);
    expect(read.problems?.[0]).toContain(HOW_TO_NAME);
  });

  it.each([
    ["is not JSON", "{ broken"],
    ["holds a list", "[]"],
  ])("give no roster when the file %s", async (_name, config) => {
    const read = await fromHarness(config);

    expect(read.problems?.[0]).toContain("cannot be read");
    expect(read.problems?.[0]).toContain(HOW_TO_NAME);
  });

  it("say why the file is not JSON without repeating what it holds", async () => {
    // A JSON parser quotes a few characters either side of the place it
    // stopped. The file is the repository's and may hold anything, so none
    // of it is printed.
    const read = await fromHarness('{ "harness": "claude", "note": KEPT }');
    const [problem = ""] = read.problems ?? [];

    expect(problem).toContain("could not be read as JSON");
    expect(problem).toContain("Unexpected token");
    expect(problem).not.toContain("note");
    expect(problem).not.toContain("KEPT");
  });
});
