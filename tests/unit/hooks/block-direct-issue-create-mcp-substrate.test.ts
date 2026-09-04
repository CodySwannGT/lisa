/**
 * Substrate coverage for `block-direct-issue-create.sh`.
 *
 * The filing contract was enforced on `Bash` and unenforced everywhere else.
 * The guard was registered `matcher: "Bash"` AND gated internally on
 * `tool_name != "Bash"`, so an MCP tool call was refused entry twice over and
 * the same undeclared creation was blocked as shell text and allowed as a tool
 * call.
 *
 * ## Why this suite exists in the form it does
 *
 * **A green run in this repository proves nothing about the defect.** No
 * issue-creating MCP is provisioned here — every filing this guard has ever
 * observed went through `curl` or `gh` — so the failing input is unreachable
 * from the environment the fix is written in. That is the precondition-
 * satisfied-by-construction trap, pointing in the direction that hides the
 * defect. The only evidence that can exist here is a synthetic MCP-shaped
 * `PreToolUse` payload driven through the guard, which is what every case below
 * does.
 *
 * ## The load-bearing distinction
 *
 * Widening the matcher ALONE would have changed nothing: the call would arrive
 * and the internal gate would still exit 0. A fix that edited only
 * `plugin.json` would have shipped a registration change, seen no test fail,
 * and closed the ticket on a guard that still allows every MCP filing. So the
 * `Bash substrate is unchanged` group is not a formality — it is the half that
 * proves the internal change did not come at the cost of the working path.
 *
 * ## Recognition is by SHAPE, and the residual is stated
 *
 * Creation-shaped tool names are matched by shape (a create-ish verb plus a
 * work-item noun), never by an enumerated list of server tool names: those are
 * supplied by whoever wrote the server and change when one is added or
 * renamed. A server whose creation tool carries neither (`mcp__x__file_work`)
 * is not recognised and is allowed — a fail-open, and the honest cost of
 * refusing to enumerate. `refuses a creation-shaped name this suite never
 * enumerated` is the row that keeps the shape test honest.
 * @module tests/unit/hooks/block-direct-issue-create-mcp-substrate
 */
import { describe, expect, it } from "vitest";

import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  projectWithTracker,
  runHook,
} from "./support/direct-issue-create.js";

/** A GitHub-tracked project whose build-ready role is a label. */
const project = projectWithTracker();

/** `it.each` titles, named because the same table shape recurs. */
const REFUSES = "refuses %s";
const ALLOWS = "allows %s";

/**
 * An MCP-shaped PreToolUse payload.
 * @param tool - The MCP tool name.
 * @param input - The structured arguments.
 * @returns The payload object.
 */
const mcp = (tool: string, input: Record<string, unknown>) => ({
  tool_name: tool,
  tool_input: input,
});

/**
 * Drive the guard against the fixture project.
 * @param payload - The PreToolUse payload.
 * @returns The exit status; 2 means refused.
 */
const run = (payload: unknown): number | null =>
  runHook(payload, { cwd: project }).status;

