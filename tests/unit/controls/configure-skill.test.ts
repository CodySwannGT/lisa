/**
 * The `lisa-configure` skill and its `/lisa:configure` command: that they
 * exist for every coding agent, that the commands the skill runs are real,
 * and that the declaration it teaches is one the register accepts.
 *
 * The skill's guidance prose is not pinned here; rewording it must not fail a
 * test. What is checked is structural (the frontmatter, the command's
 * argument pass-through, the copy each agent is given, how each agent invokes
 * it, what each step needs and hands on) and executable (every `lisa
 * controls` subcommand it runs is registered, and its example declaration
 * passes the same code a real one must). The commands themselves are run for
 * real by `tests/integration/controls-configure.test.ts`
 * (CodySwannGT/lisa#4984).
 *
 * OpenCode has no entry below because Lisa builds no plugin folder for it: it
 * is given the same skill and command from `plugins/lisa` when Lisa is
 * installed for it, as `/lisa:configure`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CONTROLS_COMMAND } from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import { evidencedEntries } from "../../../src/controls/declaration-evidence.js";
import {
  configureSkill,
  configureSkillExampleDeclarations,
  configureSkillShellBlocks,
} from "../../helpers/configure-skill.js";
import { registerSchemaErrors } from "../../helpers/control-register.js";
import { registerOf } from "./support/register-build.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SKILL = "skills/lisa-configure/SKILL.md";

/** Where the skill and command are authored, and where Claude Code reads them. */
const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The copy each coding agent is given, by the folder the build writes it to. */
const AGENT_COPIES: readonly {
  readonly agent: string;
  readonly files: readonly string[];
}[] = [
  {
    agent: "Claude Code",
    files: [`plugins/lisa/${SKILL}`, "plugins/lisa/commands/configure.md"],
  },
  { agent: "Codex", files: [`plugins/lisa/.codex-plugin/${SKILL}`] },
  {
    agent: "Cursor",
    files: [
      `plugins/lisa-cursor/${SKILL}`,
      "plugins/lisa-cursor/commands/lisa/configure.md",
    ],
  },
  {
    agent: "Antigravity",
    files: [
      `plugins/lisa-agy/${SKILL}`,
      "plugins/lisa-agy/commands/lisa/configure.md",
    ],
  },
  {
    agent: "Copilot",
    files: [
      `plugins/lisa-copilot/${SKILL}`,
      "plugins/lisa-copilot/commands/lisa/configure.md",
    ],
  },
  { agent: "Devin", files: [`plugins/lisa-devin/${SKILL}`] },
];

/**
 * Read a repository file.
 * @param relative - Repository-relative path
 * @returns Its content
 */
function read(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

/**
 * The numbered steps of the skill, each with its own text.
 * @returns One entry per `### Step` heading, in order
 */
function steps(): readonly { readonly title: string; readonly body: string }[] {
  return configureSkill()
    .split(/^### /mu)
    .slice(1)
    .map(section => ({
      title: section.slice(0, section.indexOf("\n")),
      body: section.slice(section.indexOf("\n")),
    }));
}

describe("lisa-configure skill and /lisa:configure command", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(`${root}/${SKILL}`);
    const command = read(`${root}/commands/configure.md`);

    it("is a skill named lisa-configure with a description and a body", () => {
      expect(skill).toMatch(/^---\nname: lisa-configure\n/u);
      expect(skill).toMatch(/^description: /mu);
      expect(skill.length).toBeGreaterThan(2000);
    });

    it("is surfaced by a command that passes its arguments through", () => {
      expect(command).toMatch(/^argument-hint: /mu);
      expect(command).toContain("/lisa-configure");
      expect(command).toContain("$ARGUMENTS");
    });
  });

  it.each(AGENT_COPIES)("is built for $agent", ({ files }) => {
    expect(
      files.filter(file => !existsSync(path.join(REPO_ROOT, file)))
    ).toEqual([]);
  });

  it("gives every agent the skill as authored", () => {
    const authored = read(`plugins/src/base/${SKILL}`);
    const body = authored.slice(authored.indexOf("\n# "));
    const copies = AGENT_COPIES.flatMap(({ files }) =>
      files.filter(file => file.endsWith("SKILL.md"))
    );

    expect(copies.filter(file => !read(file).endsWith(body))).toEqual([]);
  });

  it.each([
    ["an agent with slash commands", "`/lisa:configure`"],
    ["Codex", "`$lisa-configure`"],
    ["Devin", "`/lisa:lisa-configure`"],
  ])("says how %s runs it", (_agent, form) => {
    expect(configureSkill()).toContain(form);
  });
});

