#!/usr/bin/env node
/**
 * check-required-check-promotions — refuse a required status context whose
 * safety nobody proved (CodySwannGT/lisa#2509).
 *
 * ## The rule
 *
 * **A check may only become a required status context if its budget has proven
 * headroom.** "Proven" means measured against a run that actually REPRODUCED
 * the failure the budget exists to prevent — not inferred from runs that
 * passed. Sizing a budget from passing samples is circular: the sample already
 * excludes the failure mode.
 *
 * ## Why this is a control and not a paragraph
 *
 * Promoting a check to required changes the cost of every marginal time budget
 * on its path from "an agent re-runs" to "nothing merges." Nothing connected
 * those two decisions: promotion happens in `<type>/github-rulesets/*.json` and
 * in `.lisa.config.json`, while budgets live independently in the suites. A
 * check can be promoted carrying a budget that loses occasionally at any load,
 * and the first symptom is a permanently flaky merge gate, org-wide.
 *
 * It ships as a control rather than a rule document because that is what the
 * measurement supports. In this repository, over one session, executable
 * controls were obeyed 50 of 50 times and prose rules roughly 0 of 13 —
 * including by the agents who had just written them. `.claude/rules` also
 * explicitly excludes "prose restating a lint rule, hook, or CI gate."
 *
 * ## What it enforces, and which measured failure each clause came from
 *
 * Every declared required context must have an entry in
 * `.github/required-check-promotions.json`. A context with no entry FAILS —
 * that is the precondition itself. For each entry:
 *
 *  1. **The job must exist and be named exactly right.**
 *     `rails/github-rulesets/quality-checks.json` names four contexts, three
 *     non-emoji (`Quality Checks / Lint`) and one emoji
 *     (`Quality Checks / 🔗 Work-Item Traceability`). Adding a context to that
 *     file by symmetry with the TypeScript template produces a context no job
 *     ever reports, which blocks every pull request in the repository forever.
 *     So the ledger names the workflow and job id, and this guard reads the
 *     YAML and compares the `name:` against the context.
 *
 *  2. **The reporting workflow may not be `paths:`-filtered.** Measured on PR
 *     #2496: a filtered workflow does not run, so its context never reports and
 *     GitHub shows "Expected — waiting for status to be reported" forever. Not
 *     "runs and passes" — never reports at all.
 *
 *  3. **The headroom must be evidenced.** A `proven` entry must publish the
 *     budget, the observed worst case, the machine conditions it was measured
 *     under, and a description of the run that reproduced the failure. A
 *     figure without its conditions is not a measurement:
 *     `check-learnings-budget` was reported at 45.8s "in isolation" while ~56
 *     sibling vitest processes were live, and that retracted number nearly
 *     shipped as a permanent comment.
 *
 *  4. **The margin must be at least {@link MIN_HEADROOM_RATIO}x.**
 *     `learnings-writer` failed at 10,259ms against a 10,000ms budget — 2.6%
 *     over — then passed 5/5 on immediate re-run under UNCHANGED conditions.
 *     If the box did not change and the result did, the budget is not measuring
 *     the box; it is measuring nothing, because it has no headroom.
 *     `plugin-sync-scripts` consumed 92% of its budget (1.09x) and failed 15 of
 *     16 concurrent runs; at 60s (~2.5x) it failed 0 of 16. The floor therefore
 *     sits inside (1.09, 2.54], and 2 is the conservative choice in that range.
 *
 *  5. **A budget may not be sized from a different subject.** #2490 raised five
 *     budgets and sized `sonar-secrets`' 60s BY ANALOGY — its 16-way paired
 *     probe ran against `plugin-sync-scripts`. Declaring `subject` and
 *     `measured_on_subject` separately makes that mechanically visible instead
 *     of a footnote in a report.
 *
 *  6. **A worst case must come from a run that COMPLETED, and must be below the
 *     budget it justifies** (#2528). Two clauses, one rule:
 *
 *     *Do not size a budget from the duration of a run that failed on time.*
 *     This is the mirror of clause 3. #2509 says do not size from runs that
 *     passed, because the sample excludes the failure mode; the mirror says do
 *     not size from the DURATION of a run the budget terminated, because that
 *     duration is the starvation, not the work. The failing-run version is
 *     strictly worse: it does not merely omit information, it INVERTS the
 *     ratio — the more contended the box was, the safer the resulting budget
 *     looks. So `observed_on` must say `"pass"`, meaning the measured run
 *     completed inside its budget. (That is a statement about TIME, not about
 *     the check's verdict: a run that reproduces a real violation and exits 1
 *     in 30s completed, and is `"pass"` here.)
 *
 *     *And an entry claiming a worst case at or above its own budget refuses
 *     itself*, needing no knowledge of the test, the machine, or the workload.
 *     #2523 cited 60,245ms while setting the budget to 60,000ms. The ratio in
 *     clause 4 already rejects that arithmetically at 0.996x, but it reports a
 *     THIN MARGIN when the defect is an IMPOSSIBLE CLAIM, and a message that
 *     misnames the defect sends the reader off to re-measure when they should
 *     be re-reading. The tell was on the face of the number: a test cannot run
 *     60s against a 10s budget, so 60,245ms was wall clock spent waiting.
 *     Re-measured in isolation at load 31 the same test takes 2,499ms — 24x,
 *     not 0.996x, a 24-fold error in the unsafe direction.
 *
 *     The class is not specific to test timeouts. #2520 chased an actionlint
 *     invocation reported as taking "25 minutes". It was not slow: a
 *     3,490-line workflow returns in 0s while a 217-line one hangs, and the
 *     minimal repro is 28 lines. It is a spin inside actionlint's shellcheck
 *     integration — ~850% CPU across 37 threads, zero children — so it never
 *     terminates. The 25 minutes was the observer's patience, not the
 *     command's cost, and NO budget would have been generous enough. That is
 *     what `observed_on` refuses: a number produced by a run that did not
 *     finish is not a measurement of how long the work takes.
 *
 *     A missing `observed_on` is refused rather than grandfathered. Every
 *     `proven` entry in the ledger when this clause shipped had already
 *     recorded, in prose, that its worst case came from runs that completed, so
 *     backfilling the field only restates what was already proved. Exempting
 *     them would have exempted the only entries the clause could bind on.
 *
 * ## The ratchet, and why incumbents are not simply exempted
 *
 * Contexts already required when this guard shipped may declare
 * `"status": "grandfathered"`, which turns their problems into reported DEBT
 * (exit 0) rather than violations. That is not an amnesty: the entry must state
 * in `debt` exactly what is unproven, and the context must appear in the
 * ledger's frozen `grandfathered_contexts` list. That list was fixed when the
 * ledger was written, so a NEW promotion cannot buy its way in by claiming to
 * be old. Reddening `main` to punish yesterday's promotions would only get the
 * guard deleted; recording what each incumbent has not proven is the part that
 * keeps working.
 *
 * ## Where it runs
 *
 * `tests/unit/scripts/required-check-promotions.repo.test.ts` calls
 * {@link evaluate} against this repository, so it executes inside
 * `🔍 Quality Checks / 🧪 Run Unit Tests` — itself a required context. An
 * operator can also run `npm run check:required-check-promotions`.
 *
 * Usage:
 *   node scripts/check-required-check-promotions.mjs [rootDir] [--json]
 *
 * @module scripts/check-required-check-promotions
 */
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import { readGates } from "../all/copy-overwrite/scripts/lisa-gates.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { buildRulesetPayload } from "./lisa-ruleset-payload.mjs";

