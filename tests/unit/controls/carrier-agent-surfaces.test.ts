/**
 * The table that says which coding agents can be made to refuse a file
 * write, held to what the rest of this repository already says about each
 * agent.
 *
 * The table is a claim about seven programs Lisa does not own. It cannot be
 * proved from here, but it can be kept from drifting away from Lisa's other
 * statements of the same facts: where Lisa already ships its own post-edit
 * hook to an agent, the table says the agent has the surface, and where Lisa
 * documents that it cannot, the table says it does not
 * (CodySwannGT/lisa#4990).
 */
import { describe, expect, it } from "vitest";

import { shouldShipScript } from "../../../scripts/lib/per-agent-hook-filter.mjs";
import {
  CARRIER_LIMIT_SECONDS,
  agentCarrierProgram,
} from "../../../src/controls/carrier-agent-program.js";
import {
  AGENT_CARRIER_PATH,
  AGENT_CARRIER_PROGRAM_PATH,
  agentCarrierEntry,
  agentHookCommand,
} from "../../../src/controls/carrier-agent-script.js";
import {
  AGENT_HOOK_TIMEOUT_SECONDS,
  AGENT_SURFACES,
  OPENCODE_PLUGIN_FILE,
} from "../../../src/controls/carrier-agent-surfaces.js";
import { AGENT_PLACED_PATHS } from "../../../src/controls/carrier-agents.js";
import {
  AGENT_REFUSALS,
  CARRIER_HOOKS_FOLDER,
  CARRIER_KINDS,
  CARRIER_POINT_OUTCOMES,
  CARRIER_RUNNER_PATH,
  REFUSAL_EVIDENCE,
} from "../../../src/controls/carrier-types.js";
import { CODING_AGENTS } from "../../../src/controls/coding-agents.js";
import { DEVIN_FALLBACK_MATCHER } from "../../../src/devin/enforcement-fallback-installer.js";
import { OPENCODE_PLUGIN_SUBDIR } from "../../../src/opencode/hooks-installer.js";
import { OPENCODE_CONFIG_DIR } from "../../../src/opencode/manifest.js";
import { PLUGIN_CATALOG } from "../../../src/opencode/plugin-catalog.js";

/** Lisa's own hook that runs after an edit and blocks, shipped per agent. */
const POST_EDIT_HOOK = "threshold-ratchet.sh";

/** The agents whose plugin variant goes through the per-agent ship list. */
const SHIP_LIST_AGENTS = [
  "claude",
  "codex",
  "cursor",
  "agy",
  "copilot",
  "devin",
] as const;

/**
 * The agents the table says can be made to refuse a write.
 * @returns Their names, in agent order
 */
function withSurface(): readonly string[] {
  return CODING_AGENTS.filter(agent => AGENT_SURFACES[agent].refuses);
}

describe("which agents can be made to refuse a file write", () => {
  it("is answered for every agent Lisa supports, and no other", () => {
    expect(Object.keys(AGENT_SURFACES)).toEqual([...CODING_AGENTS]);
  });

  it("is every agent but Antigravity", () => {
    expect(withSurface()).toEqual([
      "claude",
      "codex",
      "cursor",
      "copilot",
      "opencode",
      "devin",
    ]);
  });

  it.each(SHIP_LIST_AGENTS)(
    "agrees for %s with whether Lisa ships its own post-edit hook there",
    agent => {
      expect(AGENT_SURFACES[agent].refuses).toBe(
        shouldShipScript(POST_EDIT_HOOK, agent)
      );
    }
  );

  it("agrees for opencode with Lisa shipping it plugins that run after a tool", () => {
    expect(
      PLUGIN_CATALOG.some(entry =>
        entry.templateFilename.endsWith("-on-edit.ts")
      )
    ).toBe(true);
    expect(AGENT_SURFACES.opencode.refuses).toBe(true);
  });

  it("gives a reason an operator can read for an agent that cannot", () => {
    const { agy } = AGENT_SURFACES;

    expect(agy.refuses).toBe(false);
    expect(agy.refuses ? "" : agy.why).toMatch(/^Antigravity has no hook/u);
  });
});

