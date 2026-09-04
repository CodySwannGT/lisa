/**
 * A deploy job that already exists in a host repository must be repaired, not
 * merely reported (CodySwannGT/lisa#3740).
 *
 * #3738 fixed the shape in Lisa's deploy templates. Those templates are
 * `create-only` — Lisa seeds `deploy.yml` once and never overwrites it — so
 * that fix reaches new adoptions and reaches nothing that already exists, which
 * is where the defect is live. This migration is the surface that reaches the
 * installed base.
 *
 * ## What makes these assertions non-tautological
 *
 * The input is the condition each shipped template ACTUALLY carried before
 * #3738, and the oracle is `jobRuns` — the evaluator written for #3467, which
 * implements GitHub's implicit `success()` rule and knows nothing about this
 * migration. So the question asked of the migrated file is the same question
 * asked of the shipped templates: under a failed release, does this job run?
 * An implementation that inserted the right text in the wrong place, or wrote a
 * condition that reads plausibly and still skips, fails here.
 *
 * The guard body is compared against the SHIPPED template rather than a copy in
 * this file, so a migration that invented its own wording fails even if the
 * wording looks right.
 *
 * ## The one that would be worse than the bug
 *
 * A migration that suppressed the implicit `success()` and did NOT insert the
 * guard would leave a deploy job that runs on a failed release with nothing
 * checking the release result — it would try to ship. That is asserted
 * directly: a repaired job's FIRST step is the guard, every time.
 * @module tests/unit/migrations/ensure-deploy-outcome-guard
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { load as loadYaml } from "js-yaml";
import { beforeEach, describe, expect, it } from "vitest";

import { jobRuns } from "../../../src/core/github-actions-condition.js";
import { rewrittenCondition } from "../../../src/migrations/deploy-outcome-guard-edit.js";
import { EnsureDeployOutcomeGuardMigration } from "../../../src/migrations/ensure-deploy-outcome-guard.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { SilentLogger } from "../../../src/logging/index.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Repository root, resolved from this file rather than from cwd. */
const ROOT = path.resolve(__dirname, "../../..");

/** The repo-relative workflow path every case seeds. */
const WORKFLOW = [".github", "workflows", "deploy.yml"] as const;

/** The guard step's name, as every shipped deploy workflow spells it. */
const GUARD_STEP_NAME = "🚨 Confirm the release shipped";

/** The rails deploy job's condition before #3738: no mention of the release. */
const RAILS_BEFORE =
  "${{ github.event_name != 'push' || " +
  "!startsWith(github.event.head_commit.message, 'chore(release):') }}";

/** The expo deploy job's condition before #3738: the release named outright. */
const EXPO_BEFORE =
  "always() && needs.check_eas_setup.outputs.has_eas_setup == 'true' && " +
  "needs.release.result == 'success'";

/** The parts of a workflow document these assertions read. */
interface WorkflowDoc {
  readonly jobs?: Readonly<
    Record<
      string,
      {
        readonly if?: string;
        readonly steps?: readonly {
          readonly name?: string;
          readonly run?: string;
        }[];
      }
    >
  >;
}

/**
 * Build a host `deploy.yml` around one deploy job.
 * @param condition - The deploy job's `if:` line content, or null for none
 * @param extraNeeds - Upstream jobs beyond the release
 * @returns Workflow source
 */
function hostWorkflow(
  condition: string | null,
  extraNeeds: readonly string[] = []
): string {
  const needs = ["release", ...extraNeeds].join(", ");
  return [
    "name: Deploy",
    "on:",
    "  push:",
    "    branches: [main]",
    "jobs:",
    "  release:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Cut the release",
    "        run: echo release",
    "  deploy:",
    "    name: Deploy",
    `    needs: [${needs}]`,
    ...(condition === null ? [] : [`    if: ${condition}`]),
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Ship it",
    "        run: echo deploying",
    "",
  ].join("\n");
}

