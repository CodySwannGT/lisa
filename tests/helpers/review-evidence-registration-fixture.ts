/** Controlled external observations for the real review-evidence CLI harness. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { loadWorkflow } from "./workflow-test-utils.js";

/** The shared managed prover shipped to consumers. */
const PROVER = "check-skipped-required-checks.mjs";

/** Initial externally reported rows. */
const CHECKS_FILE = "checks.json";

/**
 * Installs controlled external GitHub reads for the actual CLI harness.
 * @param bindir The isolated command directory.
 * @param rows Check rows, or null to refuse the external read.
 * @param head The concrete inspected head commit.
 * @returns Completion after the command fixture is installed.
 */
export async function installReviewGh(
  bindir: string,
  rows: readonly Record<string, string>[] | null,
  head: string
): Promise<void> {
  const payload = path.join(bindir, CHECKS_FILE);
  await fs.writeJson(payload, rows ?? []);
  const apiAnswer = rows === null ? "exit 1" : `cat ${JSON.stringify(payload)}`;
  await fs.writeFile(
    path.join(bindir, "gh"),
    `#!/bin/sh
case "$1:$2" in
  pr:view) printf '%s\n' ${JSON.stringify(head)} ;;
  pr:checks) ${apiAnswer} ;;
  api:*/pulls/*/commits*) printf '%s\n' '[]' ;;
  api:*/pulls/*/reviews*) printf '%s\n' '[]' ;;
  api:*/commits/*/pulls*) printf '%s\n' '[]' ;;
  api:*/pulls/*) printf '%s\n' '0' ;;
  api:*status*) ${apiAnswer} ;;
  api:*check-runs*) ${rows === null ? "exit 1" : "printf '%s\\n' '[]'"} ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o755 }
  );
}

/**
 * Extracts the actual shell step from a repository or consumer seed workflow.
 * @param root The Lisa source checkout.
 * @param workflowPath Which workflow to read.
 * @returns The shell source echoed and executed by Actions.
 */
export function reviewEvidenceStep(
  root: string,
  workflowPath = ".github/workflows/review-evidence.yml"
): string {
  const workflow = loadWorkflow(path.join(root, workflowPath));
  const script = (workflow.jobs?.vacuity?.steps ?? []).find(candidate =>
    candidate.run?.includes(PROVER)
  )?.run;
  if (!script)
    throw new Error(`${workflowPath} has no real vacuity prover step`);
  return script;
}

/**
 * Controls time and sequential external status reads, without replacing the prover.
 * @param bindir The isolated fixture command directory.
 * @param laterName A later reported name, or null for a never-registered row.
 * @param substitute Supply a writer's substitute for a rate-limited reviewer.
 * @param absentReviewer Keep the substituted reviewer entirely unreported.
 * @returns Completion after the fixture files are written.
 */
export async function configureRegistrationReads(
  bindir: string,
  laterName: string | null,
  substitute = false,
  absentReviewer = false
): Promise<void> {
  await fs.writeFile(
    path.join(bindir, "clock.mjs"),
    `let elapsed = 0; const started = Date.now(); Date.now = () => started + elapsed; Atomics.wait = (_array, _index, _value, ms) => { elapsed += ms; return "timed-out"; };`
  );
  await fs.writeJson(path.join(bindir, "event.json"), {
    repository: { full_name: "owner/name" },
    pull_request: { number: 1234, base: { ref: "main" } },
  });
  if (laterName === null) return;
  const gh = path.join(bindir, "gh");
  const original = await fs.readFile(gh, "utf8");
  if (substitute) {
    const comments = path.join(bindir, "comments.json");
    await fs.writeJson(comments, [
      {
        author: "maintainer",
        body: `<!-- lisa:review-substitute context="CodeRabbit" head="${"a".repeat(40)}" -->`,
      },
    ]);
    const surface = JSON.stringify({
      data: {
        repository: {
          pullRequest: {
            reviews: { totalCount: 0 },
            reviewThreads: { totalCount: 0, nodes: [] },
          },
        },
      },
    });
    await fs.writeFile(
      gh,
      original.replace(
        'case "$1:$2" in',
        `case "$1:$2" in
  api:*/issues/*/comments*) cat "${comments}" ;;
  api:*/collaborators/*/permission) printf '%s\\n' write ;;
  api:graphql) printf '%s\\n' '${surface}' ;;`
      )
    );
  }
  const initial = await fs.readFile(gh, "utf8");
  await fs.writeJson(path.join(bindir, "later.json"), [
    ...(absentReviewer
      ? []
      : [
          {
            name: "CodeRabbit",
            state: "SUCCESS",
            description: substitute
              ? "Review rate limited"
              : "Review completed",
          },
        ]),
    { name: laterName, state: "PENDING", description: "Queued" },
  ]);
  const count = path.join(bindir, "count");
  const read = `if [ -f "${count}" ]; then cat "${path.join(bindir, "later.json")}"; else touch "${count}"; cat "${path.join(bindir, CHECKS_FILE)}"; fi`;
  await fs.writeFile(
    gh,
    initial.replace(
      `api:*status*) cat ${JSON.stringify(path.join(bindir, CHECKS_FILE))}`,
      `api:*status*) ${read}`
    )
  );
}

/**
 * Installs the actual shipped prover and its relative library imports.
 * @param root The Lisa source checkout.
 * @param workdir The isolated consumer repository.
 * @returns Completion after all prover bytes are copied.
 */
export async function installReviewEvidenceProver(
  root: string,
  workdir: string
): Promise<void> {
  const source = path.join(root, "typescript/copy-overwrite/scripts");
  const destination = path.join(workdir, "scripts");
  await fs.ensureDir(destination);
  await fs.copy(path.join(source, "lib"), path.join(destination, "lib"));
  await fs.copy(path.join(source, PROVER), path.join(destination, PROVER));
}

/**
 * Writes a fresh required-context declaration for a real prover invocation.
 * @param workdir The isolated consumer repository.
 * @param required The exact required roster.
 * @returns Completion after the declaration and workflow are written.
 */
export async function writeReviewDeclaration(
  workdir: string,
  required: string[]
): Promise<void> {
  await fs.ensureDir(path.join(workdir, ".github/workflows"));
  await fs.writeFile(
    path.join(workdir, ".github/workflows/ci.yml"),
    "jobs:\n  quality:\n    with:\n      skip_jobs: ''\n"
  );
  await fs.writeJson(path.join(workdir, ".github/required-checks.json"), {
    ruleset: {
      repo: "owner/name",
      ids: [1],
      baseline_fetched_at: new Date().toISOString().slice(0, 10),
    },
    workflows: [".github/workflows/ci.yml"],
    required_contexts: required,
    required_contexts_by_branch: { main: required },
    skip_job_declarations: {},
    evidence_bearing_checks: { CodeRabbit: {} },
  });
}
