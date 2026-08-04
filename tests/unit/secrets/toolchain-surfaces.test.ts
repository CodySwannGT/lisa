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

  it("refuses a malformed surfaces value instead of widening scope", () => {
    // Treating any non-array as "omitted" meant `surfaces: "remote"` — an easy
    // thing to write — quietly applied to every surface, which for a
    // platform-specific archive means offering a Linux binary to a laptop.
    expect(() =>
      appliesToSurface({ name: "gh", surfaces: "remote" }, "local")
    ).toThrow(/must be an array/);
    expect(() =>
      appliesToSurface({ name: "gh", surfaces: ["cloud"] }, "local")
    ).toThrow(/unknown surface/);
  });

  it("honours an explicit surface list", () => {
    const tool = { name: "gh", surfaces: ["remote"] };

    expect(appliesToSurface(tool, "remote")).toBe(true);
    expect(appliesToSurface(tool, "local")).toBe(false);
  });

  it("offers a laptop the artifact built for it, never another platform's", () => {
    // The concrete reason any of this exists. gh and bws used to be excluded
    // from a laptop outright — `surfaces: ["remote"]` — because the only pin
    // available was a Linux archive, and a Linux binary in ~/.local/bin cannot
    // run. That bought safety by making the two CLIs Lisa's own guardrails
    // shell out to unprovisionable on the machine most likely to lack them.
    //
    // Per-platform pins fix the cause, so the invariant is no longer "do not
    // offer" but "offer the right one".
    const cfg = JSON.parse(readFileSync(".lisa.config.json", "utf8")) as {
      remoteEnv: { tools: Record<string, readonly Record<string, string>[]> };
    };
    // The platform is explicit, never the host's: a resolution bug that only
    // appears on a platform CI does not run is precisely what this prevents.
    const local = planToolchain(
      cfg.remoteEnv.tools,
      PROBE,
      "local",
      "darwin-arm64"
    ) as { name: string; action: string; tool?: Record<string, unknown> }[];
    const installs = local.filter(step => step.action === "install");

    expect(installs.map(step => step.name)).toEqual(
      expect.arrayContaining(["gh", "bws"])
    );
    for (const step of installs) {
      const url = step.tool?.url;
      if (typeof url !== "string") continue; // npm-global has no archive
      expect(url, step.name).not.toMatch(/linux/i);
      expect(url, step.name).toMatch(/darwin|macOS/i);
    }
  });

  it("gives a container the linux artifact for the same tools", () => {
    const cfg = JSON.parse(readFileSync(".lisa.config.json", "utf8")) as {
      remoteEnv: { tools: Record<string, readonly Record<string, string>[]> };
    };
    const remote = planToolchain(
      cfg.remoteEnv.tools,
      PROBE,
      "remote",
      "linux-x64"
    ) as { name: string; action: string; tool?: Record<string, unknown> }[];
    const installs = remote.filter(step => step.action === "install");

    expect(installs.map(step => step.name)).toEqual(
      expect.arrayContaining(["gh", "bws"])
    );
    for (const step of installs) {
      const url = step.tool?.url;
      if (typeof url !== "string") continue;
      expect(url, step.name).not.toMatch(/darwin|macOS/i);
    }
  });
});
