/**
 * The deploy and continuous moment families have a runner, and it is wired in.
 *
 * The registry could always accept
 *
 * ```json
 * "runtime-web-vulnerability": { "pre-deploy:production": "required" }
 * ```
 *
 * — `validate` passed it, `list` printed it, and nothing anywhere executed it.
 * Thirty-nine of the forty-one gates are legal at `pre-deploy`, so the gap was
 * not a three-gate corner; it was every property a project might want to hold a
 * release on. This suite pins the two halves of the fix that a unit test cannot
 * see: that a runner EXISTS at those moments, and that the deploy workflows
 * actually CALL it — before releasing, not beside it.
 *
 * ## Derived, never listed
 *
 * Both invariants are computed from the shipped artefacts rather than compared
 * against a snapshot. The exit-code routing is derived from the runner's own
 * `EXIT` table, so a new code cannot be added without a route. The deploy-family
 * coverage is derived by globbing the stack templates, so a new stack cannot
 * ship a deploy workflow that skips the gate. A list would go stale in silence,
 * which is the same defect in a different costume.
 * @module tests/integration/deploy-moment-runner
 */

import * as fs from "fs-extra";
import { load as loadYaml } from "js-yaml";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { momentsExecutedBy } from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { EXIT } from "../../all/copy-overwrite/scripts/lisa-run-gates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The reusable workflow that runs the gates declared at one moment. */
const GATES_WORKFLOW = ".github/workflows/gates.yml";

/** How a caller inside this repository names it. */
const LOCAL_USES = "./.github/workflows/gates.yml";

/** How a consumer names it. Version-less on purpose: it tracks `@main`. */
const REMOTE_USES = "CodySwannGT/lisa/.github/workflows/gates.yml@main";

/** The runner the workflow must actually invoke. */
const RUNNER_SCRIPT = "lisa-run-gates.mjs";

/** The moment families a deploy workflow is responsible for. */
const PRE_DEPLOY = "pre-deploy:";
const POST_DEPLOY = "post-deploy:";

/** Codes that mean nothing was proved, so a deploy must not continue. */
const FAIL_CLOSED: readonly number[] = [EXIT.BLOCKED, EXIT.RUNNER_FAILED];

/** One workflow job, in the shape this suite reads. */
interface Job {
  /** The reusable workflow it calls, if any. */
  uses?: string;
  /** Jobs it waits for. */
  needs?: string | string[];
  /** Inputs handed to the called workflow. */
  with?: Record<string, unknown>;
  /** Steps, for a job that runs its own. */
  steps?: { run?: string; name?: string }[];
}

/** One workflow file, in the shape this suite reads. */
interface Workflow {
  /** The jobs it defines. */
  jobs?: Record<string, Job>;
  /** Triggers. */
  on?: Record<string, unknown>;
}

/**
 * Parse one workflow relative to the repository root.
 * @param relative Path from the repository root.
 * @returns The parsed workflow.
 */
const read = (relative: string): Workflow =>
  loadYaml(fs.readFileSync(path.join(REPO_ROOT, relative), "utf8")) as Workflow;

/**
 * A job's `needs`, always as a list.
 * @param job The job.
 * @returns The job ids it waits for.
 */
const needsOf = (job: Job): string[] =>
  Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];

/** Any `case` arm opener: a numeric code, the `*` default, or `esac`. */
const NEXT_ARM = /^[ \t]*(?:\d+\)|\*\)|esac\b)/m;

/**
 * The routing body for one exit code, bounded by the next `case` arm.
 *
 * Bounded, because the obvious version is a false pass waiting to happen. A
 * fixed-length window past the end of an arm picks up the `exit 1` belonging to
 * a LATER arm, and the assertion then passes for an arm that does not stop —
 * on the exact property this test exists to protect. Indentation-agnostic for
 * the same reason: a hardcoded indent turns a re-indented workflow into a
 * failure with a misleading message instead of a passing test.
 * @param source The workflow source.
 * @param code The exit code whose arm is wanted.
 * @returns The arm's body, up to but excluding the next arm.
 */
function caseArm(source: string, code: number): string {
  const start = source.search(new RegExp(`^[ \\t]*${code}\\)`, "m"));
  if (start === -1) {
    throw new Error(`exit code ${code} has no case arm in ${GATES_WORKFLOW}`);
  }
  const rest = source.slice(start);
  const newline = rest.indexOf("\n");
  // Search from the line AFTER this arm's opener, or the opener matches itself
  // and the "body" comes back a single character long — a false FAILURE, which
  // is the safe direction but still the wrong answer.
  const body = newline === -1 ? rest.length : newline + 1;
  const next = rest.slice(body).search(NEXT_ARM);
  return next === -1 ? rest : rest.slice(0, body + next);
}

/**
 * Every stack template that ships a deploy workflow.
 *
 * Globbed rather than listed: a new stack that adds `deploy.yml` is picked up
 * here automatically, and therefore has to carry the gate.
 * @returns Repository-relative paths.
 */
