/**
 * Off the paved road, configure turns what the audit found and what the
 * operator answered into the declaration and the control register, and into
 * nothing else.
 *
 * An agent carries out the configure step, so no suite can run all of it.
 * This one runs the deterministic part for real: every shell command the
 * configure skill writes down, exactly as written and in order, using the
 * built CLI, inside fixture repositories where Lisa was never applied. A
 * stand-in does what only the agent does: it supplies the value it measured
 * and writes the declaration (CodySwannGT/lisa#4984).
 */
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runControlAuditGit } from "../helpers/control-audit-fixtures.js";
import {
  foundAt,
  openQuestion,
  reportWith,
} from "../helpers/control-audit-findings.js";
import { writeAuditReport } from "../helpers/control-audit-report.js";
import {
  configFile,
  registerSchemaErrors,
  type GatesBlock,
} from "../helpers/control-register.js";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  CHANGED_BLOCK,
  CONFIG,
  REGISTER,
  configureRepository,
  useConfigureRepositories,
  writtenRegister,
} from "./support/configure-repositories.js";
import {
  DECLARATION_CHECK_BLOCK,
  SEED_BLOCK,
  configureStep,
  proposalsOf,
  runConfigureSkillCommands,
  type ConfigureAgent,
} from "./support/configure-skill-run.js";

useIoLatencyBudget();

const lisaFolder = useConfigureRepositories();

const STYLE = "SI7";
const COVERAGE = "SI2";
const UNIT_TESTS = "SI1";
const MERGE = "pull-request";
const COVERAGE_ENTRY = "coverage-adequacy@.";
const FLOOR = { "minimum-coverage": { value: 41, direction: "floor" } };

/** F-none with a coverage tool set up, which is what its audit then finds. */
const COVERAGE_SETTINGS = { ".coveragerc": "[run]\nsource = src\n" };

/**
 * What the audit found in F-none: a style checker and a coverage tool, each
 * set up and run by nothing, and one question nobody has answered.
 */
const F_NONE_AUDIT = reportWith(
  ["."],
  [
    foundAt(STYLE, ".", "ruff.toml"),
    foundAt(COVERAGE, ".", ".coveragerc"),
    openQuestion(UNIT_TESTS, "."),
  ]
);

/**
 * One part of a gate for the whole repository, supported by one place.
 * @param command - The command that checks it
 * @param file - The file the audit found the check in
 * @param parameters - The threshold the operator confirmed, when there is one
 * @returns The part
 */
function wholePart(
  command: readonly string[],
  file: string,
  parameters?: unknown
): Readonly<Record<string, unknown>> {
  return {
    scope: ".",
    command,
    ...(parameters === undefined ? {} : { parameters }),
    evidence: { locators: [{ path: file, line: 1 }] },
  };
}

/**
 * The declaration an agent writes for F-none from {@link F_NONE_AUDIT}.
 * @param parameters - The threshold the operator confirmed
 * @param extra - Further gates to declare
 * @returns The `gates` block
 */
function fNoneDeclaration(parameters: unknown, extra: GatesBlock): GatesBlock {
  return {
    "code-style": {
      [MERGE]: "required",
      criteria: [STYLE],
      parts: [wholePart(["ruff", "check", "."], "ruff.toml")],
    },
    "coverage-adequacy": {
      [MERGE]: "required",
      criteria: [COVERAGE],
      parts: [
        wholePart(
          ["python", "-m", "pytest", "--cov"],
          ".coveragerc",
          parameters
        ),
      ],
    },
    ...extra,
  };
}

/**
 * A stand-in for the agent on F-none: it measured coverage at 41 percent, and
 * writes the declaration with the threshold exactly as it was proposed. It
 * stops, as the skill says to, when the audit has not been run.
 * @param repoPath - The repository being configured
 * @param extra - Further gates the stand-in declares
 * @returns The stand-in
 */
function fNoneAgent(repoPath: string, extra: GatesBlock = {}): ConfigureAgent {
  return seed =>
    seed.road === "discovery" && seed.audit_report === "found"
      ? {
          measurements: [
            {
              name: "minimum-coverage",
              "measured value": "41%",
              direction: "floor",
            },
          ],
          declare: proposals => {
            writeFileSync(
              path.join(repoPath, CONFIG),
              configFile(fNoneDeclaration(proposals[0]?.parameters, extra))
            );
          },
        }
      : null;
}

/**
 * Configure F-none after its audit, with the stand-in agent.
 * @param extra - Further gates the stand-in declares
 * @returns The repository and the steps that ran
 */
function configureFNone(extra: GatesBlock = {}): {
  readonly repoPath: string;
  readonly steps: ReturnType<typeof runConfigureSkillCommands>;
} {
  const repoPath = configureRepository("F-none", COVERAGE_SETTINGS);
  writeAuditReport(repoPath, F_NONE_AUDIT);
  return {
    repoPath,
    steps: runConfigureSkillCommands(
      repoPath,
      lisaFolder(),
      fNoneAgent(repoPath, extra)
    ),
  };
}

