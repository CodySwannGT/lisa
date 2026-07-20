import { describe, expect, it } from "vitest";

import {
  summarizeHealthFindings,
  validateHealthResult,
  validateHealthSchedule,
} from "../../../src/health/contract.js";

const finding = (overrides: Record<string, unknown> = {}) => ({
  check: "config.sync",
  layer: "deterministic",
  status: "pass",
  reason: "Configuration is synchronized.",
  ...overrides,
});

const result = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  runId: "health-run-1",
  mode: "deterministic",
  startedAt: "2026-07-20T12:00:00.000Z",
  completedAt: "2026-07-20T12:01:00.000Z",
  findings: [finding()],
  summary: { verdict: "in band", counts: { pass: 1, warn: 0, fail: 0 } },
  ...overrides,
});

describe("summarizeHealthFindings", () => {
  it("always returns zero-filled counts and preserves warn-only in band", () => {
    expect(
      summarizeHealthFindings([finding({ status: "warn" })] as never)
    ).toEqual({ verdict: "in band", counts: { pass: 0, warn: 1, fail: 0 } });
  });

  it("reports drift when any finding fails", () => {
    expect(
      summarizeHealthFindings([
        finding(),
        finding({ check: "agent.review", layer: "agentic", status: "fail" }),
      ] as never)
    ).toEqual({
      verdict: "drift detected",
      counts: { pass: 1, warn: 0, fail: 1 },
    });
  });
});

describe("validateHealthResult", () => {
  it("returns a detached deeply frozen deterministic result", () => {
    const input = result();
    const validated = validateHealthResult(input);

    expect(validated).not.toBe(input);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.findings)).toBe(true);
    expect(Object.isFrozen(validated.findings[0])).toBe(true);
    expect(Object.isFrozen(validated.summary.counts)).toBe(true);
  });

  it("accepts historical full results containing both layers", () => {
    const findings = [
      finding(),
      finding({ check: "agent.review", layer: "agentic", status: "warn" }),
    ];
    expect(
      validateHealthResult(
        result({
          mode: "full",
          findings,
          summary: {
            verdict: "in band",
            counts: { pass: 1, warn: 1, fail: 0 },
          },
        })
      ).mode
    ).toBe("full");
  });

  it("accepts full mode with zero agentic findings after a clean evaluation", () => {
    const validated = validateHealthResult(result({ mode: "full" }));

    expect(validated.mode).toBe("full");
    expect(validated.findings).toEqual([finding()]);
  });

  it.each(["pass", "fail"])(
    "preserves historical agentic %s findings for storage compatibility",
    status => {
      const findings = [
        finding(),
        finding({ check: "agent.historical", layer: "agentic", status }),
      ];
      expect(() =>
        validateHealthResult(
          result({
            mode: "full",
            findings,
            summary: summarizeHealthFindings(findings),
          })
        )
      ).not.toThrow();
    }
  );

  it.each([
    [
      "empty",
      result({
        findings: [],
        summary: { verdict: "in band", counts: { pass: 0, warn: 0, fail: 0 } },
      }),
    ],
    [
      "agentic deterministic",
      result({ findings: [finding({ layer: "agentic" })] }),
    ],
    [
      "full without deterministic layer",
      result({
        mode: "full",
        findings: [finding({ layer: "agentic" })],
      }),
    ],
    ["duplicate check", result({ findings: [finding(), finding()] })],
    ["blank reason", result({ findings: [finding({ reason: " " })] })],
    [
      "controlled reason",
      result({ findings: [finding({ reason: "hidden\u0000text" })] }),
    ],
    [
      "oversized reason",
      result({ findings: [finding({ reason: "x".repeat(2_001) })] }),
    ],
    [
      "unstable check",
      result({ findings: [finding({ check: "Config Sync" })] }),
    ],
    [
      "too many findings",
      result({
        findings: Array.from({ length: 201 }, (_unused, index) =>
          finding({ check: `check.${index}` })
        ),
      }),
    ],
  ])("rejects invalid finding contract: %s", (_name, candidate) => {
    expect(() => validateHealthResult(candidate)).toThrow();
  });

  it.each([
    [
      "offset timestamp",
      result({ completedAt: "2026-07-20T08:01:00.000-04:00" }),
    ],
    ["noncanonical timestamp", result({ completedAt: "2026-07-20T12:01:00Z" })],
    ["reverse time", result({ completedAt: "2026-07-20T11:59:00.000Z" })],
    ["unsupported schema", result({ schemaVersion: 2 })],
    [
      "forged count",
      result({
        summary: { verdict: "in band", counts: { pass: 0, warn: 0, fail: 0 } },
      }),
    ],
    [
      "forged verdict",
      result({
        summary: {
          verdict: "drift detected",
          counts: { pass: 1, warn: 0, fail: 0 },
        },
      }),
    ],
    ["extra field", { ...result(), hostPayload: "private" }],
  ])("rejects invalid envelope: %s", (_name, candidate) => {
    expect(() => validateHealthResult(candidate)).toThrow();
  });

  it("rejects proxies and accessors without invoking them", () => {
    let invoked = false;
    const accessor = Object.defineProperty(result(), "runId", {
      enumerable: true,
      get: () => {
        invoked = true;
        return "health-run-1";
      },
    });

    expect(() => validateHealthResult(accessor)).toThrow(/accessors/);
    expect(() => validateHealthResult(new Proxy(result(), {}))).toThrow(
      /plain object/
    );
    expect(invoked).toBe(false);
  });

  it("rejects exotic objects and non-dense arrays without invoking entries", () => {
    let invoked = false;
    const accessorFindings = [finding()];
    Object.defineProperty(accessorFindings, "0", {
      configurable: true,
      enumerable: true,
      get: () => {
        invoked = true;
        return finding();
      },
    });
    const sparse = Object.assign(Array<unknown>(2), { 1: finding() });
    const symbolArray = [finding()];
    Object.defineProperty(symbolArray, Symbol("hidden"), { value: true });
    const extraArray = Object.assign([finding()], { hidden: true });
    const customPrototype = Object.create({ inherited: true }) as Record<
      string,
      unknown
    >;
    Object.assign(customPrototype, result());

    expect(() =>
      validateHealthResult(result({ findings: accessorFindings }))
    ).toThrow(/accessors/);
    expect(() => validateHealthResult(result({ findings: sparse }))).toThrow(
      /dense/
    );
    expect(() =>
      validateHealthResult(result({ findings: symbolArray }))
    ).toThrow(/dense/);
    expect(() =>
      validateHealthResult(result({ findings: extraArray }))
    ).toThrow(/dense/);
    expect(() => validateHealthResult(customPrototype)).toThrow(/prototype/);
    expect(() =>
      validateHealthResult(result({ findings: new Proxy([finding()], {}) }))
    ).toThrow(/findings/);
    expect(invoked).toBe(false);
  });
});

describe("validateHealthSchedule", () => {
  it.each(["off", "daily", "weekly"])("accepts %s", value => {
    expect(validateHealthSchedule(value)).toBe(value);
  });

  it.each(["hourly", "", null, 1])("rejects %j", value => {
    expect(() => validateHealthSchedule(value)).toThrow(/health\.schedule/);
  });
});
