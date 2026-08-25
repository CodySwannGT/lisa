/**
 * The seeding migration must not change what the pre-push hook proves.
 *
 * #2838's third scenario says a step that passed before the migration may not
 * fail after it, and the nine cases in
 * `tests/unit/migrations/ensure-seeded-gates.test.ts` — noop, declares,
 * names-the-task, preserves-keys, never-overwrites, runner-from-lockfile,
 * idempotent, dry-run — do not run a hook at all. Equivalence was argued
 * STRUCTURALLY through the `seedRun` overrides rather than measured, which is
 * the "a passing test proves it ran, not that it bites" shape this epic keeps
 * finding.
 *
 * So this runs the real shipped hook, twice, against the same fixture: once
 * with no `gates` block and once after the migration writes one, and compares
 * the outcome of every step across the two runs.
 *
 * WHAT AN OUTCOME IS HERE. Not the printed line — the wording is SUPPOSED to
 * change, from "🔍 Running type check..." to "ℹ️ Covered by the
 * type-correctness gate". What must not change is which prover ran and whether
 * it passed, so every project task in the fixture prints a unique token and
 * the comparison is over the set of tokens plus the hook's exit status.
 *
 * WHY THE FIXTURE STUBS `bun`. The hook's audit step shells out to
 * `bun audit --production --json`, which needs the network and a real
 * dependency tree; neither is available to a hermetic test, and a step that
 * fails for want of a network in BOTH runs compares equal while proving
 * nothing. The stub answers `audit` with `{}` — a clean payload the hook's own
 * jq filters then evaluate for real — and `run <task>` by executing the
 * fixture's own script. The hook's logic is untouched; only the tools it
 * shells out to are fixtures.
 *
 * @module tests/integration/seeded-gates-preserve-hook-outcomes
 */

import * as fs from "fs-extra";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../src/core/config.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { EnsureSeededGatesMigration } from "../../src/migrations/ensure-seeded-gates.js";
import type { MigrationContext } from "../../src/migrations/migration.interface.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** `sh` by absolute path — never resolved through a writeable $PATH. */
const SH = "/bin/sh";

/** Wall-clock ceiling for one whole hook run. */
const HOOK_TIMEOUT_MS = 120_000;

/** The settings file the migration writes into. */
const LISA_CONFIG = ".lisa.config.json";

/** The property whose handover this suite watches most closely. */
const TYPE_CORRECTNESS = "type-correctness";

/** The fixture package name. */
const FIXTURE_NAME = "fixture";

/** The shipped hook this suite executes. */
const HOOK_TEMPLATE = path.join(
  REPO_ROOT,
  "typescript",
  "copy-contents",
  ".husky",
  "pre-push"
);

/** Shipped scripts the fixture installs so the hook resolves a real registry. */
const SHIPPED_SCRIPTS = ["lisa-gates.mjs", "lisa-run-gates.mjs"];

/**
 * The fixture's package scripts.
 *
 * Every one prints a unique token and exits 0. The token is what makes an
 * outcome comparable: it says this prover RAN, whichever branch of the hook
 * decided to run it.
 */
const FIXTURE_SCRIPTS: Readonly<Record<string, string>> = Object.freeze({
  typecheck: "echo LISA-RAN:typecheck",
  "lint:slow": "echo LISA-RAN:lint:slow",
  "knip:check": "echo LISA-RAN:knip:check",
  // Carries the scope marker the pinned script carries: without it the
  // hook falls back to `test:cov`, because a unit run with no unit-scope
  // floor is measured against the full suite's.
  "test:cov:unit": "LISA_COVERAGE_SCOPE=unit echo LISA-RAN:test:cov:unit",
  "test:integration": "echo LISA-RAN:test:integration",
  "check:work-item:push": "echo LISA-RAN:check:work-item:push",
});

