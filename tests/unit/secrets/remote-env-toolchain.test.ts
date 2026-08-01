/**
 * Contract tests for the remote-environment toolchain planner.
 *
 * The planner decides what a container already has and what it still needs.
 * Getting that wrong is expensive in both directions: a missed `require` turns
 * a vendor base-image change into a mysterious mid-task failure, and a missed
 * version pin silently serves a stale tool on every cache resume.
 *
 * Planning is separated from execution in the implementation, so every decision
 * below is exercised through an injected probe — no container, no network, and
 * no real binary anywhere.
 * @module tests/unit/secrets/remote-env-toolchain
 */
import { describe, expect, it } from "vitest";

import {
  assertPinned,
  compareVersions,
  extractVersion,
  planToolchain,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/toolchain.mjs";

/** What a `--version` probe reports for one tool. */
type Probed = { present: boolean; version: string | null };

/**
 * Build a probe backed by a fixed table, standing in for real `--version` calls.
 * @param table Probe results by tool name.
 * @returns A probe function the planner can call.
 */
const probeFrom =
  (table: Record<string, Probed>) =>
  (name: string): Probed =>
    table[name] ?? { present: false, version: null };

/**
 * Plan a manifest and return the decision recorded for one tool.
 * @param tools Toolchain manifest.
 * @param table Probe results by tool name.
 * @param name Tool to look up.
 * @returns The planned action, or an empty string when absent from the plan.
 */
const actionFor = (
  tools: Record<string, unknown>,
  table: Record<string, Probed>,
  name: string
): string =>
  planToolchain(tools, probeFrom(table)).find(p => p.name === name)?.action ??
  "";

describe("version handling", () => {
  it("compares numerically, so 10 is newer than 9", () => {
    // String comparison gets exactly this case wrong, and it is the case that
    // matters: a base-image bump to a new major would read as a downgrade.
    expect(compareVersions("10.0.0", "9.9.9")).toBeGreaterThan(0);
  });

  it("treats absent components as zero", () => {
    expect(compareVersions("20", "20.0.0")).toBe(0);
  });

  it.each([
    ["bws 2.1.0", "2.1.0"],
    ["v20.11.0", "20.11.0"],
    ["Python 3.12.1", "3.12.1"],
    ["codex-cli 0.144.6", "0.144.6"],
  ])("extracts a version from %j", (output, expected) => {
    expect(extractVersion(output)).toBe(expected);
  });

  it("returns null when nothing resembles a version", () => {
    expect(extractVersion("no numbers here")).toBeNull();
  });
});

describe("required tools", () => {
  const tools = { require: [{ name: "python3" }], install: [] };

  it("passes when the base image provides it", () => {
    const table = { python3: { present: true, version: "3.12.1" } };
    expect(actionFor(tools, table, "python3")).toBe("present");
  });

  it("fails loudly when the base image no longer provides it", () => {
    // The base image is not a contract. A vendor change must surface here, not
    // as an unexplained failure mid-task weeks later.
    const plan = planToolchain(tools, probeFrom({}));
    expect(plan[0].action).toBe("missing");
    expect(plan[0].reason).toMatch(/base image is not a contract/i);
  });

  it("fails when present but older than the declared minimum", () => {
    const versioned = {
      require: [{ name: "node", minVersion: "20" }],
      install: [],
    };
    const table = { node: { present: true, version: "18.19.0" } };
    expect(actionFor(versioned, table, "node")).toBe("missing");
  });

  it("passes when present and newer than the declared minimum", () => {
    const versioned = {
      require: [{ name: "node", minVersion: "20" }],
      install: [],
    };
    const table = { node: { present: true, version: "22.1.0" } };
    expect(actionFor(versioned, table, "node")).toBe("present");
  });
});

describe("installable tools", () => {
  const tools = { require: [], install: [{ name: "bws", version: "2.1.0" }] };

  it("skips an install when the pin already matches", () => {
    // Detect first, install second — this is what makes setup and maintenance
    // the same script, and the cheap path on cache resume.
    const table = { bws: { present: true, version: "2.1.0" } };
    expect(actionFor(tools, table, "bws")).toBe("skip");
  });

  it("reinstalls when the pin moved", () => {
    const table = { bws: { present: true, version: "2.0.0" } };
    expect(actionFor(tools, table, "bws")).toBe("install");
  });

  it("installs when absent", () => {
    expect(actionFor(tools, {}, "bws")).toBe("install");
  });

  it("rejects an unpinned install as irreproducible", () => {
    const unpinned = { require: [], install: [{ name: "loose" }] };
    expect(actionFor(unpinned, {}, "loose")).toBe("invalid");
  });
});

describe("install method validation", () => {
  it("requires both a url and a checksum for an archive", () => {
    // A pinned version with no checksum still trusts whatever the URL serves
    // today; both must move together in one reviewed commit.
    expect(() =>
      assertPinned({
        name: "x",
        install: "release-zip",
        url: "https://example",
      })
    ).toThrow(/url and sha256/i);
  });

  it("accepts a fully pinned archive", () => {
    expect(() =>
      assertPinned({
        name: "x",
        install: "release-zip",
        url: "https://example",
        sha256: "abc",
      })
    ).not.toThrow();
  });

  it("requires a package for a global npm install", () => {
    expect(() => assertPinned({ name: "x", install: "npm-global" })).toThrow(
      /needs a package/i
    );
  });

  it("refuses an unknown install method rather than guessing", () => {
    expect(() => assertPinned({ name: "x", install: "curl-bash" })).toThrow(
      /unknown install method/i
    );
  });
});
