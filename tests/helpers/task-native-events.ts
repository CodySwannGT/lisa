/** Runtime-envelope component driver. Only the actual native decision controls effects. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { taskFixture } from "./task-readiness-fixture.js";
import { boundedSpawnSync } from "./io-latency-budget.js";
export const DATABASE = "11111111-1111-4111-8111-111111111111";
export const WORKSPACE = "22222222-2222-4222-8222-222222222222";
export const USER = "33333333-3333-4333-8333-333333333333";
export const notionRequirement = {
  id: "database-access",
  kind: "capability",
  credential_names: ["NOTION_API_TOKEN"],
  access_layer: "notion",
  operation: "database-read",
  resource: DATABASE,
};
export const executableRequirement = {
  id: "api-access",
  kind: "capability",
  credential_names: ["GITGUARDIAN_API_KEY"],
  access_layer: "gitguardian",
  operation: "token-read",
  resource: "42",
};
const server = { name: "claude_ai_Notion", source: "claudeai" };
/** Supply a rejected fetch variant without changing the continuation oracle.
 * @param mode - Rejection scenario.
 * @returns Synthetic output for the actual result validator.
 */
export function rejectedFetch(mode: string): unknown {
  if (mode === "wrong-resource")
    return {
      ...fetchResult(),
      content: [
        {
          type: "resource",
          resource: {
            ...fetchResult().content[0]!.resource,
            uri: "https://www.notion.so/55555555-5555-4555-8555-555555555555",
          },
        },
      ],
    };
  const variants: Record<string, unknown> = {
    error: { isError: true, content: [] },
    missing: { isError: false, content: [] },
    arbitrary: { isError: false, content: [{ type: "text", text: "success" }] },
    chatgpt: {
      isError: false,
      structuredContent: {
        id: "supplied",
        title: "title",
        text: "body",
        url: "url",
        metadata: {},
      },
    },
  };
  return variants[mode] ?? fetchResult();
}

/** Write the synthetic task declaration after all driver definitions exist.
 * @param f - Owned fixture.
 * @param extraPending - Include an independently unsupported native obligation.
 */
function configure(f: ReturnType<typeof taskFixture>, extraPending: boolean) {
  writeFileSync(
    path.join(f.root, ".lisa.config.json"),
    JSON.stringify({
      source: "notion",
      notion: { workspaceId: WORKSPACE, prdDatabaseId: DATABASE },
      gitguardian: { workspaceId: 42 },
      sentry: { org: "fixture", project: "project" },
      secrets: {
        provider: "bitwarden",
        namespace: "fixture",
        bootstrap: { sources: ["env"], key: "FIXTURE_BOOTSTRAP" },
      },
    })
  );
  f.refresh([
    executableRequirement,
    notionRequirement,
    ...(extraPending
      ? [
          {
            id: "observability",
            kind: "capability",
            credential_names: ["SENTRY_AUTH_TOKEN"],
            access_layer: "sentry",
            operation: "list-issues",
            resource: "fixture/project",
          },
        ]
      : []),
  ]);
}

/** Install real owners and synthetic external boundaries.
 * @param extraPending - Include an unsupported second native scope.
 * @returns Actual before/after driver and mutable effect recorder.
 */
export function nativeFixture(extraPending = false) {
  const f = taskFixture(false, true, {
    GITGUARDIAN_API_KEY: "synthetic-injected",
  });
  const recorder = path.join(f.root, "native-effects.json");
  const event = (
    tool: string,
    input: Record<string, unknown>,
    mcp = false
  ) => ({
    hook_event_name: "PreToolUse",
    cwd: f.root,
    session_id: "synthetic-native-session",
    tool_use_id: `call-${randomUUID()}`,
    tool_name: tool,
    tool_input: input,
    ...(mcp ? { mcp_server: server } : {}),
  });
  const action = () =>
    event("Write", {
      file_path: path.join(f.root, "product.txt"),
      content: "synthetic",
    });
  const self = () => event("mcp__claude_ai_Notion__notion-get-self", {}, true);
  const fetch = () =>
    event("mcp__claude_ai_Notion__notion-fetch", { id: DATABASE }, true);
  /** Drive exactly the shipped before/after command; no warning/outcome suppression.
   * @param input - Native envelope.
   * @param response - Native response for an after event.
   * @returns Real command outcome and recorder state.
   */
  const run = (input: ReturnType<typeof event>, response?: unknown) => {
    const before = input.hook_event_name === "PreToolUse";
    const r = boundedSpawnSync({
      label: "actual native readiness envelope",
      command: "/bin/bash",
      args: [
        path.join(f.plugin, "hooks/secrets-preflight.sh"),
        before ? "--task-hook" : "--observe-native",
      ],
      cwd: f.root,
      env: f.env,
      input: JSON.stringify({
        ...input,
        ...(response === undefined ? {} : { tool_response: response }),
      }),
    });
    if (
      before &&
      ["Write", "Bash", "mcp__github__claimIssue"].includes(input.tool_name) &&
      r.status === 0
    ) {
      const prior = JSON.parse(readFileSync(recorder, "utf8"));
      writeFileSync(recorder, JSON.stringify({ calls: prior.calls + 1 }));
    }
    return { ...r, effects: JSON.parse(readFileSync(recorder, "utf8")).calls };
  };
  const after = (input: ReturnType<typeof event>, response: unknown) =>
    run({ ...input, hook_event_name: "PostToolUse" }, response);
  configure(f, extraPending);
  writeFileSync(recorder, '{"calls":0}');
  return { ...f, event, action, self, fetch, runEvent: run, after, recorder };
}
export const selfResult = () => ({
  isError: false,
  structuredContent: {
    workspace: { id: WORKSPACE, name: "fixture" },
    user: { id: USER, type: "bot", name: "fixture" },
  },
});
/** Standard MCP embedded resource, not fabricated REST database fields.
 * @returns Recognized positive synthetic producer output.
 */
export const fetchResult = () => ({
  isError: false,
  content: [
    {
      type: "resource",
      resource: {
        uri: `https://www.notion.so/${DATABASE}`,
        mimeType: "text/markdown",
        text: "# Synthetic database",
      },
    },
  ],
});
