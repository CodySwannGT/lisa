/**
 * `serialize_platform_legs` — the opt-in iOS-then-Android ordering, job-graph
 * half. The poll loop that does the actual waiting is proved by executing it,
 * in `maestro-leg-order-wait.test.ts`.
 *
 * The defect this closes: `android` and `ios` are sibling jobs with identical
 * `needs` and no edge between them, so they always ran at once. When both legs
 * sign in as the same test persona they invalidate each other's session and the
 * loser asserts on an authenticated screen and finds the sign-in screen —
 * measured at 1 success in 6 runs on geminisportsai/frontend-v2, and at 33%
 * flow failure while the legs overlap vs 16% after one finishes on
 * TunnlAI/frontend.
 *
 * `needs` cannot hold an expression, so there is no way to write "depend on
 * `ios` only when an input is set". The ordering is therefore split: this file
 * pins the unconditional `android → leg_order` edge and the guards around it,
 * and the sibling file pins what `leg_order` does with that time.
 *
 * The properties here:
 *
 *   • the input is opt-in and defaults to today's behavior;
 *   • Android gains no unconditional edge to iOS, and `leg_order` starts no
 *     later than a job Android already waited on, so the default path cannot
 *     lose wall clock;
 *   • Android runs even when `leg_order` fails — with a failed `pre_suite` as
 *     the negative control, so "runs anyway" is not mistaken for a blanket;
 *   • single-platform runs neither deadlock nor skip.
 */

import * as fs from "fs-extra";
import yaml from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { needsOf, runPreflight } from "./support/maestro-leg-order-harness";
import {
  evaluateIf,
  simulateRun,
  type SimulatedWorkflow,
} from "../helpers/workflow-job-graph";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REUSABLE_YML = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);
const CALLER_YML = path.join(
  REPO_ROOT,
  "expo",
  "create-only",
  ".github",
  "workflows",
  "maestro-e2e.yml"
);

const LEG_ORDER = "leg_order";
const ANDROID = "android";
const IOS = "ios";
const PRE_SUITE = "pre_suite";
const PREFLIGHT = "preflight";
const SERIALIZE = "serialize_platform_legs";