// Literals named once — each was repeated enough times that a typo in one
// copy would diverge silently.
const HEADROOM_EVIDENCE_MISSING = "headroom-evidence-missing";

/** Integration id GitHub Actions reports status checks under. */
export const ACTIONS_INTEGRATION_ID = 15_368;

/** Ledger location, relative to the repository root. */
export const LEDGER_RELATIVE_PATH = ".github/required-check-promotions.json";

/**
 * Smallest acceptable budget-to-observed-worst-case ratio.
 *
 * Derived, not chosen: 1.09x failed 15/16 and ~2.54x failed 0/16 on the only
 * budget in this repository ever proven under load, so the floor lies in
 * (1.09, 2.54]. See the module preamble.
 */
export const MIN_HEADROOM_RATIO = 2;

/** Directory names never scanned for ruleset templates. */
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
]);

/** Separator GitHub puts between a caller job name and a called job name. */
const CONTEXT_SEPARATOR = " / ";

/** Raised for operator error (bad arguments, unreadable ledger). */
export class UsageError extends Error {}

/**
 * Split a status context into the caller job name and the called job name.
 *
 * A reusable-workflow job reports as `<caller job name> / <called job name>`;
 * a job in the calling workflow reports under its own name alone. Splitting on
 * the FIRST separator only, because a called job name may itself contain one.
 *
 * @param {string} context - the status check context.
 * @returns {{ callerName: string, calledName: string | null }} the two halves.
 */
