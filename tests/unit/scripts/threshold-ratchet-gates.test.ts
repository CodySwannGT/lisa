/**
 * Tests for the threshold ratchet, part 2: Tier 2 gate configs (stryker
 * break score, k6 bounds), Tier 3 exemption additions (audit ignores,
 * mutate exclusions, allow-list self-service), the baseline-side allow
 * list. Tier 1 comparator behavior lives in threshold-ratchet.test.ts;
 * enforcement-layer wiring lives in threshold-ratchet-wiring.test.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const HOOKS_REL = "plugins/src/base/hooks";
const RATCHET_MODULES = [
  "threshold-ratchet-families.mjs",
  "threshold-ratchet-compare.mjs",
];
const STRYKER_FILE = "stryker.conf.json";
const K6_FILE = ".github/k6/thresholds/normal.json";
const LISA_CONFIG_FILE = ".lisa.config.json";
const VITEST_FILE = "vitest.thresholds.json";
const KEY_LINES = "global.lines";
const SRC_GLOB = "src/**/*.ts";
const SPEC_NEGATION = "!src/**/*.spec.ts";
const P95_BOUND = "p(95)<1000";
const RATE_UPPER = "rate<0.05";
const RATE_LOWER = "rate>=0.99";
const TYPE_EXEMPTION = "exemption-added";

/** One reported ratchet violation. */
interface Finding {
  readonly file: string;
  readonly key: string;
  readonly type: string;
  readonly message: string;
}