describe("maestro-native-e2e leg ordering — job graph", () => {
  let workflow: SimulatedWorkflow;
  let raw: Record<string, unknown>;
  let caller: Record<string, unknown>;

  beforeAll(async () => {
    raw = yaml.load(await fs.readFile(REUSABLE_YML, "utf-8")) as Record<
      string,
      unknown
    >;
    workflow = raw as unknown as SimulatedWorkflow;
    caller = yaml.load(await fs.readFile(CALLER_YML, "utf-8")) as Record<
      string,
      unknown
    >;
  });

  /**
   * The reusable workflow's `workflow_call` inputs block.
   *
   * @returns Every declared input, keyed by name.
   */
  const inputsOf = (): Record<string, Record<string, unknown>> =>
    (
      (raw.on as Record<string, Record<string, unknown>>).workflow_call as {
        inputs: Record<string, Record<string, unknown>>;
      }
    ).inputs;

  describe("the input", () => {
    it("is opt-in: a boolean defaulting to false", () => {
      // The concurrency_group precedent — an unset input must leave every
      // existing consumer on exactly the behavior it has today.
      const input = inputsOf()[SERIALIZE];
      expect(input).toBeDefined();
      expect(input.required).toBe(false);
      expect(input.default).toBe(false);
      expect(input.type).toBe("boolean");
    });

    it("budgets the ordering job above the two waits it spans", () => {
      // GitHub Actions expressions have no arithmetic operators, so this
      // ceiling cannot be derived from the two budgets it must cover and is an
      // input instead. Unpinned, the three defaults drift apart and the job
      // starts timing out on an iOS suite that is merely slow.
      const declared = inputsOf();
      const serializeTimeout = Number(
        declared.serialize_timeout_minutes.default
      );
      const spanned =
        Number(declared.pre_suite_timeout_minutes.default) +
        Number(declared.suite_timeout_minutes.default);
      expect(serializeTimeout).toBeGreaterThan(spanned);
    });

    it("is reachable from the shipped caller template", () => {
      // The template is create-only, so this is the wiring NEW adopters get.
      // The scope is granted in the CALLER and travels as a forwarded secret —
      // see the permissions guard below for why it cannot be declared in the
      // reusable workflow.
      const permissions = caller.permissions as Record<string, string>;
      const text = fs.readFileSync(CALLER_YML, "utf-8");
      expect(permissions.actions).toBe("read");
      expect(text).toContain(`# ${SERIALIZE}: true`);
      expect(text).toContain("LEG_ORDER_TOKEN:");
    });

    it("takes the ordering token as a secret, not a declared scope", () => {
      const secrets = (
        (raw.on as Record<string, Record<string, unknown>>).workflow_call as {
          secrets: Record<string, Record<string, unknown>>;
        }
      ).secrets;
      expect(secrets.LEG_ORDER_TOKEN).toBeDefined();
      expect(secrets.LEG_ORDER_TOKEN.required).toBe(false);
    });
  });

  describe("the #2046 rule — no job may escalate the caller's grant", () => {
    it("declares no job-level permissions block anywhere in this workflow", () => {
      // THE regression guard for #2566. A called workflow may only DOWNGRADE
      // the caller's grant: requesting a scope the caller never held is a
      // `startup_failure` for the ENTIRE run, decided BEFORE the run starts —
      // so the job's `if:` never runs and an unset `serialize_platform_legs`
      // does not save anyone. The first cut of this feature declared
      // `actions: read` here and would have broken every caller granting less,
      // on every path, including ones where the job does nothing.
      //
      // This mirrors tests/unit/hooks/work-item-wiring.test.ts, which pins the
      // same property on quality.yml's work_item_traceability job. The scope
      // this job needs arrives as the forwarded LEG_ORDER_TOKEN secret, which
      // carries the CALLER's token and therefore declares nothing.
      //
      // Asserted over EVERY job, not just leg_order: the rule is a property of
      // the file, and the next job added here is the one most likely to break
      // it.
      const declaring = Object.entries(workflow.jobs)
        .filter(([, job]) => (job as { permissions?: unknown }).permissions)
        .map(([name]) => name);
      expect(declaring).toEqual([]);
    });

    it("keeps the workflow-level grant at contents: read", () => {
      // The negative control for the assertion above. Moving the escalation up
      // to the workflow level would satisfy a per-job check while causing the
      // identical startup_failure, so the ceiling is pinned too.
      expect(raw.permissions).toEqual({ contents: "read" });
    });
  });

  describe("bite control 1 — ordering holds", () => {
    it("puts leg_order on Android's needs, so GitHub holds Android for it", () => {
      // The edge is unconditional; the CONDITION lives inside leg_order's own
      // step, because `needs` cannot hold an expression.
      expect(needsOf(workflow, ANDROID)).toContain(LEG_ORDER);
    });

    it("declares leg_order between build and android", () => {
      // Keeps the graph topological in declaration order, which is what the
      // simulator (and a human reading the file) walks.
      const order = Object.keys(workflow.jobs);
      expect(order.indexOf(LEG_ORDER)).toBeLessThan(order.indexOf(ANDROID));
      expect(order.indexOf(LEG_ORDER)).toBeGreaterThan(order.indexOf("build"));
    });

    it("matches the iOS job by the name that job actually declares", () => {
      // A renamed iOS job with a stale constant here is a job that waits for
      // something that does not exist. The absent-case test in the sibling file
      // turns that into an error rather than a pass; this pin is what stops it
      // happening at all.
      const step = (workflow.jobs[LEG_ORDER].steps ?? [])[0];
      const pinned = (step.env as Record<string, string>).IOS_JOB_NAME;
      expect(pinned).toBe(workflow.jobs[IOS].name);
    });
  });

  describe("bite control 2 — default unchanged", () => {
    it("does no waiting when the input is unset", () => {
      // The wait step's own guard, evaluated against an otherwise fully wired
      // run. False here means the step never executes, so leg_order concludes
      // as fast as a runner can start it.
      const step = (workflow.jobs[LEG_ORDER].steps ?? [])[0];
      const wired = {
        needs: {
          preflight: { outputs: { run_ios: "true", run_android: "true" } },
        },
      };
      expect(evaluateIf(step.if, { ...wired, inputs: {} })).toBe(false);
      expect(
        evaluateIf(step.if, { ...wired, inputs: { [SERIALIZE]: false } })
      ).toBe(false);
      // ...and true only when the caller opted in.
      expect(
        evaluateIf(step.if, { ...wired, inputs: { [SERIALIZE]: true } })
      ).toBe(true);
    });

    it("never gives Android an unconditional edge to iOS", () => {
      // The change that would have been easy and wrong: `needs: [ios]` on
      // android serializes EVERY adopter, including the ones with per-platform
      // personas who are paying nothing for concurrency today.
      expect(needsOf(workflow, ANDROID)).not.toContain(IOS);
      expect(needsOf(workflow, IOS)).not.toContain(ANDROID);
    });

    it("starts leg_order no later than a job Android already waited on", () => {
      // This is why the default path pays nothing in wall clock. leg_order's
      // dependencies are a subset of pre_suite's, so it becomes eligible at the
      // same moment pre_suite does — and Android already could not start before
      // pre_suite finished. Depending on pre_suite here would instead push a
      // fresh runner acquisition onto Android's critical path on every run,
      // opted in or not.
      const legOrderNeeds = needsOf(workflow, LEG_ORDER);
      const preSuiteNeeds = needsOf(workflow, PRE_SUITE);
      expect(legOrderNeeds).not.toContain(PRE_SUITE);
      expect(legOrderNeeds.every(job => preSuiteNeeds.includes(job))).toBe(
        true
      );
      expect(needsOf(workflow, ANDROID)).toContain(PRE_SUITE);
    });

    it("runs leg_order rather than skipping it in a wired run", () => {
      // Row 26 of the nightly gate reads any non-`success` job behind a
      // `mode: "run"` suite as `incomplete_run`. A job gated on
      // `inputs.serialize_platform_legs` at JOB level would therefore turn
      // every green nightly into a blocked one for every adopter who does not
      // use the seam — which is all of them on the day this lands.
      const outputs = runPreflight(workflow, "all");
      const run = simulateRun(workflow, {
        seed: { name: PREFLIGHT, outputs },
        inputs: { platform: "all" },
      });
      expect(run.jobs[LEG_ORDER].ran).toBe(true);
      expect(run.jobs[LEG_ORDER].result).toBe("success");
      expect(run.jobs[ANDROID].ran).toBe(true);
      expect(run.jobs[IOS].ran).toBe(true);
    });
  });

  describe("bite control 3 — a failing leg does not suppress Android", () => {
    it("runs Android even when leg_order itself fails", () => {
      // Android's guard deliberately carries NO result allowlist for
      // leg_order — the existing `!cancelled()` is what lets a broken
      // serializer degrade to today's concurrent legs instead of dropping the
      // Android suite entirely.
      const outputs = runPreflight(workflow, "all");
      const run = simulateRun(workflow, {
        seed: { name: PREFLIGHT, outputs },
        inputs: { platform: "all", [SERIALIZE]: true },
        forcedResults: { [LEG_ORDER]: "failure" },
      });
      expect(run.jobs[LEG_ORDER].result).toBe("failure");
      expect(run.jobs[ANDROID].ran).toBe(true);
    });

    it("still fails Android closed on a failed pre_suite", () => {
      // The negative control for the assertion above: `!cancelled()` is not a
      // blanket "run anyway". A pre-suite failure means known state was never
      // established, and that must still stop the leg. Without this, the test
      // above would also pass on a guard that had stopped guarding.
      const outputs = runPreflight(workflow, "all");
      const run = simulateRun(workflow, {
        seed: { name: PREFLIGHT, outputs },
        inputs: { platform: "all", [SERIALIZE]: true },
        forcedResults: { [PRE_SUITE]: "failure" },
      });
      expect(run.jobs[ANDROID].ran).toBe(false);
    });
  });

  describe("bite control 4 — single-platform runs", () => {
    it.each([
      { platform: "android", android: true, ios: false },
      { platform: "ios", android: false, ios: true },
    ])(
      "platform=$platform runs only its own leg, with leg_order green",
      ({ platform, android, ios }) => {
        const outputs = runPreflight(workflow, platform);
        const run = simulateRun(workflow, {
          seed: { name: PREFLIGHT, outputs },
          inputs: { platform, [SERIALIZE]: true },
        });
        expect(run.jobs[ANDROID].ran).toBe(android);
        expect(run.jobs[IOS].ran).toBe(ios);
        // Never skipped — see the row 26 note above.
        expect(run.jobs[LEG_ORDER].result).toBe("success");
      }
    );

    it.each(["android", "ios"])(
      "platform=%s waits for nothing, so it cannot deadlock",
      platform => {
        // With one leg absent there is no contention to order. Waiting anyway
        // would block on a job that never enters the run and burn the whole
        // discovery window before failing.
        const step = (workflow.jobs[LEG_ORDER].steps ?? [])[0];
        const outputs = runPreflight(workflow, platform);
        expect(
          evaluateIf(step.if, {
            inputs: { [SERIALIZE]: true },
            needs: { preflight: { outputs } },
          })
        ).toBe(false);
      }
    );
  });
});
