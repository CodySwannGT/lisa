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
import { entryOf, registerOf } from "./support/register-build.js";

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

  it("keeps the tier a gate declares, whatever its moments", async () => {
    const register = await registerOf({
      "code-style": { commit: "required", tier: "authoritative" },
      "type-correctness": { [PULL_REQUEST]: "required", tier: "advisory" },
    });

    expect(register.entries.map(entry => entry.tier)).toEqual([
      "authoritative",
      "advisory",
    ]);
  });
});
