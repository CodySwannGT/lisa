/**
 * Tests for contract validation: scenario shape, tracker tags, mappings,
 * waivers, and refusal of author-supplied paths that escape the repository.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  HEALTHY_FEATURES,
  HEALTHY_FILES,
  HEALTHY_MAP,
  HOME_EVIDENCE,
  HOME_ID,
  HOME_SPEC,
  HOME_FEATURE_FILE,
  MAPPING_FILE,
  PLAYWRIGHT,
  RATIFIED,
  WEB,
  codes,
  emptyProject,
  featureSource,
  healthyMapping,
  healthyProject,
  makeProject,
  messages,
  runGate,
  runReport,
} from "./bdd/support";

describe("scenario and mapping validation", () => {
  it("rejects duplicate scenario IDs", () => {
    const root = healthyProject(
      {},
      {
        features: {
          "dup.feature": featureSource("Dup", [
            { id: HOME_ID, tags: [WEB, RATIFIED] },
          ]),
        },
      }
    );
    expect(codes(runGate(root))).toContain("scenario-duplicate-id");
  });

  it("rejects a scenario carrying more than one lifecycle tag", () => {
    const root = healthyProject(
      {},
      {
        features: {
          [HOME_FEATURE_FILE]: featureSource("Home", [
            { id: HOME_ID, tags: [WEB, RATIFIED, "blocked", "superseded"] },
          ]),
        },
      }
    );
    expect(codes(runGate(root))).toContain("scenario-lifecycle");
  });

  it("rejects an orphan tracker tag naming an undeclared key or repo", () => {
    const root = healthyProject(
      {},
      {
        features: {
          [HOME_FEATURE_FILE]: featureSource("Home", [
            { id: HOME_ID, tags: [WEB, RATIFIED, "NOPE-1", "gh-ghost-3"] },
          ]),
        },
      }
    );
    const found = messages(runGate(root), "tracker-orphan");
    expect(found.some(item => item.includes("NOPE"))).toBe(true);
    expect(found.some(item => item.includes("ghost"))).toBe(true);
  });

  it("can require a tracker tag on every scenario, per repo", () => {
    const root = healthyProject(
      {
        trackers: {
          required: true,
          keys: [],
          github: { org: "o", defaultRepo: "r", repos: ["r"] },
        },
      },
      {
        features: {
          [HOME_FEATURE_FILE]: featureSource("Home", [
            { id: HOME_ID, tags: [WEB, RATIFIED] },
          ]),
        },
      }
    );
    expect(codes(runGate(root))).toContain("tracker-missing");
  });

  it("rejects an orphan mapping naming a scenario that does not exist", () => {
    const root = healthyProject({
      mappings: [{ ...healthyMapping(), scenario: "BDD-GHOST-999" }],
    });
    expect(codes(runGate(root))).toContain("mapping-orphan");
  });

  it("rejects a stale mapping whose evidence string is gone", () => {
    const root = healthyProject(
      {},
      { files: { [HOME_SPEC]: "test('renamed', () => {});\n" } }
    );
    expect(codes(runGate(root))).toContain("mapping-evidence");
  });

  it("allows distinct tests to map the same scenario, runner, and platform", () => {
    const secondEvidence = "renders the compact home page";
    const root = healthyProject(
      {
        mappings: [
          healthyMapping(),
          { ...healthyMapping(), evidence: secondEvidence },
        ],
      },
      {
        files: {
          [HOME_SPEC]: `test("${HOME_EVIDENCE}", () => {});\ntest("${secondEvidence}", () => {});\n`,
        },
      }
    );
    expect(codes(runGate(root))).not.toContain("mapping-duplicate");
  });

  it("rejects the exact same test mapping twice", () => {
    const root = healthyProject({
      mappings: [healthyMapping(), healthyMapping()],
    });
    expect(codes(runGate(root))).toContain("mapping-duplicate");
  });

  it("rejects a mapping whose runner is not configured for the claimed platform", () => {
    const root = healthyProject({
      runnerPlatforms: { [PLAYWRIGHT]: [WEB], maestro: ["ios"] },
      coverageFloor: { [WEB]: 0, ios: 0 },
      mappings: [{ ...healthyMapping(), runner: "maestro" }],
    });
    expect(codes(runGate(root))).toContain("mapping-runner");
  });

  it("rejects a mapping claiming a platform the scenario does not declare", () => {
    const root = healthyProject({
      runnerPlatforms: { [PLAYWRIGHT]: [WEB, "tv"] },
      coverageFloor: { [WEB]: 0, tv: 0 },
      mappings: [{ ...healthyMapping(), platforms: [WEB, "tv"] }],
    });
    expect(codes(runGate(root))).toContain("mapping-platform");
  });
});

describe("path traversal and symlinks", () => {
  it("refuses a mapping path that escapes the repository", () => {
    const root = healthyProject({
      mappings: [{ ...healthyMapping(), file: "../../etc/passwd" }],
    });
    expect(messages(runGate(root), MAPPING_FILE)[0]).toContain(
      "escapes the repository"
    );
  });

  it("refuses an absolute mapping path", () => {
    const root = healthyProject({
      mappings: [{ ...healthyMapping(), file: "/etc/hosts" }],
    });
    expect(messages(runGate(root), MAPPING_FILE)[0]).toContain("repo-relative");
  });

  it("refuses a symlink that resolves outside the repository", () => {
    // A sibling of the fixture project, so it is genuinely outside the
    // repository under test while still being cleaned up with the rest.
    const outside = emptyProject("outside-");
    fs.writeFileSync(path.join(outside, "secret.txt"), `${HOME_EVIDENCE}\n`);
    const root = healthyProject({
      mappings: [{ ...healthyMapping(), file: "e2e/link.spec.ts" }],
    });
    fs.symlinkSync(
      path.join(outside, "secret.txt"),
      path.join(root, "e2e", "link.spec.ts")
    );
    expect(messages(runGate(root), MAPPING_FILE)[0]).toContain(
      "symlink resolves outside"
    );
  });
});

/** A contract whose single obligation is waived rather than mapped. */
const WAIVER = {
  scenario: HOME_ID,
  platforms: [WEB],
  reason: "the inquiries endpoint writes to the one live workspace",
  owner: "cody@example.test",
  ticket: "TUN-77",
  recordedAt: "2026-08-01",
  expiresAt: "2026-12-31",
};

