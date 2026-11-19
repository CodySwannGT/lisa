/**
 * The gate registry in a repository with no `package.json`
 * (CodySwannGT/lisa#4987).
 *
 * The registry used to answer one question about every gate: which package
 * script proves it. A repository on no supported project type has no package
 * scripts, so that question has no answer there. A gate that declares `parts`
 * does not ask it — each part names its own command — and these cases hold
 * the registry to that: a part resolves, validates and lists the same whether
 * the manifest is absent, empty or full.
 *
 * A gate with no parts still asks the old question, and still gets the old
 * answer. Nothing here changes what it resolves to.
 * @module tests/unit/controls/lisa-gates-no-manifest
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  auditProvers,
  configurationProblems,
  DEFAULT_RUNNER,
  projectScripts,
  readGates,
  readScripts,
  resolveMoment,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { F_NONE_GATES } from "../../helpers/control-register.js";
import {
  declaredFNone,
  GATES_SCRIPT,
  type NoManifestRepository,
  runShipped,
  stackFrames,
} from "../../support/no-manifest-run.js";

const COMMIT = "commit";
const PULL_REQUEST = "pull-request";
const STYLE = "code-style";
const LIST_AT_COMMIT = ["list", `--moment=${COMMIT}`];

/** The command F-none declares for its one part at commit. */
const RUFF = ["ruff", "check", "."];

/** A gate as it was written before parts existed: a level and nothing else. */
const TASK_GATE = { [STYLE]: { [COMMIT]: "required" } };

/** A gate of the project's own that names nothing to run. */
const NO_PROVER = { "x-audit": { [COMMIT]: "required" } };

/** The three things a caller can know about a project's package scripts. */
const MANIFESTS: ReadonlyArray<
  readonly [string, Record<string, string> | null]
> = [
  ["absent", null],
  ["empty", {}],
  ["full", { lint: "eslint .", "test:coverage": "vitest run --coverage" }],
];

/** One resolved entry, as far as these cases read it. */
interface Resolved {
  readonly id: string;
  readonly level: string;
  readonly mode: string;
  readonly task: string | null;
  readonly command: string | null;
  readonly scope?: string;
  readonly argv?: string[] | null;
}

/**
 * Resolve a gates block at one moment.
 * @param gates - The gates block
 * @param moment - The moment
 * @param scripts - The project's package scripts, `null` for no manifest
 * @returns The resolved entries
 */
function resolve(
  gates: object,
  moment: string,
  scripts: Record<string, string> | null
): Resolved[] {
  return resolveMoment({ gates, moment, scripts });
}

