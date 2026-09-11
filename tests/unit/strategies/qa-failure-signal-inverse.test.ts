/**
 * Regression coverage for the QA-failure signal's inverse.
 *
 * The defect (#3855): `lisa-qa-fail` applied a durable label as the
 * deterministic rework signal and nothing ever removed it, so an item that
 * failed QA once — then was fixed, re-tested, passed and shipped — stayed
 * indistinguishable from an item failing QA now. The population only grows,
 * so a deterministic input to rework triage degrades toward meaning "this item
 * has been around a while".
 *
 * These tests bite in BOTH directions, because a fix that stops the signal
 * from persisting by stopping it from working would be a worse defect than the
 * one it replaces:
 * - an item that failed and has since passed is NOT live, and
 * - an item whose failure is unresolved IS still live.
 *
 * Source and generated plugin roots are both asserted so a missed
 * `bun run build:plugins` fails this suite.
 * @module tests/unit/strategies/qa-failure-signal-inverse
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTIONS,
  OUTCOMES,
  QA_FAILURE_SIGNAL,
  SIGNALS,
  evaluateSignal,
  latestQaVerdict,
  resolveSignalLabel,
  unpredicatedConditions,
  voidingRoles,
} from "../../../plugins/src/base/scripts/qa-signal-lifecycle.mjs";

const DONE = "status:done";

/** A GitHub-shaped config with every role this evaluation consults bound. */
const CONFIG = {
  github: {
    labels: {
      build: {
        ready: "status:ready",
        claimed: "status:in-progress",
        blocked: "status:blocked",
        qa: { queue: "status:on-stg", certified: "status:qa-certified" },
        done: {
          dev: "status:on-dev",
          staging: "status:on-stg",
          production: DONE,
        },
      },
    },
  },
};

const FAIL_COMMENT =
  "[lisa-qa-fail] QA failure — the export button did nothing";
const PASS_COMMENT =
  "[lisa-qa-queue] QA pass — verified by a tester on 2026-09-05";
const SCRIPT = "scripts/qa-signal-lifecycle.mjs";

const READY = "status:ready";
const RENAMED = "qa:rejected";

const evaluate = (item: {
  labels?: readonly unknown[];
  comments?: readonly string[];
  role?: string;
}): ReturnType<typeof evaluateSignal> =>
  evaluateSignal({ ...item, vendor: "github", config: CONFIG });

describe("the QA-failure signal has an executable inverse", () => {
  it("is not live once a later pass verdict is recorded", () => {
    const result = evaluate({
      labels: ["qa-fail", READY],
      comments: [FAIL_COMMENT, "some unrelated note", PASS_COMMENT],
      role: READY,
    });

    expect(result.live).toBe(false);
    expect(result.outcome).toBe(OUTCOMES.STALE);
    expect(result.action).toBe(ACTIONS.CLEAR);
    expect(result.voided).toContain("qa-pass-recorded");
  });

  it("separates presence from liveness exactly where the defect was", () => {
    const shared = { labels: ["qa-fail"], role: READY };
    const passedSince = evaluate({
      ...shared,
      comments: [FAIL_COMMENT, PASS_COMMENT],
    });
    const stillFailing = evaluate({
      ...shared,
      comments: [PASS_COMMENT, FAIL_COMMENT],
    });

    // The pre-fix reader keyed on the label being there, and by that measure
    // these two items are identical — which is the whole defect.
    expect(passedSince.present).toBe(true);
    expect(stillFailing.present).toBe(passedSince.present);
    // Keyed on liveness they are not, and in the direction that matters: the
    // resolved one stops being rework, the unresolved one still is.
    expect(passedSince.live).toBe(false);
    expect(stillFailing.live).toBe(true);
  });

  it("stays live while the failure is unresolved", () => {
    const result = evaluate({
      labels: ["qa-fail", READY],
      comments: [PASS_COMMENT, FAIL_COMMENT],
      role: READY,
    });

    expect(result.live).toBe(true);
    expect(result.outcome).toBe(OUTCOMES.LIVE);
    expect(result.action).toBe(ACTIONS.KEEP);
    expect(result.voided).toEqual([]);
  });

  it("does NOT void on a state that is merely named like a QA pass", () => {
    // The `qa.certified` role was retired with the QA acceptance skills that
    // were its only writers. Only a configured `done` rung voids the signal
    // now, so a state that reads like certification but is bound to no role
    // must leave the failure live rather than silently clearing it.
    const result = evaluate({
      labels: ["qa-fail"],
      comments: [FAIL_COMMENT],
      role: "status:qa-certified",
    });

    expect(result.live).toBe(true);
    expect(result.voided).toEqual([]);
  });

  it("voids on a terminal done rung, whatever the tracker's letter case", () => {
    const result = evaluate({
      labels: [{ name: "QA-Fail" }],
      comments: [FAIL_COMMENT],
      role: "STATUS:DONE",
    });

    expect(result.live).toBe(false);
    expect(result.present).toBe(true);
    expect(result.voided).toContain("certified-role-reached");
  });

  it("reports absence rather than staleness when the label is not there", () => {
    const result = evaluate({ labels: [READY], role: READY });

    expect(result.present).toBe(false);
    expect(result.outcome).toBe(OUTCOMES.ABSENT);
    expect(result.action).toBe(ACTIONS.NONE);
  });

  it("does not read a QA-blocked note as a verdict either way", () => {
    expect(
      latestQaVerdict([
        FAIL_COMMENT,
        "[lisa-qa-queue] QA blocked: no test account",
      ])
    ).toBe("fail");
  });

  it("does not mistake a comment quoting a marker for the marker", () => {
    expect(
      latestQaVerdict([
        FAIL_COMMENT,
        "We should check whether [lisa-qa-queue] QA pass ever fired here.",
      ])
    ).toBe("fail");
  });
});

