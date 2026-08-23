/**
 * Regression tests for the reported correctness findings that concern what the
 * gate MEASURES and what it emits (CodySwannGT/lisa#2468, section A: #1, #2,
 * #4, #5, #9, #10).
 *
 * The findings about how the gate reads paths and Gherkin live next door, in
 * `bdd-gate-paths.test.ts`.
 *
 * @module tests/unit/scripts/bdd-gate-correctness
 */
import * as path from "node:path";

import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
} from "../../helpers/io-latency-budget.js";
import { GATE_DIR, SHARED_DIR, vendorGateWithoutSchemas } from "./bdd/sources";
import {
  BOOTSTRAP,
  ENFORCED,
  HEALTHY_MAP,
  HOME_EVIDENCE,
  HOME_ID,
  HOME_SPEC,
  PLAYWRIGHT,
  PLAYWRIGHT_DISCOVERY,
  RATIFIED,
  REPO_ROOT,
  TODAY,
  WEB,
  codes,
  featureSource,
  healthyProject,
  hermeticEnv,
  makeProject,
  read,
  runGate,
} from "./bdd/support";

/**
 * Liveness bound for the vendored-gate case, calibrated to this machine.
 *
 * It used to sit inline as `}, 30_000)`, where it measured the machine rather
 * than the code and silently overrode the file-level budget raised in
 * CodySwannGT/lisa#2888. Re-measured untruncated at 98 live vitest processes
 * and a 1-minute load average of 44.7 on 18 cores, the case takes 61,153ms —
 * 2.04x the number that was capping it (CodySwannGT/lisa#2894).
 */
const VENDORED_GATE_BUDGET_MS = ioLatencyBudgetMs(30_000);

/** A waiver whose expiry passed long ago. */
const EXPIRED_WAIVER = {
  scenario: HOME_ID,
  platforms: [WEB],
  reason: "the runner cannot decide it",
  owner: "someone",
  ticket: "TUN-1",
  recordedAt: "2020-01-01",
  expiresAt: "2020-06-01",
};

