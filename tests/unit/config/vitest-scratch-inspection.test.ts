import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  SCRATCH_NAMESPACE,
  removeScratchDir,
} from "../../../src/configs/vitest/scratch.js";
import { getCdkVitestConfig } from "../../../src/configs/vitest/cdk.js";
import {
  resolveScratchRouteProfile,
  type ScratchRouteProfileName,
} from "../../../src/configs/vitest/scratch-route-profile.js";
import {
  inspectNamespace,
  sweepThenInspect,
} from "../../../src/configs/vitest/scratch-global-setup.js";
import { SCRATCH_OWNER_FILE } from "../../../src/configs/vitest/scratch-owner.js";
import { withProcessPlatformTempRoot } from "../../helpers/template-toolchain.js";

/**
 * Report every recorded process as alive.
 * @returns Always true
 */
const ALWAYS_ALIVE = (): boolean => true;
const DEAD_ROOT = "run-111-1000-dead01";
const LIVE_ROOT = "run-222-1000-live01";
const FOREIGN_ENTRY = "not-a-run-root";
const temporaryBases: string[] = [];
const ROUTES: readonly ScratchRouteProfileName[] = [
  "lisa",
  "typescript",
  "npm-package",
  "node",
  "nestjs",
  "cdk",
  "harper-fabric",
  "phaser",
  "expo",
];

/**
 * Build one isolated exact namespace.
 * @returns Isolated namespace path
 */
const makeNamespace = (): string => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "scratch-spec-base-"));
  const namespace = path.join(base, SCRATCH_NAMESPACE);
  temporaryBases.push(base);
  fs.mkdirSync(namespace, { mode: 0o700 });
  return namespace;
};

/**
 * Run a control under the concurrency-scoped authority seam.
 * @param namespace - Isolated exact namespace
 * @param operation - Control to execute
 * @returns Control result
 */
const withNamespaceAuthority = <T>(namespace: string, operation: () => T): T =>
  withProcessPlatformTempRoot(path.dirname(namespace), operation);

afterEach(() => {
  for (const base of temporaryBases.splice(0)) removeScratchDir(base);
});

describe("inspectNamespace", () => {
  it.each([100, 1_000])(
    "reuses one process-birth snapshot while sweeping and inspecting %i live roots",
    rootCount => {
      const dir = makeNamespace();
      const namespaceStat = fs.lstatSync(dir);
      const canonicalNamespace = fs.realpathSync(dir);
      for (let index = 0; index < rootCount; index += 1) {
        const pid = index + 10;
        const root = path.join(
          dir,
          `run-${String(pid)}-1000-live${String(index)}`
        );
        fs.mkdirSync(root);
        const rootStat = fs.lstatSync(root);
        fs.writeFileSync(
          path.join(root, SCRATCH_OWNER_FILE),
          `${JSON.stringify({
            schema: 1,
            pid,
            processBirthFingerprint: `birth-${String(pid)}`,
            createdAt: "2026-08-26T00:00:00.000Z",
            token: `token-${String(pid)}`,
            suiteLabel: "bulk-owner-control",
            registeredPrefixes: ["cdk.out"],
            namespace: {
              canonicalPath: canonicalNamespace,
              dev: namespaceStat.dev,
              ino: namespaceStat.ino,
            },
            root: {
              canonicalPath: fs.realpathSync(root),
              dev: rootStat.dev,
              ino: rootStat.ino,
            },
          })}\n`,
          "utf8"
        );
      }
      let snapshotCalls = 0;

      const residue = withNamespaceAuthority(dir, () =>
        sweepThenInspect(ALWAYS_ALIVE, pids => {
          snapshotCalls += 1;
          return new Map(
            pids.map(pid => [pid, `birth-${String(pid)}`] as const)
          );
        })
      );

      expect(snapshotCalls).toBe(1);
      expect(residue).toEqual({
        orphaned: [],
        unrecognised: [],
        total: rootCount,
      });
    }
  );

  it("classifies every markerless root as unowned authority", () => {
    const dir = makeNamespace();
    fs.mkdirSync(path.join(dir, DEAD_ROOT));
    fs.mkdirSync(path.join(dir, LIVE_ROOT));
    fs.mkdirSync(path.join(dir, FOREIGN_ENTRY));

    const residue = inspectNamespace(dir, pid => pid === 222);

    expect(residue).toEqual({
      orphaned: [],
      unrecognised: [FOREIGN_ENTRY, DEAD_ROOT, LIVE_ROOT],
      total: 3,
    });
  });

  it("classifies a corrupt marker on a recognized name as unowned", () => {
    const dir = makeNamespace();
    const corrupt = path.join(dir, LIVE_ROOT);
    fs.mkdirSync(corrupt);
    fs.writeFileSync(
      path.join(corrupt, SCRATCH_OWNER_FILE),
      "not-json",
      "utf8"
    );

    expect(inspectNamespace(dir, () => true)).toEqual({
      orphaned: [],
      unrecognised: [LIVE_ROOT],
      total: 1,
    });
  });

  it("reports an empty namespace for a directory that is not there", () => {
    expect(inspectNamespace("/nonexistent/lisa-scratch-absent")).toEqual({
      orphaned: [],
      unrecognised: [],
      total: 0,
    });
  });
});

describe("lisa-test-run scratch route profiles", () => {
  it.each(ROUTES)("freezes the explicit %s registry", route => {
    const profile = resolveScratchRouteProfile(route, {});

    expect(profile.name).toBe(route);
    expect(profile.suiteLabel).toBe(route);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.registeredPrefixes)).toBe(true);
  });

  it("binds the CDK route without a dynamic Vitest registry", () => {
    const profile = resolveScratchRouteProfile("cdk", {});
    expect(profile).toEqual({
      name: "cdk",
      suiteLabel: "cdk",
      registeredPrefixes: ["cdk.out"],
    });
    expect(
      profile.registeredPrefixes.some(prefix => "cdk-rogue".startsWith(prefix))
    ).toBe(false);
    expect(getCdkVitestConfig().test?.env).toBeUndefined();
  });

  it("binds the Lisa route to its committed fixture registry", () => {
    expect(resolveScratchRouteProfile("lisa", {}).registeredPrefixes).toEqual([
      "changelog-",
      "derived-",
      "e2e-",
      "failure-signatures-",
      "invoked-",
      "lisa-",
      "maestro-",
      "node-",
      "review-",
      "skipreq-",
      "state-",
      "vacuity-",
      "wiki-",
    ]);
  });

  it("canonicalizes additions, freezes them, and refuses suite conflicts", () => {
    const profile = resolveScratchRouteProfile("cdk", {
      LISA_TEST_SCRATCH_PREFIXES: '["operator-cdk-","operator-cdk-"]',
    });
    expect(profile.registeredPrefixes).toEqual(["cdk.out", "operator-cdk-"]);
    expect(() =>
      (profile.registeredPrefixes as string[]).push("replacement")
    ).toThrow();
    expect(() =>
      resolveScratchRouteProfile("cdk", {
        LISA_TEST_SCRATCH_SUITE: "typescript",
      })
    ).toThrow(/conflicts/iu);
  });

  it.each(["", "unknown", "../cdk"])("refuses profile %j", profile => {
    expect(() => resolveScratchRouteProfile(profile, {})).toThrow(/profile/iu);
  });
});
