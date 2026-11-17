/**
 * The `lisa-audit` skill and its `/lisa:audit` command: that they exist for
 * every coding agent, and that the commands the skill runs are real.
 *
 * The skill's guidance prose is not pinned here; rewording it must not fail a
 * test. What is checked is structural (the frontmatter, the command's argument
 * pass-through, the copy each agent is given) and executable (every
 * `lisa controls` subcommand the skill tells the agent to run is one the CLI
 * registers). The commands themselves are run for real by
 * `tests/integration/controls-audit-readonly.test.ts` (CodySwannGT/lisa#4979).
 *
 * OpenCode has no entry below because Lisa builds no plugin folder for it: it
 * is given the same skill and command from `plugins/lisa` when Lisa is
 * installed for it, as `/lisa:audit`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CONTROLS_COMMAND } from "../../../src/cli/controls-cmd.js";
import { createProgram } from "../../../src/cli/index.js";
import {
  inScopeCriteria,
  loadCriterionCatalogue,
} from "../../../src/controls/catalogue.js";
import { auditSkillShellBlocks } from "../../helpers/audit-skill.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SKILL = "skills/lisa-audit/SKILL.md";

/** Where the skill and command are authored, and where Claude Code reads them. */
const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The copy each coding agent is given, by the folder the build writes it to. */
const AGENT_COPIES: readonly {
  readonly agent: string;
  readonly files: readonly string[];
}[] = [
  {
    agent: "Claude Code",
    files: [`plugins/lisa/${SKILL}`, "plugins/lisa/commands/audit.md"],
  },
  { agent: "Codex", files: [`plugins/lisa/.codex-plugin/${SKILL}`] },
  {
    agent: "Cursor",
    files: [
      `plugins/lisa-cursor/${SKILL}`,
      "plugins/lisa-cursor/commands/lisa/audit.md",
    ],
  },
  {
    agent: "Antigravity",
    files: [
      `plugins/lisa-agy/${SKILL}`,
      "plugins/lisa-agy/commands/lisa/audit.md",
    ],
  },
  {
    agent: "Copilot",
    files: [
      `plugins/lisa-copilot/${SKILL}`,
      "plugins/lisa-copilot/commands/lisa/audit.md",
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

describe("lisa-audit skill and /lisa:audit command", () => {
  describe.each(ROOTS)("%s", root => {
    const skill = read(`${root}/${SKILL}`);
    const command = read(`${root}/commands/audit.md`);

    it("is a skill named lisa-audit with a description and a body", () => {
      expect(skill).toMatch(/^---\nname: lisa-audit\n/u);
      expect(skill).toMatch(/^description: /mu);
      expect(skill.length).toBeGreaterThan(2000);
    });

    it("is surfaced by a command that passes its arguments through", () => {
      expect(command).toMatch(/^argument-hint: /mu);
      expect(command).toContain("/lisa-audit");
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

  it("explains every field the catalogue command prints for a requirement", () => {
    // The agent is told where to file a finding by a field of the printed
    // requirement (`answered`), not by a rule of thumb in the skill. A field
    // the command prints and the skill never names is one the agent has to
    // guess the meaning of (CodySwannGT/lisa#5007).
    const skill = read(`plugins/src/base/${SKILL}`);
    const printed = [
      ...new Set(
        inScopeCriteria(loadCriterionCatalogue()).flatMap(criterion =>
          Object.keys(criterion)
        )
      ),
    ];

    expect(printed).toContain("answered");
    expect(printed.filter(field => !skill.includes(`\`${field}\``))).toEqual(
      []
    );
  });

  it("runs only lisa controls subcommands the CLI registers", () => {
    const registered = (
      createProgram().commands.find(
        command => command.name() === CONTROLS_COMMAND
      )?.commands ?? []
    ).map(command => command.name());
    const run = auditSkillShellBlocks().flatMap(block =>
      [...block.matchAll(/\blisa controls ([a-z][a-z-]*)/gu)].map(
        match => match[1] ?? ""
      )
    );

    expect(run).toEqual(expect.arrayContaining(["catalogue", "report-check"]));
    expect(run.filter(name => !registered.includes(name))).toEqual([]);
  });
});