export function splitContext(context) {
  const index = context.indexOf(CONTEXT_SEPARATOR);
  if (index === -1) return { callerName: context, calledName: null };
  return {
    callerName: context.slice(0, index),
    calledName: context.slice(index + CONTEXT_SEPARATOR.length),
  };
}

/**
 * Read the required contexts declared by one ruleset template.
 *
 * @param {string} absolute - absolute path to the template JSON.
 * @param {string} relative - path reported as the source.
 * @returns {{ context: string, integrationId: number, source: string }[]} declarations.
 */
function contextsFromTemplate(absolute, relative) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch {
    return [];
  }
  const found = [];
  for (const rule of parsed?.rules ?? []) {
    if (rule?.type !== "required_status_checks") continue;
    for (const check of rule?.parameters?.required_status_checks ?? []) {
      if (typeof check?.context !== "string") continue;
      found.push({
        context: check.context,
        integrationId:
          typeof check.integration_id === "number"
            ? check.integration_id
            : ACTIONS_INTEGRATION_ID,
        source: relative,
      });
    }
  }
  return found;
}

/**
 * Read the per-repository required-check opt-in.
 *
 * This surface is NOT templated and exists precisely because a Lisa-only
 * context must never ship in a shared template — host projects would inherit a
 * context they never report (the #2476 defect). A guard blind to it would clear
 * every context added this way.
 *
 * Both key spellings are read: `requiredChecks` is the declarative one that
 * can also STOP requiring a context, and `addRequiredChecks` is the additive
 * one it replaced. A guard that read only the new name would go blind to every
 * repository that has not renamed the key yet — the very blindness described
 * above, reintroduced by the rename that was supposed to improve things.
 *
 * @param {string} root - absolute repository root.
 * @returns {{ context: string, integrationId: number, source: string }[]} declarations.
 */
function contextsFromConfig(root) {
  const absolute = path.join(root, ".lisa.config.json");
  if (!fs.existsSync(absolute)) return [];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch {
    return [];
  }
  const rulesets = parsed?.github?.rulesets ?? {};
  const declared = {
    ...rulesets.addRequiredChecks,
    ...rulesets.requiredChecks,
  };
  const found = [];
  for (const entries of Object.values(declared)) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (typeof entry?.context !== "string") continue;
      found.push({
        context: entry.context,
        integrationId:
          typeof entry.integration_id === "number"
            ? entry.integration_id
            : ACTIONS_INTEGRATION_ID,
        source: ".lisa.config.json",
      });
    }
  }
  return found;
}

/**
 * Read the required contexts the generated `base` ruleset will carry.
 *
 * `all/github-rulesets/base.json` used to be a template this function found by
 * walking each project type's `github-rulesets` directory, and it named two
 * vendor contexts. It is now
 * generated from `.lisa.config.json`'s `await` gate declarations, so a guard
 * that only walked directories would have gone blind to two contexts that are
 * still required — and worse, gone blind SILENTLY, reporting a clean promotion
 * ledger for a surface it had stopped reading.
 *
 * @param {string} root - absolute repository root.
 * @returns {{ context: string, integrationId: number, source: string }[]} declarations.
 */
function contextsFromGeneratedBase(root) {
  let payload;
  try {
    const { gates, policy } = readGates(root);
    payload = buildRulesetPayload({ gates, policy });
  } catch {
    return [];
  }
  const found = [];
  for (const rule of payload?.rules ?? []) {
    if (rule?.type !== "required_status_checks") continue;
    for (const check of rule?.parameters?.required_status_checks ?? []) {
      if (typeof check?.context !== "string") continue;
      found.push({
        context: check.context,
        integrationId:
          typeof check.integration_id === "number"
            ? check.integration_id
            : ACTIONS_INTEGRATION_ID,
        source: ".lisa.config.json (generated base ruleset)",
      });
    }
  }
  return found;
}

