/**
 * The PRD writer's own create command against `block-direct-issue-create.sh`.
 *
 * `lisa-github-write-prd` documented a `gh issue create` that carried only a
 * PRD lifecycle label. The guard accepts three declarations — the build-ready
 * role, a human gate, or the canonical container line — and a PRD label is none
 * of them, so following the skill as written was refused and Research could not
 * file its PRD (CodySwannGT/lisa#4959). The refusal talks about build-ready
 * work items, so it did not tell the agent what a PRD should declare.
 *
 * The fix is on the writer, and the guard is unchanged: a PRD's lifecycle rolls
 * up from the work generated from it (`prd-lifecycle-rollup`), so the container
 * declaration is the truthful one, and the guard already accepts it.
 *
 * These cases EXECUTE the skill rather than quote it. The commands the CREATE
 * phase lists before its create command are run for real against a PRD body,
 * and the create command is then handed to the guard as typed. That is what
 * makes the suite fail on the unfixed skill for the right reason — the body the
 * skill produces carries no declaration — and what stops the skill and the
 * guard drifting apart again without a red test.
 *
 * Ordering is part of the contract, not a nicety: the guard reads the
 * `--body-file` before the command runs, so a declaration appended in the same
 * command as the create is not there yet when the guard looks. The last case
 * pins that, because it is the reason the skill uses a separate step.
 * @module tests/unit/hooks/block-direct-issue-create-prd-writer
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  bash,
  BASH_PATH,
  CONTAINER_DECLARATION,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  projectWithTracker,
  runHook,
} from "./support/direct-issue-create.js";

const SKILL = "lisa-github-write-prd";

/** The skill source, then the copy each supported coding agent is shipped. */
const SURFACES = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
] as const;

/** A repository whose PRD source and tracker are both GitHub. */
const GITHUB_PRD_PROJECT: Record<string, unknown> = {
  source: "github",
  tracker: "github",
  github: {
    org: "example-org",
    repo: "example-repo",
    labels: { build: { ready: "status:ready" } },
  },
};

/**
 * A marker-normalized PRD body, as the writer's first CREATE step leaves it:
 * exactly one marker line, the requirements, and nothing the guard reads as a
 * declaration.
 */
const PRD_BODY = [
  "<!-- [lisa-research] prd=report-export -->",
  "# PRD: Export a report",
  "",
  "## Requirements",
  "",
  "- R1: When an operator requests a report, the system shall produce it",
  "  within five seconds.",
  "",
].join("\n");

/** The executable part of the writer's CREATE phase, in document order. */
type CreatePhase = {
  /** Commands the skill lists before the create command. */
  readonly prepare: readonly string[];
  /** The create command, as documented. */
  readonly create: string;
  /** The body file path the create command names. */
  readonly bodyFile: string;
};

/**
 * Read the commands of a skill copy's CREATE phase.
 * @param surface - The skills root of one agent surface.
 * @returns The commands before the create, the create, and its body file.
 */
const createPhase = (surface: string): CreatePhase => {
  const text = readFileSync(path.resolve(surface, SKILL, "SKILL.md"), "utf8");
  const start = text.indexOf("**CREATE**");
  const end = text.indexOf("**UPDATE**", start);
  if (start === -1 || end === -1) {
    throw new Error(`${surface}/${SKILL} has no CREATE phase to read`);
  }
  const commands = text
    .slice(start, end)
    .split("```")
    .filter((_part, index) => index % 2 === 1)
    .filter(block => block.startsWith("bash\n"))
    .map(block =>
      block
        .split("\n")
        .slice(1)
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join("\n")
    );
  const createAt = commands.findIndex(command =>
    command.includes("gh issue create")
  );
  const create = commands[createAt];
  if (create === undefined) {
    throw new Error(`${surface}/${SKILL} documents no create command`);
  }
  const words = create.split(/\s+/u);
  const flagAt = words.indexOf("--body-file");
  const bodyFile = flagAt === -1 ? undefined : words[flagAt + 1];
  if (bodyFile === undefined) {
    throw new Error(`${surface}/${SKILL} create command names no body file`);
  }
  return { prepare: commands.slice(0, createAt), create, bodyFile };
};

/** One filing attempt: a project, and the body file the commands act on. */
type Filing = {
  readonly cwd: string;
  readonly bodyPath: string;
  /**
   * Point a documented command at this filing's body file. The skill names one
   * fixed path under the system temp directory; every case gets its own, inside
   * its project directory, so parallel workers cannot read each other's body.
   * Nothing else in the command is rewritten.
   */
  readonly relocate: (command: string) => string;
};

/**
 * Start a filing: a GitHub-sourced project holding the PRD body on disk.
 * @param phase - The CREATE phase whose body file path is being relocated.
 * @returns The project directory, the body path, and the relocation.
 */
