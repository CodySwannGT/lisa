/**
 * Packaging and parity for the session manager (CodySwannGT/lisa#4448).
 *
 * `lisa-session-manager` and `lisa-setup-session-manager` ship from
 * `plugins/src/base` into every runtime projection that `build:plugins`
 * generates. Claude, Cursor, Antigravity (agy), Copilot and Devin copy the skill
 * folder verbatim. Codex compacts the frontmatter description and moves the
 * full routing text into the body, and it gets a derived `agents/openai.yaml`.
 * OpenCode is not checked in: it copies skill folders from `plugins/lisa` at
 * install time, so its exposure is asserted through the same discovery and
 * denylist the installer uses.
 *
 * The CLI is the deterministic half of the feature, so the `scripts/` folder
 * must travel with the skill, its entrypoint must stay executable in git, and
 * it must load from each verbatim copy (its static imports reach the
 * plugin-level `scripts/` three directories up).
 *
 * Known gap, kept visible rather than silently passing: the Codex copy's
 * `../../../scripts/` lands on `.codex-plugin/scripts/`, which does not exist,
 * so that copy of the CLI cannot load. The script-root ladder never points
 * there; a Codex session reaches a runnable copy through `claude plugin list`
 * or the npm package. The last test pins that the ladder keeps avoiding it.
 * The prose contract lives in session-manager-skill-contract.test.ts.
 * @module tests/unit/strategies/session-manager-skill
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  deriveSkillInterface,
  parseSkillFrontmatter,
  serializeInterfaceToYaml,
} from "../../../scripts/generate-codex-plugin-artifacts.mjs";
import {
  discoverBundledSkills,
  loadSkillDenylist,
} from "../../../src/core/lisa-skill-sources.js";
import { routingPrefacedBody } from "../../helpers/codex-skill-parity.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";
import {
  ALL_ROOTS,
  CODEX_ROOT,
  ENTRYPOINT,
  read,
  SKILLS,
  SOURCE_ROOT,
  VERBATIM_ROOTS,
} from "./session-manager-skill-helpers.js";

/** Command shims: the source plus every runtime that ships native commands. */
const COMMANDS = {
  "session-manager": "lisa-session-manager",
  "setup/session-manager": "lisa-setup-session-manager",
} as const;
const COMMAND_ROOTS = [
  "plugins/lisa/commands",
  "plugins/lisa-cursor/commands/lisa",
  "plugins/lisa-agy/commands/lisa",
  "plugins/lisa-copilot/commands/lisa",
] as const;

/**
 * Every file under a directory, relative to it, sorted.
 * @param dir - Repo-relative directory
 * @returns Relative file paths
 */
const listFiles = (dir: string): readonly string[] =>
  readdirSync(path.resolve(dir), { recursive: true, encoding: "utf8" })
    .filter(rel => statSync(path.resolve(dir, rel)).isFile())
    .sort((a: string, b: string) => a.localeCompare(b));

/**
 * Whether a file is one a generator adds and the source does not author.
 * @param rel - Path relative to the skill folder
 * @returns True for generated `agents/` metadata
 */
const isGenerated = (rel: string): boolean => rel.startsWith("agents/");

/**
 * Run the CLI's `--help` from one skill root.
 * @param root - Skill root
 * @returns The usage text
 */
const helpFrom = (root: string): string =>
  boundedExecFileSync({
    label: `session-manager --help (${root})`,
    command: process.execPath,
    args: [path.resolve(root, ENTRYPOINT), "--help"],
  });

describe.each(SKILLS)("%s ships to every runtime", skill => {
  const sourceFiles = listFiles(`${SOURCE_ROOT}/${skill}`);

  it("has a SKILL.md in the source root", () => {
    expect(sourceFiles).toContain("SKILL.md");
  });

  it.each(VERBATIM_ROOTS)("is a byte-identical copy in %s", root => {
    const files = listFiles(`${root}/${skill}`);
    expect(files.filter(rel => !isGenerated(rel))).toEqual(sourceFiles);
    for (const rel of sourceFiles) {
      expect(read(`${root}/${skill}/${rel}`), rel).toBe(
        read(`${SOURCE_ROOT}/${skill}/${rel}`)
      );
    }
  });

  it("ships every resource verbatim in Codex and only rewrites SKILL.md", () => {
    const files = listFiles(`${CODEX_ROOT}/${skill}`);
    expect(files.filter(rel => !isGenerated(rel))).toEqual(sourceFiles);
    for (const rel of sourceFiles.filter(rel => rel !== "SKILL.md")) {
      expect(read(`${CODEX_ROOT}/${skill}/${rel}`), rel).toBe(
        read(`${SOURCE_ROOT}/${skill}/${rel}`)
      );
    }
  });

  it("keeps the full routing text and the unchanged body in Codex", () => {
    const source = read(`${SOURCE_ROOT}/${skill}/SKILL.md`);
    const codex = read(`${CODEX_ROOT}/${skill}/SKILL.md`);
    const bodyStart = codex.indexOf("\n---\n") + "\n---\n".length;
    expect(codex.slice(bodyStart)).toBe(routingPrefacedBody(source));
    expect(codex).toContain(`\nname: ${skill}\n`);
    expect(codex).toMatch(/\ndescription: "[^"\n]{1,60}…"\n/);
  });

  it.each(["plugins/lisa/skills", CODEX_ROOT])(
    "has an agents/openai.yaml in %s derived from its own SKILL.md",
    root => {
      const yaml = read(`${root}/${skill}/agents/openai.yaml`);
      const frontmatter = parseSkillFrontmatter(
        path.resolve(root, skill, "SKILL.md")
      );
      expect(yaml).toBe(
        serializeInterfaceToYaml(deriveSkillInterface(frontmatter, skill))
      );
      expect(yaml).toContain(`Use $${skill}:`);
    }
  );
});