/**
 * Collect every required context this repository declares, from every surface.
 *
 * @param {string} root - absolute repository root.
 * @returns {{ context: string, integrationId: number, source: string }[]}
 *   declarations, sorted by context then source.
 */
export function collectDeclaredContexts(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const rulesetDir = path.join(root, entry.name, "github-rulesets");
    if (!fs.existsSync(rulesetDir)) continue;
    for (const file of fs.readdirSync(rulesetDir).sort()) {
      if (!file.endsWith(".json")) continue;
      found.push(
        ...contextsFromTemplate(
          path.join(rulesetDir, file),
          `${entry.name}/github-rulesets/${file}`
        )
      );
    }
  }
  found.push(...contextsFromConfig(root));
  found.push(...contextsFromGeneratedBase(root));
  return found.sort(
    (a, b) =>
      a.context.localeCompare(b.context) || a.source.localeCompare(b.source)
  );
}

/**
 * Parse a workflow into the two facts a required context depends on: which
 * jobs it declares, and whether it actually runs on every pull request.
 *
 * @param {string} absolute - absolute path to the workflow YAML.
 * @returns {{ jobs: Map<string, string>, onPullRequest: boolean, pathFilterKeys: string[] } | null}
 *   the parsed facts, or null when the file is absent or unparseable.
 */
export function readWorkflow(absolute) {
  if (!fs.existsSync(absolute)) return null;
  let doc;
  try {
    doc = yaml.load(fs.readFileSync(absolute, "utf8"));
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) return null;
  // `on:` is a YAML 1.1 boolean. js-yaml's default schema keeps it a string,
  // but a schema change upstream would silently move the key to `true` and a
  // guard reading only one spelling would then report "no pull_request
  // trigger" for every workflow in the fleet.
  const triggers = doc.on ?? doc[true] ?? {};
  const pullRequest =
    typeof triggers === "object" && triggers !== null
      ? triggers.pull_request
      : undefined;
  const onPullRequest =
    (typeof triggers === "object" &&
      triggers !== null &&
      "pull_request" in triggers) ||
    triggers === "pull_request" ||
    (Array.isArray(triggers) && triggers.includes("pull_request"));
  const pathFilterKeys =
    typeof pullRequest === "object" && pullRequest !== null
      ? ["paths", "paths-ignore"].filter(key => key in pullRequest)
      : [];
  const jobs = new Map();
  for (const [id, job] of Object.entries(doc.jobs ?? {})) {
    jobs.set(id, typeof job?.name === "string" ? job.name : id);
  }
  return { jobs, onPullRequest, pathFilterKeys };
}

/**
 * Validate one declared budget inside a headroom block.
 *
 * @param {object} budget - a `headroom.budgets[]` entry.
 * @returns {{ rule: string, detail: string }[]} problems, empty when sound.
 */
function budgetProblems(budget) {
  const subject = budget?.subject;
  const measuredOn = budget?.measured_on_subject;
  if (typeof subject !== "string" || typeof measuredOn !== "string") {
    return [
      {
        rule: HEADROOM_EVIDENCE_MISSING,
        detail:
          "every headroom.budgets[] entry needs a subject and a measured_on_subject",
      },
    ];
  }
  if (subject !== measuredOn) {
    return [
      {
        rule: "budget-sized-by-analogy",
        detail: `budget for '${subject}' was measured on '${measuredOn}'; a budget must be measured on the subject that consumes it`,
      },
    ];
  }
  // A budgets[] entry publishes its OWN observed_worst_ms, so it can be a
  // starved figure exactly as the block-level one can. Checking provenance
  // first: a ratio computed from a duration that measures contention is
  // arithmetic on the wrong number, so the reader needs the provenance before
  // the margin.
  const provenance = provenanceProblems(budget.observed_on);
  if (provenance.length > 0) return provenance;
  return ratioProblems(budget.budget_ms, budget.observed_worst_ms);
}

/**
 * Validate where an observed worst case was measured (#2528).
 *
 * `observed_on` records whether the run that produced `observed_worst_ms`
 * COMPLETED within its budget (`"pass"`) or was terminated by it (`"fail"`).
 * That is a claim about time, not about the check's verdict — a run that
 * reproduces a real violation and exits 1 well inside its budget completed.
 *
 * @param {unknown} observedOn - the declared provenance.
 * @returns {{ rule: string, detail: string }[]} problems, empty when sound.
 */
