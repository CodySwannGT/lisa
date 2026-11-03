/** Reasoned late registration never waives reviewer evidence (#4622). */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const REVIEWER = "CodeRabbit";
const LATE = "🧩 Plugin artifacts match source";
const OTHER = "Build";
const HEAD = "a".repeat(40);
const REASON = "Final job registers after the prerequisite shell guard shards.";
const rows = [
  { name: REVIEWER, state: "SUCCESS", description: "Review completed" },
];

interface Registration {
  elapsedSeconds: number;
  present: number;
  total: number;
  missing: string[];
  expired: boolean;
  line: string;
}
interface Guard {
  fetchSettledChecks(
    declaration: Record<string, unknown>,
    pr: string,
    repo: string,
    options: Record<string, unknown>
  ): { registration: Registration; settled: boolean };
  evaluateAbsentRequiredChecks(
    declaration: Record<string, unknown>,
    checks: unknown[],
    options?: Record<string, unknown>
  ): { absent: string[]; violations: { token: string; kind: string }[] };
  selectRequiredContexts(
    declaration: Record<string, unknown>,
    base: { base: string; source: string }
  ): unknown;
}

/** Build a declaration with two required contexts, only one of them review proof. */
function declaration(extra: Record<string, unknown> = {}) {
  return {
    required_contexts: [REVIEWER, LATE],
    evidence_bearing_checks: { [REVIEWER]: {} },
    ...extra,
  };
}

describe("reasoned registration deferral (#4622)", () => {
  let guard: Guard;
  beforeAll(async () => {
    guard = (await import(
      pathToFileURL(
        path.join(
          ROOT,
          "typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs"
        )
      ).href
    )) as Guard;
  });

  /** Drive the real bounded loop without real sleeping or GitHub access. */
  function settle(
    value: Record<string, unknown>,
    checks = rows,
    requiredSet?: unknown
  ) {
    let elapsed = 0;
    const result = guard.fetchSettledChecks(value, "7", "owner/name", {
      headSha: () => HEAD,
      fetch: () => checks,
      timeoutSeconds: 300,
      intervalSeconds: 30,
      now: () => elapsed,
      sleep: (ms: number) => {
        elapsed += ms;
      },
      ...(requiredSet ? { requiredSet } : {}),
    });
    return { ...result, elapsed };
  }

  it("settles immediately once all nondeferred rows appear and names the deferred check", () => {
    const value = declaration({ registration_deferred: { [LATE]: REASON } });
    const result = settle(value);
    expect(result.elapsed).toBe(0);
    expect(result.registration).toMatchObject({
      present: 1,
      total: 1,
      missing: [],
      expired: false,
    });
    expect(result.registration.line).toMatch(/deferred by declaration/u);
    expect(result.registration.line).toContain(LATE);
    expect(guard.evaluateAbsentRequiredChecks(value, rows).violations).toEqual(
      []
    );
  });

  it("still waits the complete existing window and reports an undeclared missing check", () => {
    const value = declaration({
      required_contexts: [REVIEWER, LATE, OTHER],
      registration_deferred: { [LATE]: REASON },
    });
    const result = settle(value);
    expect(result.elapsed).toBe(300000);
    expect(result.registration).toMatchObject({
      missing: [OTHER],
      expired: true,
    });
    const findings = guard.evaluateAbsentRequiredChecks(value, rows);
    expect(findings.absent).toEqual([OTHER]);
    expect(findings.violations).toEqual([
      expect.objectContaining({ token: OTHER, kind: "absent_required_check" }),
    ]);
  });

  it("preserves the wait and absence findings for hosts without the optional key", () => {
    const value = declaration();
    const result = settle(value);
    expect(result.elapsed).toBe(300000);
    expect(result.registration).toMatchObject({
      present: 1,
      total: 2,
      missing: [LATE],
      expired: true,
    });
    expect(guard.evaluateAbsentRequiredChecks(value, rows).absent).toEqual([
      LATE,
    ]);
    expect(result.registration.line).not.toMatch(/deferred/u);
  });

  it("does not defer a selected required reviewer even when its row is missing", () => {
    const value = declaration({
      registration_deferred: { [REVIEWER]: REASON },
    });
    expect(() => settle(value, [])).toThrow(/CodeRabbit/u);
    expect(() => guard.evaluateAbsentRequiredChecks(value, [])).toThrow(
      /CodeRabbit/u
    );
  });

  it("refuses a union member excluded from the selected branch set", () => {
    const value = declaration({
      required_contexts_by_branch: { main: [REVIEWER] },
      registration_deferred: { [LATE]: REASON },
    });
    const requiredSet = guard.selectRequiredContexts(value, {
      base: "main",
      source: "--base",
    });
    expect(() => settle(value, rows, requiredSet)).toThrow(
      /Plugin artifacts match source/u
    );
    expect(() =>
      guard.evaluateAbsentRequiredChecks(value, rows, { requiredSet })
    ).toThrow(/Plugin artifacts match source/u);
  });

  it("refuses an undeclared context by name rather than silently ignoring a typo", () => {
    const value = declaration({ registration_deferred: { Typo: REASON } });
    expect(() => settle(value)).toThrow(/Typo/u);
    expect(() => guard.evaluateAbsentRequiredChecks(value, rows)).toThrow(
      /Typo/u
    );
  });

  it.each([null, [], "late", 1, true].map(value => [value]))(
    "refuses malformed registration_deferred map %j",
    map => {
      const value = declaration({ registration_deferred: map });
      expect(() => settle(value)).toThrow(/registration_deferred/u);
      expect(() => guard.evaluateAbsentRequiredChecks(value, rows)).toThrow(
        /registration_deferred/u
      );
    }
  );

  it.each(["", " \t\n", null, 1, true, [], {}].map(value => [value]))(
    "refuses a missing or non-text reason %j",
    reason => {
      const value = declaration({ registration_deferred: { [LATE]: reason } });
      expect(() => settle(value)).toThrow(/Plugin artifacts match source/u);
      expect(() => guard.evaluateAbsentRequiredChecks(value, rows)).toThrow(
        /Plugin artifacts match source/u
      );
    }
  );

  it("accepts an empty deferral map without changing the default", () => {
    const value = declaration({ registration_deferred: {} });
    const result = settle(value);
    expect(result.elapsed).toBe(300000);
    expect(result.registration.missing).toEqual([LATE]);
    expect(guard.evaluateAbsentRequiredChecks(value, rows).absent).toEqual([
      LATE,
    ]);
  });

  it("a deferred late check cannot end the pending review evidence wait", () => {
    const value = declaration({ registration_deferred: { [LATE]: REASON } });
    const result = settle(value, [
      { name: REVIEWER, state: "PENDING", description: "Review in progress" },
    ]);
    expect(result.elapsed).toBe(300000);
    expect(result.settled).toBe(false);
    expect(result.registration.expired).toBe(false);
  });
});