describe("block-direct-issue-create.sh substrates", () => {
  describe("refuses an undeclared creation through an MCP tool", () => {
    it.each([
      [
        "a Linear create",
        mcp("mcp__linear-server__create_issue", {
          title: "x",
          teamId: "T",
          description: "no role anywhere",
        }),
      ],
      [
        "a GitHub create",
        mcp("mcp__github__create_issue", {
          owner: "o",
          repo: "r",
          title: "x",
          body: "no role",
        }),
      ],
      [
        "a JIRA create",
        mcp("mcp__atlassian__createJiraIssue", {
          projectKey: "P",
          summary: "x",
        }),
      ],
      [
        "a creation-shaped name this suite never enumerated",
        mcp("mcp__some-future-server__add_work_item", { title: "x" }),
      ],
    ])(REFUSES, (_label, payload) => {
      expect(run(payload)).toBe(EXIT_BLOCKED);
    });

    it("names the substrate in the refusal", () => {
      const { stderr } = runHook(
        mcp("mcp__github__create_issue", { title: "x" }),
        { cwd: project }
      );
      expect(stderr).toContain("mcp__github__create_issue");
    });

    it("fails closed on a creation-shaped call whose payload is unreadable", () => {
      // Silence about a filing the guard could not inspect is this ticket's
      // own defect one substrate over.
      expect(
        run({
          tool_name: "mcp__github__create_issue",
          tool_input: "not-an-object",
        })
      ).toBe(EXIT_BLOCKED);
    });
  });

  describe("allows a DECLARED creation through an MCP tool", () => {
    // The rejection controls for the group above. Without these, that group is
    // satisfied by a guard that refuses every MCP call.
    it.each([
      [
        "the ready role in a labels array",
        mcp("mcp__github__create_issue", {
          owner: "o",
          repo: "r",
          title: "x",
          labels: ["status:ready"],
        }),
      ],
      [
        "the ready role nested in a state object",
        mcp("mcp__linear-server__create_issue", {
          title: "x",
          state: { name: "status:ready" },
        }),
      ],
      [
        "a human-gate marker in the body",
        mcp("mcp__github__create_issue", {
          title: "x",
          body: "Held. <!-- [lisa-human-gate] reason=pricing -->",
        }),
      ],
    ])(ALLOWS, (_label, payload) => {
      expect(run(payload)).toBe(EXIT_ALLOWED);
    });
  });

  describe("allows MCP calls that are not work-item creations", () => {
    // The lesson from the over-blocking half of this guard's history: a guard
    // that refuses everything adjacent to a tracker is a guard someone turns
    // off. Reading, updating and commenting are not filings.
    it.each([
      ["an issue read", mcp("mcp__github__get_issue", { issue_number: 1 })],
      ["an issue update", mcp("mcp__linear-server__update_issue", { id: "X" })],
      ["a comment create", mcp("mcp__github__create_comment", { body: "hi" })],
      ["a search", mcp("mcp__linear-server__list_issues", { teamId: "T" })],
      [
        "a pull-request create",
        mcp("mcp__github__create_pull_request", { title: "x" }),
      ],
    ])(ALLOWS, (_label, payload) => {
      expect(run(payload)).toBe(EXIT_ALLOWED);
    });
  });

  describe("allows ordinary tool calls, which it now sees all of", () => {
    // This hook is registered `matcher: ""` — every tool call reaches it. These
    // rows are the population that must never notice.
    it.each([
      ["Read", { tool_name: "Read", tool_input: { file_path: "/etc/hosts" } }],
      ["Grep", { tool_name: "Grep", tool_input: { pattern: "x" } }],
      // Repo-relative rather than a temp path: nothing here is ever written —
      // these are payload shapes the guard must ignore — and a world-writable
      // directory in a fixture trips the publicly-writable-directories rule.
      [
        "Edit",
        { tool_name: "Edit", tool_input: { file_path: "src/index.ts" } },
      ],
      [
        "Write",
        { tool_name: "Write", tool_input: { file_path: "src/index.ts" } },
      ],
      ["Glob", { tool_name: "Glob", tool_input: { pattern: "*" } }],
      ["TodoWrite", { tool_name: "TodoWrite", tool_input: { todos: [] } }],
      ["Task", { tool_name: "Task", tool_input: { prompt: "x" } }],
      ["an MCP tool with no creation shape", mcp("mcp__sentry__get_issue", {})],
    ])(ALLOWS, (_label, payload) => {
      expect(run(payload)).toBe(EXIT_ALLOWED);
    });
  });

  describe("leaves the Bash substrate unchanged", () => {
    // The differential. Every one of these had the same verdict before the
    // substrate change, and a change to the shell path would show up here.
    it("still refuses an undeclared shell creation", () => {
      expect(run(bash('gh issue create --title "x"'))).toBe(EXIT_BLOCKED);
    });

    it("still allows a declared shell creation", () => {
      expect(
        run(bash('gh issue create --title "x" --label status:ready --repo o/r'))
      ).toBe(EXIT_ALLOWED);
    });

    it("still allows an ordinary shell command", () => {
      expect(run(bash("git status"))).toBe(EXIT_ALLOWED);
    });

    it("still allows a read-only command naming a file", () => {
      expect(run(bash("wc -l /etc/hosts"))).toBe(EXIT_ALLOWED);
    });
  });

  describe("honours the operator escape on both substrates", () => {
    it.each([
      ["an MCP creation", mcp("mcp__github__create_issue", { title: "x" })],
      ["a shell creation", bash('gh issue create --title "x"')],
    ])("allows %s when the override is exported", (_label, payload) => {
      expect(
        runHook(payload, {
          cwd: project,
          env: { LISA_ALLOW_DIRECT_ISSUE_CREATE: "1" },
        }).status
      ).toBe(EXIT_ALLOWED);
    });
  });
});
