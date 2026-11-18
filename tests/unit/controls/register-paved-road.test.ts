/**
 * The control register of a repository that declares no `parts` at all.
 *
 * Existing users write a level per moment and nothing else, and the gate
 * registry already knows what that runs. The register has to say the same
 * thing the runner would do: one entry per gate for the whole repository, with
 * the task, awaited check, shipped hook or built-in job that measures it at
 * each moment (CodySwannGT/lisa#4983).
 */
import { describe, expect, it } from "vitest";

import { mechanismAt } from "../../../src/controls/register-types.js";
import { F_PAVED_GATES } from "../../helpers/control-register.js";
import { buildOf, entryOf, registerOf } from "./support/register-build.js";

const PULL_REQUEST = "pull-request";
const HOSTING_PLATFORM = "hosting-platform";
const NO_SCRIPTS = {};
const REVIEW = "code-review@.";
const LINT = "code-style@.";
const AUDIT = "dependency-vulnerability@.";
const SAFETY = "destructive-safety@.";

describe("a declaration with no parts", () => {
  it("gets one whole-repository entry per gate, in gate order", async () => {
    const register = await registerOf(F_PAVED_GATES, NO_SCRIPTS);

    expect(register.entries.map(entry => entry.id)).toEqual([
      REVIEW,
      LINT,
      AUDIT,
      SAFETY,
      "test-correctness@.",
      "test-node-suites@.",
    ]);
    expect(new Set(register.entries.map(entry => entry.scope))).toEqual(
      new Set(["."])
    );
  });

  it("records the task the registry resolves, and a different one where a moment names its own", async () => {
    const lint = entryOf(await registerOf(F_PAVED_GATES, NO_SCRIPTS), LINT);

    expect(lint.measuring_mechanism).toEqual({
      kind: "task",
      task: "lint:staged",
      command: "npm run lint:staged",
    });
    expect(lint.enforcement_points).toEqual([
      { moment: "commit", level: "required", location: "local-checkout" },
      {
        moment: PULL_REQUEST,
        level: "required",
        location: HOSTING_PLATFORM,
        measuring_mechanism: {
          kind: "task",
          task: "lint",
          command: "npm run lint",
        },
      },
    ]);
  });

  it("answers what measures an entry at a point from the point first, then the entry", async () => {
    const lint = entryOf(await registerOf(F_PAVED_GATES, NO_SCRIPTS), LINT);
    const [commit, pullRequest] = lint.enforcement_points;

    expect(commit && mechanismAt(lint, commit)).toEqual(
      lint.measuring_mechanism
    );
    expect(pullRequest && mechanismAt(lint, pullRequest)).toEqual({
      kind: "task",
      task: "lint",
      command: "npm run lint",
    });
  });

  it("uses the declared task runner in the command", async () => {
    const register = await registerOf(
      { ...F_PAVED_GATES, runner: "bun run" },
      NO_SCRIPTS
    );

    expect(entryOf(register, "test-correctness@.").measuring_mechanism).toEqual(
      { kind: "task", task: "test:unit", command: "bun run test:unit" }
    );
  });

  it("records an awaited check by name, with the app allowed to report it", async () => {
    const review = entryOf(await registerOf(F_PAVED_GATES, NO_SCRIPTS), REVIEW);

    expect(review.measuring_mechanism).toEqual({
      kind: "external-check",
      name: "Review Bot",
      posted_by: 4242,
    });
    expect(review.enforcement_points).toEqual([
      { moment: PULL_REQUEST, level: "required", location: HOSTING_PLATFORM },
    ]);
  });

  it("records a shipped hook that stops an action as an interceptor in the coding agent", async () => {
    expect(
      entryOf(await registerOf(F_PAVED_GATES, NO_SCRIPTS), SAFETY)
    ).toMatchObject({
      measuring_mechanism: { kind: "interceptor" },
      enforcement_points: [
        { moment: "pre-tool", level: "required", location: "coding-agent" },
      ],
    });
  });

  it("records the workflow's own job where the repository has no task for the gate", async () => {
    const audit = entryOf(await registerOf(F_PAVED_GATES, NO_SCRIPTS), AUDIT);

    expect(audit.measuring_mechanism).toEqual({ kind: "built-in" });
    expect(audit.enforcement_points).toEqual([
      { moment: PULL_REQUEST, level: "required", location: HOSTING_PLATFORM },
      {
        moment: "continuous:staging",
        level: "optional",
        location: "scheduled-run",
        measuring_mechanism: {
          kind: "task",
          task: "security:audit",
          command: "npm run security:audit",
        },
      },
    ]);
  });

  it("resolves the same way with no package.json, where nothing is known about scripts", async () => {
    const audit = entryOf(await registerOf(F_PAVED_GATES, null), AUDIT);

    expect(audit.measuring_mechanism).toEqual({
      kind: "task",
      task: "security:audit",
      command: "npm run security:audit",
    });
  });

  it("lists a gate turned off everywhere as enforced nowhere and measured by nothing", async () => {
    expect(
      entryOf(await registerOf(F_PAVED_GATES, NO_SCRIPTS), "test-node-suites@.")
    ).toMatchObject({
      enforcement_points: [],
      measuring_mechanism: { kind: "none" },
      tier: "advisory",
    });
  });

  it("puts moments in the order they happen, environments by name", async () => {
    const register = await registerOf({
      "dependency-vulnerability": {
        "continuous:staging": "optional",
        "pre-deploy:production": "required",
        "pre-deploy:canary": "required",
        "pull-request": "required",
        push: "required",
      },
    });

    expect(
      entryOf(register, AUDIT).enforcement_points.map(
        point => `${point.moment} ${point.location}`
      )
    ).toEqual([
      "push local-checkout",
      "pull-request hosting-platform",
      "pre-deploy:canary deployment-pipeline",
      "pre-deploy:production deployment-pipeline",
      "continuous:staging scheduled-run",
    ]);
  });
});