describe("threshold-ratchet tiers 2 and 3", () => {
  let compareFile: (
    relPath: string,
    baselineText: string | null,
    currentText: string | null
  ) => Finding[];
  let applyAllowList: (
    findings: Finding[],
    allowEntries: ReadonlyArray<{ file: string; key: string }>
  ) => { blocked: Finding[]; allowed: Finding[] };
  let extractAllowEntries: (
    config: unknown
  ) => Array<{ file: string; key: string }>;

  beforeAll(async () => {
    const families = await import(
      pathToFileURL(path.join(REPO_ROOT, HOOKS_REL, RATCHET_MODULES[0])).href
    );
    const compare = await import(
      pathToFileURL(path.join(REPO_ROOT, HOOKS_REL, RATCHET_MODULES[1])).href
    );
    compareFile = compare.compareFile;
    applyAllowList = compare.applyAllowList;
    extractAllowEntries = families.extractAllowEntries;
  });

  describe("stryker", () => {
    const base = JSON.stringify({
      thresholds: { high: 80, low: 60, break: 60 },
      mutate: [SRC_GLOB, SPEC_NEGATION],
    });

    it("blocks lowering thresholds.break", () => {
      const current = base.replace('"break":60', '"break":40');
      const findings = compareFile(STRYKER_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        key: "thresholds.break",
        type: "weakened",
      });
    });

    it("ignores the reporting-only high/low bands", () => {
      const current = JSON.stringify({
        thresholds: { high: 70, low: 50, break: 60 },
        mutate: [SRC_GLOB, SPEC_NEGATION],
      });
      expect(compareFile(STRYKER_FILE, base, current)).toHaveLength(0);
    });

    it("flags a new mutate exclusion", () => {
      const current = JSON.stringify({
        thresholds: { high: 80, low: 60, break: 60 },
        mutate: [SRC_GLOB, SPEC_NEGATION, "!src/hard-stuff/**"],
      });
      const findings = compareFile(STRYKER_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe(TYPE_EXEMPTION);
    });

    it("flags removing a mutate target", () => {
      const current = JSON.stringify({
        thresholds: { high: 80, low: 60, break: 60 },
        mutate: [SPEC_NEGATION],
      });
      const findings = compareFile(STRYKER_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe(TYPE_EXEMPTION);
    });
  });

  describe("k6 bounds", () => {
    const base = JSON.stringify({
      thresholds: {
        http_req_failed: { threshold: RATE_UPPER, abortOnFail: true },
        http_req_duration: { threshold: P95_BOUND },
        checks: { threshold: RATE_LOWER },
      },
    });

    it("blocks loosening an upper bound", () => {
      const current = base.replace(P95_BOUND, "p(95)<3000");
      const findings = compareFile(K6_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe("weakened");
    });

    it("allows tightening an upper bound", () => {
      const current = base.replace(P95_BOUND, "p(95)<500");
      expect(compareFile(K6_FILE, base, current)).toHaveLength(0);
    });

    it("blocks loosening a lower bound", () => {
      const current = base.replace(RATE_LOWER, "rate>=0.9");
      const findings = compareFile(K6_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe("weakened");
    });

    it("blocks turning off abortOnFail", () => {
      const current = base.replace('"abortOnFail":true', '"abortOnFail":false');
      const findings = compareFile(K6_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0].key).toBe("http_req_failed.abortOnFail");
    });

    it("blocks removing an explicit abortOnFail entirely", () => {
      const current = JSON.stringify({
        thresholds: {
          http_req_failed: { threshold: RATE_UPPER },
          http_req_duration: { threshold: P95_BOUND },
          checks: { threshold: RATE_LOWER },
        },
      });
      const findings = compareFile(K6_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0].key).toBe("http_req_failed.abortOnFail");
    });

    it("handles long-format arrays without crashing and per item", () => {
      const arrayBase = JSON.stringify({
        thresholds: {
          http_req_duration: [
            "p(99)<2000",
            { threshold: P95_BOUND, abortOnFail: true },
          ],
        },
      });
      const weakened = JSON.stringify({
        thresholds: {
          http_req_duration: [
            "p(99)<2000",
            { threshold: P95_BOUND, abortOnFail: false },
          ],
        },
      });
      expect(compareFile(K6_FILE, arrayBase, arrayBase)).toHaveLength(0);
      const findings = compareFile(K6_FILE, arrayBase, weakened);
      expect(findings).toHaveLength(1);
      expect(findings[0].key).toBe("http_req_duration.abortOnFail[1]");
    });

    it("blocks deleting a gated metric", () => {
      const current = JSON.stringify({
        thresholds: {
          http_req_failed: { threshold: RATE_UPPER, abortOnFail: true },
          checks: { threshold: RATE_LOWER },
        },
      });
      const findings = compareFile(K6_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe("removed");
    });
  });

  describe("audit ignore lists", () => {
    it("flags a newly ignored advisory", () => {
      const base = JSON.stringify({ "GHSA-aaaa": "known, patched upstream" });
      const current = JSON.stringify({
        "GHSA-aaaa": "known, patched upstream",
        "GHSA-bbbb": "new ignore",
      });
      const findings = compareFile("audit.ignore.local.json", base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        key: "GHSA-bbbb",
        type: TYPE_EXEMPTION,
      });
    });

    it("allows removing an ignore (tightening)", () => {
      const base = JSON.stringify({ "GHSA-aaaa": "x", "GHSA-bbbb": "y" });
      const current = JSON.stringify({ "GHSA-aaaa": "x" });
      expect(
        compareFile("audit.ignore.config.json", base, current)
      ).toHaveLength(0);
    });
  });

  describe("allow-list", () => {
    it("flags new thresholdRatchet.allow entries", () => {
      const base = JSON.stringify({ thresholdRatchet: { allow: [] } });
      const current = JSON.stringify({
        thresholdRatchet: {
          allow: [
            {
              file: VITEST_FILE,
              key: KEY_LINES,
              reason: "legacy module onboarding",
            },
          ],
        },
      });
      const findings = compareFile(LISA_CONFIG_FILE, base, current);
      expect(findings).toHaveLength(1);
      expect(findings[0].type).toBe("allow-added");
    });

    it("ignores unrelated .lisa.config.json changes", () => {
      const base = JSON.stringify({ tracker: "jira" });
      const current = JSON.stringify({ tracker: "github" });
      expect(compareFile(LISA_CONFIG_FILE, base, current)).toHaveLength(0);
    });

    it("suppresses findings matched by a baseline allow entry", () => {
      const findings = compareFile(
        `packages/api/${VITEST_FILE}`,
        JSON.stringify({ global: { lines: 70 } }),
        JSON.stringify({ global: { lines: 50 } })
      );
      const { blocked, allowed } = applyAllowList(findings, [
        { file: VITEST_FILE, key: KEY_LINES },
      ]);
      expect(blocked).toHaveLength(0);
      expect(allowed).toHaveLength(1);
    });

    it("supports the wildcard key", () => {
      const findings = compareFile(
        VITEST_FILE,
        JSON.stringify({ global: { lines: 70, branches: 70 } }),
        JSON.stringify({ global: { lines: 50, branches: 40 } })
      );
      const { blocked } = applyAllowList(findings, [
        { file: VITEST_FILE, key: "*" },
      ]);
      expect(blocked).toHaveLength(0);
    });

    it("never lets an allow entry approve its own creation", () => {
      const findings = compareFile(
        LISA_CONFIG_FILE,
        JSON.stringify({}),
        JSON.stringify({
          thresholdRatchet: { allow: [{ file: VITEST_FILE, key: "*" }] },
        })
      );
      const { blocked } = applyAllowList(findings, [
        { file: LISA_CONFIG_FILE, key: "*" },
      ]);
      expect(blocked).toHaveLength(1);
    });

    it("extracts only well-formed allow entries", () => {
      expect(
        extractAllowEntries({
          thresholdRatchet: {
            allow: [
              { file: "a.json", key: "x" },
              { file: 42, key: "y" },
              "nope",
              null,
            ],
          },
        })
      ).toEqual([{ file: "a.json", key: "x" }]);
      expect(extractAllowEntries(undefined)).toEqual([]);
    });
  });
});