function provenanceProblems(observedOn) {
  if (observedOn === "pass") return [];
  if (observedOn === "fail") {
    return [
      {
        rule: "headroom-measured-on-failing-run",
        detail:
          'observed_worst_ms was taken from a run the budget terminated ("observed_on": "fail"); that duration is the starvation, not the work, and the more contended the box was the safer the budget looks — re-measure on a run that completed, in isolation',
      },
    ];
  }
  return [
    {
      rule: HEADROOM_EVIDENCE_MISSING,
      detail:
        'headroom.observed_on must be "pass": the run that produced observed_worst_ms must have COMPLETED within its budget, because a duration reported alongside a timeout measures contention, not cost',
    },
  ];
}

/**
 * Compare an observed worst case against its budget.
 *
 * @param {unknown} budgetMs - the declared wall-clock budget.
 * @param {unknown} observedMs - the worst case actually observed.
 * @returns {{ rule: string, detail: string }[]} problems, empty when sound.
 */
function ratioProblems(budgetMs, observedMs) {
  if (
    typeof budgetMs !== "number" ||
    typeof observedMs !== "number" ||
    budgetMs <= 0 ||
    observedMs <= 0
  ) {
    return [
      {
        rule: HEADROOM_EVIDENCE_MISSING,
        detail:
          "headroom needs a positive budget_ms and a positive observed_worst_ms",
      },
    ];
  }
  // Checked before the ratio, and reported as its own defect: an entry whose
  // worst case is not below the budget it justifies can never be valid, and
  // "thin margin" would misname it. See clause 6 in the module preamble.
  if (observedMs >= budgetMs) {
    return [
      {
        rule: "headroom-worst-case-exceeds-budget",
        detail: `observed worst ${observedMs}ms is not below the ${budgetMs}ms budget it justifies, so the entry disproves itself; a worst case at or above its own budget is usually elapsed time from a run the budget terminated, which measures contention rather than cost (#2528)`,
      },
    ];
  }
  const ratio = budgetMs / observedMs;
  if (ratio < MIN_HEADROOM_RATIO) {
    return [
      {
        rule: "headroom-ratio-too-thin",
        detail: `observed worst ${observedMs}ms against a ${budgetMs}ms budget is ${ratio.toFixed(2)}x; ${MIN_HEADROOM_RATIO}x is the floor`,
      },
    ];
  }
  return [];
}

/**
 * Validate a headroom block.
 *
 * A `grandfathered` block is shape-checked by the caller instead, because its
 * obligation is to NAME what is unproven rather than to prove it.
 *
 * @param {object} headroom - the `headroom` object from a ledger entry.
 * @returns {{ rule: string, detail: string }[]} problems, empty when sound.
 */
export function headroomProblems(headroom) {
  const status = headroom?.status;
  if (status !== "proven" && status !== "grandfathered") {
    return [
      {
        rule: "unknown-headroom-status",
        detail: `headroom.status must be 'proven' or 'grandfathered', got '${String(status)}'`,
      },
    ];
  }
  if (status === "grandfathered") return [];
  const problems = [];
  const prose = [
    [
      "reproduced",
      "headroom.reproduced must describe the run that reproduced the failure the budget prevents",
    ],
    [
      "measured_on",
      "headroom.measured_on must name what was measured, so the next person can re-measure it",
    ],
    [
      "conditions",
      "headroom.conditions must state the machine state the measurement was taken under",
    ],
  ];
  for (const [field, detail] of prose) {
    const value = headroom[field];
    if (typeof value !== "string" || value.trim() === "") {
      problems.push({ rule: HEADROOM_EVIDENCE_MISSING, detail });
    }
  }
  if (problems.length > 0) return problems;
  problems.push(...provenanceProblems(headroom.observed_on));
  if (problems.length > 0) return problems;
  problems.push(
    ...ratioProblems(headroom.budget_ms, headroom.observed_worst_ms)
  );
  if (problems.length > 0) return problems;
  for (const budget of headroom.budgets ?? []) {
    problems.push(...budgetProblems(budget));
  }
  return problems;
}

