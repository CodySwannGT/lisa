/**
 * One toolchain manifest, consumed by several surfaces.
 *
 * Not two config blocks. Most tools a project needs are needed everywhere — a
 * Maestro or Sonar CLI is as required on a laptop as in a container — and
 * duplicated blocks drift, which this repository has paid for more than once.
 * What genuinely differs between surfaces is the install method and, above all,
 * the consent: a disposable container may provision itself silently, a
 * developer's machine may not.
 * @module tests/unit/secrets/toolchain-surfaces
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  appliesToSurface,
  planToolchain,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/toolchain.mjs";

describe("one manifest, many surfaces", () => {
  // Not two config blocks. Most tools a project needs are needed everywhere — a
  // Maestro or Sonar CLI is as required on a laptop as in a container — and
  // duplicated blocks drift, which this repository has paid for more than once.
  // What differs between surfaces is the install method and the consent.
  /**
   *
   */
  /**
   * A probe that reports every tool absent, so the plan is the manifest's
   * decision rather than this machine's contents.
   * @returns A uniform "not installed" result
   */
  const PROBE = () => ({ present: false, version: null });

  it("applies an entry to every surface when none is named", () => {
    // Forgetting `surfaces` should cost a redundant check, never a silent
    // absence on the surface that needed it.
    expect(appliesToSurface({ name: "jq" }, "local")).toBe(true);
    expect(appliesToSurface({ name: "jq" }, "remote")).toBe(true);
  });

  it("honours an explicit surface list", () => {
    const tool = { name: "gh", surfaces: ["remote"] };

    expect(appliesToSurface(tool, "remote")).toBe(true);
    expect(appliesToSurface(tool, "local")).toBe(false);
  });

  it("never offers a linux-only archive to a laptop", () => {
    // The concrete reason this exists. Lisa pins gh and bws as Linux release
    // archives; installing either on a developer's machine would place a
    // binary that cannot run.
    const cfg = JSON.parse(readFileSync(".lisa.config.json", "utf8")) as {
      remoteEnv: { tools: Record<string, readonly Record<string, string>[]> };
    };
    const local = planToolchain(cfg.remoteEnv.tools, PROBE, "local");

    expect(local.filter(step => step.action === "install")).toHaveLength(0);
    // Still asserted there, so a missing tool is loud rather than discovered
    // at the moment of use.
    expect(local.map(step => step.name)).toContain("gh");
  });

  it("still installs them remotely", () => {
    const cfg = JSON.parse(readFileSync(".lisa.config.json", "utf8")) as {
      remoteEnv: { tools: Record<string, readonly Record<string, string>[]> };
    };
    const remote = planToolchain(cfg.remoteEnv.tools, PROBE, "remote");

    expect(
      remote.filter(step => step.action === "install").map(s => s.name)
    ).toEqual(expect.arrayContaining(["gh", "bws"]));
  });
});
