/**
 * The doctor check for the always-promotable setting
 * (CodySwannGT/lisa#5188): it reports how `release.liveUsers` resolved and
 * names any invalid `release.*` value.
 * @module tests/unit/cli/doctor-release-setting
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDoctor } from "../../../src/cli/doctor.js";
import { checkReleaseSetting } from "../../../src/cli/doctor-release-setting.js";

const NAME = "Always-promotable setting";
const NO_LIVE_USERS = '{"release":{"liveUsers":false}}\n';
const tempDirectories: string[] = [];

/**
 * Create a Lisa project fixture with the given committed config text.
 * @param config - Raw `.lisa.config.json` text
 * @param local - Raw `.lisa.config.local.json` text, when present
 * @returns Temporary project path
 */
async function projectFixture(config: string, local?: string): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "lisa-doctor-release-")
  );
  tempDirectories.push(directory);
  await writeFile(path.join(directory, ".lisa.config.json"), config);
  if (local !== undefined)
    await writeFile(path.join(directory, ".lisa.config.local.json"), local);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map(directory => rm(directory, { force: true, recursive: true }))
  );
});

describe("always-promotable doctor check", () => {
  it("reports a project that says nothing as having live users", async () => {
    const check = checkReleaseSetting(await projectFixture("{}\n"));
    expect(check.name).toBe(NAME);
    expect(check.status).toBe("ok");
    expect(check.detail).toContain("has live users");
    expect(check.detail).toContain("release.liveUsers is not set");
    expect(check.detail).toContain("plain configuration value");
  });

  it("reports a pre-launch project's opt-out in plain words", async () => {
    const check = checkReleaseSetting(await projectFixture(NO_LIVE_USERS));
    expect(check.status).toBe("ok");
    expect(check.detail).toContain("release.liveUsers is false");
    expect(check.detail).toContain("rule is off");
  });

  it("names the project's switch mechanism and its guide", async () => {
    const check = checkReleaseSetting(
      await projectFixture(
        '{"release":{"liveUsers":true,"switch":{"mechanism":"hosted-flags","guide":"docs/flags.md"}}}\n'
      )
    );
    expect(check.status).toBe("ok");
    expect(check.detail).toContain("hosted-flags");
    expect(check.detail).toContain("docs/flags.md");
  });

  it("fails on an invalid value and names it", async () => {
    const check = checkReleaseSetting(
      await projectFixture('{"release":{"liveUsers":"no"}}\n')
    );
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("release.liveUsers");
    expect(check.detail).toContain('"no"');
    expect(check.detail).toContain("treated as true");
  });

  it("reads the local override", async () => {
    const check = checkReleaseSetting(
      await projectFixture("{}\n", NO_LIVE_USERS)
    );
    expect(check.detail).toContain("release.liveUsers is false");
  });

  it("fails when the config cannot be read", async () => {
    const check = checkReleaseSetting(await projectFixture("{ not json"));
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("could not be read");
  });

  it("is part of the doctor run", async () => {
    const result = await runDoctor(
      await projectFixture(NO_LIVE_USERS),
      { offline: true },
      { runUpdateCheck: vi.fn(), write: vi.fn() }
    );
    expect(result.checks.map(check => check.name)).toContain(NAME);
  });
});