describe("configure on F-none, where Lisa ships no checks", () => {
  it("proposes the measured coverage of 41 as the floor, and no other number reaches the entry", () => {
    const { repoPath, steps } = configureFNone();
    const [proposal] = proposalsOf(steps);
    const coverage = writtenRegister(repoPath).entries.find(
      entry => entry.id === COVERAGE_ENTRY
    );

    expect(steps.filter(step => step.status !== 0)).toEqual([]);
    expect(proposal).toMatchObject({
      measured: 41,
      parameters: FLOOR,
      question:
        "It measures 41 today. Shall 41 be the lowest it may go from now on?",
    });
    expect(coverage?.parameters).toEqual(FLOOR);
    expect(
      JSON.stringify(coverage)
        .match(/\d+(?:\.\d+)?/gu)
        ?.filter(number => !["41", "1", "2"].includes(number))
    ).toEqual([]);
  });

  it("writes no entry for the unanswered question, and every entry names what supports it", () => {
    const { repoPath, steps } = configureFNone();
    const { entries } = writtenRegister(repoPath);

    expect(configureStep(steps, DECLARATION_CHECK_BLOCK).stdout).toMatch(
      /^declaration-check: PASS\. \.lisa\/audit\/report\.json supports each of the 2 parts/u
    );
    expect(entries.map(entry => entry.id)).toEqual([
      "code-style@.",
      COVERAGE_ENTRY,
    ]);
    expect(
      entries.filter(entry => entry.criteria.includes(UNIT_TESTS))
    ).toEqual([]);
    expect(
      entries.filter(
        entry =>
          (entry.evidence?.locators.length ?? 0) +
            (entry.evidence?.questions.length ?? 0) ===
          0
      )
    ).toEqual([]);
    expect(registerSchemaErrors({ schema_version: 1, entries })).toEqual([]);
  });

  it("stops before the register when an entry is declared for the unanswered question", () => {
    const { repoPath, steps } = configureFNone({
      "test-correctness": {
        [MERGE]: "required",
        criteria: [UNIT_TESTS],
        parts: [wholePart(["python", "-m", "pytest"], "pyproject.toml")],
      },
    });
    const check = configureStep(steps, DECLARATION_CHECK_BLOCK);

    expect(check.status).toBe(1);
    expect(check.stdout).toBe("");
    expect(check.stderr).toContain(
      'The gate "test-correctness" in .lisa.config.json has a part for the whole repository, but the audit still has an open question for the whole repository:'
    );
    expect(steps.at(-1)).toBe(check);
    expect(existsSync(path.join(repoPath, REGISTER))).toBe(false);
  });

  it("changes nothing but the declaration and the register", () => {
    const { repoPath, steps } = configureFNone();

    expect(
      configureStep(steps, CHANGED_BLOCK).stdout.trim().split("\n")
    ).toEqual([`?? ${CONFIG}`, "?? .lisa/audit/report.json", `?? ${REGISTER}`]);
    expect(existsSync(path.join(repoPath, "package.json"))).toBe(false);
  });

  it("stops at the first step, with nothing changed, when the audit has not been run", () => {
    const repoPath = configureRepository("F-none");

    const steps = runConfigureSkillCommands(
      repoPath,
      lisaFolder(),
      fNoneAgent(repoPath)
    );

    expect(JSON.parse(configureStep(steps, SEED_BLOCK).stdout)).toMatchObject({
      road: "discovery",
      audit_report: "missing",
      wrote: false,
    });
    expect(steps.at(-1)?.block.trim()).toBe(SEED_BLOCK);
    expect(runControlAuditGit(repoPath, ["status", "--porcelain"])).toBe("");
  });
});

describe("configure on F-mixed, which has two parts", () => {
  it("takes the discovery road and writes one entry per part the audit supports", () => {
    const repoPath = configureRepository("F-mixed");
    const places = { api: "api/ruff.toml", web: "web/package.json" };
    writeAuditReport(
      repoPath,
      reportWith(
        [".", "api", "web"],
        Object.entries(places).map(([part, file]) => foundAt(STYLE, part, file))
      )
    );
    const declaration: GatesBlock = {
      "code-style": {
        [MERGE]: "required",
        criteria: [STYLE],
        parts: [
          { ...wholePart(["ruff", "check", "."], places.api), scope: "api" },
          { ...wholePart(["npm", "run", "lint"], places.web), scope: "web" },
        ],
      },
    };

    const steps = runConfigureSkillCommands(repoPath, lisaFolder(), () => ({
      declare: () => {
        writeFileSync(path.join(repoPath, CONFIG), configFile(declaration));
      },
    }));

    expect(steps.filter(step => step.status !== 0)).toEqual([]);
    expect(JSON.parse(configureStep(steps, SEED_BLOCK).stdout)).toMatchObject({
      road: "discovery",
      parts: [".", "api", "web"],
      wrote: false,
    });
    expect(writtenRegister(repoPath).entries.map(entry => entry.id)).toEqual([
      "code-style@api",
      "code-style@web",
    ]);
  });
});
