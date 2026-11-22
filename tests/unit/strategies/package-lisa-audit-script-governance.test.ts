/** Apply the real shipped policy: preserve host audit chains, force Lisa's base. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LisaConfig } from "../../../src/core/config.js";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const ROOT = process.cwd();
const PACKAGE_JSON = "package.json";
const SOURCE = path.join(ROOT, "typescript/package-lisa/package.lisa.json");
const PUBLIC = "security:audit";
const BASE = "security:audit:lisa";
const COMMAND = "node scripts/lisa-audit.mjs";
const ALIAS = "$npm_execpath run security:audit:lisa";
const CUSTOM =
  "$npm_execpath run security:audit:lisa && node scripts/project-audit.mjs --all-depths";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => cleanupTempDir(root)));
});

/**
 * Apply the actual TypeScript template to an isolated pre-existing host.
 * @param scripts - Host's pre-existing script choices
 * @returns The written manifest and the prepared context for a second apply
 */
async function apply(scripts: Record<string, string>) {
  const root = await createTempDir();
  const destination = path.join(root, PACKAGE_JSON);
  const config: LisaConfig = {
    lisaDir: ROOT,
    destDir: root,
    dryRun: false,
    yesMode: true,
    validateOnly: false,
    skipGitCheck: false,
    harness: "codex",
  };
  const context: StrategyContext = {
    config,
    backupFile: async () => {},
    promptOverwrite: async () => true,
  };
  const strategy = new PackageLisaStrategy(() => "9.9.9");
  roots.push(root);
  await fs.writeJson(path.join(root, "tsconfig.json"), {});
  await fs.writeJson(destination, {
    name: "controlled-audit-host",
    version: "1.0.0",
    scripts,
  });
  await strategy.apply(SOURCE, destination, PACKAGE_JSON, context);
  return {
    root,
    destination,
    context,
    strategy,
    written: await fs.readJson(destination),
  };
}

describe("audit script governance through PackageLisaStrategy.apply", () => {
  it("retains an existing project audit chain and supplies its governed Lisa base", async () => {
    const fixture = await apply({
      [PUBLIC]: CUSTOM,
      [BASE]: "echo stale-base",
    });
    expect(fixture.written.scripts[PUBLIC]).toBe(CUSTOM);
    expect(fixture.written.scripts[BASE]).toBe(COMMAND);
  });

  it("defaults the public script only when the host has not supplied one", async () => {
    const fixture = await apply({});
    expect(fixture.written.scripts[PUBLIC]).toBe(ALIAS);
    expect(fixture.written.scripts[BASE]).toBe(COMMAND);
  });

  it("keeps the exact custom chain across a second real apply", async () => {
    const fixture = await apply({ [PUBLIC]: CUSTOM });
    const before = await fs.readFile(fixture.destination, "utf8");
    await fixture.strategy.apply(
      SOURCE,
      fixture.destination,
      PACKAGE_JSON,
      fixture.context
    );
    expect(await fs.readFile(fixture.destination, "utf8")).toBe(before);
    expect((await fs.readJson(fixture.destination)).scripts[PUBLIC]).toBe(
      CUSTOM
    );
  });

  it("keeps source-repository package policy in parity with the reserved/default split", async () => {
    const template = await fs.readJson(path.join(ROOT, "package.lisa.json"));
    const manifest = await fs.readJson(path.join(ROOT, PACKAGE_JSON));
    expect(template.force.scripts[PUBLIC]).toBeUndefined();
    expect(template.force.scripts[BASE]).toBe(COMMAND);
    expect(template.defaults.scripts[PUBLIC]).toBe(ALIAS);
    expect(manifest.scripts[BASE]).toBe(COMMAND);
    expect(manifest.scripts[PUBLIC]).toBe(ALIAS);
  });
});