/** The stub package manager the fixture puts ahead of the real one. */
const BUN_STUB = `#!/bin/sh
# Fixture stand-in for bun. Two verbs, both hermetic.
if [ "$1" = "audit" ]; then
  # A clean payload the hook's own jq filters evaluate for real. Emitting
  # nothing would (correctly) block the push, which is the transport hole the
  # hook is written to refuse.
  echo '{}'
  exit 0
fi
if [ "$1" = "run" ]; then
  shift
  exec node -e '
    const fs = require("node:fs");
    const scripts = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts || {};
    const task = process.argv[1];
    if (!scripts[task]) { process.stderr.write("no such script: " + task + "\\n"); process.exit(1); }
    const { spawnSync } = require("node:child_process");
    const done = spawnSync("/bin/sh", ["-c", scripts[task]], { stdio: "inherit" });
    process.exit(done.status === null ? 1 : done.status);
  ' "$@"
fi
exit 0
`;

/**
 * Which registry property each fixture prover proves.
 *
 * The comparison has to be by PROPERTY, not by command. That is the whole
 * substance of the migration: `traceability` is proved before it by the
 * written-in `node scripts/lisa-work-item.mjs validate-push` and after it by
 * the declared `check:work-item:push` task. Comparing commands would report
 * that as a regression; comparing properties reports it as the handover it is.
 */
const TASK_PROVES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "work-item-builtin": ["traceability"],
  "check:work-item:push": ["traceability"],
  typecheck: [TYPE_CORRECTNESS],
  "lint:slow": ["code-style-slow"],
  "knip:check": ["dead-code"],
  // ONE run, TWO properties — the suite passing and the thresholds holding.
  "test:cov:unit": ["test-correctness", "coverage-adequacy"],
  "test:integration": ["test-integration"],
});

/**
 * The properties one run proved and passed.
 *
 * Two sources, because the migration moves the proof from one to the other:
 * a token means a prover executed and the hook did not stop, and a runner
 * verdict line means the declared gate ran green. A property present in
 * neither was not proved by that run.
 * @param output The hook's combined output.
 * @returns Property ids, sorted.
 */
const provedIn = (output: string): string[] => {
  const proved = new Set<string>();
  for (const hit of output.matchAll(/LISA-RAN:(\S{1,64})/g)) {
    for (const gate of TASK_PROVES[hit[1] ?? ""] ?? []) proved.add(gate);
  }
  for (const hit of output.matchAll(
    /^ {2,}PASSED {1,20}\S{1,20} {1,20}(\S{1,64})/gm
  )) {
    if (hit[1] !== undefined) proved.add(hit[1]);
  }
  return [...proved].sort((left, right) => left.localeCompare(right));
};

