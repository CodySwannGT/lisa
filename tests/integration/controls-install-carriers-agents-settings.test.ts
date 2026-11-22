/**
 * `lisa controls install-carriers --agents`: what happens to files a
 * repository already has, and what a second run does
 * (CodySwannGT/lisa#4990).
 *
 * Two things are held:
 *
 * - A settings file the repository wrote is added to and never rewritten,
 *   and one that cannot be read is left exactly as it was.
 * - A second run writes nothing, `--check` says what a run would write, and
 *   a later run that names no agent does not forget the files an earlier one
 *   placed.
 * @module tests/integration/controls-install-carriers-agents-settings
 */
import { afterEach, describe, expect, it } from "vitest";

import { CARRIER_RECORD_PATH } from "../../src/controls/carrier-types.js";
import {
  CARRIERS_BLOCKED_EXIT_CODE,
  CHECK_WOULD_CHANGE_EXIT_CODE,
} from "../../src/controls/commands/install-carriers.js";
import {
  agentPoint,
  agentWrites,
  deliver,
  editRepository,
  installForAgents,
  placeFile,
  readJson,
  readText,
  shellAgent,
  type EditRepository,
} from "../support/carrier-agents.js";
import {
  dirt,
  installCarriers,
  LINT_SHAPE,
  PLANTED,
} from "../support/carrier-install.js";

const CONFIG = ".lisa.config.json";
const CLAUDE = "claude";
const CLAUDE_SETTINGS = ".claude/settings.json";
const OWN_COMMAND = "echo ours";
const UNENFORCEABLE = "unenforceable";
const ALREADY_WIRED = "already-wired";
const SOME_AGENTS = [CLAUDE, "agy"];
const EVERY_AGENT = ["fleet"];

/** A settings file a repository wrote itself, in its own style. */
const HOST_SETTINGS = [
  "{",
  '    "model": "opus",',
  '    "x-team": { "owner": "platform" },',
  '    "hooks": {',
  '        "PostToolUse": [',
  "            {",
  '                "matcher": "Bash",',
  `                "hooks": [{ "type": "command", "command": "${OWN_COMMAND}" }]`,
  "            }",
  "        ]",
  "    }",
  "}",
  "",
].join("\n");

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Build F-none with a check declared after a file write, removed when the
 * case ends.
 * @param settings - What `.claude/settings.json` already holds, if anything
 * @returns The repository
 */
function declared(settings?: string): EditRepository {
  const built = editRepository();
  cleanups.push(built.repository.cleanup);
  if (settings !== undefined) placeFile(built.root, CLAUDE_SETTINGS, settings);
  return built;
}

describe("a settings file the repository already has", () => {
  it("keeps every line it had, and gains one hook entry", async () => {
    const built = declared(HOST_SETTINGS);

    const run = await installForAgents(built.root, [CLAUDE]);
    const after = readText(built.root, CLAUDE_SETTINGS);
    const hooks = (
      readJson(built.root, CLAUDE_SETTINGS) as {
        hooks: { PostToolUse: readonly { matcher: string }[] };
      }
    ).hooks.PostToolUse;

    expect(run.code).toBe(0);
    expect(agentPoint(run, CLAUDE).outcome).toBe("installed");
    expect(
      HOST_SETTINGS.split("\n")
        .filter(line => line.trim() !== "" && line.trim() !== "}")
        .filter(line => !after.includes(line.replace(/,$/u, "")))
    ).toEqual([]);
    expect(readJson(built.root, CLAUDE_SETTINGS)).toMatchObject({
      model: "opus",
      "x-team": { owner: "platform" },
    });
    expect(hooks.map(hook => hook.matcher)).toEqual([
      "Bash",
      "Write|Edit|MultiEdit|NotebookEdit",
    ]);
  });

  it("still refuses a violating write through the entry that was added", async () => {
    const built = declared(HOST_SETTINGS);
    const agent = shellAgent(CLAUDE);
    const lisaOnly = {
      ...agent,
      commands: (document: unknown) =>
        agent.commands(document).filter(command => command !== OWN_COMMAND),
    };
    await installForAgents(built.root, [CLAUDE]);
    const file = agentWrites(built.root, `# ${PLANTED}`);

    const hook = deliver(
      built.root,
      lisaOnly,
      agent.writeEvent(built.root, file)
    );

    expect(hook?.status).toBe(2);
    expect(hook?.stderr).toContain(LINT_SHAPE);
  });

  it("is left untouched, and the entry to add by hand is given, when it cannot be read", async () => {
    const broken = "{ broken\n";
    const built = declared(broken);

    const run = await installForAgents(built.root, [CLAUDE, "cursor"]);
    const point = agentPoint(run, CLAUDE);

    expect(run.code).toBe(CARRIERS_BLOCKED_EXIT_CODE);
    expect(point.outcome).toBe("blocked");
    expect(point.reason).toContain(CLAUDE_SETTINGS);
    expect(point.reason).toContain(
      '"matcher":"Write|Edit|MultiEdit|NotebookEdit"'
    );
    expect(point.reason).toContain(".lisa/hooks/post-tool");
    expect(readText(built.root, CLAUDE_SETTINGS)).toBe(broken);
    expect(agentPoint(run, "cursor").outcome).toBe("installed");
  });
});

