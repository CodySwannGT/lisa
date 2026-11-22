/**
 * The packed tool installs Lisa the way every host does (CodySwannGT/lisa#4636).
 *
 * It used to install from `file:<tarball>` through Bun's default registry while
 * every host installed through the loopback registry. These cases pin the
 * tool's install to the hosts' route: the candidate version by name, and the
 * hosts' own arguments — the same `--registry` and shared cache — from the one
 * function both are derived from, plus the `--ignore-scripts` only the tool
 * passes.
 * @module tests/unit/fixtures/shared-runtime-tool-install
 */
import { describe, expect, it } from "vitest";

import {
  hostInstallArgs,
  toolInstallArgs,
} from "../../fixtures/shared-runtime-hosts/install-args.js";
import { toolManifest } from "../../fixtures/shared-runtime-hosts/tool-install.js";

const REGISTRY = "http://127.0.0.1:43210";
const CACHE = "/owned/artifact-bun-cache";

describe("the packed tool's install", () => {
  it("passes the hosts' registry and cache arguments, and skips lifecycle scripts", () => {
    const hosts = hostInstallArgs(REGISTRY, CACHE);

    expect(hosts).toEqual([
      "install",
      "--registry",
      REGISTRY,
      "--network-concurrency",
      "8",
      "--cache-dir",
      CACHE,
    ]);
    // The hosts do not pass --ignore-scripts; the tool always has.
    expect(toolInstallArgs(REGISTRY, CACHE)).toEqual([
      ...hosts,
      "--ignore-scripts",
    ]);
  });

  it("requests the candidate version by name, never a file path", () => {
    const manifest = toolManifest("4.102.1");

    expect(manifest.dependencies).toEqual({ "@codyswann/lisa": "4.102.1" });
    expect(JSON.stringify(manifest)).not.toContain("file:");
    expect(manifest.private).toBe(true);
  });
});
