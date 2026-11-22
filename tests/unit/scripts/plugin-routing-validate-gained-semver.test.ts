/**
 * An upstream that gains a semver AFTER its routing artifact was approved
 * (CodySwannGT/lisa#4556).
 *
 * `code-review@claude-plugins-official` was approved with
 * `upstreamVersion: "unknown"` because its cache held only `unknown` and
 * commit-hash directories. Upstream later published `1.0.1`; the new sibling
 * directory appeared in every machine's cache and the pre-push validator began
 * refusing every push, although nobody had touched the artifact.
 *
 * These cases pin that transition with committed fixtures that mirror the real
 * cache shape (an `unknown` dir, a hash dir, and — after the change — a `1.0.1`
 * dir), so the contract is proven end to end through the CLI:
 *
 *   1. the approved `unknown` artifact is valid against the pre-semver cache;
 *   2. the SAME artifact fails against the cache once `1.0.1` appears, with the
 *      exact message the push gate prints — the cache change alone flips it;
 *   3. the re-analysed artifact (`1.0.1` + `synced-from` stamps) passes;
 *   4. bumping only the number, without the stamps, still fails — so the
 *      repair cannot be a one-field edit that skips re-pinning the reimplementations.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED.
 *
 * @module tests/unit/scripts/plugin-routing-validate-gained-semver
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cacheMaxVersion,
  validateArtifact,
} from "../../../scripts/plugin-routing-validate.mjs";
import {
  CACHE_FLAG,
  DEMO_MKT,
  FIXTURE_CACHE,
  FIXTURE_ROOT,
  ROUTING_DIR_FLAG,
  runValidate,
  summaryOf,
} from "./plugin-routing-validate-helpers.js";

const PLUGIN = "gained-semver";
const FILE = `${PLUGIN}@${DEMO_MKT}.json`;
const STALE_DIR = path.join(FIXTURE_ROOT, "gained-semver-stale");
const REPINNED_DIR = path.join(FIXTURE_ROOT, "gained-semver-repinned");
const CACHE_BEFORE = path.join(FIXTURE_ROOT, "cache-before-semver");

/**
 * Run the validator over one routing dir against one cache root.
 *
 * @param routingDir - the routing fixture dir.
 * @param cacheRoot - the cache fixture root.
 * @returns The exit code and parsed report.
 */
const validate = (routingDir: string, cacheRoot: string) =>
  runValidate([ROUTING_DIR_FLAG, routingDir, CACHE_FLAG, cacheRoot, "--json"]);

describe("upstream gains a semver after approval", () => {
  it("resolves no semver before the upstream publishes one", () => {
    expect(cacheMaxVersion(CACHE_BEFORE, PLUGIN, DEMO_MKT)).toBeNull();
  });

  it("resolves the new semver past the unknown and hash sibling dirs", () => {
    expect(cacheMaxVersion(FIXTURE_CACHE, PLUGIN, DEMO_MKT)).toBe("1.0.1");
  });

  it("accepts the approved unknown artifact against the pre-semver cache", () => {
    const { code, report } = validate(STALE_DIR, CACHE_BEFORE);
    expect(code).toBe(0);
    expect(report.summary).toEqual(summaryOf(1, 1, 0));
  });

  it("refuses the same artifact once the cache gains 1.0.1", () => {
    const { code, report } = validate(STALE_DIR, FIXTURE_CACHE);
    expect(code).toBe(1);
    expect(report.summary).toEqual(summaryOf(1, 0, 1));
    expect(report.results[0]?.file).toBe(FILE);
    expect(report.results[0]?.errors).toEqual([
      'upstreamVersion "unknown" but the cache has semver 1.0.1',
    ]);
  });

  it("accepts the re-analysed artifact pinned to 1.0.1 with synced-from stamps", () => {
    const { code, report } = validate(REPINNED_DIR, FIXTURE_CACHE);
    expect(code).toBe(0);
    expect(report.summary).toEqual(summaryOf(1, 1, 0));
  });

  it("still refuses a version bump that skips re-pinning the reimplementations", () => {
    const artifact = JSON.parse(
      fs.readFileSync(path.join(STALE_DIR, FILE), "utf8")
    ) as { upstreamVersion: string };
    artifact.upstreamVersion = "1.0.1";
    const stamp = `"synced-from: ${PLUGIN}@${DEMO_MKT}@1.0.1"`;
    expect(
      validateArtifact(artifact, {
        cacheMax: "1.0.1",
        filename: FILE,
        mdExists: true,
      })
    ).toEqual([
      `routing.agy reimplement actions must include the stamp ${stamp}`,
      `routing.codex reimplement actions must include the stamp ${stamp}`,
      `routing.devin reimplement actions must include the stamp ${stamp}`,
    ]);
  });
});