describe("the gate registry in a repository with no package.json", () => {
  let repository: NoManifestRepository;
  let root: string;

  beforeAll(() => {
    repository = declaredFNone(F_NONE_GATES);
    root = repository.fixture.repoPath;
  });

  afterAll(() => {
    repository.cleanup();
  });

  it("is looking at a repository that really has no manifest", () => {
    expect(existsSync(path.join(root, "package.json"))).toBe(false);
  });

  it("reads the absent manifest as unknown, never as an empty one", () => {
    expect(projectScripts(root)).toBeNull();
    expect(readScripts(root)).toEqual({});
  });

  it("reads the declaration without a manifest to read beside it", () => {
    const { gates, runner } = readGates(root);

    expect(Object.keys(gates)).toEqual(Object.keys(F_NONE_GATES));
    expect(runner).toBe(DEFAULT_RUNNER);
  });

  it("resolves a part to the command it declares", () => {
    const { gates } = readGates(root);

    expect(resolve(gates, COMMIT, projectScripts(root))).toEqual([
      expect.objectContaining({
        argv: RUFF,
        command: null,
        id: STYLE,
        level: "required",
        mode: "run",
        scope: ".",
        task: null,
      }),
    ]);
  });

  it.each(MANIFESTS)(
    "resolves a part the same when the manifest is %s",
    (_name, scripts) => {
      for (const moment of [COMMIT, PULL_REQUEST]) {
        expect(resolve(F_NONE_GATES, moment, scripts)).toEqual(
          resolve(F_NONE_GATES, moment, null)
        );
      }
    }
  );

  it.each(MANIFESTS)(
    "has nothing to advise about a part when the manifest is %s",
    (_name, scripts) => {
      expect(
        auditProvers({ gates: F_NONE_GATES, runner: DEFAULT_RUNNER, scripts })
      ).toEqual([]);
    }
  );

  it.each(MANIFESTS)(
    "refuses nothing about a part when the manifest is %s",
    (_name, scripts) => {
      expect(
        configurationProblems({ gates: F_NONE_GATES, policy: {}, scripts })
          .blocking
      ).toEqual([]);
    }
  );

  describe("a gate with no parts", () => {
    it("still resolves to the task runner's command line", () => {
      const [entry, ...rest] = resolve(TASK_GATE, COMMIT, projectScripts(root));

      expect(rest).toEqual([]);
      expect(entry).toMatchObject({
        command: `${DEFAULT_RUNNER} lint`,
        mode: "run",
        task: "lint",
      });
      expect(entry).not.toHaveProperty("argv");
      expect(entry).not.toHaveProperty("scope");
    });

    it("is not called unrunnable on the strength of a manifest nobody read", () => {
      const scripts = projectScripts(root);

      expect(
        configurationProblems({ gates: TASK_GATE, policy: {}, scripts })
          .blocking
      ).toEqual([]);
      expect(
        auditProvers({ gates: TASK_GATE, runner: DEFAULT_RUNNER, scripts })
      ).toEqual([]);
    });

    it("is refused when it is the project's own and names nothing to run", () => {
      const { blocking } = configurationProblems({
        gates: NO_PROVER,
        policy: {},
        scripts: projectScripts(root),
      });

      expect(blocking).toHaveLength(1);
      expect(blocking[0]).toContain('gates."x-audit"."commit" names no prover');
    });
  });

  describe("the validate and list commands", () => {
    it("validate accepts the declaration and prints no complaint", () => {
      const child = runShipped(repository, GATES_SCRIPT, ["validate"]);

      expect(child.status).toBe(0);
      expect(child.stdout).toContain(
        "gates and policy: configuration is valid"
      );
      expect(child.stderr).toBe("");
    });

    it("list shows a part as its folder and its argument list", () => {
      const child = runShipped(repository, GATES_SCRIPT, LIST_AT_COMMIT);

      expect(child.status).toBe(0);
      expect(child.stdout.trimEnd()).toBe(
        `required  ${STYLE.padEnd(28)} in .: ${JSON.stringify(RUFF)}`
      );
      expect(child.stderr).toBe("");
    });

    it("list --json carries the folder and the argument list", () => {
      const child = runShipped(repository, GATES_SCRIPT, [
        ...LIST_AT_COMMIT,
        "--json",
      ]);

      expect(child.status).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual([
        expect.objectContaining({ argv: RUFF, command: null, scope: "." }),
      ]);
    });
  });
});

describe("the same two commands on a gate with no parts and no manifest", () => {
  const cleanups: Array<() => void> = [];

  /**
   * Build F-none with a declaration, removed when the case ends.
   * @param gates - The gates block
   * @returns The repository
   */
  function declaring(gates: Record<string, unknown>): NoManifestRepository {
    const repository = declaredFNone(gates);
    cleanups.push(repository.cleanup);
    return repository;
  }

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("list shows the task runner's command line, as it always has", () => {
    const child = runShipped(
      declaring(TASK_GATE),
      GATES_SCRIPT,
      LIST_AT_COMMIT
    );

    expect(child.status).toBe(0);
    expect(child.stdout).toContain(`${DEFAULT_RUNNER} lint`);
  });

  it("validate refuses a gate that names nothing to run, in a sentence", () => {
    const child = runShipped(declaring(NO_PROVER), GATES_SCRIPT, ["validate"]);

    expect(child.status).toBe(1);
    expect(child.stderr).toContain('gates."x-audit"."commit" names no prover');
    expect(child.stderr).toContain("1 blocking configuration problem(s).");
    expect(stackFrames(`${child.stdout}\n${child.stderr}`)).toEqual([]);
  });
});