const deployTemplates = (): string[] =>
  fs
    .readdirSync(REPO_ROOT)
    .map(entry => path.join(entry, "create-only/.github/workflows/deploy.yml"))
    .filter(relative => fs.existsSync(path.join(REPO_ROOT, relative)));

describe("a runner exists at the deploy and continuous moments", () => {
  it("ships a reusable workflow that invokes the gate runner", () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, GATES_WORKFLOW),
      "utf8"
    );

    expect(source).toContain(RUNNER_SCRIPT);
    expect(source).toContain("--moment=");
    expect(read(GATES_WORKFLOW).on).toHaveProperty("workflow_call");
  });

  it("routes every exit code the runner publishes", () => {
    // Derived from the runner's own table. A code added there with no route
    // here would fall through to the shell's last status, which is how a
    // deploy gate comes to pass having proved nothing.
    const source = fs.readFileSync(
      path.join(REPO_ROOT, GATES_WORKFLOW),
      "utf8"
    );

    for (const code of Object.values(EXIT) as number[]) {
      expect(source, `exit code ${code} is unrouted`).toMatch(
        new RegExp(`^\\s*${code}\\)`, "m")
      );
    }
  });

  it("fails closed on every code that means nothing was proved", () => {
    // A hook falls back to its built-in steps when the runner cannot run. A
    // deploy has no built-in steps to fall back to, so the only safe answer is
    // to stop. `78` is deliberately NOT here: it means the project has no gates
    // block at all, and inventing a verdict for it would change behaviour for a
    // project that declared nothing.
    const source = fs.readFileSync(
      path.join(REPO_ROOT, GATES_WORKFLOW),
      "utf8"
    );
    for (const code of FAIL_CLOSED) {
      expect(caseArm(source, code), `code ${code} does not stop`).toContain(
        "exit 1"
      );
    }
    // And the arm that must NOT stop, asserted in the same place as the ones
    // that must. Without it this test is satisfied by a workflow that fails on
    // everything, which blocks every deploy in every consumer that declared
    // nothing — the regression that shipped in this PR's first commit.
    expect(caseArm(source, EXIT.NO_GATES)).toContain("exit 0");
    expect(EXIT.NO_GATES).not.toBe(EXIT.BLOCKED);
  });
});

describe("the deploy workflow stops before releasing", () => {
  it("gates Lisa's own release behind the pre-deploy moment", () => {
    const workflow = read(".github/workflows/deploy.yml");
    const jobs = workflow.jobs ?? {};

    const gateJobs = Object.entries(jobs).filter(
      ([, job]) =>
        job.uses === LOCAL_USES &&
        String(job.with?.["moment"] ?? "").startsWith(PRE_DEPLOY)
    );
    expect(gateJobs.length).toBeGreaterThan(0);

    // The load-bearing edge. A gate job that merely EXISTS reports red after the
    // tag has been cut; the release job has to wait on it.
    const release = jobs["release"];
    expect(release).toBeDefined();
    expect(needsOf(release as Job)).toEqual(
      expect.arrayContaining([gateJobs[0]?.[0] as string])
    );
  });

  it("runs the post-deploy moment after the release", () => {
    const jobs = read(".github/workflows/deploy.yml").jobs ?? {};
    const post = Object.values(jobs).find(
      job =>
        job.uses === LOCAL_USES &&
        String(job.with?.["moment"] ?? "").startsWith(POST_DEPLOY)
    );

    expect(post).toBeDefined();
    expect(needsOf(post as Job)).toContain("release");
  });

  it("gates every stack's seeded deploy workflow the same way", () => {
    // Globbed, so a new stack template cannot ship without this.
    const templates = deployTemplates();
    expect(templates.length).toBeGreaterThan(0);

    for (const relative of templates) {
      const jobs = read(relative).jobs ?? {};
      const gate = Object.entries(jobs).find(
        ([, job]) =>
          job.uses === REMOTE_USES &&
          String(job.with?.["moment"] ?? "").startsWith(PRE_DEPLOY)
      );
      expect(gate, `${relative} has no pre-deploy gate`).toBeDefined();

      const gateId = gate?.[0] as string;
      const gated = Object.entries(jobs).filter(
        ([id, job]) => id !== gateId && needsOf(job).includes(gateId)
      );
      expect(
        gated.length,
        `${relative} declares a pre-deploy gate that blocks nothing`
      ).toBeGreaterThan(0);
    }
  });
});

describe("the repository's own moment inventory reflects the wiring", () => {
  it("reports all three previously-unrunnable families as executed", () => {
    // The tie between the workflows above and the classifier that reports on
    // them. Before this issue every one of these was absent, which is what made
    // "nothing runs gates here" true — and what made hardcoding it tempting.
    const { families } = momentsExecutedBy({ cwd: REPO_ROOT }) as {
      families: string[];
    };

    expect(families).toEqual(
      expect.arrayContaining(["pre-deploy", "post-deploy", "continuous"])
    );
  });
});
