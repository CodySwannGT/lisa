/**
 * Unit tests for scripts/check-workflow-contract-assertions.mjs
 * (CodySwannGT/lisa#3698).
 *
 * The run-time assertion proved in
 * `tests/unit/scripts/workflow-contract-assertion.test.ts` only fires if a
 * caller actually carries it. The reference and the assertion are one unit: a
 * template that takes `uses: …@main` and drops the seeded major is back to
 * silent staleness and looks perfectly healthy doing it. This gate is what
 * refuses that separation, and it is the reason the run-time half can afford to
 * be non-fatal when a caller declares nothing.
 *
 * The exit-2 cases carry as much weight as the exit-1 cases. A gate that could
 * not read its registry, or that scanned nothing, must say NOT DETERMINED
 * rather than report a clean run — reproducing the very "silence reads as
 * success" defect it exists to catch would be the worst possible outcome here.
 *
 * Per the Test Isolation house rule, expected values are HARDCODED. The fixture
 * repositories are self-contained: nothing below reads this repository's own
 * registry or workflows, so a legitimate change to either cannot green or
 * redden these cases.
 *
 * @module tests/unit/scripts/check-workflow-contract-assertions
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, describe, expect, it } from "vitest";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const SCRIPT = path.resolve("scripts/check-workflow-contract-assertions.mjs");
const GIT = resolveGit();

/** The reusable the fixture repositories ship. */
const REUSABLE = "gates.yml";

/** A caller path the gate recognises: `<lane>/<mode>/.github/workflows/…`. */
const TEMPLATE = "typescript/create-only/.github/workflows/ci.yml";

/** The canonical assertion body, as the fixture declares it. */
const CANON = ["set -eu", 'echo "${DECLARED_MAJOR} ${EXPECTED_MAJOR}"'];

/**
 * A reusable workflow carrying the assertion.
 *
 * @param options - what to leave out or get wrong.
 * @param options.declared - the major the workflow declares.
 * @param options.input - whether the `expected_…` input is declared.
 * @param options.body - the inlined assertion body.
 * @returns The workflow's YAML text.
 */
function reusable(options: {
  declared: string;
  input?: boolean;
  body?: readonly string[];
}): string {
  const lines = ["name: gates", "on:", "  workflow_call:", "    inputs:"];
  if (options.input !== false) {
    lines.push(
      "      expected_workflow_contract_major:",
      "        required: false",
      "        default: ''",
      "        type: string"
    );
  } else {
    lines.push(
      "      node_version:",
      "        default: '22'",
      "        type: string"
    );
  }
  lines.push(
    "jobs:",
    "  workflow_contract:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: assert",
    "        env:",
    `          DECLARED_MAJOR: '${options.declared}'`,
    "          EXPECTED_MAJOR: ${{ inputs.expected_workflow_contract_major }}",
    `          WORKFLOW_FILE: ${REUSABLE}`,
    "        run: |",
    ...(options.body ?? CANON).map(line => `          ${line}`),
    ""
  );
  return lines.join("\n");
}

/**
 * A caller template referencing the fixture reusable at `@main`.
 *
 * @param seeded - the major to seed, or `null` to omit the assertion entirely.
 * @returns The template's YAML text.
 */
