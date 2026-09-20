/** Landed behavior stays historical during deployment-branch synchronization. */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  EXTRA_FEATURE,
  EXTRA_FEATURE_FILE,
  EXTRA_ID,
  EXTRA_MAPPING,
  EXTRA_SPEC,
  EXTRA_SPEC_BODY,
  EXTRA_WAIVER,
} from "./bdd/regression-support.js";
import {
  GIT_BIN,
  WEB,
  RATIFIED,
  commitAll,
  featureSource,
  healthyProject,
  messages,
  runGate,
  runReport,
  hermeticEnv,
  readMap,
  writeMap,
} from "./bdd/support.js";

const CONFIG = ".lisa.config.json";
const REF = "refs/remotes/origin/staging";
const MAIN_REF = "refs/remotes/origin/main";
const DEFECT = "obligation-uncovered";
const UPDATE_REF = "update-ref";

/**
 * Execute one bounded git operation in the disposable fixture.
 * @param root - Fixture repository.
 * @param args - Git arguments.
 */
function git(root: string, ...args: string[]): void {
  const result = boundedSpawnSync({
    label: "deployment history fixture",
    command: GIT_BIN,
    args,
    cwd: root,
    env: hermeticEnv(root),
  });
  expect(result.status).toBe(0);
}

/**
 * Commit a mapped base, then an uncovered scenario on fetched staging history.
 * @param configured - Whether the immutable base declares the deployment chain.
 * @returns The fixture and its target base.
 */
function landed(
  configured = true,
  mapped = false
): { root: string; base: string; source: string } {
  const root = healthyProject({ coverageFloor: { [WEB]: 0 } });
  fs.writeFileSync(
    path.join(root, CONFIG),
    JSON.stringify(
      configured
        ? {
            deploy: {
              branches: { production: "main", staging: "staging", dev: "dev" },
            },
          }
        : {}
    )
  );
  const base = commitAll(root);
  fs.writeFileSync(
    path.join(root, "bdd/features", EXTRA_FEATURE_FILE),
    EXTRA_FEATURE
  );
  if (mapped) {
    const map = readMap(root);
    writeMap(root, {
      ...map,
      mappings: [...(map.mappings as object[]), EXTRA_MAPPING],
    });
    fs.writeFileSync(path.join(root, EXTRA_SPEC), EXTRA_SPEC_BODY);
  }
  const source = commitAll(root);
  git(root, UPDATE_REF, REF, source);
  fs.writeFileSync(path.join(root, "sync.txt"), "sync resolution\n");
  commitAll(root);
  return { root, base, source };
}