describe("seeding the gates block preserves what the pre-push hook proves", () => {
  const migration = new EnsureSeededGatesMigration();
  let tempDir = "";
  let projectDir = "";
  let lisaDir = "";
  let binDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-hook-equiv-"));
    projectDir = path.join(tempDir, "project");
    lisaDir = path.join(tempDir, "lisa");
    binDir = path.join(tempDir, "bin");
    await fs.ensureDir(lisaDir);
    await fs.ensureDir(path.join(projectDir, "scripts"));
    await fs.ensureDir(path.join(projectDir, ".husky"));
    await fs.ensureDir(binDir);

    await fs.writeFile(path.join(binDir, "bun"), BUN_STUB, { mode: 0o755 });
    // A lockfile is how the hook picks its runner, and how the migration picks
    // the `gates.runner` it writes. Both must land on the stub.
    await fs.writeFile(path.join(projectDir, "bun.lock"), "");
    await fs.writeJson(path.join(projectDir, "package.json"), {
      name: FIXTURE_NAME,
      version: "1.0.0",
      scripts: { ...FIXTURE_SCRIPTS },
    });
    await fs.writeJson(path.join(projectDir, LISA_CONFIG), {
      tracker: "github",
    });
    await fs.copy(HOOK_TEMPLATE, path.join(projectDir, ".husky", "pre-push"));
    for (const script of SHIPPED_SCRIPTS) {
      await fs.copy(
        path.join(REPO_ROOT, "all", "copy-overwrite", "scripts", script),
        path.join(projectDir, "scripts", script)
      );
    }
    // The gate runner imports its diagnosis helpers by relative path, so the
    // installed copy is a directory beside it, not a lone file.
    await fs.copy(
      path.join(REPO_ROOT, "all", "copy-overwrite", "scripts", "lib"),
      path.join(projectDir, "scripts", "lib")
    );
    // The traceability step runs before any coverage file exists, so it always
    // shells out to this. A stub keeps the fixture off the network without
    // changing which branch the hook takes.
    await fs.writeFile(
      path.join(projectDir, "scripts", "lisa-work-item.mjs"),
      'process.stdout.write("LISA-RAN:work-item-builtin\\n");\n'
    );
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  /**
   * The migration context for the fixture project.
   * @returns The context the seeding migration runs against.
   */
  const context = (): MigrationContext => ({
    projectDir,
    lisaDir,
    detectedTypes: ["typescript"] as ProjectType[],
    dryRun: false,
    logger: new SilentLogger(),
  });

  /**
   * Runs the shipped hook in the fixture.
   * @returns Exit status, output, and the provers that ran.
   */
  const runHook = (): {
    status: number;
    output: string;
    proved: string[];
  } => {
    const result = spawnSync(SH, [path.join(".husky", "pre-push")], {
      cwd: projectDir,
      encoding: "utf8",
      timeout: HOOK_TIMEOUT_MS,
      input: "",
      env: {
        ...process.env,
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- the
        // prepended directory is a per-test mkdtemp the suite created and
        // owns; putting the stub package manager on PATH is the ONLY way to
        // run the shipped hook unmodified, and modifying it would mean this
        // suite no longer tests the artifact that ships.
        PATH: `${binDir}:${process.env["PATH"] ?? ""}`,
      },
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    // A killed child returns EMPTY streams, so the failure would present as a
    // hook that proved nothing and never say "time".
    if (result.signal !== null) {
      throw new Error(
        `the hook was KILLED (${result.signal}) rather than completing, so ` +
          `its empty output is a timeout and not a hook that proved nothing.`
      );
    }
    return { status: result.status ?? -1, output, proved: provedIn(output) };
  };

  it("runs the built-in provers before the migration", () => {
    // The positive control. Without this, a comparison of two runs that both
    // proved nothing would pass and mean nothing.
    const before = runHook();

    expect(before.status, before.output).toBe(0);
    expect(before.proved.length).toBeGreaterThan(3);
    expect(before.proved).toContain(TYPE_CORRECTNESS);
    expect(before.proved).toContain("traceability");
  });

  it("proves the same properties after the migration seeds a gates block", async () => {
    const before = runHook();
    const applied = await migration.apply(context());
    const after = runHook();
    const seeded = (await fs.readJson(path.join(projectDir, LISA_CONFIG)))[
      "gates"
    ] as Record<string, unknown>;

    expect(applied.action).toBe("applied");
    // The declaration exists, so the second run genuinely took the other path.
    expect(Object.keys(seeded).length).toBeGreaterThan(1);
    expect(after.output).toContain("Covered by");

    // THE CONTROL. Every property proved and passed before the migration must
    // still be proved and passed after it. A seeded declaration pointing at a
    // different task, at a task the project does not have, or at nothing at
    // all drops its property here.
    expect(
      before.proved.filter(gate => !after.proved.includes(gate)),
      `these properties were proved before the migration and not after:\n${after.output}`
    ).toEqual([]);
    expect(after.status, after.output).toBe(0);
  });

  it("fails when a declaration points at a prover that does not pass", async () => {
    // The negative control, which is what makes the comparison above worth
    // running. Without it, a control comparing two identical empty sets would
    // report success having proved nothing — the exact defect this epic exists
    // to remove.
    const broken = {
      tracker: "github",
      gates: {
        runner: "bun run",
        [TYPE_CORRECTNESS]: {
          push: { level: "required", run: "typecheck:broken" },
        },
      },
    };
    const manifest = {
      name: FIXTURE_NAME,
      version: "1.0.0",
      scripts: { ...FIXTURE_SCRIPTS, "typecheck:broken": "exit 1" },
    };
    const before = runHook();
    await fs.writeJson(path.join(projectDir, LISA_CONFIG), broken);
    await fs.writeJson(path.join(projectDir, "package.json"), manifest);
    const after = runHook();

    expect(before.proved).toContain(TYPE_CORRECTNESS);
    expect(after.proved).not.toContain(TYPE_CORRECTNESS);
    expect(
      before.proved.filter(gate => !after.proved.includes(gate))
    ).not.toEqual([]);
  });
});