function caller(seeded: string | null): string {
  const lines = [
    "name: ci",
    "on:",
    "  pull_request:",
    "jobs:",
    "  quality:",
    `    uses: CodySwannGT/lisa/.github/workflows/${REUSABLE}@main`,
    "    with:",
    "      node_version: '22'",
  ];
  if (seeded !== null) {
    lines.push(`      expected_workflow_contract_major: '${seeded}'`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * A registry recording one workflow.
 *
 * @param entry - the entry to store, keyed by the fixture reusable's name.
 * @returns The registry's JSON text.
 */
function registry(entry: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify({ schemaVersion: 1, workflows: { [REUSABLE]: entry } }, null, 2)}\n`;
}

/** A conformant fixture: registry, canonical body, reusable, seeded caller. */
function conformant(): Record<string, string> {
  return {
    ".github/reusable-workflow-contracts.json": registry({ major: 1 }),
    [`.github/workflows/${REUSABLE}`]: reusable({ declared: "1" }),
    "scripts/workflow-contract-assertion.sh": `${CANON.join("\n")}\n`,
    [TEMPLATE]: caller("1"),
  };
}

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/**
 * Create a temporary git repository with `files` written and committed.
 *
 * @param files - relative path to file contents.
 * @returns The absolute repository root.
 */
function tempRepo(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-3698-"));
  const env = cleanGitEnv(process.env);
  const git = (...args: readonly string[]): void => {
    boundedExecFileSync({
      label: `git ${args[0] ?? ""}`,
      command: GIT,
      args,
      cwd: root,
      env,
      stdio: "ignore",
    });
  };
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", "-A");
  git("commit", "-q", "-m", "seed");
  return root;
}

/**
 * Run the CLI against a fixture repository.
 *
 * @param files - the fixture's contents.
 * @returns The exit code and combined output.
 */
function run(files: Readonly<Record<string, string>>): {
  code: number;
  output: string;
} {
  const root = tempRepo(files);
  try {
    const stdout = boundedExecFileSync({
      label: "check-workflow-contract-assertions.mjs",
      command: process.execPath,
      args: [SCRIPT, "--root", root],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const failure = error as {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: typeof failure.exitCode === "number" ? failure.exitCode : -1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

describe("a conformant repository", () => {
  it("passes, reporting what it examined rather than only that it passed", () => {
    const result = run(conformant());

    expect(result.code).toBe(0);
    expect(result.output).toContain("1 reusable workflow(s)");
    expect(result.output).toContain("1 caller reference(s)");
  });
});

describe("the assertion cannot be dropped silently", () => {
  it("reports a template carrying the reference without the assertion", () => {
    const result = run({ ...conformant(), [TEMPLATE]: caller(null) });

    expect(result.code).toBe(1);
    expect(result.output).toContain(TEMPLATE);
    expect(result.output).toContain(
      "seeds no `expected_workflow_contract_major`"
    );
  });

  it("reports a template still seeding a superseded major", () => {
    // The state a bump reaches before the templates are reseeded: a NEW
    // consumer would take the template and be red on arrival.
    const result = run({
      ...conformant(),
      ".github/reusable-workflow-contracts.json": registry({ major: 2 }),
      [`.github/workflows/${REUSABLE}`]: reusable({ declared: "2" }),
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain("seeds gates.yml with major 1");
  });
});

describe("every reusable is covered, not only the ones someone remembered", () => {
  it("reports a reusable workflow missing from the registry", () => {
    const files = conformant();
    delete files[".github/reusable-workflow-contracts.json"];
    const result = run({
      ...files,
      ".github/reusable-workflow-contracts.json": `${JSON.stringify({ schemaVersion: 1, workflows: {} }, null, 2)}\n`,
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain("absent from");
  });

  it("accepts a workflow that records why it carries no assertion", () => {
    const result = run({
      ...conformant(),
      ".github/reusable-workflow-contracts.json": registry({
        uncovered: "called only by a local ./ reference, which cannot be stale",
      }),
      [TEMPLATE]: caller(null),
    });

    expect(result.code).toBe(0);
  });

  it("refuses an exemption that records no reason", () => {
    const result = run({
      ...conformant(),
      ".github/reusable-workflow-contracts.json": registry({ uncovered: "" }),
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain("non-empty reason");
  });

  it("reports a registry entry for a workflow that does not exist", () => {
    const result = run({
      ...conformant(),
      ".github/reusable-workflow-contracts.json": `${JSON.stringify(
        {
          schemaVersion: 1,
          workflows: { [REUSABLE]: { major: 1 }, "gone.yml": { major: 1 } },
        },
        null,
        2
      )}\n`,
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain("gone.yml");
  });
});

describe("the reusable's own half", () => {
  it("reports a workflow whose declared major disagrees with the registry", () => {
    const result = run({
      ...conformant(),
      [`.github/workflows/${REUSABLE}`]: reusable({ declared: "3" }),
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain("declares major 3");
  });

  it("reports a workflow that never declares the input to compare", () => {
    const result = run({
      ...conformant(),
      [`.github/workflows/${REUSABLE}`]: reusable({
        declared: "1",
        input: false,
      }),
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain("does not declare");
  });

  it("reports an inlined assertion that has drifted from the canonical body", () => {
    // Fifteen inlined copies of one shell block drift the way every copied
    // artifact in this repository drifts; the difference is whether anything
    // notices.
    const result = run({
      ...conformant(),
      [`.github/workflows/${REUSABLE}`]: reusable({
        body: ["set -eu", "exit 0"],
        declared: "1",
      }),
    });

    expect(result.code).toBe(1);
    expect(result.output).toContain("drifted");
  });
});

describe("a scan that could not look", () => {
  it("says NOT DETERMINED when the registry is unreadable", () => {
    const files = conformant();
    delete files[".github/reusable-workflow-contracts.json"];
    const result = run(files);

    expect(result.code).toBe(2);
    expect(result.output).toContain("NOT DETERMINED");
  });

  it("says NOT DETERMINED when the canonical body is missing", () => {
    const files = conformant();
    delete files["scripts/workflow-contract-assertion.sh"];
    const result = run(files);

    expect(result.code).toBe(2);
    expect(result.output).toContain("workflow-contract-assertion.sh");
  });

  it("refuses to call a scan clean when it found no caller templates", () => {
    const files = conformant();
    delete files[TEMPLATE];
    const result = run(files);

    expect(result.code).toBe(2);
    expect(result.output).toContain("no caller templates found");
  });

  it("refuses to call a scan clean when it found no reusable workflows", () => {
    const files = conformant();
    delete files[`.github/workflows/${REUSABLE}`];
    const result = run({
      ...files,
      ".github/reusable-workflow-contracts.json": `${JSON.stringify({ schemaVersion: 1, workflows: {} }, null, 2)}\n`,
    });

    expect(result.code).toBe(2);
    expect(result.output).toContain("no reusable workflows found");
  });
});
