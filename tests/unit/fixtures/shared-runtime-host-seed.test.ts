/**
 * The packed-host journey's hosts declare the package manager that installs
 * them (CodySwannGT/lisa#4941).
 *
 * Apply fits the CDK template's forced npm `devEngines` floor to the host's
 * manager (CodySwannGT/lisa#4848). A seeded host with no signal kept the floor
 * on its first adoption and lost it on the second, once `bun install` had
 * written `bun.lock`, so the journey's idempotence check failed. Each seeded
 * host must therefore name Bun, at the version Lisa itself is reviewed on.
 * @module tests/unit/fixtures/shared-runtime-host-seed
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HOST_PACKAGE_MANAGER,
  seedHost,
} from "../../fixtures/shared-runtime-hosts/host.js";

const scratch: string[] = [];

afterEach(() => {
  for (const area of scratch.splice(0))
    fs.rmSync(area, { force: true, recursive: true });
});

describe("packed-host journey seeds", () => {
  it("pins the host manager to Lisa's own reviewed Bun", () => {
    const lisa = JSON.parse(
      fs.readFileSync(
        path.join(import.meta.dirname, "../../../package.json"),
        "utf8"
      )
    ) as { readonly engines: { readonly bun: string } };
    expect(HOST_PACKAGE_MANAGER).toBe(`bun@${lisa.engines.bun}`);
  });

  it.each(["typescript", "cdk"] as const)(
    "declares that manager in the seeded %s host before its first adoption",
    stack => {
      const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-host-seed-"));
      scratch.push(root);
      seedHost(root, stack);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8")
      ) as { readonly packageManager?: string };
      expect(manifest.packageManager).toBe(HOST_PACKAGE_MANAGER);
    }
  );
});