/**
 * Verify that the workflow wiring a ledger entry declares actually reports the
 * context it claims to.
 *
 * @param {object} entry - the ledger entry.
 * @param {string} root - absolute repository root.
 * @returns {{ rule: string, detail: string }[]} problems, empty when sound.
 */
export function wiringProblems(entry, root) {
  const { callerName, calledName } = splitContext(entry.context);
  if (typeof entry.caller_workflow !== "string") {
    return [
      {
        rule: "caller-workflow-missing",
        detail:
          "an Actions-reported context must declare caller_workflow and caller_job",
      },
    ];
  }
  const caller = readWorkflow(path.join(root, entry.caller_workflow));
  if (caller === null) {
    return [
      {
        rule: "caller-workflow-missing",
        detail: `caller_workflow '${entry.caller_workflow}' is absent or unparseable`,
      },
    ];
  }
  const problems = [];
  if (!caller.onPullRequest) {
    problems.push({
      rule: "pull-request-trigger-missing",
      detail: `'${entry.caller_workflow}' does not run on pull_request, so this context never reports on a pull request`,
    });
  }
  if (caller.pathFilterKeys.length > 0) {
    problems.push({
      rule: "path-filtered-workflow",
      detail: `'${entry.caller_workflow}' filters pull_request by ${caller.pathFilterKeys.join("/")}; a filtered workflow does not run, so a required context on it waits forever (#2496)`,
    });
  }
  problems.push(
    ...jobNameProblems(caller, entry.caller_job, callerName, "caller")
  );
  if (calledName !== null) {
    problems.push(...calledJobProblems(entry, root, calledName));
  }
  return problems;
}

/**
 * Compare a workflow job's display name against the half of the context it is
 * supposed to report as.
 *
 * @param {{ jobs: Map<string, string> }} workflow - parsed workflow.
 * @param {unknown} jobId - the job id the ledger declares.
 * @param {string} expected - the context half the job must render as.
 * @param {"caller" | "called"} side - which half, for the rule name.
 * @returns {{ rule: string, detail: string }[]} problems, empty when sound.
 */
function jobNameProblems(workflow, jobId, expected, side) {
  if (typeof jobId !== "string" || !workflow.jobs.has(jobId)) {
    return [
      {
        rule: `${side}-job-missing`,
        detail: `no job '${String(jobId)}' in the ${side} workflow; a context no job reports blocks every pull request forever`,
      },
    ];
  }
  const actual = workflow.jobs.get(jobId);
  if (actual !== expected) {
    return [
      {
        rule: `${side}-job-name-mismatch`,
        detail: `job '${jobId}' is named '${actual}' but the context expects '${expected}'`,
      },
    ];
  }
  return [];
}

/**
 * Verify the reusable workflow half of a `caller / called` context.
 *
 * @param {object} entry - the ledger entry.
 * @param {string} root - absolute repository root.
 * @param {string} calledName - the expected called-job display name.
 * @returns {{ rule: string, detail: string }[]} problems, empty when sound.
 */
function calledJobProblems(entry, root, calledName) {
  if (typeof entry.called_workflow !== "string") {
    return [
      {
        rule: "called-workflow-missing",
        detail: `context '${entry.context}' names a reusable-workflow job, so the entry must declare called_workflow and job_id`,
      },
    ];
  }
  const called = readWorkflow(path.join(root, entry.called_workflow));
  if (called === null) {
    return [
      {
        rule: "called-workflow-missing",
        detail: `called_workflow '${entry.called_workflow}' is absent or unparseable`,
      },
    ];
  }
  return jobNameProblems(called, entry.job_id, calledName, "called");
}

/**
 * Read the promotion ledger.
 *
 * @param {string} root - absolute repository root.
 * @returns {object | null} the parsed ledger, or null when absent/unparseable.
 */
