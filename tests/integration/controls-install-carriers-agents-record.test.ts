/**
 * `lisa controls install-carriers --agents`: which agents a run carries, and
 * what is written down about one that cannot be made to refuse a write
 * (CodySwannGT/lisa#4990).
 *
 * Three things are held:
 *
 * - An agent with no hook gets nothing installed; the gates declaration names
 *   it, and the regenerated control register names it on the edit-time point.
 * - The agents come from the `harness` setting or from the flag, and are
 *   never guessed.
 * - A run without `--agents` is exactly what it was before the flag existed.
 * @module tests/integration/controls-install-carriers-agents-record
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CARRIERS_BLOCKED_EXIT_CODE } from "../../src/controls/commands/install-carriers.js";
import { generateControlRegister } from "../../src/controls/register.js";
import {
  agentPoint,
  EDIT_GATE,
  editGates,
  editRepository,
  installForAgents,
  POST_TOOL,
  readJson,
  readText,
  type EditRepository,
} from "../support/carrier-agents.js";
import { dirt, installCarriers } from "../support/carrier-install.js";

const CONFIG = ".lisa.config.json";
const UNENFORCEABLE = "unenforceable";
const HOOKLESS = "agy";
const FROM_HARNESS = { agents: { from: "harness" } } as const;

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-none, removed when the case ends.
 * @param config - Builds `.lisa.config.json`, or `null` for no such file;
 *   left out, the file declares one check after a file write
 * @returns The repository
 */
function declared(config?: ((ran: string) => string) | null): EditRepository {
  const built =
    config === undefined ? editRepository() : editRepository(config);
  cleanups.push(built.repository.cleanup);
  return built;
}

/**
 * A `.lisa.config.json` holding the check and whatever else is given.
 * @param extra - Further top-level keys
 * @param entry - The gate's `post-tool` entry
 * @returns What builds the file's content
 */
function configWith(
  extra: Readonly<Record<string, unknown>>,
  entry: unknown = "required"
): (ran: string) => string {
  return ran =>
    `${JSON.stringify({ ...extra, gates: editGates(ran, entry) }, null, 2)}\n`;
}

describe("an agent with no hook that can refuse a write", () => {
  it("gets nothing installed and is named in the gates declaration", async () => {
    const built = declared();

    const run = await installForAgents(built.root, [HOOKLESS]);

    expect(run.code).toBe(0);
    expect(agentPoint(run, HOOKLESS)).toMatchObject({
      hook: null,
      kind: "agent-hook",
      location: "coding-agent",
      moment: POST_TOOL,
      outcome: UNENFORCEABLE,
      path: CONFIG,
      recorded_on: [EDIT_GATE],
      wired_through: "no-hook-surface",
    });
    expect(readJson(built.root, CONFIG)).toMatchObject({
      gates: {
        [EDIT_GATE]: {
          [POST_TOOL]: { level: "required", unenforceable_on: [HOOKLESS] },
        },
      },
    });
    expect(existsSync(path.join(built.root, ".lisa/hooks/post-tool"))).toBe(
      false
    );
  });

  it("is named on the edit-time point of the regenerated register", async () => {
    const built = declared();
    await installForAgents(built.root, ["claude", HOOKLESS]);

    const generated = await generateControlRegister(built.root);

    expect(generated.problems).toBeNull();
    expect(
      generated.problems === null
        ? generated.register.entries.map(entry => ({
            id: entry.id,
            points: entry.enforcement_points,
          }))
        : []
    ).toEqual([
      {
        id: `${EDIT_GATE}@.`,
        points: [
          {
            level: "required",
            location: "coding-agent",
            moment: POST_TOOL,
            unenforceable_on: [HOOKLESS],
          },
        ],
      },
    ]);
  });

  it("is added to a list the declaration already holds, and nobody is dropped", async () => {
    const built = declared(
      configWith({}, { level: "optional", unenforceable_on: ["copilot"] })
    );

    await installForAgents(built.root, [HOOKLESS]);

    expect(readJson(built.root, CONFIG)).toMatchObject({
      gates: {
        [EDIT_GATE]: {
          [POST_TOOL]: {
            level: "optional",
            unenforceable_on: [HOOKLESS, "copilot"],
          },
        },
      },
    });
  });

  it("is reported, and nothing is written, when no check is declared after a write", async () => {
    const built = declared(() => `${JSON.stringify({ harness: HOOKLESS })}\n`);
    const before = readText(built.root, CONFIG);

    const run = await installCarriers(built.root, FROM_HARNESS);

    expect(run.code).toBe(0);
    expect(agentPoint(run, HOOKLESS)).toMatchObject({
      outcome: UNENFORCEABLE,
      path: null,
      recorded_on: [],
    });
    expect(agentPoint(run, HOOKLESS).reason).toContain("Nothing is declared");
    expect(readText(built.root, CONFIG)).toBe(before);
  });

  it("is blocked, with what to add by hand, when the declaration cannot be read", async () => {
    const broken = "{ not json\n";
    const built = declared(() => broken);

    const run = await installForAgents(built.root, [HOOKLESS]);

    expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(agentPoint(run, HOOKLESS).outcome).toBe("blocked");
    expect(agentPoint(run, HOOKLESS).reason).toContain(
      `"unenforceable_on": ["${HOOKLESS}"]`
    );
    expect(readText(built.root, CONFIG)).toBe(broken);
  });
});