/**
 * The run state for one release outcome.
 * @param release - What the release job reported
 * @returns A scenario the evaluator can be run against
 */
function scenario(
  release: "success" | "failure"
): Parameters<typeof jobRuns>[1] {
  return {
    needs: {
      release: { result: release },
      check_eas_setup: {
        result: "success",
        outputs: { has_eas_setup: "true" },
      },
    },
    github: {
      "github.event_name": "push",
      "github.event.head_commit.message": "feat: x",
    },
    cancelled: false,
  };
}

describe("ensure-deploy-outcome-guard (#3740)", () => {
  let migration: EnsureDeployOutcomeGuardMigration;
  let tempDir: string;
  let projectDir: string;

  beforeEach(async () => {
    migration = new EnsureDeployOutcomeGuardMigration();
    tempDir = await createTempDir("lisa-deploy-guard-");
    projectDir = path.join(tempDir, "project");
    await mkdir(path.join(projectDir, WORKFLOW[0], WORKFLOW[1]), {
      recursive: true,
    });
    return async (): Promise<void> => {
      await cleanupTempDir(tempDir);
    };
  });

  /**
   * A context pointing at the temp project and this repository's templates.
   * @param overrides - Fields to override
   * @returns A migration context
   */
  function context(
    overrides: Partial<MigrationContext> = {}
  ): MigrationContext {
    return {
      projectDir,
      lisaDir: ROOT,
      detectedTypes: ["typescript"],
      dryRun: false,
      logger: new SilentLogger(),
      ...overrides,
    };
  }

  /**
   * Seed the host workflow and run the migration over it.
   * @param source - Workflow source to seed
   * @param overrides - Context fields to override
   * @returns The workflow source after the run
   */
  async function migrate(
    source: string,
    overrides: Partial<MigrationContext> = {}
  ): Promise<string> {
    const file = path.join(projectDir, ...WORKFLOW);
    await writeFile(file, source);
    if (await migration.applies(context(overrides))) {
      await migration.apply(context(overrides));
    }
    return readFile(file, "utf8");
  }

  /**
   * Read the deploy job out of a workflow source.
   * @param source - Workflow source
   * @returns The job's condition and steps
   */
  function deployJob(source: string): {
    readonly condition: string;
    readonly steps: readonly {
      readonly name?: string;
      readonly run?: string;
    }[];
  } {
    const document = loadYaml(source) as WorkflowDoc;
    const job = document.jobs?.deploy;
    return { condition: job?.if ?? "", steps: job?.steps ?? [] };
  }

  describe("the repaired job survives a failed release", () => {
    it.each([
      ["a job with no `if:` at all", null],
      ["the rails condition", RAILS_BEFORE],
      ["the expo condition", EXPO_BEFORE],
    ])("repairs %s", async (_label, condition) => {
      const before = hostWorkflow(condition, ["check_eas_setup"]);

      // Control: the job really does skip before the migration runs.
      expect(jobRuns(deployJob(before).condition, scenario("failure"))).toBe(
        false
      );

      const after = deployJob(await migrate(before));

      expect(jobRuns(after.condition, scenario("failure"))).toBe(true);
      expect(jobRuns(after.condition, scenario("success"))).toBe(true);
    });

    it("puts the guard FIRST, so a job that now runs cannot ship regardless", async () => {
      const after = deployJob(await migrate(hostWorkflow(RAILS_BEFORE)));

      expect(after.steps[0]?.name).toBe(GUARD_STEP_NAME);
      expect(after.steps[1]?.name).toBe("Ship it");
    });

    it("writes the guard body the shipped template carries, not its own", async () => {
      const template = await readFile(
        path.join(
          ROOT,
          "rails",
          "create-only",
          ".github",
          "workflows",
          "deploy.yml"
        ),
        "utf8"
      );
      const shipped = (loadYaml(template) as WorkflowDoc).jobs?.deploy_rails
        ?.steps?.[0];

      const after = deployJob(await migrate(hostWorkflow(RAILS_BEFORE)));

      expect(shipped?.name).toBe(GUARD_STEP_NAME);
      expect(after.steps[0]?.run).toBe(shipped?.run);
    });

    it("points the guard at the host's own release job, not the template's", async () => {
      // The shipped template's guard reads `needs.release.result`. A host whose
      // release job is called something else would receive a guard referring to
      // a job that does not exist — which GitHub resolves to an empty string, so
      // the guard would fail EVERY deploy, including the ones that shipped fine.
      const source = hostWorkflow(null).replaceAll("release", "cut_release");
      const after = loadYaml(await migrate(source)) as WorkflowDoc;

      expect(JSON.stringify(after.jobs?.deploy?.steps?.[0])).toContain(
        "needs.cut_release.result"
      );
    });
  });

  describe("it is idempotent", () => {
    it("leaves an already-repaired workflow alone", async () => {
      const once = await migrate(hostWorkflow(RAILS_BEFORE));
      const twice = await migrate(once);

      expect(twice).toBe(once);
      expect(await migration.applies(context())).toBe(false);
    });

    it("reports noop rather than applied on a healthy workflow", async () => {
      await writeFile(
        path.join(projectDir, ...WORKFLOW),
        hostWorkflow("!cancelled()")
      );

      expect((await migration.apply(context())).action).toBe("noop");
    });
  });

  describe("what it declines", () => {
    it("declines during a postinstall run and changes nothing", async () => {
      const before = hostWorkflow(RAILS_BEFORE);

      const after = await migrate(before, { postinstallSafe: true });

      expect(after).toBe(before);
    });

    it("declines a release gate nested inside an `||`", async () => {
      const before = hostWorkflow(
        "always() && (needs.release.result == 'success' || " +
          "github.event_name == 'workflow_dispatch')"
      );

      // Skips on a failed release under `push`, so it IS the defect — and the
      // migration still refuses, because dropping a term from inside a
      // disjunction changes what the condition means in ways it cannot check.
      expect(jobRuns(deployJob(before).condition, scenario("failure"))).toBe(
        false
      );
      expect(await migrate(before)).toBe(before);
    });

    it("declines when wrapping the condition would not actually repair it", async () => {
      // `success()` is explicit, so `!cancelled() && (success() && ...)` still
      // skips on a failed release. The wrap rule alone would have written that
      // and reported success; the self-check — feeding every rewrite back
      // through the analysis that found the defect — is what refuses it. This
      // is the case that makes that check load-bearing rather than decorative.
      const before = hostWorkflow("success() && github.event_name == 'push'");

      expect(jobRuns(deployJob(before).condition, scenario("failure"))).toBe(
        false
      );
      expect(await migrate(before)).toBe(before);
    });

    it("refuses a rewrite that would not repair, at the point it is proposed", () => {
      // The same refusal as the case above, asserted one layer down. Driving it
      // only through the migration cannot tell the pre-write self-check apart
      // from the post-write one: either alone discards the bad edit, so
      // removing either alone changes nothing observable. This pins the first.
      expect(
        rewrittenCondition(
          {
            id: "deploy",
            needs: ["release"],
            ifCondition: "success() && github.event_name == 'push'",
          },
          "release"
        )
      ).toBeNull();
    });

    it("declines a job whose steps it cannot locate", async () => {
      const before = hostWorkflow(RAILS_BEFORE).replace(
        "    steps:\n      - name: Ship it\n        run: echo deploying\n",
        "    uses: ./.github/workflows/deploy-impl.yml\n"
      );

      expect(await migrate(before)).toBe(before);
    });

    it("changes nothing on a dry run", async () => {
      const before = hostWorkflow(RAILS_BEFORE);

      const after = await migrate(before, { dryRun: true });

      expect(after).toBe(before);
    });
  });
});