const startFiling = (phase: CreatePhase): Filing => {
  const cwd = projectWithTracker(GITHUB_PRD_PROJECT);
  const bodyPath = path.join(cwd, "prd-body.md");
  writeFileSync(bodyPath, PRD_BODY, "utf8");
  return {
    cwd,
    bodyPath,
    relocate: command => command.replaceAll(phase.bodyFile, bodyPath),
  };
};

/**
 * Run the skill's body-preparation commands, each as its own shell command and
 * each through the guard first — a step the guard refuses is not followable.
 * @param phase - The CREATE phase being followed.
 * @param filing - The filing whose body is prepared.
 * @returns The guard's exit status for each preparation command.
 */
const prepareBody = (
  phase: CreatePhase,
  filing: Filing
): readonly (number | null)[] =>
  phase.prepare.map(documented => {
    const command = filing.relocate(documented);
    const { status } = runHook(bash(command), { cwd: filing.cwd });
    boundedSpawnSync({
      label: "PRD writer body preparation",
      command: BASH_PATH,
      args: ["-c", command],
      cwd: filing.cwd,
    });
    return status;
  });

/**
 * The create command as an agent types it once the skill's variables hold
 * values. The guard reads the command text, so both spellings are evaluated.
 * @param command - The documented create command.
 * @returns The command with its shell variables resolved.
 */
const withResolvedVariables = (command: string): string =>
  command
    .replaceAll("$ORG/$REPO", "example-org/example-repo")
    .replaceAll("$TITLE", "PRD: Export a report")
    .replaceAll("$ROLE_LABEL", "prd-draft");

describe("block-direct-issue-create.sh and the PRD writer's create command", () => {
  describe.each(SURFACES)("%s", surface => {
    it("prepares a body that declares the PRD a container before the create", () => {
      const phase = createPhase(surface);
      const filing = startFiling(phase);

      const statuses = prepareBody(phase, filing);

      expect(statuses).toEqual(statuses.map(() => EXIT_ALLOWED));
      expect(readFileSync(filing.bodyPath, "utf8")).toContain(
        CONTAINER_DECLARATION
      );
    });

    it("has its documented create command allowed by the guard", () => {
      const phase = createPhase(surface);
      const filing = startFiling(phase);
      prepareBody(phase, filing);

      const { status, stderr } = runHook(bash(filing.relocate(phase.create)), {
        cwd: filing.cwd,
      });

      expect(stderr).toBe("");
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("has the same command allowed once its variables are resolved", () => {
      const phase = createPhase(surface);
      const filing = startFiling(phase);
      prepareBody(phase, filing);

      const { status, stderr } = runHook(
        bash(withResolvedVariables(filing.relocate(phase.create))),
        { cwd: filing.cwd }
      );

      expect(stderr).toBe("");
      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("the declaration is written once", () => {
    it("leaves one declaration when the preparation runs twice", () => {
      const phase = createPhase(SURFACES[0]);
      const filing = startFiling(phase);

      prepareBody(phase, filing);
      prepareBody(phase, filing);

      const body = readFileSync(filing.bodyPath, "utf8");
      expect(body.split(CONTAINER_DECLARATION)).toHaveLength(2);
      expect(body.startsWith(PRD_BODY)).toBe(true);
    });
  });

  describe("the guard is not weakened for PRDs — the control on this change", () => {
    it("refuses a prd-draft create whose body declares nothing", () => {
      const phase = createPhase(SURFACES[0]);
      const filing = startFiling(phase);

      const { status, stderr } = runHook(
        bash(withResolvedVariables(filing.relocate(phase.create))),
        { cwd: filing.cwd }
      );

      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("this filing declares no readiness");
    });

    it("refuses a prd-ready create whose body declares nothing", () => {
      const filing = startFiling(createPhase(SURFACES[0]));

      const { status } = runHook(
        bash(
          'gh issue create --repo example-org/example-repo --title "PRD" ' +
            `--body-file ${filing.bodyPath} --label prd-ready`
        ),
        { cwd: filing.cwd }
      );

      expect(status).toBe(EXIT_BLOCKED);
    });

    it("refuses a declaration appended in the same command as the create", () => {
      const phase = createPhase(SURFACES[0]);
      const filing = startFiling(phase);
      const append =
        `printf '\\n## Target Backend Environment\\n\\n` +
        `${CONTAINER_DECLARATION}\\n' >> ${filing.bodyPath}`;

      const { status } = runHook(
        bash(`${append} && ${filing.relocate(phase.create)}`),
        { cwd: filing.cwd }
      );

      expect(status).toBe(EXIT_BLOCKED);
    });
  });
});
