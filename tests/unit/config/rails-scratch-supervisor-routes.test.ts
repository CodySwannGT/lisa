/**
 * Route inventory for the Rails scratch supervisor.
 *
 * Five shipped routes create scratch during a Rails test or mutation run:
 * PostgreSQL RSpec and MySQL RSpec in the reusable quality workflow, the CI
 * Mutant gate, and the generated pre-push RSpec and Mutant commands. Each must
 * cross exactly ONE supervisor boundary — not zero, which leaves the debris the
 * supervisor exists to own, and not two, which would nest a run inside itself.
 *
 * The other half of the inventory is what the supervisor is allowed to need. A
 * Rails repository may have no Node, no npm, no Bun, no Yarn, no populated
 * `node_modules` and no network when its tests run. Reusing an npm-delivered
 * executable here would have added a runtime requirement to exactly the routes
 * that are permitted not to have one, so the supervisor is a POSIX shell
 * program and this file holds it to that.
 * @module tests/unit/config/rails-scratch-supervisor-routes
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { load as loadYaml } from "js-yaml";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The single canonical supervisor implementation. */
const SUPERVISOR = "rails/copy-overwrite/scripts/lisa-scratch-run.sh";

/** Path the routes invoke, after `lisa` materializes the template. */
const INSTALLED_SUPERVISOR = "scripts/lisa-scratch-run.sh";

/** The three supervised jobs in the reusable Rails quality workflow. */
const RSPEC_POSTGRES_JOB = "test-postgres";
const RSPEC_MYSQL_JOB = "test-mysql";
const MUTATION_JOB = "mutation";

/** The two payloads those jobs and the pre-push hook wrap. */
const RSPEC_PAYLOAD = "bundle exec rspec";
const MUTANT_PAYLOAD = "bash scripts/lisa-mutation.sh";

const WORKFLOW = ".github/workflows/quality-rails.yml";
const LEFTHOOK = "rails/copy-overwrite/lefthook.yml";
const MUTATION_SCRIPT = "rails/copy-contents/scripts/lisa-mutation.sh";

/**
 * Read a repository file as text.
 * @param relativePath - Repo-relative path
 * @returns File contents
 */
function read(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

/**
 * Strip `#` comment lines so a scan sees only what the shell would execute.
 * @param source - Shell source
 * @returns The same source with whole-line comments removed
 */
function executableLines(source: string): string {
  return source
    .split("\n")
    .filter(line => !/^\s*#/.test(line))
    .join("\n");
}

/** One `steps:` entry of a workflow job. */
interface WorkflowStep {
  readonly name?: string;
  readonly run?: string;
}

/** One job of a workflow. */
interface WorkflowJob {
  readonly steps?: readonly WorkflowStep[];
}

/** A parsed GitHub Actions workflow document. */
interface Workflow {
  readonly jobs?: Readonly<Record<string, WorkflowJob>>;
}

/**
 * Parse the reusable Rails quality workflow.
 * @returns Parsed workflow document
 */
function workflow(): Workflow {
  return loadYaml(read(WORKFLOW)) as Workflow;
}

/**
 * Collect a job's `run:` step bodies.
 * @param jobId - Job key in the workflow
 * @returns Every run body in that job, in order
 */
function runSteps(jobId: string): readonly string[] {
  const job = workflow().jobs?.[jobId];
  expect(job, `workflow job ${jobId} is missing`).toBeDefined();
  return (job?.steps ?? [])
    .map(step => step.run)
    .filter((body): body is string => typeof body === "string");
}

/**
 * Parse the generated Rails lefthook configuration.
 * @returns Pre-push command bodies keyed by command name
 */
function prePushCommands(): Readonly<Record<string, string>> {
  const parsed = loadYaml(read(LEFTHOOK)) as {
    readonly "pre-push"?: {
      readonly commands?: Readonly<Record<string, { readonly run?: string }>>;
    };
  };
  const commands = parsed["pre-push"]?.commands ?? {};
  return Object.fromEntries(
    Object.entries(commands).map(([name, value]) => [name, value.run ?? ""])
  );
}

/**
 * Count non-overlapping occurrences of a literal in a string.
 * @param haystack - Text to scan
 * @param needle - Literal to count
 * @returns Number of occurrences
 */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("the Rails scratch supervisor ships exactly once", () => {
  it("exists as a single canonical copy under the Rails copy-overwrite tree", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, SUPERVISOR))).toBe(true);

    // A second on-disk copy is the drift AC6 forbids: `copy-overwrite` puts
    // this exact file at `scripts/lisa-scratch-run.sh` in every Rails project,
    // so one template file is the whole delivery mechanism.
    const duplicates = findByBasename(REPO_ROOT, "lisa-scratch-run.sh");
    expect(duplicates).toEqual([SUPERVISOR]);
  });

  it("is delivered by the npm package's Rails template directory", () => {
    const files = (
      JSON.parse(read("package.json")) as { readonly files?: readonly string[] }
    ).files;
    expect(files).toContain("rails");
    expect(SUPERVISOR.startsWith("rails/copy-overwrite/")).toBe(true);
  });

  it("is a POSIX shell program with no shipped executable bit assumption", () => {
    const source = read(SUPERVISOR);
    expect(source.startsWith("#!/bin/sh\n")).toBe(true);
    // Every route invokes it through an explicit interpreter, so a template
    // copied without its mode bit still runs.
    expect(read(WORKFLOW)).toContain(`bash ${INSTALLED_SUPERVISOR}`);
    expect(read(LEFTHOOK)).toContain(`sh ${INSTALLED_SUPERVISOR}`);
  });
});