describe.each(Object.entries(COMMANDS))("/lisa:%s command", (name, skill) => {
  const source = read(`plugins/src/base/commands/${name}.md`);

  it("delegates to its skill", () => {
    expect(source).toContain(`Use the /${skill} skill`);
    expect(source).toContain("$ARGUMENTS");
    expect(source).toContain('allowed-tools: ["Skill"]');
  });

  it.each(COMMAND_ROOTS)("ships byte-identical in %s", root => {
    expect(read(`${root}/${name}.md`)).toBe(source);
  });

  it("needs no generated Codex command skill: the authored skill owns the name", () => {
    expect(existsSync(path.resolve(CODEX_ROOT, skill, "SKILL.md"))).toBe(true);
    const generated = readdirSync(path.resolve(CODEX_ROOT)).filter(entry =>
      entry.includes("session-manager")
    );
    const byName = (a: string, b: string): number => a.localeCompare(b);
    expect([...generated].sort(byName)).toEqual([...SKILLS].sort(byName));
  });
});

describe("the manager CLI travels and runs", () => {
  it("lists every subcommand group in the manager's argument hint", () => {
    expect(read("plugins/src/base/commands/session-manager.md")).toContain(
      'argument-hint: "[cycle|start|stop|status]"'
    );
  });

  it("keeps the entrypoint executable in git in every root", () => {
    const paths = ALL_ROOTS.map(root => `${root}/${ENTRYPOINT}`);
    const listing = boundedExecFileSync({
      label: "git ls-files -s",
      command: resolveGit(),
      args: ["ls-files", "-s", "--", ...paths],
    });
    const modes = new Map(
      listing
        .trim()
        .split("\n")
        .map(line => {
          const [meta = "", file = ""] = line.split("\t");
          return [file, meta.split(" ")[0]] as const;
        })
    );
    for (const file of paths) expect(modes.get(file), file).toBe("100755");
  });

  it.each([SOURCE_ROOT, ...VERBATIM_ROOTS])(
    "loads from %s and prints the same usage as the source",
    root => {
      const usage = helpFrom(root);
      expect(usage).toContain("Usage: node session-manager.mjs <subcommand>");
      expect(usage).toBe(helpFrom(SOURCE_ROOT));
    }
  );

  it.each([SOURCE_ROOT, ...VERBATIM_ROOTS])(
    "reaches the role resolver the skill cites from %s",
    root => {
      const resolver = path.resolve(
        root,
        "lisa-session-manager/scripts/../../../scripts/resolve-lifecycle-role.mjs"
      );
      expect(existsSync(resolver)).toBe(true);
    }
  );

  it("never resolves the Codex copy, whose plugin-level imports do not exist", () => {
    for (const skill of SKILLS) {
      const ladder = read(`${SOURCE_ROOT}/${skill}/SKILL.md`)
        .split("\n")
        .filter(line => line.trimStart().startsWith("[") || /SM=/.test(line));
      expect(ladder.join("\n")).not.toContain(".codex-plugin");
      expect(ladder.join("\n")).toContain(
        "node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-session-manager/scripts"
      );
    }
    expect(existsSync(path.resolve(CODEX_ROOT, "../scripts"))).toBe(false);
  });
});

describe("runtime exposure", () => {
  it("is on no internal-skill denylist", async () => {
    const lists = await Promise.all(
      ["codex", "opencode"].map(runtime =>
        loadSkillDenylist(
          process.cwd(),
          `scripts/internal-${runtime}-skill-policy.json`
        )
      )
    );
    const flat = ["cursor", "agy", "copilot"].flatMap(
      runtime =>
        (
          JSON.parse(read(`scripts/internal-${runtime}-skill-policy.json`)) as {
            denylist?: string[];
          }
        ).denylist ?? []
    );
    const denied = [...lists.flatMap(list => [...list]), ...flat];
    expect(denied.length).toBeGreaterThan(0);
    for (const skill of SKILLS) {
      expect(denied).not.toContain(skill);
      expect(denied).not.toContain(skill.replace(/^lisa-/, ""));
    }
  });

  it("is installed into OpenCode with its scripts and references", async () => {
    const denylist = await loadSkillDenylist(
      process.cwd(),
      "scripts/internal-opencode-skill-policy.json"
    );
    const bundled = await discoverBundledSkills(
      process.cwd(),
      denylist,
      plugin => plugin === "lisa"
    );
    const manager = bundled.find(s => s.skillName === "lisa-session-manager");
    const setup = bundled.find(
      s => s.skillName === "lisa-setup-session-manager"
    );
    expect(setup?.files).toContain("SKILL.md");
    expect(manager?.files).toEqual(
      expect.arrayContaining([
        "SKILL.md",
        "references/runbook-template.md",
        "scripts/session-manager.mjs",
        "scripts/cli-usage.mjs",
      ])
    );
  });
});