const WAIVED_MAP = {
  ...HEALTHY_MAP,
  mappings: [],
  platformWaivers: [WAIVER],
};

/**
 * Lay down the waived project with a patched waiver list.
 * @param map - Map overrides.
 * @returns Project root.
 */
function waivedProject(map: Record<string, unknown> = {}): string {
  return makeProject({
    map: { ...WAIVED_MAP, ...map },
    features: HEALTHY_FEATURES,
    files: HEALTHY_FILES,
  });
}

describe("waivers", () => {
  it("accepts a fully-recorded waiver and keeps it out of the denominator", () => {
    const report = runReport(waivedProject());
    expect(report.waived.count).toBe(1);
    expect(report.traceability.overall.total).toBe(0);
    expect(report.waived.entries[0]).toMatchObject({
      owner: "cody@example.test",
      ticket: "TUN-77",
      expiresAt: "2026-12-31",
    });
  });

  it("requires owner, ticket, and expiry on every waiver", () => {
    const root = waivedProject({
      platformWaivers: [
        {
          scenario: HOME_ID,
          platforms: [WEB],
          reason: "r",
          recordedAt: "2026-08-01",
        },
      ],
    });
    const found = messages(runGate(root), "waiver-metadata");
    for (const field of ["owner", "ticket", "expiresAt"]) {
      expect(
        found.some(item => item.includes(field)),
        field
      ).toBe(true);
    }
  });

  it("rejects a waiver ticket that is not a valid tracker reference", () => {
    const root = waivedProject({
      platformWaivers: [{ ...WAIVER, ticket: "some ticket somewhere" }],
    });
    const found = messages(runGate(root), "waiver-metadata");
    expect(
      found.some(item => item.includes("not a valid tracker reference"))
    ).toBe(true);
  });

  it("fails an expired waiver, so an IOU cannot outlive its reason silently", () => {
    const root = waivedProject({
      platformWaivers: [{ ...WAIVER, expiresAt: "2026-01-01" }],
    });
    expect(codes(runGate(root))).toContain("waiver-expired");
  });

  it("rejects a waiver that masks an existing mapping", () => {
    const root = waivedProject({ mappings: HEALTHY_MAP.mappings });
    expect(codes(runGate(root))).toContain("waiver-masks-mapping");
  });

  it("rejects a duplicate waiver for the same scenario and platform", () => {
    const root = waivedProject({ platformWaivers: [WAIVER, { ...WAIVER }] });
    expect(codes(runGate(root))).toContain("waiver-duplicate");
  });

  it("rejects a waiver naming a scenario that is already excluded", () => {
    const root = makeProject({
      map: WAIVED_MAP,
      features: {
        [HOME_FEATURE_FILE]: featureSource("Home", [
          { id: HOME_ID, tags: [WEB, RATIFIED, "blocked"] },
        ]),
      },
      files: HEALTHY_FILES,
    });
    expect(codes(runGate(root))).toContain("waiver-excluded");
  });

  it("requires a waiver to name its runner when the platform has more than one", () => {
    const root = waivedProject({
      runnerPlatforms: { [PLAYWRIGHT]: [WEB], cypress: [WEB] },
    });
    expect(codes(runGate(root))).toContain("waiver-runner");
  });
});