describe("bdd gate: measurement and output findings (lisa#2468)", () => {
  describe("#1 the floor compares an unrounded percentage", () => {
    it("fails a platform at 99.95% against a floor of 100", async () => {
      const module = (await import(
        path.join(REPO_ROOT, GATE_DIR, "bdd", "report.mjs")
      )) as {
        buildReport: (input: Record<string, unknown>) => {
          traceability: { byPlatform: Record<string, { percentage: number }> };
          floor: { byPlatform: Record<string, { ok: boolean }>; ok: boolean };
        };
      };
      const total = 2001;
      const scenarios = Array.from({ length: total }, (_unused, index) => ({
        id: `BDD-BIG-${String(index).padStart(4, "0")}`,
        name: `behavior ${index}`,
        feature: "Big",
        required: true,
        platforms: [WEB],
        lifecycle: [],
        trackers: [],
      }));
      // One obligation short of complete: 2000/2001 is 99.95002%, which rounds
      // to 100.0 for display and must still fail a floor of 100.
      const contract = {
        runnerPlatforms: { [PLAYWRIGHT]: [WEB] },
        coverageFloor: { [WEB]: 100 },
        mappings: scenarios.slice(0, total - 1).map(scenario => ({
          scenario: scenario.id,
          runner: PLAYWRIGHT,
          platforms: [WEB],
          file: HOME_SPEC,
          evidence: HOME_EVIDENCE,
        })),
      };
      const report = module.buildReport({
        scenarios,
        contract,
        runs: [],
        platforms: new Set([WEB]),
      });
      expect(report.traceability.byPlatform[WEB]?.percentage).toBe(100);
      expect(report.floor.byPlatform[WEB]?.ok).toBe(false);
      expect(report.floor.ok).toBe(false);
    });
  });

  describe("#2 an unusable BDD_TODAY cannot excuse an expired waiver", () => {
    it("reports waiver-metadata instead of silently passing every expiry", () => {
      const root = healthyProject({
        platformWaivers: [EXPIRED_WAIVER],
        mappings: [],
      });
      const run = runGate(root, {
        BDD_MODE: BOOTSTRAP,
        BDD_TODAY: "not-a-date",
      });
      expect(codes(run)).toContain("waiver-metadata");
    });

    it("still reports the expiry when the date is usable", () => {
      const root = healthyProject({
        platformWaivers: [EXPIRED_WAIVER],
        mappings: [],
      });
      const run = runGate(root, { BDD_MODE: BOOTSTRAP });
      expect(codes(run)).toContain("waiver-expired");
    });
  });

  describe("#4/#9 a partially copied scripts/ directory fails readably", () => {
    // Vendors fifteen files and spawns a fresh Node, so it is the slowest case
    // in the suite; the default per-test budget is not enough under load.
    it(
      "emits an envelope and exits nonzero instead of an ENOENT stack",
      () => {
        const project = makeProject({
          map: { ...HEALTHY_MAP, mappings: [] },
          features: {
            "home.feature": featureSource("Home", [
              { id: HOME_ID, tags: [WEB, RATIFIED] },
            ]),
          },
        });
        const scripts = vendorGateWithoutSchemas(project);
        const result = boundedSpawnSync({
          label: "vendored check-bdd-coverage.mjs --json",
          command: process.execPath,
          args: [path.join(scripts, "check-bdd-coverage.mjs"), "--json"],
          env: {
            ...hermeticEnv(project),
            BDD_COVERAGE_ROOT: project,
            BDD_TODAY: TODAY,
            BDD_MODE: ENFORCED,
          },
        });
        // A named, operator-readable line — not a raw stack from an import the
        // operator never made.
        const stack = result.stderr
          .split("\n")
          .some(line => line.trimStart().startsWith("at "));
        expect(stack).toBe(false);
        expect(result.stderr).toContain(
          "[bdd-coverage] invalid command envelope"
        );
        expect(result.stderr).toContain("lisa-command-envelope.v1.schema.json");
        const envelope = JSON.parse(result.stdout.trim()) as {
          status: string;
          reason?: string;
        };
        expect(envelope.status).toBe("invalid");
        expect(envelope.reason).toBeTruthy();
        expect(result.status).toBe(1);
      },
      VENDORED_GATE_BUDGET_MS
    );
  });

  describe("#10 the array form of `type` is validated, not waved through", () => {
    it("rejects a value matching none of the declared types", async () => {
      const module = (await import(
        path.join(REPO_ROOT, SHARED_DIR, "lisa-schema-validate.mjs")
      )) as {
        validateAgainstSchema: (
          document: unknown,
          schema: unknown
        ) => { valid: boolean; errors: string[] };
      };
      const schema = {
        type: "object",
        properties: { a: { type: ["string", "null"] } },
      };
      expect(module.validateAgainstSchema({ a: 1 }, schema).valid).toBe(false);
      expect(module.validateAgainstSchema({ a: null }, schema).valid).toBe(
        true
      );
      expect(module.validateAgainstSchema({ a: "x" }, schema).valid).toBe(true);
      expect(
        module.validateAgainstSchema(1, { type: ["object", "string"] }).valid
      ).toBe(false);
    });
  });

  describe("#5 REFUTED — the state contract's conditionals ARE enforced", () => {
    it("is read by check-state-classification, which enforces each one", () => {
      const source = read(`${SHARED_DIR}/check-state-classification.mjs`);
      expect(source).toContain("lisa-state-contract.v1.schema.json");
      expect(source).toContain("validateAgainstSchema");
      for (const requirement of [
        "entity.ownership",
        "entity.sweptBy",
        "entity.rebuiltBy",
        "entity.enforcedBy",
        "contract.noop?.capabilityManifest",
      ]) {
        expect(source).toContain(requirement);
      }
    });
  });

  describe("the enforced defect set is unchanged", () => {
    it("still refuses a malformed discovery block in enforced mode", () => {
      const root = healthyProject({
        testDiscovery: {
          [PLAYWRIGHT]: PLAYWRIGHT_DISCOVERY,
          unknownRunner: PLAYWRIGHT_DISCOVERY,
        },
      });
      const run = runGate(root, { BDD_MODE: ENFORCED });
      expect(codes(run)).toContain("discovery-invalid");
    });
  });
});
