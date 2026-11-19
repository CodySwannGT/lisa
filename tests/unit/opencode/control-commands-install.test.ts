/**
 * OpenCode is given the four control commands by Lisa's installer, not by a
 * built plugin folder of its own (CodySwannGT/lisa#5002).
 *
 * Six agents read a folder the plugin build writes. OpenCode reads
 * `.opencode/` in the host repository, which `lisa apply` fills from
 * `plugins/lisa`. So "the four commands are on OpenCode" is two facts: the
 * folder it is installed from carries them, which
 * `scripts/lib/control-command-parity.mjs` checks, and the installer copies
 * them to where OpenCode reads them, which this suite proves by running the
 * real installer over a copy of the real files. Where they land is read from
 * `parity/control-commands.json`, so the recorded paths and the installer
 * cannot disagree unnoticed.
 * @module tests/unit/opencode/control-commands-install
 */
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CONTROL_COMMANDS,
  REPO_ROOT,
  readParityFixture,
  skillNameOf,
} from "../../../scripts/lib/control-command-parity.mjs";
import { discoverAndInstallCommands } from "../../../src/opencode/command-installer.js";
import { installSkills } from "../../../src/opencode/skills-installer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** What the fixture records about how OpenCode is given the commands. */
interface InstalledAgent {
  readonly id: string;
  readonly source: string;
  readonly skill: string;
  readonly command: string;
  readonly installed: {
    readonly by: readonly string[];
    readonly withheld_by: string;
    readonly skill: string;
    readonly command: string;
  };
}

/**
 * The fixture's entry for OpenCode.
 * @returns The recorded facts
 * @throws {Error} When the fixture records no installed OpenCode entry
 */
function opencode(): InstalledAgent {
  const { fixture } = readParityFixture(REPO_ROOT);
  const agent = (
    (fixture?.agents ?? []) as readonly Partial<InstalledAgent>[]
  ).find(entry => entry.id === "opencode");
  if (agent?.installed === undefined) {
    throw new Error("The parity fixture records no installer for OpenCode");
  }
  return agent as InstalledAgent;
}

/**
 * Fill in the command a recorded path is for.
 * @param template - A path holding `{command}`
 * @param command - The command, for example `attest`
 * @returns The path
 */
function pathFor(template: string, command: string): string {
  return template.replaceAll("{command}", command);
}

describe("the control commands as OpenCode is given them", () => {
  const agent = opencode();
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    fs.mkdirSync(destDir, { recursive: true });
    for (const command of CONTROL_COMMANDS) {
      const skillFolder = path.dirname(
        path.join(agent.source, pathFor(agent.skill, command))
      );
      fs.cpSync(
        path.join(REPO_ROOT, skillFolder),
        path.join(lisaDir, skillFolder),
        { recursive: true }
      );
      const commandFile = path.join(
        agent.source,
        pathFor(agent.command, command)
      );
      fs.mkdirSync(path.dirname(path.join(lisaDir, commandFile)), {
        recursive: true,
      });
      fs.copyFileSync(
        path.join(REPO_ROOT, commandFile),
        path.join(lisaDir, commandFile)
      );
    }
    fs.mkdirSync(path.dirname(path.join(lisaDir, agent.installed.withheld_by)));
    fs.copyFileSync(
      path.join(REPO_ROOT, agent.installed.withheld_by),
      path.join(lisaDir, agent.installed.withheld_by)
    );
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Run the installer the way `lisa apply` does for OpenCode.
   */
  async function install(): Promise<void> {
    await installSkills(lisaDir, destDir, [], []);
    await discoverAndInstallCommands(lisaDir, destDir, [], []);
  }

  /**
   * What the installer wrote for one command's skill.
   * @param command - The command
   * @returns The installed skill, or null when nothing was written
   */
  function installedSkill(command: string): string | null {
    const file = path.join(destDir, pathFor(agent.installed.skill, command));
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  }

  /**
   * The skill as the plugin build wrote it.
   * @param command - The command
   * @returns The built skill
   */
  function builtSkill(command: string): string {
    return fs.readFileSync(
      path.join(REPO_ROOT, agent.source, pathFor(agent.skill, command)),
      "utf8"
    );
  }

  it("is installed by code that exists", () => {
    expect(
      agent.installed.by.filter(
        file => !fs.existsSync(path.join(REPO_ROOT, file))
      )
    ).toEqual([]);
  });

  it.each(CONTROL_COMMANDS)(
    "installs the %s skill, unchanged, where OpenCode reads skills",
    async command => {
      await install();

      expect(installedSkill(command)).toBe(builtSkill(command));
      expect(installedSkill(command)).toContain(`\`/lisa:${command}\``);
    }
  );

  it.each(CONTROL_COMMANDS)(
    "installs /lisa:%s as a command that hands over to its skill",
    async command => {
      await install();

      const installed = fs.readFileSync(
        path.join(destDir, pathFor(agent.installed.command, command)),
        "utf8"
      );
      expect(installed).toContain(`/${skillNameOf(command)}`);
      expect(installed).toContain("$ARGUMENTS");
    }
  );

  it("does not install a skill its source folder no longer carries", async () => {
    fs.rmSync(
      path.dirname(
        path.join(lisaDir, agent.source, pathFor(agent.skill, "attest"))
      ),
      { recursive: true }
    );

    await install();

    expect(installedSkill("attest")).not.toBe(builtSkill("attest"));
    expect(installedSkill("audit")).toBe(builtSkill("audit"));
  });

  it("does not install a skill the OpenCode policy withholds", async () => {
    fs.writeFileSync(
      path.join(lisaDir, agent.installed.withheld_by),
      JSON.stringify({ denylistedSkills: [skillNameOf("enforce")] })
    );

    await install();

    expect(installedSkill("enforce")).not.toBe(builtSkill("enforce"));
    expect(installedSkill("configure")).toBe(builtSkill("configure"));
  });
});