describe("which agents a run carries", () => {
  it("reads them from the harness setting when the flag names none", async () => {
    const built = declared(configWith({ harness: "fleet" }));

    const run = await installCarriers(built.root, FROM_HARNESS);

    expect(run.code).toBe(0);
    expect(run.result?.roster).toEqual({
      agents: [
        "claude",
        "codex",
        "cursor",
        HOOKLESS,
        "copilot",
        "opencode",
        "devin",
      ],
      harness: "fleet",
      source: "harness",
    });
  });

  it("gives no result, and writes nothing, when there is no harness setting to read", async () => {
    const built = declared(null);

    const run = await installCarriers(built.root, FROM_HARNESS);

    expect(run.code).toBe(1);
    expect(run.result).toBeNull();
    expect(run.said.join("\n")).toContain("--agents=<names>");
    expect(dirt(built.root)).toBe("");
  });

  it("carries the named agents where there is no .lisa.config.json at all", async () => {
    const built = declared(null);

    const run = await installForAgents(built.root, ["codex", HOOKLESS]);

    expect(run.code).toBe(0);
    expect(run.result?.roster).toEqual({
      agents: ["codex", HOOKLESS],
      harness: null,
      source: "named",
    });
    expect(agentPoint(run, "codex").outcome).toBe("installed");
    expect(agentPoint(run, HOOKLESS)).toMatchObject({
      outcome: UNENFORCEABLE,
      path: null,
      recorded_on: [],
    });
    expect(existsSync(path.join(built.root, CONFIG))).toBe(false);
  });

  it("reports commit and push exactly as before when the flag is not given", async () => {
    const built = declared();

    const run = await installCarriers(built.root);

    expect(run.result).not.toHaveProperty("roster");
    expect(run.result?.enforcement_points).toEqual(
      ["commit", "push"].map(moment => ({
        hook: moment === "commit" ? "pre-commit" : "pre-push",
        kind: "git-hook",
        location: "local-checkout",
        moment,
        outcome: "installed",
        path: "core.hooksPath",
        reason: null,
        wired_through: "none",
      }))
    );
    expect(run.result?.reason).toBe(
      "Installed. Git now runs the checks this repository declares at commit and push."
    );
    expect(existsSync(path.join(built.root, ".claude"))).toBe(false);
    expect(readJson(built.root, CONFIG)).toMatchObject({
      gates: { [EDIT_GATE]: { [POST_TOOL]: "required" } },
    });
  });
});
