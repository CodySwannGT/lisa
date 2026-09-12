/**
 * The filing guard reaches agy's STRUCTURED substrate, not just its shell one
 * (CodySwannGT/lisa#3785).
 *
 * CodySwannGT/lisa#3753 taught the canonical guard that a creation also arrives
 * as NAMED FIELDS rather than as a command line, and closed that substrate on
 * Claude. The agy port forwarded `run_command` and nothing else, and its
 * registration matched `run_command` only, so on agy the second substrate was
 * refused entry twice over — the same double gate #3753 had to open on Claude,
 * one agent across.
 *
 * ## The envelope these cases use was CAPTURED, not invented
 *
 * The ticket's own first deliverable. A probe plugin registered with an empty
 * matcher, driven through `agy --dangerously-skip-permissions -p` against a
 * local MCP server exposing one `create_issue` tool, on agy 1.1.3:
 *
 *   {"toolCall":{"name":"call_mcp_tool","args":{
 *      "ServerName":"probe-tracker","ToolName":"create_issue",
 *      "Arguments":{"title":"envelope probe","body":"capture"},
 *      "toolAction":"...","toolSummary":"..."}}}
 *
 * Two properties of it decide these cases, and a plausible guess gets both
 * wrong. EVERY MCP call arrives under the one generic name `call_mcp_tool`, so
 * forwarding agy's outer name verbatim hands the canonical guard a name with no
 * tracker noun in it and the shape gate allows the lot — measured, before the
 * fix. And the arguments live under `Arguments`, beside agy's own `toolAction`
 * / `toolSummary` prose, so a translation that forwarded the whole `args` would
 * let a summary sentence answer for the filing.
 *
 * ## Why a green run here is not the proof on its own
 *
 * No issue-creating MCP is provisioned in CI, so the failing input is
 * unreachable from where this suite runs, in the direction that hides the
 * defect: a suite that passes because nothing exercised the path looks exactly
 * like one that passes because the guard works. So every acceptance case has a
 * rejection control beside it — an adapter that denied everything would satisfy
 * the refusals and fail the allows — and the shell substrate's verdicts are
 * asserted unchanged as their own group.
 *
 * The end-to-end run that a unit suite cannot do was done by hand once, and is
 * recorded in the pull request: the real adapter, installed as an agy plugin
 * with the widened matcher, refused a real `create_issue` MCP call from agy and
 * allowed the same call carrying the ready role.
 *
 * EVERY CASE RUNS AGAINST A SYNTHETIC HOST PROJECT. The canonical guard stands
 * down inside Lisa's own repository, so a run rooted here reports `allow` for
 * everything and would pass against an adapter that does nothing at all.
 * @module tests/unit/agy/block-direct-issue-create-structured-agy
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const SCRIPT = path.join(
  process.cwd(),
  "plugins/src/base/hooks/block-direct-issue-create.agy.sh"
);
const BASH_PATH = "/bin/bash";
const READY_ROLE = "status:ready";

let host = "";

beforeAll(() => {
  host = mkdtempSync(path.join(tmpdir(), "lisa-agy-filing-"));
  writeFileSync(
    path.join(host, ".lisa.config.json"),
    JSON.stringify({
      github: { labels: { build: { ready: READY_ROLE } }, org: "o", repo: "r" },
      tracker: "github",
    }),
    "utf-8"
  );
});

/**
 * Run the adapter as the host project and return agy's own response object.
 * @param stdin - The agy PreToolUse payload.
 * @returns The parsed agy decision.
 */
const run = (
  stdin: string
): { readonly decision: string; readonly reason?: string } => {
  const result = boundedSpawnSync({
    label: "the agy block-direct-issue-create hook",
    args: [SCRIPT],
    command: BASH_PATH,
    cwd: host,
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: host,
      LISA_ALLOW_DIRECT_ISSUE_CREATE: "",
    },
    input: stdin,
  });
  return JSON.parse(result.stdout) as { decision: string; reason?: string };
};

/**
 * Run the adapter and return only agy's decision.
 * @param stdin - The agy PreToolUse payload.
 * @returns The `decision` field agy would act on.
 */
const decide = (stdin: string): string => run(stdin).decision;

/**
 * An agy `call_mcp_tool` payload, in the captured shape.
 * @param toolName - The MCP tool the model asked for.
 * @param args - The arguments it passed.
 * @returns The stdin payload.
 */
const mcpCall = (
  toolName: string,
  args: Readonly<Record<string, unknown>>
): string =>
  JSON.stringify({
    toolCall: {
      args: {
        Arguments: args,
        ServerName: "probe-tracker",
        ToolName: toolName,
        toolAction: `Calling probe-tracker ${toolName}`,
        toolSummary: `Run ${toolName}`,
      },
      name: "call_mcp_tool",
    },
  });

/**
 * An agy `run_command` payload — the shell substrate, unchanged by this work.
 * @param commandLine - The shell command agy is about to run.
 * @returns The stdin payload.
 */
const shellCall = (commandLine: string): string =>
  JSON.stringify({
    toolCall: { args: { CommandLine: commandLine }, name: "run_command" },
  });

