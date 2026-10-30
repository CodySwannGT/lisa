/** Full existing intake route before header, followed by private native Write data. */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { taskFixture } from "../../helpers/task-readiness-fixture.js";
import { nativeBash } from "../../helpers/task-native-bash.js";
import { nativeWrite } from "../../helpers/task-native-context.js";
import {
  intakeCommands,
  intakeRaw,
  installIntakeGh,
} from "../../helpers/task-intake-gh.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { readConfig } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";
import { requirementsContext } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/task-requirements.mjs";
import {
  queries,
  reviewThreadsQuery,
  threadCommentsQuery,
} from "../../../plugins/src/base/skills/lisa-github-read-issue/read-contract.mjs";
import { classifyReadyCandidate } from "../../../plugins/src/base/scripts/intake-blocker-reprobe.mjs";
const roots: string[] = [];
const CONTEXT = ".lisa/work-item-context.md",
  REF = "fixture/project#1";
/** Fresh configured project without a context or binding.
 * @returns Owned installed fixture.
 */
function fresh() {
  const f = taskFixture(true, true, { GITGUARDIAN_API_KEY: "synthetic-value" });
  roots.push(f.root);
  rmSync(path.join(f.root, CONTEXT));
  return f;
}
/** Feed a real fixed native owner request.
 * @param f - Owned fixture.
 * @param tool - Actual tool name.
 * @param data - Native input.
 * @returns Actual before decision.
 */
