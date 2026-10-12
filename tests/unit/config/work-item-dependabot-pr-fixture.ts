/** Execute both workflow-owned adapters: PR-head code is never a proof source. */
import { Evaluator, Lexer, Parser, data } from "@actions/expressions";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { runInNewContext } from "node:vm";
import { load } from "js-yaml";
import { expect, vi } from "vitest";

export const QUALITY_WORKFLOW = "quality.yml";
export const FILES = [QUALITY_WORKFLOW, "quality-rails.yml"] as const;
export const BASE = "a".repeat(40);
export const HEAD = "b".repeat(40);
const REPOSITORY = { id: 123, full_name: "example/project" };
const BOT = { id: 49699333, type: "Bot", login: "dependabot[bot]" };
export const VALIDATE_STEP = "Validate Work-Item";
export const URL = "https://github.com/example/project/pull/7";

/** Only the workflow fields executed by these controls. */
interface Step {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  with?: { script?: string };
}

/**
 * Keep event and authenticated provider responses independent.
 * @returns A genuine same-repository PR fixture, with mutable provider reads.
 */
export function fixture() {
  const pull = {
    number: 7,
    state: "open",
    merged: false,
    html_url: URL,
    user: { ...BOT },
    base: { sha: BASE, repo: { ...REPOSITORY } },
    head: { sha: HEAD, repo: { ...REPOSITORY } },
  };
  return {
    context: {
      serverUrl: "https://github.com",
      apiUrl: "https://api.github.com",
      eventName: "pull_request",
      repo: { owner: "example", repo: "project" },
      payload: {
        number: 7,
        repository: { ...REPOSITORY },
        pull_request: structuredClone(pull),
      },
    },
    config: JSON.stringify({
      workItem: { dependabotTracking: "pull-request" },
    }),
    pulls: [structuredClone(pull), structuredClone(pull)],
    contentSuffix: "",
    configError: 0,
    pullError: 0,
  };
}

/**
 * Read the actual reusable job, rather than a mirror of its implementation.
 * @param file - Workflow whose original steps are selected.
 * @returns The actual traceability job steps.
 */
export function steps(file: string): Step[] {
  const workflow = load(
    readFileSync(
      path.join(__dirname, "../../../.github/workflows", file),
      "utf8"
    )
  ) as {
    jobs: { work_item_traceability: { steps: Step[] } };
  };
  return workflow.jobs.work_item_traceability.steps;
}

/**
 * Execute Actions conditions with its own expression implementation.
 * @param condition - Actual workflow condition, absent means unconditional.
 * @param configured - Original gate resolver output.
 * @param qualified - The independently qualified adapter output.
 * @returns Whether this original workflow branch runs.
 */
export function runs(
  condition: string | undefined,
  configured: string,
  qualified: string
): boolean {
  if (!condition) return true;
  const outputs = (key: string, value: string) =>
    new data.Dictionary({
      key: "outputs",
      value: new data.Dictionary({ key, value: new data.StringData(value) }),
    });
  const context = new data.Dictionary({
    key: "steps",
    value: new data.Dictionary(
      { key: "gate", value: outputs("configured", configured) },
      { key: "dependabot_record", value: outputs("qualified", qualified) }
    ),
  });
  const expression = new Parser(
    new Lexer(condition).lex().tokens,
    ["steps"],
    []
  ).parse();
  return (
    new Evaluator(expression, context).evaluate().coerceString() === "true"
  );
}

/**
 * Run the extracted script with independent API responses and capture its proof.
 * @param file - Reusable workflow whose exact script runs.
 * @param input - Provider/event mutations for this one control.
 * @returns Outputs, bounded success log, and exact read request vectors.
 */
export async function execute(file: string, input = fixture()) {
  const script = steps(file).find(step => step.id === "dependabot_record")?.with
    ?.script;
  if (!script)
    return {
      outputs: {} as Record<string, string>,
      messages: [],
      warnings: [],
      calls: [],
    };
  const getContent = vi.fn(async (_args: Record<string, unknown>) => {
    if (input.configError)
      throw Object.assign(new Error("provider unavailable"), {
        status: input.configError,
        statusCode: input.configError,
      });
    return {
      data: {
        type: "file",
        encoding: "base64",
        size: Buffer.byteLength(input.config),
        content:
          Buffer.from(input.config).toString("base64") + input.contentSuffix,
      },
    };
  });
  const get = vi.fn(
    async (
      _args: Record<string, unknown>
    ): Promise<{
      data: ReturnType<typeof fixture>["pulls"][number] | undefined;
    }> => {
      if (input.pullError) throw new Error("provider unavailable");
      return { data: input.pulls[get.mock.calls.length - 1] };
    }
  );
  const setOutput = vi.fn((_key: string, _value: string) => undefined);
  const info = vi.fn((_message: string) => undefined);
  const warning = vi.fn((_message: string) => undefined);
  // eslint-disable-next-line sonarjs/code-eval -- executes only committed workflow text, never fixture or provider text
  await runInNewContext(`(async () => {${script}\n})()`, {
    Buffer,
    context: input.context,
    github: { rest: { repos: { getContent }, pulls: { get } } },
    core: { setOutput, info, warning },
  });
  return {
    outputs: Object.fromEntries(setOutput.mock.calls),
    messages: info.mock.calls.map(([message]) => message),
    warnings: warning.mock.calls.map(([message]) => message),
    calls: [
      ...getContent.mock.calls.map(([args]) => ({ api: "content", args })),
      ...get.mock.calls.map(([args]) => ({ api: "pull", args })),
    ],
  };
}

/**
 * No authenticated record means the original validator, not soft success.
 * @param file - Original workflow being exercised.
 * @param input - Refused provider/event proof.
 */
export async function assertRefused(
  file: string,
  input: ReturnType<typeof fixture>
): Promise<void> {
  const result = await execute(file, input);
  expect(result.outputs.qualified).toBe("false");
  expect(result.messages).toEqual([]);
  expect(result.warnings).toEqual([
    "Dependabot PR record not authenticated; original traceability validation remains required.",
  ]);
  expect(
    runs(
      steps(file).find(step => step.name?.includes(VALIDATE_STEP))?.if,
      "false",
      "false"
    )
  ).toBe(true);
  if (file === QUALITY_WORKFLOW)
    expect(
      runs(
        steps(file).find(step => step.name === "🔗 Run the traceability gate")
          ?.if,
        "true",
        "false"
      )
    ).toBe(true);
}