describe("where each agent's carrier is registered", () => {
  it("is a file in the repository, one per agent", () => {
    const files = CODING_AGENTS.flatMap(agent => {
      const surface = AGENT_SURFACES[agent];
      return surface.refuses ? [surface.registration.file] : [];
    });

    expect(files).toEqual([
      ".claude/settings.json",
      ".codex/hooks.json",
      ".cursor/hooks.json",
      ".github/hooks/lisa-controls.json",
      ".opencode/plugin/lisa-controls-carrier.js",
      ".devin/hooks.v1.json",
    ]);
    expect(files.filter(file => path(file))).toEqual(files);
  });

  it("puts OpenCode's plugin in the folder lisa apply writes plugins to, under a name it does not manage", () => {
    expect(
      OPENCODE_PLUGIN_FILE.startsWith(
        `${OPENCODE_CONFIG_DIR}/${OPENCODE_PLUGIN_SUBDIR}/`
      )
    ).toBe(true);
    expect(PLUGIN_CATALOG.map(entry => entry.templateFilename)).not.toContain(
      OPENCODE_PLUGIN_FILE.split("/").at(-1)
    );
  });

  it("matches Devin's write tools the way Lisa's other Devin hook does", () => {
    const { devin } = AGENT_SURFACES;
    const matcher =
      devin.refuses && devin.registration.kind === "merged"
        ? new RegExp(devin.registration.matcher, "u")
        : /$^/u;
    const other = new RegExp(DEVIN_FALLBACK_MATCHER, "u");

    expect(
      ["write", "edit", "apply_patch"].map(tool => matcher.test(tool))
    ).toEqual(["write", "edit", "apply_patch"].map(tool => other.test(tool)));
    expect(matcher.test("exec")).toBe(false);
    expect(matcher.test("rewrite")).toBe(false);
  });

  it("lists every file the agent kind may place, for the record of what was written", () => {
    expect(AGENT_PLACED_PATHS).toEqual([
      AGENT_CARRIER_PATH,
      AGENT_CARRIER_PROGRAM_PATH,
      ".github/hooks/lisa-controls.json",
      OPENCODE_PLUGIN_FILE,
    ]);
  });
});

describe("the names a result uses for an agent point", () => {
  it("are closed lists", () => {
    expect(CARRIER_KINDS).toEqual(["git-hook", "agent-hook"]);
    expect(CARRIER_POINT_OUTCOMES).toEqual([
      "installed",
      "already-wired",
      "updated",
      "blocked",
      "unenforceable",
    ]);
    expect(AGENT_REFUSALS).toEqual([
      "exit-2",
      "additional-context",
      "thrown-error",
    ]);
    expect(REFUSAL_EVIDENCE).toEqual(["measured", "documented", "assumed"]);
  });

  it("say how each agent is told, and how well that is known", () => {
    expect(
      Object.fromEntries(
        CODING_AGENTS.flatMap(agent => {
          const surface = AGENT_SURFACES[agent];
          return surface.refuses
            ? [[agent, `${surface.refusal}, ${surface.evidence}`]]
            : [];
        })
      )
    ).toEqual({
      claude: "exit-2, documented",
      codex: "exit-2, documented",
      cursor: "additional-context, documented",
      copilot: "exit-2, assumed",
      opencode: "thrown-error, measured",
      devin: "exit-2, assumed",
    });
  });
});

describe("the carrier every agent's hook starts", () => {
  it("lives in Lisa's hook folder, beside the commit and push carriers", () => {
    expect(AGENT_CARRIER_PATH).toBe(`${CARRIER_HOOKS_FOLDER}/post-tool`);
    expect(AGENT_CARRIER_PROGRAM_PATH).toBe(`${AGENT_CARRIER_PATH}.mjs`);
  });

  it("runs the gate runner at post-tool for a caller with no checks of its own", () => {
    const program = agentCarrierProgram();

    expect(program).toContain(JSON.stringify(CARRIER_RUNNER_PATH));
    expect(program).toContain('"--moment=post-tool", "--builtins=none"');
  });

  it("stops the checks before the agent stops the hook", () => {
    expect(CARRIER_LIMIT_SECONDS).toBeLessThan(AGENT_HOOK_TIMEOUT_SECONDS);
    expect(agentCarrierProgram()).toContain(
      `const LIMIT_SECONDS = ${CARRIER_LIMIT_SECONDS};`
    );
  });

  it("asks for Node before anything else, in words", () => {
    const entry = agentCarrierEntry();

    expect(entry.startsWith("#!/bin/sh\n# >>> lisa-carrier post-tool\n")).toBe(
      true
    );
    expect(entry.indexOf("command -v node")).toBeLessThan(
      entry.indexOf("exec node")
    );
    expect(entry).toContain("Write refused: Node.js is missing");
  });

  it.each(withSurface().filter(agent => agent !== "opencode"))(
    "is started for %s by a command that names the agent and refuses when the carrier is gone",
    agent => {
      const command = agentHookCommand(agent as (typeof CODING_AGENTS)[number]);

      expect(command).toContain(`/${AGENT_CARRIER_PATH}"`);
      expect(command.endsWith(`exec sh "$f" ${agent}`)).toBe(true);
      expect(command).toContain("Write refused: ");
      expect(command).toContain(`--agents=${agent}`);
    }
  );
});

/**
 * Tell whether a file is written from the repository root, with no step out
 * of it.
 * @param file - The file
 * @returns Whether it stays inside the repository
 */
function path(file: string): boolean {
  return !file.startsWith("/") && !file.split("/").includes("..");
}