function envelope(f: ReturnType<typeof fresh>, tool: string, data: object) {
  return boundedSpawnSync({
    label: "fresh intake owner envelope",
    command: "/bin/bash",
    args: [path.join(f.plugin, "hooks/secrets-preflight.sh"), "--task-hook"],
    cwd: f.root,
    env: f.env,
    input: JSON.stringify({
      hook_event_name: "PreToolUse",
      cwd: f.root,
      session_id: "fresh-intake",
      tool_name: tool,
      tool_input: data,
    }),
  });
}
afterEach(() =>
  roots
    .splice(0)
    .forEach(root => rmSync(root, { recursive: true, force: true }))
);
describe("realizable fresh native intake", () => {
  it.each([
    "lisa-implement",
    "lisa-track",
    "lisa-tracker-read",
    "lisa-github-read-issue",
    "lisa-secrets-access",
  ])("loads existing owning Skill %s before any header", skill => {
    const f = fresh();
    expect(envelope(f, "Skill", { skill }).status).toBe(0);
    expect(existsSync(path.join(f.root, CONTEXT))).toBe(false);
  });
  it("does not turn an unknown configured tracker into an arbitrary Skill admission", () => {
    const f = fresh();
    writeFileSync(
      path.join(f.root, ".lisa.config.local.json"),
      JSON.stringify({ tracker: "untrusted" })
    );
    expect(
      envelope(f, "Skill", { skill: "lisa-untrusted-read-issue" }).status
    ).toBe(2);
  });
  it("follows the actual Track -> tracker-read -> GitHub complete documented route before private preparation", () => {
    const f = fresh();
    for (const skill of [
      "lisa-implement",
      "lisa-track",
      "lisa-tracker-read",
      "lisa-github-read-issue",
    ])
      expect(envelope(f, "Skill", { skill, args: REF }).status).toBe(0);
    expect(
      envelope(f, "Agent", {
        name: "input-resolver",
        subagent_type: "general-purpose",
        description: "Resolve Lisa input",
        prompt: `Invoke lisa-track ${REF}; resolve the complete live issue, comments and graph; prepare requirements and prove access before any claim. Do not implement or change source.`,
      }).status
    ).toBe(0);
    installIntakeGh(f);
    const outputs = intakeCommands.map(command => {
      const r = nativeBash(f, command);
      expect(r.guard.status, command).toBe(0);
      expect(r.tool?.status, command).toBe(0);
      expect(existsSync(path.join(f.root, CONTEXT))).toBe(false);
      return { command, request: r.request, raw: String(r.tool?.stdout) };
    });
    const primary = JSON.parse(outputs[0]!.raw),
      comments = JSON.parse(outputs[1]!.raw),
      total = JSON.parse(outputs[2]!.raw);
    expect(comments).toHaveLength(total);
    expect(comments).toEqual(intakeRaw.comments.flat());
    const graph = JSON.parse(outputs[3]!.raw),
      history = JSON.parse(outputs[4]!.raw);
    expect(graph[0].data.repository.issue.parent).toBeNull();
    expect(graph[0].data.repository.issue.subIssues.nodes).toEqual([]);
    expect(history).toHaveLength(2);
    const threads = JSON.parse(outputs[11]!.raw),
      threadComments = JSON.parse(outputs[12]!.raw);
    expect(
      threads[0].data.repository.pullRequest.reviewThreads.nodes[0].comments
        .pageInfo.hasNextPage
    ).toBe(true);
    expect(threadComments[0].data.node.comments.pageInfo.hasNextPage).toBe(
      false
    );
    expect(
      history[1].data.repository.issue.timelineItems.pageInfo.hasNextPage
    ).toBe(false);
    expect(
      classifyReadyCandidate({
        labels: primary.labels,
        body: primary.body,
        comments,
        trustedHumanActorIds: ["17"],
      }).claimable
    ).toBe(true);
    expect(
      classifyReadyCandidate({
        labels: primary.labels,
        body: primary.body,
        comments: comments.slice(0, 1),
        trustedHumanActorIds: ["17"],
      }).claimable
    ).toBe(false);
    const body = JSON.stringify({
      primary,
      comments,
      complete_raw_reads: outputs.map(o => ({
        command: o.command,
        raw: o.raw,
      })),
    });
    const header = requirementsContext(
      readConfig(f.root),
      REF,
      "github",
      [
        {
          id: "scan",
          kind: "capability",
          credential_names: ["GITGUARDIAN_API_KEY"],
          access_layer: "gitguardian",
          operation: "token-read",
          resource: "42",
        },
      ],
      body
    );
    const r = nativeWrite(f, header);
    expect(r.guard.status).toBe(2);
    expect(r.rawWrites).toBe(0);
    const bytes = readFileSync(path.join(f.root, CONTEXT), "utf8");
    expect(bytes.slice(bytes.indexOf("\n-->\n") + 5)).toBe(body);
    const continuation = f.run();
    expect(continuation.counters.code).toBe(1);
    console.info(
      "QUALIFICATION_OBSERVATION",
      JSON.stringify({
        case: "canonical-fresh-intake",
        reads: outputs.length,
        comments: comments.length,
        total,
        history_pages: history.length,
        rawWrite: r.rawWrites,
        metadata_exit: r.guard.status,
        effects: continuation.counters,
      })
    );
    if (process.env.LISA_READINESS_FIXTURE_CAPTURE) {
      for (const [name, value] of [
        ["fresh-complete-reads.json", JSON.stringify(outputs)],
        ["fresh-native-request.json", JSON.stringify(r.request)],
        ["fresh-context.md", bytes],
        [
          "fresh-metadata-result.json",
          JSON.stringify({
            exit: r.guard.status,
            stdout: String(r.guard.stdout),
            stderr: String(r.guard.stderr),
            rawWrites: r.rawWrites,
          }),
        ],
      ])
        writeFileSync(
          path.join(process.env.LISA_READINESS_FIXTURE_CAPTURE, name!),
          value!,
          { flag: "wx", mode: 0o600 }
        );
    }
  });
  it("ships the same exact paginated read-only graph/history queries in the owning instructions", () => {
    const skill = readFileSync(
      path.resolve(
        __dirname,
        "../../../plugins/src/base/skills/lisa-github-read-issue/SKILL.md"
      ),
      "utf8"
    );
    for (const query of [...queries, reviewThreadsQuery, threadCommentsQuery])
      expect(skill).toContain(query);
    expect(skill).toContain("--paginate --slurp");
  });
  it.each([
    "mutation",
    "query-suffix",
    "missing-pagination",
    "shell-suffix",
    "wrong-repo",
    "claim",
    "branch",
    "source",
    "generic-agent",
    "generic-skill",
  ])("denies %s before header without any unrelated effects", mode => {
    const f = fresh(),
      commands: Record<string, string> = {
        mutation:
          "gh api graphql -f query='mutation{deleteIssue(input:{issueId:\"x\"}){clientMutationId}}'",
        "query-suffix": `${intakeCommands[3]}; touch source.ts`,
        "missing-pagination": intakeCommands[3]!.replace(
          "--paginate --slurp ",
          ""
        ),
        "shell-suffix": `${intakeCommands[0]} && touch source.ts`,
        "wrong-repo": intakeCommands[0]!.replace(
          "fixture/project",
          "other/project"
        ),
        claim: "gh issue edit 1 --repo fixture/project --add-assignee fixture",
        branch: "git checkout -b branch",
        source: "printf x > source.ts",
      };
    if (mode === "generic-agent")
      expect(
        envelope(f, "Agent", { name: "other", prompt: "implement" }).status
      ).toBe(2);
    else if (mode === "generic-skill")
      expect(envelope(f, "Skill", { skill: "lisa-github-claim" }).status).toBe(
        2
      );
    else {
      const r = nativeBash(f, commands[mode]!);
      expect(r.guard.status).toBe(2);
      expect(r.tool).toBeNull();
    }
    expect(existsSync(path.join(f.root, CONTEXT))).toBe(false);
    expect(existsSync(path.join(f.root, "source.ts"))).toBe(false);
  });
  it.each([
    "literal",
    "suffix",
    "unquoted",
    "alternate",
    "wrong-ref",
    "source-write",
  ])("refuses unsafe full-body Bash route %s", mode => {
    const f = fresh(),
      literal = `node '${path.join(f.plugin, "skills/lisa-secrets-access/scripts/preflight-secrets.mjs")}' --prepare --ref ${REF} <<'LISA_REQUIREMENTS_JSON'\n${JSON.stringify({ requirements_complete: true, required_access: [], context_body: "Private whole body" })}\nLISA_REQUIREMENTS_JSON`;
    const commands: Record<string, string> = {
      literal,
      suffix: `${literal}; touch source.ts`,
      unquoted: literal.replace(
        "<<'LISA_REQUIREMENTS_JSON'",
        "<<LISA_REQUIREMENTS_JSON"
      ),
      alternate: literal.replace("node ", "node -e "),
      "wrong-ref": literal.replace(REF, "other/project#1"),
      "source-write": "printf x > source.ts",
    };
    const r = nativeBash(f, commands[mode]!);
    expect(r.guard.status).toBe(2);
    expect(r.tool).toBeNull();
    expect(existsSync(path.join(f.root, CONTEXT))).toBe(false);
    expect(existsSync(path.join(f.root, "source.ts"))).toBe(false);
  });
});