describe("what the declaration leaves out", () => {
  it("takes the requirements a gate serves from the catalogue", async () => {
    const register = await registerOf(F_PAVED_GATES, NO_SCRIPTS);

    expect(entryOf(register, LINT).criteria).toEqual(["SI7"]);
    expect(entryOf(register, REVIEW).criteria).toEqual(["AC1.3", "AC8.1"]);
    expect(entryOf(register, SAFETY).criteria).toEqual([]);
  });

  it("prefers the gate's own criteria over the catalogue's", async () => {
    const register = await registerOf({
      "code-style": { commit: "required", criteria: ["AC5.4"] },
    });

    expect(entryOf(register, LINT).criteria).toEqual(["AC5.4"]);
  });

  it("names nobody as accountable when the gate names nobody", async () => {
    const register = await registerOf(F_PAVED_GATES, NO_SCRIPTS);

    expect(
      new Set(register.entries.map(entry => entry.accountable_party))
    ).toEqual(new Set([null]));
  });

  it.each([
    [
      "required on the pull request",
      { [PULL_REQUEST]: "required" },
      "authoritative",
    ],
    [
      "optional on the pull request",
      { [PULL_REQUEST]: "optional" },
      "advisory",
    ],
    [
      "required only at commit and push",
      { commit: "required", push: "required" },
      "advisory",
    ],
    [
      "required before a deployment",
      { "pre-deploy:production": "required" },
      "authoritative",
    ],
  ])("calls a gate %s %s", async (_when, moments, tier) => {
    const register = await registerOf({ "code-style": moments });

    expect(entryOf(register, LINT).tier).toBe(tier);
  });

  it("keeps the tier a gate declares when the gate is required where its author cannot skip it", async () => {
    const register = await registerOf({
      "code-style": {
        commit: "required",
        [PULL_REQUEST]: "required",
        tier: "authoritative",
      },
      "type-correctness": { [PULL_REQUEST]: "required", tier: "advisory" },
    });

    expect(register.entries.map(entry => entry.tier)).toEqual([
      "authoritative",
      "advisory",
    ]);
  });

  it("keeps a declared advisory on a gate that is required only on the author's machine", async () => {
    const register = await registerOf({
      "code-style": { commit: "required", tier: "advisory" },
    });

    expect(entryOf(register, LINT).tier).toBe("advisory");
  });
});

describe("a gate that declares itself authoritative", () => {
  /**
   * What refuses a gate that calls itself authoritative.
   * @param where - Where the gate is required, as the sentence puts it
   * @param folder - The folder the entry is for, when it is for one
   * @returns The whole line
   */
  const refusal = (where: string, folder = ""): string =>
    `The gate "code-style" in .lisa.config.json declares "tier": "authoritative"${folder}, but ${where}. An authoritative check is one that is required somewhere the author does not control. Either require it at "pull-request", before a deployment or on a schedule, or change its tier to "advisory" (leave "tier" out and the register works it out).`;
  const ONLY_AT_COMMIT =
    "it is required only at commit, where the author of a change can skip it";

  it.each([
    ["required only at commit", { commit: "required" }, ONLY_AT_COMMIT],
    [
      "required only at commit and push",
      { commit: "required", push: "required" },
      "it is required only at commit and push, where the author of a change can skip it",
    ],
    [
      "required at commit and only optional on the pull request",
      { commit: "required", [PULL_REQUEST]: "optional" },
      ONLY_AT_COMMIT,
    ],
    [
      "optional wherever it runs",
      { commit: "optional", [PULL_REQUEST]: "optional" },
      "it is not required at any moment",
    ],
  ])(
    "is refused when it is %s, with what to change",
    async (_when, moments, where) => {
      const built = await buildOf({
        "code-style": { ...moments, tier: "authoritative" },
      });

      expect(built.problems).toEqual([refusal(where)]);
    }
  );

  it.each([
    ["on the pull request", { [PULL_REQUEST]: "required" }],
    ["before a deployment", { "pre-deploy:production": "required" }],
    ["on a schedule", { "continuous:production": "required" }],
  ])("is accepted when it is required %s", async (_where, moments) => {
    const register = await registerOf({
      "code-style": { commit: "required", ...moments, tier: "authoritative" },
    });

    expect(entryOf(register, LINT).tier).toBe("authoritative");
  });

  it("is refused for each folder it is not required in beyond the author's machine", async () => {
    const built = await buildOf({
      "code-style": {
        commit: "required",
        tier: "authoritative",
        parts: [
          {
            scope: "api",
            command: ["ruff", "check", "."],
            evidence: { locators: [{ path: "api/ruff.toml", line: 1 }] },
          },
        ],
      },
    });

    expect(built.problems).toEqual([
      refusal(ONLY_AT_COMMIT, ' for the folder "api"'),
    ]);
  });
});
