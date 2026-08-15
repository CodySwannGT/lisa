/**
 * Harness shared by the ruleset-reconciliation test files.
 *
 * The `gh` runner is injected rather than mocked at the module boundary, so the
 * suite proves the real call shape — argument vectors and piped payloads — and
 * never touches the network. Extracted so each test file stays inside the
 * project's own max-lines gate.
 * @module tests/unit/scripts/lisa-reconcile-policy-fixtures
 */

import { vi } from "vitest";

import { reconcile } from "../../../all/copy-overwrite/scripts/lisa-reconcile-policy.mjs";
import { PULL_REQUEST, QUALITY } from "./lisa-gates-fixtures.js";

export const REPO = "acme/widgets";
export const LINT = `${QUALITY} / 🧹 Lint`;
export const TYPES = `${QUALITY} / 🔍 Type Check`;
export const SONAR = "SonarCloud Code Analysis";
export const ACTIONS_ID = 15368;

/** What the injected runner returns for one `gh` invocation. */
export type GhResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  missing?: boolean;
};

/** One recorded call, with the body piped to stdin when there was one. */
export type GhCall = { args: string[]; input?: string };

/** Canned responses, keyed by the call each one answers. */
export type GhState = {
  rulesets?: object[];
  index?: GhResult;
  detail?: GhResult;
  settings?: object | GhResult;
  write?: GhResult;
};

/**
 * A successful `gh` call returning JSON.
 * @param value - The body `gh` printed.
 * @returns The runner result.
 */
export const ok = (value: unknown): GhResult => ({
  ok: true,
  stdout: JSON.stringify(value),
  stderr: "",
});

/**
 * A failed `gh` call.
 * @param stderr - What `gh` wrote to stderr.
 * @returns The runner result.
 */
export const boom = (stderr: string): GhResult => ({
  ok: false,
  stdout: "",
  stderr,
});

/**
 * One entry shaped exactly as `liveContexts` produces it.
 *
 * Complete rather than minimal: a comparison fed a half-built context would
 * pass while the real one carried fields nothing had ever compared.
 * @param contexts - Contexts the ruleset requires.
 * @returns One live-context entry per name.
 */
export const liveEntries = (
  contexts: string[]
): {
  context: string;
  integration_id: number;
  ruleset: string;
  rulesetId: number;
}[] =>
  contexts.map(context => ({
    context,
    integration_id: ACTIONS_ID,
    ruleset: "base",
    rulesetId: 7,
  }));

/**
 * A live ruleset shaped like the one GitHub returns, read-only fields included.
 * @param contexts - Contexts the ruleset requires.
 * @param overrides - Fields to replace on the ruleset.
 * @returns The ruleset.
 */
export const baseRuleset = (
  contexts: string[],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: 7,
  name: "base",
  target: "branch",
  enforcement: "active",
  created_at: "2026-01-01",
  _links: { self: {} },
  rules: [
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: contexts.map(context => ({
          context,
          integration_id: ACTIONS_ID,
        })),
      },
    },
  ],
  ...overrides,
});

/**
 * A fake `gh` that records every call it was asked to make.
 * @param state - Canned responses.
 * @param state.rulesets - Rulesets the repository carries.
 * @param state.index - Override for the ruleset-index read.
 * @param state.detail - Override for every ruleset-detail read.
 * @param state.settings - Repository settings, or an override result.
 * @param state.write - Result every PUT/PATCH gets.
 * @returns The runner, whose `mock.calls` is the log.
 */
export const gitHub = (state: GhState) => {
  const rulesets = state.rulesets ?? [];
  // `vi.fn` keeps the call log — including the piped body, which it records
  // whether or not the implementation reads it — so the harness never has to
  // mutate an array of its own.
  return vi.fn(
    (args: string[], _options: { input?: string } = {}): GhResult => {
      const joined = args.join(" ");
      const detail = /rulesets\/(\d+)$/u.exec(joined);
      const settings = state.settings ?? {};

      if (joined.includes("-X PUT") || joined.includes("-X PATCH")) {
        return state.write ?? ok({});
      }
      if (joined === `api repos/${REPO}/rulesets`) {
        return state.index ?? ok(rulesets.map(entry => ({ ...entry })));
      }
      if (detail) {
        if (state.detail) return state.detail;
        const hit = rulesets.find(
          entry => String((entry as { id: number }).id) === detail[1]
        );
        return hit ? ok(hit) : boom("HTTP 404");
      }
      if (joined === `api repos/${REPO}`) {
        return "ok" in settings ? (settings as GhResult) : ok(settings);
      }
      return boom(`unexpected call: ${joined}`);
    }
  );
};

/**
 * The calls a fake runner recorded, in order.
 * @param calls - A fake runner's `mock.calls`.
 * @returns Each call's arguments and piped body.
 */
export const recorded = (calls: unknown[][]): GhCall[] =>
  calls.map(([args, options]) => ({
    args: args as string[],
    input: (options as { input?: string } | undefined)?.input,
  }));

/** Two required gates, so the derived context list is two entries long. */
export const GATES = {
  "code-style": { [PULL_REQUEST]: "required" },
  "type-correctness": { [PULL_REQUEST]: "required" },
};

/**
 * Reconcile against a fake repository.
 * @param state - Canned `gh` responses.
 * @param options - Overrides passed straight to `reconcile`.
 * @returns The result and every `gh` call it made.
 */
export const run = (state: GhState, options: object = {}) => {
  const gh = gitHub(state);
  const result = reconcile({ repo: REPO, gates: GATES, gh, ...options });
  return { result, calls: recorded(gh.mock.calls) };
};

/**
 * The contexts a written ruleset payload requires, in order.
 * @param input - The JSON body piped to `gh`.
 * @returns Context strings.
 */
export const writtenContexts = (input: string | undefined): string[] =>
  JSON.parse(input ?? "{}").rules[0].parameters.required_status_checks.map(
    (check: { context: string }) => check.context
  );

/**
 * The calls that carried a body — i.e. the writes.
 * @param calls - Every recorded call.
 * @returns Only the writes.
 */
export const writes = (calls: GhCall[]): GhCall[] =>
  calls.filter(call => call.input);