describe("the steps of the configure skill", () => {
  it("are numbered from 1 with none missing", () => {
    expect(
      steps().map(step => Number(/^Step (\d+):/u.exec(step.title)?.[1]))
    ).toEqual(steps().map((_step, index) => index + 1));
    expect(steps().length).toBeGreaterThan(5);
  });

  it("each say what they need and what they hand on", () => {
    expect(
      steps()
        .filter(
          step =>
            !step.body.includes("**Needs:**") ||
            !step.body.includes("**Hands on:**")
        )
        .map(step => step.title)
    ).toEqual([]);
  });
});

describe("the commands the configure skill runs", () => {
  it("are lisa controls subcommands the CLI registers", () => {
    const registered = (
      createProgram().commands.find(
        command => command.name() === CONTROLS_COMMAND
      )?.commands ?? []
    ).map(command => command.name());
    const run = configureSkillShellBlocks().flatMap(block =>
      [...block.matchAll(/\blisa controls ([a-z][a-z-]*)/gu)].map(
        match => match[1] ?? ""
      )
    );

    expect(run).toEqual(
      expect.arrayContaining([
        "seed",
        "propose-threshold",
        "declaration-check",
        "register",
      ])
    );
    expect(run.filter(name => !registered.includes(name))).toEqual([]);
  });

  it("checks the declaration against the audit before the register is written", () => {
    const blocks = configureSkillShellBlocks().map(block => block.trim());

    expect(blocks.indexOf("lisa controls declaration-check")).toBeGreaterThan(
      -1
    );
    expect(blocks.indexOf("lisa controls declaration-check")).toBeLessThan(
      blocks.indexOf("lisa controls register")
    );
    expect(blocks.indexOf("lisa controls register")).toBeLessThan(
      blocks.indexOf("lisa controls register --check")
    );
  });

  it("are each one plain command, with nothing an agent's shell guard refuses", () => {
    expect(
      configureSkillShellBlocks().filter(
        block => block.trim().includes("\n") || /[;{}|&]|\$\(|`/u.test(block)
      )
    ).toEqual([]);
  });

  it("lists the working tree in the preflight, before anything is written, and again at the end", () => {
    const listing = "git status --porcelain --untracked-files=all";
    const blocks = configureSkillShellBlocks().map(block => block.trim());
    const listings = blocks.flatMap((block, index) =>
      block === listing ? [index] : []
    );
    const [preflight] = steps();
    const confirm = steps().find(step => step.title.includes("Confirm"));

    expect(listings).toHaveLength(2);
    expect(listings[0]).toBeLessThan(blocks.indexOf("lisa controls seed"));
    expect(listings[1]).toBeGreaterThan(
      blocks.indexOf("lisa controls register --check")
    );
    expect(preflight?.body).toContain(listing);
    expect(confirm?.body).toMatch(/the\s+list\s+step\s+1\s+kept/u);
  });
});

describe("the declaration the configure skill teaches", () => {
  const examples = configureSkillExampleDeclarations();

  it("is shown at least once", () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  it.each(examples)(
    "is one the register accepts, with every part saying what supports it (example %#)",
    async example => {
      const register = await registerOf(example.gates);

      expect(register.entries.length).toBeGreaterThan(0);
      expect(evidencedEntries(register)).toHaveLength(register.entries.length);
      expect(registerSchemaErrors(register)).toEqual([]);
    }
  );

  it.each(examples)(
    "shows a threshold as a value and the direction it may move in (example %#)",
    async example => {
      const thresholds = (await registerOf(example.gates)).entries.flatMap(
        entry => Object.values(entry.parameters)
      );

      expect(thresholds.length).toBeGreaterThan(0);
      expect(
        thresholds.filter(
          parameter =>
            typeof parameter.value !== "number" ||
            parameter.direction === undefined
        )
      ).toEqual([]);
    }
  );
});