describe("the signal's name is configured, never hardcoded", () => {
  it("resolves a project's own label name from config", () => {
    const renamed = { qa: { labels: { fail: RENAMED } } };

    expect(
      resolveSignalLabel({ signal: QA_FAILURE_SIGNAL, config: renamed })
    ).toEqual({ value: RENAMED, source: "config" });
  });

  it("falls back to the declared name when a project binds none", () => {
    expect(
      resolveSignalLabel({ signal: QA_FAILURE_SIGNAL, config: {} })
    ).toEqual({
      value: SIGNALS[QA_FAILURE_SIGNAL].fallback,
      source: "fallback",
    });
  });

  it("evaluates the renamed label, not the default one", () => {
    const result = evaluateSignal({
      labels: [RENAMED],
      comments: [FAIL_COMMENT],
      role: READY,
      vendor: "github",
      config: { ...CONFIG, qa: { labels: { fail: RENAMED } } },
    });

    expect(result.present).toBe(true);
    expect(result.live).toBe(true);
  });

  it("resolves the voiding roles per vendor rather than assuming GitHub", () => {
    const jira = {
      jira: {
        workflow: {
          qa: { certified: "Certified" },
          done: { staging: "On Stg", production: "Done" },
        },
      },
    };

    // `qa.certified` is a retired role: even when a stale config still declares
    // it, only the `done` rungs void the signal.
    expect(voidingRoles({ vendor: "jira", config: jira })).toEqual([
      "On Stg",
      "Done",
    ]);
  });

  it("honours a scalar `done` as well as an env-indexed map", () => {
    // `done` has two sanctioned shapes. Reading only the map form returns NO
    // voiding roles for a single-rung project, which holds every QA failure
    // live forever — and it fails silently, because an empty list is exactly
    // what a project that binds nothing also produces.
    const scalar = { jira: { workflow: { done: "Done" } } };

    expect(voidingRoles({ vendor: "jira", config: scalar })).toEqual(["Done"]);
  });

  it("still voids a live signal when the only terminal state is scalar", () => {
    const result = evaluateSignal({
      labels: ["qa-fail"],
      comments: [FAIL_COMMENT],
      role: DONE,
      vendor: "github",
      config: { github: { labels: { build: { done: DONE } } } },
    });

    expect(result.live).toBe(false);
  });
});

describe("the contract cannot be satisfied by prose", () => {
  it("gives every declared void condition an executable predicate", () => {
    expect(unpredicatedConditions()).toEqual([]);
  });

  it("holds a signal live when a condition has no predicate, never clears it", () => {
    const result = evaluateSignal({
      signal: QA_FAILURE_SIGNAL,
      labels: ["qa-fail"],
      comments: [PASS_COMMENT],
      role: READY,
      vendor: "github",
      config: CONFIG,
    });
    // Sanity: with predicates present this clears. The fail-closed branch is
    // asserted through `unpredicatedConditions` above — a registry row nothing
    // can evaluate is a reported defect, not a silent exemption.
    expect(result.unchecked).toEqual([]);
    expect(result.action).toBe(ACTIONS.CLEAR);
  });

  it("refuses an undeclared signal instead of inventing a label for it", () => {
    const result = evaluateSignal({
      signal: "not-a-signal",
      vendor: "github",
      config: CONFIG,
    });

    expect(result.outcome).toBe(OUTCOMES.UNKNOWN_SIGNAL);
    expect(result.action).toBe(ACTIONS.NONE);
  });
});

const SKILL_ROOTS = ["plugins/src/base", "plugins/lisa"] as const;
const GENERATED_ROOTS = [
  "plugins/lisa",
  "plugins/lisa-cursor",
  "plugins/lisa-agy",
  "plugins/lisa-copilot",
] as const;

const readSkill = (root: string, name: string): string =>
  readFileSync(path.resolve(root, `skills/${name}/SKILL.md`), "utf8");

describe("every skill on the QA signal's path resolves it through one module", () => {
  describe.each(SKILL_ROOTS)("%s", root => {
    // `lisa-qa-fail`, `lisa-qa-queue` and `lisa-qa-checklist`/`lisa-qa-clear`
    // were retired: they were an unused human-tester acceptance loop, and they
    // were the signal's only automatic writers. Rework triage is now the sole
    // skill on this path, so it is the only one with a contract to enforce.
    it("rework triage reads liveness, not bare label presence", () => {
      const triage = readSkill(root, "lisa-rework-triage");

      expect(triage).toContain(SCRIPT);
      expect(triage).toMatch(/\blive\b/);
      expect(triage).toMatch(/stale/i);
      // A stale signal is repaired where it is found, so the backlog of items
      // labelled before the inverse existed drains instead of accumulating.
      expect(triage).toMatch(/remove|clear/i);
    });
  });

  describe.each(GENERATED_ROOTS)("generated root %s", root => {
    it("ships the resolver alongside the skills that call it", () => {
      expect(existsSync(path.resolve(root, SCRIPT))).toBe(true);
    });
  });
});