describe("block-direct-issue-create.agy.sh, structured substrate", () => {
  it("denies an undeclared creation through agy's MCP tool surface", () => {
    expect(decide(mcpCall("create_issue", { body: "b", title: "t" }))).toBe(
      "deny"
    );
  });

  it("carries the canonical refusal through to agy", () => {
    // The adapter translates protocols and nothing else, so the operator has
    // to see the canonical refusal — the same two sanctioned paths the shell
    // refusal names — rather than an adapter-shaped summary of it.
    const { reason } = run(mcpCall("create_issue", { title: "t" }));
    expect(reason).toContain("/lisa:track");
    expect(reason).toContain("[lisa-human-gate]");
    expect(reason).toContain(READY_ROLE);
  });

  it("names the MCP tool the model actually asked for, not agy's wrapper", () => {
    // The refusal has to be actionable, and `call_mcp_tool` names nothing an
    // operator can act on. This is also the assertion that fails if the
    // adapter ever forwards agy's outer name verbatim — the translation that
    // would silently ALLOW every filing, because that name carries no tracker
    // noun for the canonical guard's shape gate to catch.
    const { reason } = run(mcpCall("create_issue", { title: "t" }));
    expect(reason).toContain("mcp__probe-tracker__create_issue");
    expect(reason).not.toContain("through call_mcp_tool");
  });

  // ── Rejection controls ────────────────────────────────────────────────────
  // An adapter that answered `deny` to every structured call satisfies every
  // case above. These are what separate a working translation from a refusal
  // machine, and they are the half the acceptance criteria call out by name.
  describe("rejection controls", () => {
    it.each([
      ["a label array", { labels: [READY_ROLE], title: "t" }],
      [
        "a packed label string",
        { labels: `${READY_ROLE},type:Bug`, title: "t" },
      ],
      [
        "a human-gate marker in the body",
        { body: "<!-- [lisa-human-gate] reason=pending -->", title: "t" },
      ],
    ])("allows a creation declaring readiness through %s", (_label, args) => {
      expect(decide(mcpCall("create_issue", args))).toBe("allow");
    });

    it.each([
      ["update_issue", { id: "1", title: "t" }],
      ["add_comment", { body: "hi", id: "1" }],
      ["search_issues", { query: "is:open" }],
      ["get_issue", { id: "1" }],
    ])("allows the non-creation MCP tool %s", (toolName, args) => {
      expect(decide(mcpCall(toolName, args))).toBe("allow");
    });

    it("allows agy's own non-shell tools", () => {
      // Every tool now reaches the adapter, so the tools agy uses constantly
      // are the population that would feel a false refusal first.
      expect(
        decide(
          JSON.stringify({
            toolCall: {
              args: { AbsolutePath: "/etc/hosts" },
              name: "view_file",
            },
          })
        )
      ).toBe("allow");
    });

    it("reads the declaration from Arguments, not from agy's own prose", () => {
      // `toolSummary` is agy's sentence about the call, not part of what the
      // call submits. A translation that forwarded the whole `args` blob would
      // let this pass; the tracker would receive no role at all.
      expect(
        decide(
          JSON.stringify({
            toolCall: {
              args: {
                Arguments: { title: "t" },
                ServerName: "probe-tracker",
                ToolName: "create_issue",
                toolSummary: `Create a ${READY_ROLE} issue`,
              },
              name: "call_mcp_tool",
            },
          })
        )
      ).toBe("deny");
    });
  });

  // ── The registration, which had to move with the adapter ──────────────────
  // The lesson CodySwannGT/lisa#3753 wrote into the canonical guard's own
  // header: widening the classifier while the registration still admits one
  // tool changes nothing, no test fails, and a guard ships that still allows
  // every structured filing. On agy the registration is the emitted
  // `hooks.json`, so that is what this reads.
  describe("registration", () => {
    it("registers the guard for every tool agy can call, not the shell alone", () => {
      const registered = JSON.parse(
        readFileSync(
          path.join(process.cwd(), "plugins/lisa-agy/hooks.json"),
          "utf-8"
        )
      ) as Record<string, { PreToolUse?: { matcher?: string }[] }>;
      const entry =
        registered["lisa-block-direct-issue-create"]?.PreToolUse?.[0];
      // agy compiles the matcher as a regex and documents `""` (and `"*"`) as
      // "matches all tools"; `run_command` matches exactly that one tool, and
      // an MCP creation arrives as `call_mcp_tool`.
      expect(entry?.matcher).not.toBe("run_command");
      expect(
        new RegExp(entry?.matcher ?? "(?!)", "u").test("call_mcp_tool")
      ).toBe(true);
      // The shell surface must survive the widening — the same assertion the
      // acceptance criteria make about verdicts, one level down.
      expect(
        new RegExp(entry?.matcher ?? "(?!)", "u").test("run_command")
      ).toBe(true);
    });
  });

  // ── The shell substrate, asserted unchanged ───────────────────────────────
  // Its own group because the acceptance criteria make it one: the widening
  // must not move a single shell verdict on this agent.
  describe("the shell substrate is unchanged", () => {
    it("still denies an undeclared shell creation", () => {
      expect(decide(shellCall("gh issue create --title x"))).toBe("deny");
    });

    it("still allows a declared shell creation", () => {
      expect(
        decide(shellCall(`gh issue create --title x --label ${READY_ROLE}`))
      ).toBe("allow");
    });

    it("still allows an ordinary shell command", () => {
      expect(decide(shellCall("git status"))).toBe("allow");
    });
  });
});