describe("the supervisor assumes no JavaScript runtime", () => {
  const forbidden = [
    "node",
    "npm",
    "npx",
    "bun",
    "bunx",
    "yarn",
    "pnpm",
    "node_modules",
    "curl",
    "wget",
    "nc",
  ] as const;

  it.each(forbidden)("never invokes %s", command => {
    const source = executableLines(read(SUPERVISOR));
    // Word-boundary match: `nc` must not hit `sync`, and `node` must not hit
    // `node_modules` in a path that is itself already forbidden below.
    expect(source).not.toMatch(new RegExp(`(^|[\\s;&|(\`'"])${command}\\b`));
  });

  it("depends only on the userland a Rails route already requires", () => {
    const source = executableLines(read(SUPERVISOR));
    // Named so a reviewer can see the whole external surface at once.
    for (const tool of [
      "ps",
      "mkdir",
      "rm",
      "mv",
      "date",
      "od",
      "sed",
      "awk",
    ]) {
      expect(source).toContain(tool);
    }
    // Ruby and Bundler belong to the payload, never to the supervisor.
    expect(source).not.toMatch(/(^|[\s;&|(])bundle\b/);
    expect(source).not.toMatch(/(^|[\s;&|(])ruby\b/);
  });
});

describe("every shipped Rails route crosses exactly one supervisor boundary", () => {
  it.each([
    [RSPEC_POSTGRES_JOB, "rspec-postgres", RSPEC_PAYLOAD],
    [RSPEC_MYSQL_JOB, "rspec-mysql", RSPEC_PAYLOAD],
    [MUTATION_JOB, "mutant-postgres", MUTANT_PAYLOAD],
  ])(
    "supervises the %s job payload under suite %s",
    (jobId, suite, payload) => {
      const bodies = runSteps(jobId).join("\n");
      expect(
        count(bodies, `bash ${INSTALLED_SUPERVISOR} --suite ${suite} --`)
      ).toBe(1);
      expect(bodies).toContain(
        `bash ${INSTALLED_SUPERVISOR} --suite ${suite} -- ${payload}`
      );
      // The payload appears once, and only inside the supervisor invocation.
      expect(count(bodies, payload)).toBe(1);
    }
  );

  it.each([[RSPEC_POSTGRES_JOB], [RSPEC_MYSQL_JOB], [MUTATION_JOB]])(
    "refuses to run the %s payload when the supervisor is not installed",
    jobId => {
      const bodies = runSteps(jobId).join("\n");
      // A stale `lisa` apply is a failure, not a licence to run unsupervised.
      expect(bodies).toContain(`if [ ! -f ${INSTALLED_SUPERVISOR} ]; then`);
      expect(bodies).toContain("exit 1");
    }
  );

  it.each([[RSPEC_POSTGRES_JOB], [RSPEC_MYSQL_JOB], [MUTATION_JOB]])(
    "keeps %s database preparation outside the supervisor",
    jobId => {
      const prepare = runSteps(jobId).filter(body =>
        body.includes("bin/rails db:prepare")
      );
      expect(prepare).toHaveLength(1);
      // A database-preparation failure must stay a database-preparation failure
      // rather than being relabelled a test or cleanup outcome.
      expect(prepare[0]).not.toContain(INSTALLED_SUPERVISOR);
      expect(prepare[0]?.trim()).toBe("bin/rails db:prepare");
    }
  );

  it.each([
    ["rspec", "prepush-rspec", RSPEC_PAYLOAD],
    [MUTATION_JOB, "prepush-mutant", MUTANT_PAYLOAD],
  ])(
    "supervises the pre-push %s command under suite %s",
    (name, suite, payload) => {
      const body = prePushCommands()[name];
      expect(body).toBeDefined();
      expect(count(body as string, INSTALLED_SUPERVISOR)).toBe(1);
      expect(body).toBe(
        `sh scripts/lisa-clean-git-env.sh sh ${INSTALLED_SUPERVISOR} --suite ${suite} -- ${payload}`
      );
    }
  );

  it("gives every route a distinct suite label so a leak names the right suite", () => {
    const labels = [
      ...read(WORKFLOW).matchAll(/--suite (\S+) --/g),
      ...read(LEFTHOOK).matchAll(/--suite (\S+) --/g),
    ].map(match => match[1] ?? "");
    expect(labels.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "mutant-postgres",
      "prepush-mutant",
      "prepush-rspec",
      "rspec-mysql",
      "rspec-postgres",
    ]);
  });

  it("never nests a supervisor inside the mutation gate script", () => {
    // The boundary lives at the route, not inside the payload. Both the CI and
    // the pre-push Mutant routes run this script, so a boundary here would make
    // one of them cross two.
    // Comment lines are stripped first: the file DOCUMENTS that supervision
    // lives outside it, and that note is the thing keeping the next maintainer
    // from adding the boundary here.
    expect(executableLines(read(MUTATION_SCRIPT))).not.toContain(
      "lisa-scratch-run"
    );
    expect(read(MUTATION_SCRIPT)).toContain(
      "SCRATCH SUPERVISION LIVES OUTSIDE THIS FILE"
    );
  });
});

describe("the mutation gate's own behavior is unchanged by supervision", () => {
  it("still self-skips from mutation.gate.yml and still honors the env overrides", () => {
    const source = read(MUTATION_SCRIPT);
    expect(source).toContain('GATE_FILE="mutation.gate.yml"');
    expect(source).toContain(
      'ENABLED="${MUTATION_ENABLED:-$(read_gate enabled false)}"'
    );
    expect(source).toContain(
      'SINCE="${MUTATION_SINCE:-$(read_gate since main)}"'
    );
    expect(source).toContain('if [ "$ENABLED" != "true" ]; then');
  });

  it("still mutates only changed Ruby subjects, diff-only, against the same base", () => {
    const source = read(MUTATION_SCRIPT);
    expect(source).toContain(
      `git diff --name-only --diff-filter=ACMR "\${BASE}...HEAD" -- 'app/**/*.rb' 'lib/**/*.rb'`
    );
    expect(source).toContain('exec bundle exec mutant run --since "$SINCE"');
  });

  it("still lets CI skip the gate when the script is absent, before asserting anything else", () => {
    const bodies = runSteps(MUTATION_JOB).join("\n");
    expect(bodies).toContain("if [ ! -f scripts/lisa-mutation.sh ]; then");
    expect(bodies).toContain(
      "Skipping mutation gate - scripts/lisa-mutation.sh not found"
    );
    // Order matters: a project that does not ship the mutation gate at all has
    // no payload to supervise, and must not start failing over a supervisor it
    // has no use for.
    expect(bodies.indexOf("Skipping mutation gate")).toBeLessThan(
      bodies.indexOf(`if [ ! -f ${INSTALLED_SUPERVISOR} ]; then`)
    );
  });
});

/**
 * Find every tracked-looking file with a given basename, ignoring directories
 * that are not part of the shipped source.
 * @param root - Directory to search
 * @param basename - Exact file name to match
 * @returns Repo-relative paths, sorted
 */
function findByBasename(root: string, basename: string): readonly string[] {
  const skip = new Set([
    ".git",
    "node_modules",
    "dist",
    "coverage",
    ".claude",
    "scratchpad",
  ]);
  const walk = (dir: string): readonly string[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(entry => !skip.has(entry.name))
      .flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name === basename ? [path.relative(root, full)] : [];
      });
  return walk(root).toSorted((a, b) => a.localeCompare(b));
}
