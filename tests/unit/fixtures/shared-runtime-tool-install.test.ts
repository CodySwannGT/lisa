/**
 * The packed tool installs Lisa the way every host does (CodySwannGT/lisa#4636).
 *
 * It used to install from `file:<tarball>` through Bun's default registry while
 * every host installed through the loopback registry, so Lisa's dependency
 * tree was resolved twice, from two registries, into one shared cache. These
 * cases pin the tool's install to the hosts' route: the candidate version by
 * name, the same `--registry`, and the same shared cache.
 * @module tests/unit/fixtures/shared-runtime-tool-install
 */
import { describe, expect, it } from "vitest";

import {
  toolInstallArgs,
  toolManifest,
} from "../../fixtures/shared-runtime-hosts/tool-install.js";

const REGISTRY = "http://127.0.0.1:43210";
const CACHE = "/owned/artifact-bun-cache";

describe("the packed tool's install", () => {
  it("installs through the loopback registry into the shared cache", () => {
    const args = toolInstallArgs(REGISTRY, CACHE);

    expect(args[0]).toBe("install");
    expect(args[args.indexOf("--registry") + 1]).toBe(REGISTRY);
    expect(args[args.indexOf("--cache-dir") + 1]).toBe(CACHE);
    expect(args).toContain("--ignore-scripts");
  });

  it("passes the same registry and cache arguments the hosts pass", () => {
    // journey.ts and inherited-journey.ts install with exactly these.
    expect(toolInstallArgs(REGISTRY, CACHE)).toEqual([
      "install",
      "--ignore-scripts",
      "--registry",
      REGISTRY,
      "--network-concurrency",
      "8",
      "--cache-dir",
      CACHE,
    ]);
  });

  it("requests the candidate version by name, never a file path", () => {
    const manifest = toolManifest("4.102.1");

    expect(manifest.dependencies).toEqual({ "@codyswann/lisa": "4.102.1" });
    expect(JSON.stringify(manifest)).not.toContain("file:");
    expect(manifest.private).toBe(true);
  });
});