describe("running it again", () => {
  it("changes nothing on a second run and says so", async () => {
    const built = declared();
    await installForAgents(built.root, EVERY_AGENT);
    const before = dirt(built.root);
    const config = readText(built.root, CONFIG);

    const again = await installForAgents(built.root, EVERY_AGENT);

    expect(again.code).toBe(0);
    expect(again.result?.outcome).toBe(ALREADY_WIRED);
    expect(again.result?.changes).toEqual([]);
    expect(
      again.result?.enforcement_points
        .filter(point => point.agent !== undefined)
        .map(point => `${point.agent ?? ""}: ${point.outcome}`)
    ).toEqual([
      `claude: ${ALREADY_WIRED}`,
      `codex: ${ALREADY_WIRED}`,
      `cursor: ${ALREADY_WIRED}`,
      `agy: ${UNENFORCEABLE}`,
      `copilot: ${ALREADY_WIRED}`,
      `opencode: ${ALREADY_WIRED}`,
      `devin: ${ALREADY_WIRED}`,
    ]);
    expect(again.said.join("\n")).toMatch(/Nothing changed/u);
    expect(dirt(built.root)).toBe(before);
    expect(readText(built.root, CONFIG)).toBe(config);
  });

  it("writes nothing under --check and lists what a run would write", async () => {
    const built = declared();

    const check = await installForAgents(built.root, SOME_AGENTS, true);

    expect(check.code).toBe(CHECK_WOULD_CHANGE_EXIT_CODE);
    expect(check.result?.changes).toContainEqual({
      action: "create",
      path: CLAUDE_SETTINGS,
    });
    expect(check.result?.changes).toContainEqual({
      action: "update",
      path: CONFIG,
    });
    expect(dirt(built.root)).toBe("");
  });

  it("passes --check once everything is in place", async () => {
    const built = declared();
    await installForAgents(built.root, SOME_AGENTS);

    const check = await installForAgents(built.root, SOME_AGENTS, true);

    expect(check.code).toBe(0);
    expect(check.result?.changes).toEqual([]);
  });

  it("keeps an agent's carrier on record through a run that names no agent", async () => {
    const built = declared();
    await installForAgents(built.root, [CLAUDE, "copilot"]);
    const recorded = readText(built.root, CARRIER_RECORD_PATH);

    const gitOnly = await installCarriers(built.root);

    expect(gitOnly.result?.changes).toEqual([]);
    expect(readText(built.root, CARRIER_RECORD_PATH)).toBe(recorded);
    expect(recorded).toContain(".lisa/hooks/post-tool");
    expect(recorded).toContain(".github/hooks/lisa-controls.json");
  });
});