describe("deployment history obligations", () => {
  it("does not let an older source gap hide newer source coverage", () => {
    const { root, base, source } = landed();
    git(root, UPDATE_REF, MAIN_REF, source);
    const map = readMap(root);
    writeMap(root, {
      ...map,
      mappings: [...(map.mappings as object[]), EXTRA_MAPPING],
    });
    fs.writeFileSync(path.join(root, EXTRA_SPEC), EXTRA_SPEC_BODY);
    const coveredSource = commitAll(root);
    git(root, UPDATE_REF, REF, coveredSource);
    fs.writeFileSync(path.join(root, "after-source.txt"), "sync resolution\n");
    commitAll(root);
    writeMap(root, map);
    fs.unlinkSync(path.join(root, EXTRA_SPEC));
    expect(
      messages(runGate(root, { BDD_BASE_SHA: base }), DEFECT)
    ).toHaveLength(1);
  });

  it("does not use partial history when another source map is unreadable", () => {
    const { root, base, source } = landed();
    git(root, UPDATE_REF, MAIN_REF, source);
    const map = readMap(root);
    fs.writeFileSync(path.join(root, "bdd/coverage-map.json"), "{broken");
    const unreadable = commitAll(root);
    git(root, UPDATE_REF, REF, unreadable);
    writeMap(root, map);
    commitAll(root);
    expect(
      messages(runGate(root, { BDD_BASE_SHA: base }), DEFECT)
    ).toHaveLength(1);
  });

  it("does not let an older source gap hide removal of a newer waiver", () => {
    const { root, base, source } = landed();
    git(root, UPDATE_REF, MAIN_REF, source);
    const map = readMap(root);
    writeMap(root, { ...map, platformWaivers: [EXTRA_WAIVER] });
    const waivedSource = commitAll(root);
    git(root, UPDATE_REF, REF, waivedSource);
    writeMap(root, map);
    commitAll(root);
    expect(
      messages(runGate(root, { BDD_BASE_SHA: base }), DEFECT)
    ).toHaveLength(1);
  });

  it("does not exempt the commit currently being checked", () => {
    const { root, base } = landed();
    git(root, UPDATE_REF, REF, "HEAD");
    expect(
      messages(runGate(root, { BDD_BASE_SHA: base }), DEFECT)
    ).toHaveLength(1);
  });

  it("still rejects loss of source-only test coverage", () => {
    const { root, base } = landed(true, true);
    const map = readMap(root);
    writeMap(root, {
      ...map,
      mappings: (map.mappings as { scenario: string }[]).filter(
        mapping => mapping.scenario !== EXTRA_ID
      ),
    });
    fs.unlinkSync(path.join(root, EXTRA_SPEC));
    expect(
      messages(runGate(root, { BDD_BASE_SHA: base }), DEFECT)
    ).toHaveLength(1);
  });

  it("keeps shared source history when its remote tip advances", () => {
    const { root, base, source } = landed();
    git(root, "branch", "sync-checkpoint", "HEAD");
    git(root, "checkout", "--detach", source);
    fs.writeFileSync(
      path.join(root, "later.txt"),
      "independent source change\n"
    );
    const later = commitAll(root);
    git(root, UPDATE_REF, REF, later);
    git(root, "checkout", "sync-checkpoint");
    expect(messages(runGate(root, { BDD_BASE_SHA: base }), DEFECT)).toEqual([]);
  });

  it("retains historical gaps without claiming coverage or execution", () => {
    const { root, base } = landed();
    const result = runGate(root, { BDD_BASE_SHA: base });
    expect(messages(result, DEFECT)).toEqual([]);
    expect(result.status).toBe(0);
    expect(JSON.stringify(runReport(root).gaps)).toContain(EXTRA_ID);
  });

  it("still rejects a newly authored uncovered scenario", () => {
    const { root, base } = landed();
    fs.writeFileSync(
      path.join(root, "bdd/features/new.feature"),
      featureSource("New", [{ id: "BDD-NEW-001", tags: [WEB, RATIFIED] }])
    );
    const result = runGate(root, { BDD_BASE_SHA: base });
    expect(messages(result, DEFECT)).toHaveLength(1);
    expect(messages(result, DEFECT)[0]).toContain("BDD-NEW-001");
  });

  it("does not trust a deployment declaration added by this change", () => {
    const { root, base } = landed(false);
    fs.writeFileSync(
      path.join(root, CONFIG),
      JSON.stringify({ deploy: { branches: { staging: "staging" } } })
    );
    expect(
      messages(runGate(root, { BDD_BASE_SHA: base }), DEFECT)
    ).toHaveLength(1);
  });

  it("does not accept a local-only or missing remote branch", () => {
    const { root, base } = landed();
    git(root, UPDATE_REF, "refs/heads/staging", "HEAD");
    git(root, UPDATE_REF, "-d", REF);
    expect(
      messages(runGate(root, { BDD_BASE_SHA: base }), DEFECT)
    ).toHaveLength(1);
  });

  it("does not accept an unmerged source tip", () => {
    const { root, base } = landed();
    git(root, "checkout", "--detach", base);
    fs.writeFileSync(
      path.join(root, "bdd/features", EXTRA_FEATURE_FILE),
      EXTRA_FEATURE
    );
    expect(
      messages(runGate(root, { BDD_BASE_SHA: base }), DEFECT)
    ).toHaveLength(1);
  });
});