export function loadLedger(root) {
  const absolute = path.join(root, LEDGER_RELATIVE_PATH);
  if (!fs.existsSync(absolute)) return null;
  try {
    return JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Check one matched ledger entry and file its problems as violations or debt.
 *
 * @param {object} args - entry, declaration, root, frozen set, and sinks.
 * @returns {void}
 */
function evaluateEntry({ entry, integrationId, root, frozen, out }) {
  const grandfathered = entry.headroom?.status === "grandfathered";
  const file = (rule, detail) =>
    (grandfathered ? out.debts : out.violations).push({
      context: entry.context,
      rule,
      detail,
    });
  if (grandfathered) {
    if (!frozen.has(entry.context)) {
      out.violations.push({
        context: entry.context,
        rule: "grandfather-not-frozen",
        detail:
          "only contexts already required when the ledger was written may be grandfathered; a new promotion must prove its headroom",
      });
      return;
    }
    const debt = entry.headroom?.debt;
    if (typeof debt !== "string" || debt.trim() === "") {
      out.violations.push({
        context: entry.context,
        rule: "grandfather-missing-debt",
        detail:
          "a grandfathered entry must say in `debt` exactly what about its headroom is unproven",
      });
      return;
    }
    out.debts.push({
      context: entry.context,
      rule: "grandfathered-headroom",
      detail: debt,
    });
  }
  if (integrationId === ACTIONS_INTEGRATION_ID) {
    for (const p of wiringProblems(entry, root)) file(p.rule, p.detail);
  }
  for (const p of headroomProblems(entry.headroom)) file(p.rule, p.detail);
}

/**
 * Evaluate every required context this repository declares against the ledger.
 *
 * @param {string} root - absolute repository root.
 * @returns {{ violations: {context: string|null, rule: string, detail: string}[],
 *   debts: {context: string|null, rule: string, detail: string}[], covered: number }}
 *   the report. A non-empty `violations` is a failed promotion precondition.
 */
export function evaluate(root) {
  const out = { violations: [], debts: [], covered: 0 };
  const ledger = loadLedger(root);
  if (ledger === null) {
    out.violations.push({
      context: null,
      rule: "ledger-missing",
      detail: `${LEDGER_RELATIVE_PATH} is absent or unparseable; refusing to report that promotions are sound when nothing was read`,
    });
    return out;
  }
  const frozen = new Set(ledger.grandfathered_contexts ?? []);
  const declared = new Map();
  for (const d of collectDeclaredContexts(root)) {
    if (!declared.has(d.context)) declared.set(d.context, d.integrationId);
  }
  const seen = new Set();
  for (const entry of ledger.promotions ?? []) {
    if (seen.has(entry.context)) {
      out.violations.push({
        context: entry.context,
        rule: "duplicate-promotion-entry",
        detail: "the ledger records this context more than once",
      });
      continue;
    }
    seen.add(entry.context);
    if (!declared.has(entry.context)) {
      out.violations.push({
        context: entry.context,
        rule: "orphan-promotion-entry",
        detail:
          "the ledger promotes a context no ruleset template or config declares; delete the entry or restore the declaration",
      });
      continue;
    }
    out.covered += 1;
    evaluateEntry({
      entry,
      integrationId: declared.get(entry.context),
      root,
      frozen,
      out,
    });
  }
  for (const context of declared.keys()) {
    if (seen.has(context)) continue;
    out.violations.push({
      context,
      rule: "missing-promotion-entry",
      detail: `'${context}' is required but has no entry in ${LEDGER_RELATIVE_PATH}; a promotion must record what proves it safe`,
    });
  }
  return out;
}

/**
 * Render a human-readable report.
 *
 * @param {ReturnType<typeof evaluate>} result - the evaluation.
 * @returns {string} the report text.
 */
export function formatReport(result) {
  const lines = [
    `Required-check promotions: ${result.covered} recorded, ${result.violations.length} violation(s), ${result.debts.length} outstanding debt(s).`,
  ];
  for (const v of result.violations) {
    lines.push(`  ✖ [${v.rule}] ${v.context ?? "(ledger)"}: ${v.detail}`);
  }
  for (const d of result.debts) {
    lines.push(`  • [${d.rule}] ${d.context ?? "(ledger)"}: ${d.detail}`);
  }
  if (result.violations.length === 0) {
    lines.push(
      "No unproven promotion. Debt lines are recorded, not enforced — see #2509."
    );
  }
  return lines.join("\n");
}

/**
 * CLI entry point.
 *
 * @returns {void}
 */
function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const root = path.resolve(args.find(a => !a.startsWith("--")) ?? ".");
  const result = evaluate(root);
  console.log(json ? JSON.stringify(result, null, 2) : formatReport(result));
  if (result.violations.length > 0) process.exitCode = 1;
}

if (invokedAsScript(import.meta.url)) {
  main();
}
