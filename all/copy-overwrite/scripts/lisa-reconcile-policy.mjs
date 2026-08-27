#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file Reconcile DECLARED gate/policy config against the LIVE GitHub ruleset.
 *
 * `lisa-gates.mjs` can already *derive* the branch-protection contexts a
 * repository ought to require: `contextsFor(gates, {moment: "pull-request"})`.
 * What it cannot do is say whether GitHub agrees. That answer lives in a
 * ruleset a human edits in an admin console, and until now the only way to hold
 * the two together was to transcribe the live list into
 * `.github/required-checks.json` by hand — a snapshot that ships empty, expires
 * after 90 days, and was measured wrong in BOTH directions (#2476: it claimed a
 * context was required that nothing required, and omitted six that were).
 *
 * This script replaces the transcription with a comparison. It reads the live
 * ruleset through `gh`, derives the declared list from `.lisa.config.json`, and
 * reports three sets: MISSING (declared, not live), EXTRA (live, not declared),
 * MATCHED. It reads repository settings the same way and compares them against
 * the `policy` block.
 *
 * ## Could-not-check is not clean
 *
 * There is a third verdict beside matched and drifted, and it is the one this
 * script exists to get right. If `gh` is absent, unauthenticated, refused (a
 * private repo on a plan without rulesets answers 403), or returns something
 * unparseable, the verdict is **UNPROVEN** — its own state, carrying its own
 * exit code (2), with the drift sets set to `null` rather than to empty arrays.
 * Empty arrays are what a clean repository looks like, so a failed read that
 * produced them would render as "policy matches" and be indistinguishable from
 * proof. The structure makes that unrepresentable: an unproven result has no
 * sets to read, and `on_drift` does not govern it, because `on_drift` answers
 * what to do about a drift you have MEASURED and here nothing was measured.
 *
 * ## An EXTRA context is never deleted without being named
 *
 * `repair` ADDS what is missing. It does not remove what is extra unless
 * `--prune` is passed, and even then it names every context it removes first.
 *
 * The reason is that Lisa does not own the whole required list. A repository
 * routinely requires contexts posted by external apps — `SonarCloud Code
 * Analysis`, `GitGuardian Security Checks`, `CodeRabbit` — which no gates block
 * declares and which `contextsFor` therefore cannot derive. Every one of those
 * is EXTRA by construction. A repair that treated EXTRA as "delete to converge"
 * would silently strip live protection on its first run, and the deletion would
 * read in the audit log as a routine reconciliation. So the default is: add,
 * report, and require a human to ask for the removal.
 *
 * That is also why an EXTRA context does not FAIL `on_drift: block`. It is
 * reported by name in every mode, and it still makes the verdict DRIFT — there
 * genuinely is a difference between the declaration and the repository. But
 * blocking on it would make `block` a mode no repository with a SonarCloud or
 * CodeRabbit check can ever satisfy, since by construction nothing declares
 * those and this script refuses to remove them. A check that cannot pass while
 * the repository is correct gets one fix from whoever is blocked by it —
 * `--prune`, or deleting the check — and both of those lose protection. So
 * `block` fails on the drift a repair could converge: MISSING contexts, and
 * settings drift. Under `--prune` an EXTRA becomes removable, and therefore
 * blocking, because the operator has said it should be.
 *
 * ## Only a workflow context is pinned to the Actions app
 *
 * A required check can name the app allowed to post it. Every context Lisa
 * derives from a `run` gate is posted by GitHub Actions, so it is pinned. An
 * `await` gate's context is posted by somebody else entirely — that is what
 * awaiting means — and pinning `CodeRabbit` to the Actions integration would
 * require a status that the only app able to post it can never satisfy. Those
 * are added unpinned, which is GitHub's "any source".
 *
 * ## The alias window
 *
 * `--previous=a,b` is passed through to `contextsFor`'s `previousLabels`, which
 * emits BOTH the old and the new context for one release. During a job rename
 * the old context stops reporting the moment the workflow changes, and a
 * required context that never reports blocks every in-flight pull request
 * indefinitely. The fastest way out of that for whoever is blocked is deleting
 * the requirement — which is how a rename quietly removes a guarantee. Requiring
 * both names for one release is what avoids it. Downstream repositories call
 * the shared workflow unpinned, so the rename reaches them before any of them
 * has reconciled; the window is not optional.
 *
 * ## One writer per surface
 *
 * Repair writes exactly two things: required-status-check contexts on a ruleset
 * (PUT), and repository settings (PATCH). Policy that lives in the SHAPE of a
 * ruleset's rules — linear history, signed commits, force-push and deletion
 * protection, conversation resolution — is compared and reported here but
 * repaired by `scripts/lisa-github-rulesets.sh`, which owns rule construction.
 * Reshaping rules from two places is how a repair strips a rule it did not
 * understand.
 *
 * Usage:
 *   lisa-reconcile-policy.mjs [--repo=OWNER/NAME] [--moment=pull-request]
 *                             [--workflow="🔍 Quality Checks"] [--previous=a,b]
 *                             [--on-drift=repair|report|block] [--ruleset=NAME]
 *                             [--dry-run] [--prune] [--json]
 *
 * Exit codes:
 *   0  matched, or drift under `repair`/`report`, or EXTRA-only drift under
 *      `block`
 *   1  convergeable drift under `block`, or a repair write that failed
 *   2  UNPROVEN — nothing was measured
 * @module lisa-reconcile-policy
 */

import {
  boundedSpawnSync,
  DEFAULT_CHILD_BUDGET_MS,
  isChildTimeout,
} from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

import {
  contextsFor,
  POLICY_SCHEMA,
  readGates,
  resolveMoment,
} from "./lisa-gates.mjs";

/**
 * A ruleset as GitHub returns it. Permissive on purpose: the API adds fields,
 * and this module only ever reads `name`, `id`, `enforcement`, and `rules`.
 * @typedef {Record<string, *>} Ruleset
 */

/**
 * One required status check, with the ruleset that requires it.
 *
 * The owner travels with the context because an EXTRA one has to be NAMED with
 * somewhere for the reader to go and look, and because pruning needs to know
 * which ruleset to rewrite.
 * @typedef {object} LiveContext
 * @property {string} context The exact context string GitHub matches on.
 * @property {number|null} integration_id The app that posts it, when declared.
 * @property {string} ruleset Name of the ruleset requiring it.
 * @property {*} rulesetId Id of that ruleset.
 */

/**
 * Why nothing could be measured.
 * @typedef {object} Unproven
 * @property {string} reason One of `UNPROVEN`.
 * @property {string} detail Verbatim failure text, never summarised away.
 * @property {string|null} command The `gh` invocation that failed.
 */

/**
 * The three context sets. Reached only when the read succeeded.
 * @typedef {object} ContextDrift
 * @property {string[]} missing Declared, not required on GitHub. A name appears
 *   here when ANY of its declarations is unsatisfied.
 * @property {Array<{context: string, ruleset?: string, integration_id?: number}>} missingRecords
 *   The unsatisfied (ruleset, context) pairs behind `missing`. What a repair
 *   acts on: `missing` says which names to report, this says where each goes.
 * @property {LiveContext[]} extra Required on GitHub, not declared.
 * @property {string[]} matched Present on both sides, in EVERY ruleset that
 *   declared them.
 */

/**
 * One declared policy field, compared against what GitHub reports.
 * @typedef {object} PolicyFinding
 * @property {string} path Dotted path into the `policy` block.
 * @property {*} declared What the project declared.
 * @property {*} observed What GitHub reports.
 * @property {string} surface `repository` or `ruleset`.
 * @property {string} field The name it is observed under.
 */

/**
 * Policy comparison, split by whether it agreed.
 * @typedef {object} SettingsDrift
 * @property {PolicyFinding[]} drift Fields that disagree.
 * @property {PolicyFinding[]} matched Fields that agree.
 * @property {string[]} unknown Declared paths this module cannot observe.
 */

/**
 * One step of a repair. `manual` steps are printed and never executed.
 * @typedef {object} RepairAction
 * @property {string} kind `contexts`, `settings`, or `manual`.
 * @property {string} [message] What a human must do, for a `manual` step.
 * @property {string} [ruleset] Name of the ruleset a `contexts` step writes.
 * @property {*} [rulesetId] Its id.
 * @property {string[]} [add] Contexts to start requiring.
 * @property {string[]} [remove] Contexts to stop requiring.
 * @property {Ruleset} [payload] The body a `contexts` step PUTs.
 * @property {Record<string, *>} [fields] The body a `settings` step PATCHes.
 * @property {string[]} [paths] Policy paths a `settings` step repairs.
 */

/**
 * What became of one planned action.
 * @typedef {object} RepairOutcome
 * @property {RepairAction} action The action attempted.
 * @property {boolean} applied Whether GitHub accepted the write.
 * @property {string|null} note The failure text, or a manual step's message.
 */

/**
 * A full reconciliation.
 *
 * `contexts` and `settings` are `null` — never empty — when the verdict is
 * UNPROVEN, because empty sets are what a CLEAN repository looks like and a
 * reader that cannot tell them apart reports a match it never measured.
 * @typedef {object} Reconciliation
 * @property {string|null} repo `OWNER/NAME`, or null when none resolved.
 * @property {string} moment The moment contexts were derived for.
 * @property {string[]} declared Contexts `contextsFor` derived.
 * @property {string} onDrift The response in force.
 * @property {boolean} dryRun Whether writing was suppressed.
 * @property {boolean} prune Whether EXTRA contexts may be removed.
 * @property {string} verdict One of `VERDICT`.
 * @property {boolean|null} blocking Whether the measured drift is the kind a
 *   repair could converge, and therefore the kind `block` fails on. Null when
 *   nothing was measured, for the same reason the sets are.
 * @property {Unproven|null} unproven Why nothing was measured, when nothing was.
 * @property {ContextDrift|null} contexts Context comparison, or null.
 * @property {SettingsDrift|null} settings Policy comparison, or null.
 * @property {RepairAction[]} plan What would bring the repository back.
 * @property {RepairOutcome[]} outcomes What was actually attempted.
 */

/**
 * Everything read from the repository in one pass.
 * @typedef {object} LivePolicy
 * @property {true} ok Discriminator: the read succeeded.
 * @property {Ruleset[]} rulesets Branch-target rulesets, in full.
 * @property {LiveContext[]} contexts Every required context they carry.
 * @property {Record<string, *>} settings Repository settings.
 * @property {Record<string, boolean>} signals Ruleset-surface policy.
 */

/**
 * A failed read. The discriminator is what keeps it from being mistaken for a
 * clean `LivePolicy`.
 * @typedef {object} FailedRead
 * @property {false} ok Discriminator: nothing was measured.
 * @property {Unproven} unproven Why.
 */

/** The three states a reconciliation can end in. */
export const VERDICT = Object.freeze({
  MATCHED: "matched",
  DRIFT: "drift",
  UNPROVEN: "unproven",
});

/**
 * Why a reconciliation could not be performed.
 *
 * Separated by operator action, not by error class: a missing CLI, a missing
 * login, and a repository that refused the read send someone to three different
 * places.
 */
export const UNPROVEN = Object.freeze({
  NO_CLI: "gh-not-installed",
  UNAUTHENTICATED: "gh-unauthenticated",
  NO_REPO: "repository-unresolved",
  API_ERROR: "api-error",
  MALFORMED: "unreadable-response",
});

/** How to respond to measured drift. Mirrors `DRIFT_RESPONSES` in lisa-gates. */
export const ON_DRIFT = Object.freeze(["repair", "report", "block"]);

/** Fields GitHub rejects on a ruleset write. Same list the apply script strips. */
const READ_ONLY_RULESET_FIELDS = [
  "id",
  "source_type",
  "source",
  "node_id",
  "created_at",
  "updated_at",
  "_links",
  "current_user_can_bypass",
];

/** GitHub Actions integration id, the default owner of a Lisa-derived context. */
const ACTIONS_INTEGRATION_ID = 15368;

/**
 * Where each `policy` field is observed, and under what name.
 *
 * `surface` is load-bearing: `repository` fields are readable and writable
 * through `PATCH /repos/{owner}/{repo}`, while `ruleset` fields are properties
 * of a ruleset's rule shape, which this script reads but does not write.
 *
 * The keys are asserted to cover `POLICY_SCHEMA` exactly, so a policy field
 * added upstream cannot quietly become one this script never compares — which
 * would present as a clean reconciliation of a setting nobody looked at.
 */
export const POLICY_SOURCES = Object.freeze({
  "merge.squash": { surface: "repository", field: "allow_squash_merge" },
  "merge.merge_commit": { surface: "repository", field: "allow_merge_commit" },
  "merge.rebase": { surface: "repository", field: "allow_rebase_merge" },
  "merge.auto_merge": { surface: "repository", field: "allow_auto_merge" },
  "merge.delete_branch_on_merge": {
    surface: "repository",
    field: "delete_branch_on_merge",
  },
  "merge.allow_update_branch": {
    surface: "repository",
    field: "allow_update_branch",
  },
  "history.linear": { surface: "ruleset", field: "linear" },
  "history.signed_commits": { surface: "ruleset", field: "signed_commits" },
  "history.commit_signoff": {
    surface: "repository",
    field: "web_commit_signoff_required",
  },
  "protect.force_push": { surface: "ruleset", field: "force_push" },
  "protect.deletion": { surface: "ruleset", field: "deletion" },
  "protect.up_to_date_before_merge": {
    surface: "ruleset",
    field: "up_to_date_before_merge",
  },
  "protect.conversation_resolution": {
    surface: "ruleset",
    field: "conversation_resolution",
  },
  "protect.dismiss_stale_reviews": {
    surface: "ruleset",
    field: "dismiss_stale_reviews",
  },
  "protect.require_last_push_approval": {
    surface: "ruleset",
    field: "require_last_push_approval",
  },
  "repository.has_issues": { surface: "repository", field: "has_issues" },
  "repository.has_wiki": { surface: "repository", field: "has_wiki" },
  "repository.default_branch": {
    surface: "repository",
    field: "default_branch",
  },
  "review.required_approving_review_count": {
    surface: "ruleset",
    field: "required_approving_review_count",
  },
  "review.require_code_owner_review": {
    surface: "ruleset",
    field: "require_code_owner_review",
  },
  "review.require_extra_approval_for_unattributed_changes": {
    surface: "ruleset",
    field: "require_extra_approval_for_unattributed_changes",
  },
  "ruleset.enforcement": { surface: "ruleset", field: "enforcement" },
  "ruleset.include_refs": { surface: "ruleset", field: "include_refs" },
  "ruleset.exclude_refs": { surface: "ruleset", field: "exclude_refs" },
  "ruleset.bypass_actors": { surface: "ruleset", field: "bypass_actors" },
});

/**
 * The ruleset whose SHAPE the `policy.ruleset` and `policy.review` blocks
 * describe.
 *
 * The boolean signals below are an OR across every active ruleset, because
 * "are force pushes refused anywhere" is the question those fields ask. The
 * shape fields are not like that: a repository has several rulesets and each
 * has its own `enforcement`, its own ref conditions and its own bypass list, so
 * ORing them would compare a declaration against a value from whichever ruleset
 * happened to sort first. These are read off the one ruleset Lisa generates.
 */
export const POLICY_RULESET_NAME = "base";

/**
 * Run `gh` and report the outcome without throwing.
 *
 * A missing executable is reported as `missing` rather than as a failed call,
 * because "gh is not installed here" and "gh said no" are different findings
 * with different fixes, and collapsing them is how an unauthenticated machine
 * gets told to install a CLI it already has.
 *
 * `timedOut` exists for exactly that reason applied once more. "The box was
 * busy" and "gh said no" are also different findings with different fixes, and
 * a killed child returns EMPTY streams — so folded into the ordinary failure
 * path it becomes an empty `stderr` and a verdict of no, indistinguishable from
 * a clean refusal. This function is deliberately the one that refuses to
 * collapse outcomes; a third one belongs here on the same principle rather than
 * as an exception to it.
 *
 * It does not throw, unlike most call sites converted for
 * CodySwannGT/lisa#2980, because callers read a result object and a throw would
 * change that contract. Not-throwing is safe here precisely BECAUSE the outcome
 * is named: `ok` is false, so every existing caller already treats it as a
 * failure, and one that wants to say "the machine was busy" now can.
 * @param {string[]} args Arguments to `gh`.
 * @param {object} [options] Runner options.
 * @param {string} [options.input] Body to pipe to stdin.
 * @returns {{ok: boolean, stdout: string, stderr: string, missing?: boolean, timedOut?: boolean}} Outcome.
 */
export function ghRunner(args, options = {}) {
  let result;
  try {
    result = boundedSpawnSync("gh", args, {
      encoding: "utf8",
      input: options.input,
    });
  } catch (error) {
    if (!isChildTimeout(error)) throw error;
    return {
      ok: false,
      stdout: "",
      stderr: `gh was killed after ${String(DEFAULT_CHILD_BUDGET_MS)}ms without finishing: ${String(error.message)}`,
      timedOut: true,
    };
  }
  if (result.error) {
    const missing = result.error.code === "ENOENT";
    return { ok: false, stdout: "", stderr: result.error.message, missing };
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Build an unproven result.
 * @param {string} reason One of `UNPROVEN`.
 * @param {string} detail Verbatim failure text, never summarised away.
 * @param {string[]} [command] The `gh` arguments that produced it.
 * @returns {FailedRead} Unproven.
 */
function unproven(reason, detail, command = null) {
  return {
    ok: false,
    unproven: {
      reason,
      detail: String(detail ?? "").trim(),
      command: command ? `gh ${command.join(" ")}` : null,
    },
  };
}

/**
 * Call `gh` and parse its stdout as JSON, mapping every failure to UNPROVEN.
 * @param {Function} gh The injected runner.
 * @param {string[]} args Arguments to `gh`.
 * @returns {{ok: true, value: *}|FailedRead} Parsed value, or unproven.
 */
function ghJson(gh, args) {
  let result;
  try {
    result = gh(args);
  } catch (err) {
    return unproven(UNPROVEN.API_ERROR, `gh threw: ${err.message}`, args);
  }
  if (result?.missing) {
    return unproven(
      UNPROVEN.NO_CLI,
      result.stderr || "the gh executable was not found on PATH",
      args
    );
  }
  if (!result?.ok) {
    const text = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`.trim();
    const authFailed =
      /gh auth login|bad credentials|not logged|HTTP 401|requires authentication/iu.test(
        text
      );
    return unproven(
      authFailed ? UNPROVEN.UNAUTHENTICATED : UNPROVEN.API_ERROR,
      text || "gh exited non-zero with no output",
      args
    );
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch (err) {
    return unproven(
      UNPROVEN.MALFORMED,
      `could not parse the response as JSON: ${err.message}`,
      args
    );
  }
}

/**
 * Reduce a repository's rulesets to the policy properties they assert.
 *
 * `force_push` reads `non_fast_forward` because that is the rule GitHub uses to
 * mean "force pushes are refused"; the policy field states the protection, not
 * the permission, so `true` means force pushing is blocked.
 *
 * The boolean signals are ORed across every ACTIVE ruleset. The shape fields —
 * `enforcement`, the ref conditions, `bypass_actors`, the review counts — are
 * read off `POLICY_RULESET_NAME` alone, and they are read whatever its
 * enforcement is, because `enforcement` is itself one of the declared fields
 * and skipping a non-active ruleset would report the one drift that matters
 * most as no drift at all.
 * @param {Ruleset[]} rulesets Full ruleset objects.
 * @param {string} [policyRuleset] Ruleset the shape fields are read from.
 * @returns {Record<string, *>} Observed ruleset-surface policy.
 */
export function rulesetSignals(rulesets, policyRuleset = POLICY_RULESET_NAME) {
  const signals = {
    linear: false,
    signed_commits: false,
    force_push: false,
    deletion: false,
    up_to_date_before_merge: false,
    conversation_resolution: false,
    dismiss_stale_reviews: false,
    require_last_push_approval: false,
  };
  for (const ruleset of rulesets ?? []) {
    // An `evaluate`/`disabled` ruleset asserts nothing; counting it would make
    // a dry-run ruleset read as live protection.
    if ((ruleset?.enforcement ?? "active") !== "active") continue;
    for (const rule of ruleset?.rules ?? []) {
      const parameters = rule?.parameters ?? {};
      if (rule?.type === "required_linear_history") signals.linear = true;
      if (rule?.type === "required_signatures") signals.signed_commits = true;
      if (rule?.type === "non_fast_forward") signals.force_push = true;
      if (rule?.type === "deletion") signals.deletion = true;
      if (
        rule?.type === "required_status_checks" &&
        parameters.strict_required_status_checks_policy
      ) {
        signals.up_to_date_before_merge = true;
      }
      if (rule?.type !== "pull_request") continue;
      if (parameters.required_review_thread_resolution) {
        signals.conversation_resolution = true;
      }
      if (parameters.dismiss_stale_reviews_on_push) {
        signals.dismiss_stale_reviews = true;
      }
      if (parameters.require_last_push_approval) {
        signals.require_last_push_approval = true;
      }
    }
  }
  return { ...signals, ...rulesetShape(rulesets, policyRuleset) };
}

/**
 * The per-ruleset shape fields, read off the policy ruleset.
 *
 * Every field is `undefined` when that ruleset does not exist, which is what
 * makes "the ruleset Lisa generates is not on this repository" render as drift
 * on each declared field rather than as a match against a fabricated default.
 * @param {Ruleset[]} rulesets Full ruleset objects.
 * @param {string} policyRuleset The ruleset to read.
 * @returns {Record<string, *>} Observed shape.
 */
function rulesetShape(rulesets, policyRuleset) {
  const target = (rulesets ?? []).find(entry => entry?.name === policyRuleset);
  if (!target) return {};
  const pullRequest = (target.rules ?? []).find(
    rule => rule?.type === "pull_request"
  );
  return {
    enforcement: target.enforcement,
    include_refs: target.conditions?.ref_name?.include,
    exclude_refs: target.conditions?.ref_name?.exclude,
    bypass_actors: target.bypass_actors,
    required_approving_review_count:
      pullRequest?.parameters?.required_approving_review_count,
    require_code_owner_review:
      pullRequest?.parameters?.require_code_owner_review,
    // Read as a SHAPE field, not as an OR across rulesets. GitHub fills this
    // in on every ruleset carrying a `pull_request` rule, so ORing would
    // report the strictest ruleset's value as the answer for the one Lisa
    // generates, and a declared `false` on that ruleset would read as matched
    // because some other ruleset had GitHub's default.
    require_extra_approval_for_unattributed_changes:
      pullRequest?.parameters?.require_extra_approval_for_unattributed_changes,
  };
}

/**
 * Every required status check the live rulesets carry, with its owner.
 * @param {Ruleset[]} rulesets Full ruleset objects.
 * @returns {LiveContext[]} Live contexts.
 */
export function liveContexts(rulesets) {
  const found = [];
  for (const ruleset of rulesets ?? []) {
    if ((ruleset?.enforcement ?? "active") !== "active") continue;
    for (const rule of ruleset?.rules ?? []) {
      if (rule?.type !== "required_status_checks") continue;
      for (const check of rule?.parameters?.required_status_checks ?? []) {
        if (typeof check?.context !== "string") continue;
        found.push({
          context: check.context,
          integration_id: check.integration_id ?? null,
          ruleset: ruleset.name,
          rulesetId: ruleset.id,
        });
      }
    }
  }
  return found;
}

/**
 * Read the live ruleset and repository settings.
 *
 * Every failure path returns UNPROVEN rather than a partial reading. A ruleset
 * index that was readable while a detail fetch failed still leaves the required
 * list unknown, and half a list compared against a whole declaration reports
 * drift that may not exist.
 * @param {object} options Read inputs.
 * @param {string} options.repo `OWNER/NAME`.
 * @param {Function} options.gh Injected `gh` runner.
 * @returns {LivePolicy|FailedRead} Live state, or why it could not be read.
 */
export function readLivePolicy({ repo, gh }) {
  const index = ghJson(gh, ["api", `repos/${repo}/rulesets`]);
  if (!index.ok) return index;
  if (!Array.isArray(index.value)) {
    return unproven(
      UNPROVEN.MALFORMED,
      `expected an array of rulesets, got ${typeof index.value}`,
      ["api", `repos/${repo}/rulesets`]
    );
  }

  const rulesets = [];
  for (const entry of index.value) {
    if (entry?.target && entry.target !== "branch") continue;
    const detail = ghJson(gh, ["api", `repos/${repo}/rulesets/${entry?.id}`]);
    if (!detail.ok) return detail;
    rulesets.push(detail.value);
  }

  const settings = ghJson(gh, ["api", `repos/${repo}`]);
  if (!settings.ok) return settings;

  return {
    ok: true,
    rulesets,
    contexts: liveContexts(rulesets),
    settings: settings.value ?? {},
    signals: rulesetSignals(rulesets),
  };
}

/**
 * Compare declared contexts against live ones.
 *
 * Comparison is exact string equality, deliberately. A repository routinely
 * carries confusable pairs — an app's required `GitGuardian Security Checks`
 * beside a not-required `🔐 Credential Leakage` proving the same property,
 * `🧹 Lint` beside `🐢 Slow Lint Rules` — and a fuzzy match raises a false
 * alarm whose obvious fix is deleting the guard.
 * ## Why a name alone is not the comparison
 *
 * A context declared in `github.rulesets.requiredChecks` carries structure —
 * the ruleset that owns it, and often an `integration_id` pinning WHICH app may
 * satisfy it. Reducing the declaration to a bare name threw that away, so a
 * context declared pinned in one ruleset was reported as matched by an
 * UNPINNED context of the same name in a different ruleset. No repair was
 * produced, and the requirement stayed satisfiable by a writer the project
 * never named — which is the whole property the pin exists to establish.
 *
 * The constraint applies only where the project actually declared one.
 * A gate-derived context names no ruleset and no app, so it keeps matching on
 * name against any active ruleset; nothing is tightened that was never stated.
 * @param {object} options Comparison inputs.
 * @param {string[]} options.declared Contexts `contextsFor` derived.
 * @param {LiveContext[]} options.live Contexts read from the rulesets.
 * @param {Record<string, string>} [options.homes] Declared ruleset per context,
 *   from `declaredChecks`. A context absent here declares no owner.
 * @param {Record<string, number>} [options.pins] Declared app id per context,
 *   from `declaredChecks`. A context absent here declares no writer.
 * @param {Array<{context: string, ruleset?: string, integration_id?: number}>} [options.records]
 *   One record per declared (ruleset, context) pair, from `declaredChecks`.
 *   Supplied, it is what the comparison is made of; absent, the name-keyed
 *   `homes`/`pins` projection is reconstituted into equivalent records.
 * @param {Array<{context:string, ruleset?:string}>} [options.awaited]
 *   Awaited declarations, preserving their ruleset identity.
 * @returns {ContextDrift} Three sets, plus the unsatisfied records.
 */
export function reconcileContexts({
  declared,
  live,
  homes = {},
  pins = {},
  records,
  awaited = [],
}) {
  const liveContexts = live ?? [];
  const declaredNames = new Set(declared ?? []);
  const byName = (a, b) => a.localeCompare(b);
  const awaitedDeclarations = awaited ?? [];

  // The unit of declaration is a (ruleset, context) PAIR, not a name. A name
  // set cannot hold `build` required by both `base` and `release`, so a live
  // `build` in `release` alone answered for both and the `base` requirement was
  // reported matched — a requirement that does not exist, reported satisfied.
  const supplied = Array.isArray(records) ? records : null;
  const reconstituted = [...declaredNames]
    .filter(name => Object.hasOwn(homes, name))
    .map(name => ({
      context: name,
      ruleset: homes[name],
      // `Object.hasOwn`, not a truthiness test: an entry's absence and an entry
      // holding a falsy value are different declarations, and the prototype
      // chain is not a source of declared policy.
      ...(Object.hasOwn(pins, name) ? { integration_id: pins[name] } : {}),
    }));
  const byContext = new Map();
  for (const record of supplied ?? reconstituted) {
    if (!declaredNames.has(record?.context)) continue;
    if (!byContext.has(record.context)) byContext.set(record.context, []);
    byContext.get(record.context).push(record);
  }
  // A gate-derived context names no ruleset and no app, so it keeps matching on
  // name against any active ruleset; nothing is tightened that was never stated.
  const declarations = [...declaredNames]
    .sort(byName)
    .flatMap(name => byContext.get(name) ?? [{ context: name }]);

  const satisfies = (entry, record) => {
    if (entry.context !== record.context) return false;
    if (record.ruleset !== undefined && entry.ruleset !== record.ruleset) {
      return false;
    }
    // Configured ruleset policy defaults to GitHub Actions when it carries no
    // explicit pin. That is the same default the writer applies, so comparison
    // and repair converge. A gate-derived record names no ruleset and remains
    // name-only: it never declared which app may satisfy it.
    if (record.ruleset !== undefined) {
      if (
        record.integration_id === undefined &&
        awaitedDeclarations.some(
          awaitedRecord =>
            awaitedRecord.context === record.context &&
            awaitedRecord.ruleset === record.ruleset
        )
      ) {
        return (
          entry.integration_id === null || entry.integration_id === undefined
        );
      }
      const expected = record.integration_id ?? ACTIONS_INTEGRATION_ID;
      return entry.integration_id === expected;
    }
    return (
      record.integration_id === undefined ||
      entry.integration_id === record.integration_id
    );
  };
  const unsatisfied = declarations.filter(
    record => !liveContexts.some(entry => satisfies(entry, record))
  );
  const missingNames = new Set(unsatisfied.map(record => record.context));

  return {
    // A NAME is missing when ANY of its declarations is unsatisfied, and
    // matched only when every one of them is. The two stay mutually exclusive,
    // and a partially-satisfied context can no longer report as done.
    missing: [...missingNames].sort(byName),
    // The specific pairs still to be written. `missing` says which names to
    // report; this says where each one has to go — a distinction a name-keyed
    // `homes` lookup cannot make once two rulesets want the same context.
    missingRecords: unsatisfied,
    // EXTRA stays name-based. A live context whose name IS declared is not
    // unexpected — it is the same requirement in the wrong shape, already
    // reported through `missing`. Listing it here too would tell `--prune` to
    // delete the thing the repair is about to add.
    extra: liveContexts
      .filter(entry => !declaredNames.has(entry.context))
      .sort((a, b) => a.context.localeCompare(b.context)),
    matched: [...declaredNames]
      .filter(name => !missingNames.has(name))
      .sort(byName),
  };
}

/**
 * Compare the declared `policy` block against observed repository state.
 *
 * Only declared fields are compared. A field the project did not declare has no
 * expected value, and inventing one would report drift against Lisa's taste
 * rather than against the project's decision.
 * @param {object} options Comparison inputs.
 * @param {object} options.policy The `policy` block.
 * @param {{settings?: Record<string, *>, signals?: Record<string, boolean>}} options.live The two
 *   surfaces a policy field can be observed on. Narrower than `LivePolicy` on
 *   purpose: this is everything the comparison reads.
 * @returns {SettingsDrift} Findings.
 */
export function reconcileSettings({ policy, live }) {
  const drift = [];
  const matched = [];
  const unknown = [];

  for (const [section, fields] of Object.entries(policy ?? {})) {
    if (section === "on_drift") continue;
    if (!fields || typeof fields !== "object") continue;
    for (const [field, declared] of Object.entries(fields)) {
      const path = `${section}.${field}`;
      const source = POLICY_SOURCES[path];
      if (!source) {
        unknown.push(path);
        continue;
      }
      const observed =
        source.surface === "repository"
          ? live.settings?.[source.field]
          : live.signals?.[source.field];
      const finding = { path, declared, observed, ...source };
      if (sameDeclaredValue(observed, declared)) matched.push(finding);
      else drift.push(finding);
    }
  }
  return { drift, matched, unknown };
}

/**
 * Whether an observed value satisfies a declared one.
 *
 * `===` was enough while every policy field was a boolean or a string. The
 * ruleset shape moved into config carrying `include_refs` and `bypass_actors`,
 * and two arrays with identical contents are never `===` — so a repository in
 * perfect agreement with its declaration would have reported drift on every
 * run, and a `repair` would have rewritten a setting that was already right.
 *
 * ARRAY order matters and is compared: `include_refs` is a list a reader
 * compares line by line, and calling two genuinely different ref lists equal
 * would hide a real difference.
 *
 * OBJECT KEY order does not, and must not. `JSON.stringify` preserves insertion
 * order, `bypass_actors` entries are objects, GitHub emits its own key order and
 * the declaration is hand-authored — so `{actor_type, actor_id}` against
 * `{actor_id, actor_type}` would report drift forever on a repository that
 * agrees with its declaration exactly. That is the same permanent false alarm
 * this module removes elsewhere, reintroduced by a serializer detail, so keys
 * are sorted before comparing.
 * @param {*} observed What GitHub reports.
 * @param {*} declared What the project declared.
 * @returns {boolean} True when they agree.
 */
export function sameDeclaredValue(observed, declared) {
  if (observed === declared) return true;
  if (
    observed === null ||
    declared === null ||
    typeof observed !== "object" ||
    typeof declared !== "object"
  ) {
    return false;
  }
  return canonicalJson(observed) === canonicalJson(declared);
}

/**
 * Serialize a value with object keys in a stable order, arrays left alone.
 * @param {*} value Any JSON-representable value.
 * @returns {string} A key-order-independent serialization.
 */
function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

/**
 * Rebuild a value with every object's keys sorted, recursively.
 * @param {*} value Any JSON-representable value.
 * @returns {*} The same value with deterministic key order.
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(entry => canonicalize(entry));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map(key => [key, canonicalize(value[key])])
  );
}

/**
 * Choose the ruleset a context repair should write to.
 *
 * Ambiguity refuses rather than guesses. More than one shipped template carries
 * a `required_status_checks` rule (`base` and `quality checks` both do), and
 * writing to the wrong one puts a context where a different ref-name condition
 * governs it — enforced somewhere other than where it was meant to be.
 * Both keys are always present, one of them null. A discriminated union would
 * read better in isolation and worse at every call site, which has to answer
 * "did this refuse?" before it can do anything either way.
 * @param {Ruleset[]} rulesets Live rulesets.
 * @param {string|null} [named] An explicit `--ruleset` name.
 * @returns {{ruleset: Ruleset|null, problem: string|null}} Target, or why not.
 */
export function repairTarget(rulesets, named = null) {
  if (named) {
    const hit = (rulesets ?? []).find(entry => entry?.name === named) ?? null;
    return {
      ruleset: hit,
      problem: hit ? null : `no ruleset named "${named}" on this repository`,
    };
  }
  const carriers = (rulesets ?? []).filter(entry =>
    (entry?.rules ?? []).some(rule => rule?.type === "required_status_checks")
  );
  if (carriers.length === 1) return { ruleset: carriers[0], problem: null };
  if (carriers.length === 0) {
    return {
      ruleset: null,
      problem:
        "no ruleset requires any status check, so there is nothing to add to. " +
        "Seed one with scripts/lisa-github-rulesets.sh first.",
    };
  }
  return {
    ruleset: null,
    problem:
      `${carriers.length} rulesets require status checks ` +
      `(${carriers.map(entry => entry.name).join(", ")}); ` +
      `pass --ruleset=<name> to say which one owns the derived contexts.`,
  };
}

/**
 * The contexts at this moment that some other app posts.
 *
 * An `await` gate names a signal Lisa does not produce — `CodeRabbit`,
 * `SonarCloud Code Analysis`. The name travels separately from the derived list
 * because by the time `contextsFor` has flattened both kinds to strings, the
 * one fact a writer needs about them — who is allowed to post this — is gone.
 * @param {object} gates The gates block.
 * @param {string} moment The moment contexts were derived for.
 * @returns {string[]} Awaited context names, required ones only.
 */
export function awaitedContexts(gates, moment) {
  return resolveMoment({ gates, moment })
    .filter(gate => gate.level === "required" && gate.mode === "await")
    .map(gate => gate.awaits)
    .filter(Boolean);
}

/**
 * The app each awaited context is pinned to, where the project named one.
 *
 * A pin is what stops any other writer satisfying a required check. It has to
 * come from the declaration, because the alternative — a shipped list of vendor
 * integration ids — is the fleet-wide lock this replaced. An awaited context
 * with no declared pin is written unpinned, which is GitHub's "any source";
 * that is strictly what the reconciler did for every awaited context before
 * config could express the pin at all.
 * @param {object} gates The gates block.
 * @param {string} moment The moment contexts were derived for.
 * @returns {Record<string, number>} Context to GitHub App id.
 */
export function awaitedPins(gates, moment) {
  const pins = {};
  for (const gate of resolveMoment({ gates, moment })) {
    if (gate.level !== "required" || gate.mode !== "await") continue;
    if (!gate.awaits || gate.postedBy === null) continue;
    pins[gate.awaits] = gate.postedBy;
  }
  return pins;
}

/**
 * Read `github.rulesets.requiredChecks` into the three things a reconciliation
 * needs from it.
 *
 * This is the declarative replacement for `addRequiredChecks`, and reading it
 * here is what stops the reconciler reporting a context the project DID
 * declare as EXTRA — a false alarm whose only offered fixes were `--prune`
 * (deletes live protection) and editing the config to stop declaring it.
 *
 * The home matters as much as the name. A repository has several rulesets and
 * the declaration says which one owns each context, so a repair can write it
 * where it was declared instead of wherever the single fallback target points.
 * @param {object} [requiredChecks] The `requiredChecks` map, by ruleset name.
 * @returns {{contexts: string[], homes: Record<string, string>, pins: Record<string, number>}} Declared checks.
 */
export function declaredChecks(requiredChecks = {}) {
  const contexts = [];
  const homes = {};
  const pins = {};
  // The RECORD is the declaration; `homes` and `pins` are a name-keyed
  // projection of it that cannot represent a context required by two rulesets.
  // `homes[context] = ruleset` is last-write-wins, so `build` required in both
  // `base` and `release` kept only `release` — and a live `build` in `release`
  // alone marked the declaration matched while the `base` requirement stayed
  // missing and unrepaired. The projections remain because callers use them to
  // ROUTE a repair for a context that has exactly one home; they are no longer
  // what the comparison is made of.
  const records = [];
  for (const [ruleset, entries] of Object.entries(requiredChecks ?? {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.context !== "string") continue;
      contexts.push(entry.context);
      homes[entry.context] = ruleset;
      const pinned = Number.isInteger(entry.integration_id);
      if (pinned) pins[entry.context] = entry.integration_id;
      records.push({
        context: entry.context,
        ruleset,
        ...(pinned ? { integration_id: entry.integration_id } : {}),
      });
    }
  }
  return { contexts, homes, pins, records };
}

/**
 * Where an awaited context should be written.
 *
 * An awaited context is declared on a GATE, not in `requiredChecks`, so it
 * names no ruleset of its own. `POLICY_RULESET_NAME` is its DEFAULT home
 * because that is where Lisa's own generator writes it, which is what lets the
 * two writers agree without anyone passing `--ruleset`.
 *
 * A default, though, and not an override — which is what it had become. The
 * name was assigned directly, so an explicit `--ruleset` was silently ignored
 * for exactly these contexts, and a repository with no ruleset called `base`
 * was told to go and seed one instead of falling back to the single carrier it
 * already had. Both are answers to a question the caller had already answered.
 *
 * `null` means "no declared home", which sends the context down the normal
 * fallback path in `planContextRepairs` and surfaces that path's real
 * diagnosis — ambiguous carriers, or none at all — rather than a message about
 * a ruleset the project never mentioned.
 * @param {LivePolicy} live Result of `readLivePolicy`.
 * @param {string|null} [rulesetName] An explicit `--ruleset` name.
 * @returns {string|null} Ruleset name to write to, or null for the fallback.
 */
export function awaitedHome(live, rulesetName = null) {
  const rulesets = live?.rulesets ?? [];
  if (rulesetName)
    return repairTarget(rulesets, rulesetName).ruleset?.name ?? null;
  if (rulesets.some(entry => entry?.name === POLICY_RULESET_NAME)) {
    return POLICY_RULESET_NAME;
  }
  return repairTarget(rulesets, null).ruleset?.name ?? null;
}

/**
 * Rewrite a ruleset's required contexts, returning a writable payload.
 * @param {Ruleset} ruleset The live ruleset.
 * @param {object} [options] Edit inputs.
 * @param {string[]} [options.add] Contexts to require.
 * @param {string[]} [options.remove] Contexts to stop requiring.
 * @param {string[]} [options.awaited] Of `add`, the ones an external app posts.
 * @param {Record<string, number>} [options.pins] Declared app id per awaited
 *   context, from `awaitedPins`.
 * @returns {Ruleset} A payload with read-only fields stripped.
 */
export function rulesetPayload(
  ruleset,
  { add = [], remove = [], awaited = [], pins = {} } = {}
) {
  const payload = structuredClone(ruleset);
  for (const field of READ_ONLY_RULESET_FIELDS) delete payload[field];

  const rules = payload.rules ?? [];
  const rule = rules.find(entry => entry?.type === "required_status_checks");
  // Pinning the integration is what stops another writer satisfying a check
  // Actions is supposed to post. Applied to an awaited context it does the
  // opposite: it names the one app that will never post it, and the required
  // check then blocks every pull request forever.
  const additions = add.map(context => {
    if (Object.hasOwn(pins, context)) {
      return { context, integration_id: pins[context] };
    }
    return awaited.includes(context)
      ? { context }
      : { context, integration_id: ACTIONS_INTEGRATION_ID };
  });

  if (!rule) {
    payload.rules = [
      ...rules,
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          do_not_enforce_on_create: true,
          required_status_checks: additions,
        },
      },
    ];
    return payload;
  }

  // An ADDITION REPLACES a same-named check in this ruleset rather than losing
  // to it. Only a context the comparison reported unsatisfied HERE reaches
  // `add`, so an existing check of that name in this ruleset is by construction
  // the wrong shape — the unpinned form of a pinned declaration, or one pinned
  // to an app the project did not name. Keeping it and de-duplicating the
  // addition away wrote a PUT that preserved the wrong pin, so the repair
  // reported success and converged on nothing: the next run found the same
  // drift, planned the same repair, and reported the same success forever.
  const added = new Map(additions.map(check => [check.context, check]));
  const kept = (rule.parameters?.required_status_checks ?? []).filter(
    check => !remove.includes(check?.context) && !added.has(check?.context)
  );
  rule.parameters = {
    ...rule.parameters,
    required_status_checks: [...kept, ...added.values()],
  };
  payload.rules = rules;
  return payload;
}

/**
 * The actions that would bring the repository back to its declaration.
 *
 * Built whether or not they will be executed, so `--dry-run` and `report` print
 * exactly what `repair` would do rather than a description of it.
 * @param {object} options Planning inputs.
 * @param {ContextDrift} options.contexts Result of `reconcileContexts`.
 * @param {SettingsDrift} options.settings Result of `reconcileSettings`.
 * @param {LivePolicy} options.live Result of `readLivePolicy`.
 * @param {boolean} options.prune Whether EXTRA contexts may be removed.
 * @param {string|null} options.rulesetName Explicit target ruleset.
 * @param {Array<{context:string, ruleset?:string}>} [options.awaited]
 *   Ruleset-scoped contexts an external app posts.
 * @param {Record<string, number>} [options.pins] Declared app id per awaited
 *   context.
 * @returns {RepairAction[]} Planned actions.
 */
export function planRepairs({
  contexts,
  settings,
  live,
  prune,
  rulesetName,
  awaited = [],
  pins = {},
  homes = {},
}) {
  const plan = [
    ...planContextRepairs({
      contexts,
      live,
      prune,
      rulesetName,
      awaited,
      pins,
      homes,
    }),
  ];

  // Rule (b): an EXTRA context is reported by name and left alone. Most of them
  // are external apps Lisa never declares, and removing one silently strips a
  // protection nobody asked to lose.
  if (contexts.extra.length && !prune) {
    plan.push({
      kind: "manual",
      message:
        `${contexts.extra.length} required context(s) are live but not ` +
        `declared: ${contexts.extra.map(entry => `"${entry.context}"`).join(", ")}. ` +
        `They are NOT removed. Each is either an external app Lisa does not ` +
        `manage (SonarCloud, GitGuardian, CodeRabbit) — in which case leave it ` +
        `— or a gate that should be declared in .lisa.config.json. Re-run with ` +
        `--prune only once you have decided, one by one, that each is neither.`,
    });
  }

  const repositoryDrift = settings.drift.filter(
    finding => finding.surface === "repository"
  );
  if (repositoryDrift.length) {
    plan.push({
      kind: "settings",
      fields: Object.fromEntries(
        repositoryDrift.map(finding => [finding.field, finding.declared])
      ),
      paths: repositoryDrift.map(finding => finding.path),
    });
  }

  const rulesetDrift = settings.drift.filter(
    finding => finding.surface === "ruleset"
  );
  if (rulesetDrift.length) {
    plan.push({
      kind: "manual",
      message:
        `${rulesetDrift.map(finding => finding.path).join(", ")} live in the ` +
        `SHAPE of a ruleset's rules, which scripts/lisa-github-rulesets.sh ` +
        `owns. Re-run that script to repair them; this one will not reshape ` +
        `rules it did not build.`,
    });
  }
  return plan;
}

/**
 * The pins that apply to ONE ruleset's additions.
 *
 * Three sources, in increasing authority: the name-keyed map (awaited-context
 * pins, which are declared per context and belong to no ruleset), this group's
 * own declared pins, and this group's declarations that state NO pin. The last
 * is why a merge is not enough — an unpinned declaration has to remove an
 * inherited value, and spreading objects can only add.
 * @param {object} options Inputs.
 * @param {Record<string, number>} options.pins Name-keyed declared and awaited pins.
 * @param {Record<string, number>} options.groupPins Pins declared on this ruleset.
 * @param {Set<string>} options.unpinned Contexts this ruleset declares without a pin.
 * @returns {Record<string, number>} Pins to apply to this ruleset's additions.
 */
function pinsFor({ pins, groupPins, unpinned }) {
  const effective = { ...pins, ...groupPins };
  for (const context of unpinned) delete effective[context];
  return effective;
}

/**
 * Group the context repairs by the ruleset each one belongs to.
 *
 * Every add and every remove used to be written into ONE ruleset. For removals
 * that made `--prune` a no-op whenever the extra context lived somewhere other
 * than the fallback target: the payload dropped a context the target never
 * required, GitHub accepted it, and the check stayed required. For additions it
 * put a context under whichever ref-name condition the fallback target carries,
 * enforced somewhere other than where it was declared.
 *
 * A context's home is the ruleset that declares it in
 * `github.rulesets.requiredChecks`, or — for a gate-derived context, which
 * names no ruleset — the single carrier or the explicit `--ruleset`.
 * @param {object} options Planning inputs.
 * @param {ContextDrift} options.contexts Result of `reconcileContexts`.
 * @param {LivePolicy} options.live Result of `readLivePolicy`.
 * @param {boolean} options.prune Whether EXTRA contexts may be removed.
 * @param {string|null} options.rulesetName Explicit fallback target.
 * @param {Array<{context:string, ruleset?:string}>} options.awaited
 *   Ruleset-scoped contexts an external app posts.
 * @param {Record<string, number>} options.pins Declared app id per context.
 * @param {Record<string, string>} options.homes Declared ruleset per context.
 * @returns {RepairAction[]} Context actions, one per ruleset written.
 */
function planContextRepairs({
  contexts,
  live,
  prune,
  rulesetName,
  awaited,
  pins,
  homes,
}) {
  /** @type {Map<string, {add: string[], remove: string[], pins: Record<string, number>, unpinned: Set<string>}>} */
  const groups = new Map();
  const group = name => {
    if (!groups.has(name)) {
      groups.set(name, {
        add: [],
        remove: [],
        pins: {},
        unpinned: new Set(),
      });
    }
    return groups.get(name);
  };
  const problems = [];

  // A removal goes to the ruleset that actually requires it. That ruleset is
  // reported alongside every EXTRA context precisely so this is knowable.
  if (prune) {
    for (const entry of contexts.extra)
      group(entry.ruleset).remove.push(entry.context);
  }

  let fallback;
  // Planned per RECORD, not per name. A context required by two rulesets needs
  // an addition in each one that lacks it, and `homes[context]` can only name
  // one of them — so routing by name repaired one requirement and silently
  // abandoned the other. `missingRecords` is the unsatisfied (ruleset, context)
  // pairs; a record without a ruleset is gate-derived and still routes through
  // `homes` and then the fallback, exactly as before.
  const missingRecords =
    contexts.missingRecords ??
    (contexts.missing ?? []).map(context => ({ context }));
  for (const record of missingRecords) {
    const context = record.context;
    const home = record.ruleset ?? homes[context];
    const target = home ? group(home) : null;
    if (target) {
      target.add.push(context);
      // A declared record is authoritative about its own pin — INCLUDING the
      // absence of one. `pins` is name-keyed and last-write-wins, so if `base`
      // declares a context unpinned and `release` pins it to app 99, the
      // name-keyed value is 99 and the `base` addition inherited it: a pin the
      // project never declared for that ruleset, written by the repair itself.
      // Silently narrowing WHO may satisfy a required check is the same class
      // of harm as silently widening it — both replace a stated policy with an
      // invented one — so the record's silence is recorded, not defaulted over.
      if (record.ruleset !== undefined) {
        if (Number.isInteger(record.integration_id)) {
          target.pins[context] = record.integration_id;
        } else {
          target.unpinned.add(context);
        }
      }
      continue;
    }
    fallback ??= repairTarget(live.rulesets, rulesetName);
    if (!fallback.ruleset) {
      problems.push(fallback.problem);
      continue;
    }
    group(fallback.ruleset.name).add.push(context);
  }

  const actions = [];
  for (const [name, { add, remove, pins: groupPins, unpinned }] of groups) {
    const ruleset = (live.rulesets ?? []).find(entry => entry?.name === name);
    if (!ruleset) {
      actions.push({
        kind: "manual",
        message:
          `.lisa.config.json declares ${add.map(entry => `"${entry}"`).join(", ")} ` +
          `on a ruleset named "${name}", which this repository does not have. ` +
          `Seed it with scripts/lisa-github-rulesets.sh first — this script ` +
          `adds contexts to a ruleset, it does not create one.`,
      });
      continue;
    }
    actions.push({
      kind: "contexts",
      ruleset: ruleset.name,
      rulesetId: ruleset.id,
      add,
      remove,
      payload: rulesetPayload(ruleset, {
        add,
        remove,
        awaited: awaited
          .filter(record => record.ruleset === name)
          .map(record => record.context),
        // The name-keyed map still carries AWAITED pins, which are declared per
        // context and have no ruleset of their own, so it stays the base. A
        // declared record then overrides it — with its pin, or by deleting the
        // inherited one when the declaration states none.
        pins: pinsFor({ pins, groupPins, unpinned }),
      }),
    });
  }
  for (const problem of [...new Set(problems)]) {
    actions.push({ kind: "manual", message: problem });
  }
  return actions;
}

/**
 * Execute a plan. Never called under `--dry-run` or outside `repair`.
 * @param {object} options Write inputs.
 * @param {string} options.repo `OWNER/NAME`.
 * @param {Function} options.gh Injected runner.
 * @param {RepairAction[]} options.plan Planned actions.
 * @returns {RepairOutcome[]} One outcome per action.
 */
export function applyRepairs({ repo, gh, plan }) {
  const outcomes = [];
  for (const action of plan) {
    if (action.kind === "manual") {
      outcomes.push({ action, applied: false, note: action.message });
      continue;
    }
    const [args, input] =
      action.kind === "contexts"
        ? [
            [
              "api",
              "-X",
              "PUT",
              `repos/${repo}/rulesets/${action.rulesetId}`,
              "--input",
              "-",
            ],
            JSON.stringify(action.payload),
          ]
        : [
            ["api", "-X", "PATCH", `repos/${repo}`, "--input", "-"],
            JSON.stringify(action.fields),
          ];
    let result;
    try {
      result = gh(args, { input });
    } catch (err) {
      result = { ok: false, stdout: "", stderr: err.message };
    }
    outcomes.push({
      action,
      applied: Boolean(result?.ok),
      note: result?.ok
        ? null
        : `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`.trim(),
    });
  }
  return outcomes;
}

/**
 * Reconcile declared configuration against the live repository.
 * @param {object} options Reconciliation inputs.
 * @param {string|null} options.repo `OWNER/NAME`, or null when none resolved —
 *   which is itself an UNPROVEN verdict, not an error.
 * @param {object} [options.gates] The gates block.
 * @param {object} [options.policy] The policy block.
 * @param {Function} [options.gh] Injected `gh` runner.
 * @param {string} [options.moment] Moment to derive contexts for.
 * @param {string} [options.workflowName] Calling workflow name.
 * @param {string[]} [options.previousLabels] Labels retired this release.
 * @param {boolean} [options.dryRun] Never write, whatever `on_drift` says.
 * @param {boolean} [options.prune] Allow removal of EXTRA contexts.
 * @param {string} [options.onDrift] Override `policy.on_drift`.
 * @param {string|null} [options.rulesetName] Explicit repair target.
 * @param {boolean} [options.ghMissing] Whether resolving `repo` failed because
 *   `gh` is not installed, rather than because nothing named the repository.
 * @param {object} [options.requiredChecks] The `github.rulesets.requiredChecks`
 *   map, whose contexts are declared alongside the gate-derived ones.
 * @returns {Reconciliation} The reconciliation result.
 */
export function reconcile({
  repo,
  gates = {},
  policy = {},
  requiredChecks = {},
  gh = ghRunner,
  moment = "pull-request",
  workflowName = "🔍 Quality Checks",
  previousLabels = [],
  dryRun = false,
  prune = false,
  onDrift = policy?.on_drift ?? "repair",
  rulesetName = null,
  ghMissing = false,
}) {
  const configured = declaredChecks(requiredChecks);
  const awaited = awaitedContexts(gates, moment);
  const declared = [
    ...new Set([
      ...contextsFor(gates, { moment, workflowName, previousLabels }),
      ...configured.contexts,
    ]),
  ].sort((left, right) => left.localeCompare(right));
  const base = { repo, moment, declared, onDrift, dryRun, prune };

  if (!repo) {
    return {
      ...base,
      verdict: VERDICT.UNPROVEN,
      blocking: null,
      unproven: unproven(
        ghMissing ? UNPROVEN.NO_CLI : UNPROVEN.NO_REPO,
        ghMissing
          ? "no OWNER/NAME was configured and `gh repo view` could not be " +
              "asked, because the gh executable was not found on PATH"
          : "no OWNER/NAME could be resolved from --repo, .lisa.config.json " +
              "(github.org + github.repo), or `gh repo view`"
      ).unproven,
      contexts: null,
      settings: null,
      plan: [],
      outcomes: [],
    };
  }

  const live = readLivePolicy({ repo, gh });
  if (!live.ok) {
    // Rule (a): the sets are null, not empty. Empty is what clean looks like.
    return {
      ...base,
      verdict: VERDICT.UNPROVEN,
      blocking: null,
      unproven: live.unproven,
      contexts: null,
      settings: null,
      plan: [],
      outcomes: [],
    };
  }

  // The structured declaration travels through the comparison, so a pinned
  // context is not reported as satisfied by an unpinned one somewhere else.
  // Only `configured` is passed: it is what the project actually declared. The
  // awaited-context homes below are a routing hint for repairs, not a stated
  // expectation, and treating them as one would report drift nobody declared.
  const resolvedAwaitedHome = awaitedHome(live, rulesetName);
  const awaitedDeclarations = awaited.map(context => ({
    context,
    ...(resolvedAwaitedHome === null ? {} : { ruleset: resolvedAwaitedHome }),
  }));
  const contexts = reconcileContexts({
    declared,
    live: live.contexts,
    homes: configured.homes,
    pins: configured.pins,
    records: configured.records,
    awaited: awaitedDeclarations,
  });
  const settings = reconcileSettings({ policy, live });
  const drifted =
    contexts.missing.length > 0 ||
    contexts.extra.length > 0 ||
    settings.drift.length > 0;
  // Every difference is DRIFT and every difference is reported. Only the part a
  // repair could converge decides `block`, so the mode stays passable on a
  // repository whose only EXTRA is a check this script refuses to remove.
  const blocking =
    contexts.missing.length > 0 ||
    settings.drift.length > 0 ||
    (prune && contexts.extra.length > 0);
  const plan = drifted
    ? planRepairs({
        contexts,
        settings,
        live,
        prune,
        rulesetName,
        awaited: awaitedDeclarations,
        pins: { ...configured.pins, ...awaitedPins(gates, moment) },
        // An awaited context has no ruleset in its declaration — it is declared
        // on a GATE. Its home defaults to the ruleset Lisa generates from
        // config, which is where the applier writes it, so the two writers
        // agree instead of the reconciler needing --ruleset to place a context
        // the generator already placed. `awaitedHome` keeps that default while
        // letting an explicit --ruleset win and falling back when the default
        // ruleset does not exist here.
        homes: {
          ...(resolvedAwaitedHome === null
            ? {}
            : Object.fromEntries(
                awaitedContexts(gates, moment).map(context => [
                  context,
                  resolvedAwaitedHome,
                ])
              )),
          ...configured.homes,
        },
      })
    : [];
  const outcomes =
    drifted && onDrift === "repair" && !dryRun
      ? applyRepairs({ repo, gh, plan })
      : [];

  return {
    ...base,
    verdict: drifted ? VERDICT.DRIFT : VERDICT.MATCHED,
    blocking,
    unproven: null,
    contexts,
    settings,
    plan,
    outcomes,
  };
}

/**
 * The process exit code for a result.
 *
 * UNPROVEN is 2 in every mode, including `report`. `on_drift` decides what to do
 * about a drift that was measured, and an unproven run measured nothing — so
 * letting `report` map it to 0 would be a mode that turns "I could not look"
 * into "I looked and it was fine".
 * @param {Reconciliation} result A reconciliation result.
 * @returns {number} 0 matched or reported, 1 blocked or failed write, 2 unproven.
 */
export function exitCodeFor(result) {
  if (result.verdict === VERDICT.UNPROVEN) return 2;
  if (result.verdict === VERDICT.MATCHED) return 0;
  // A `manual` outcome is an instruction printed for a human, and `applyRepairs`
  // records it as `applied: false` because nothing was written — not because a
  // write was attempted and refused. Counting it as a failed write reports the
  // routine EXTRA-context notice as a broken repair, which `render` already
  // knows better than to do.
  const writeFailed = result.outcomes.some(
    outcome => outcome.action.kind !== "manual" && !outcome.applied
  );
  if (writeFailed) return 1;
  return result.onDrift === "block" && result.blocking ? 1 : 0;
}

/**
 * Render a result for a human.
 * @param {Reconciliation} result A reconciliation result.
 * @returns {string} The report.
 */
export function render(result) {
  if (result.verdict === VERDICT.UNPROVEN) {
    return [
      `UNPROVEN — the policy was NOT checked. This is not "matches".`,
      `  reason:  ${result.unproven.reason}`,
      result.unproven.command ? `  command: ${result.unproven.command}` : null,
      `  detail:  ${result.unproven.detail}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const lines = [
    `${result.verdict.toUpperCase()} — ${result.repo} at ${result.moment}`,
    `  matched: ${result.contexts.matched.length} context(s)`,
  ];
  // Reported per unsatisfied PAIR where there is one, so a context required by
  // two rulesets and present in one names the ruleset still lacking it. A
  // reader who is told only the name looks at the ruleset that already has it.
  for (const record of result.contexts.missingRecords ??
    result.contexts.missing.map(context => ({ context }))) {
    lines.push(
      record.ruleset
        ? `  MISSING  ${record.context}  (declared on "${record.ruleset}", not required there on GitHub)`
        : `  MISSING  ${record.context}  (declared, not required on GitHub)`
    );
  }
  for (const entry of result.contexts.extra) {
    lines.push(
      `  EXTRA    ${entry.context}  (required by "${entry.ruleset}", not declared)`
    );
  }
  for (const finding of result.settings.drift) {
    lines.push(
      `  DRIFT    ${finding.path}: declared ${JSON.stringify(finding.declared)}, ` +
        `live ${JSON.stringify(finding.observed)} [${finding.surface}]`
    );
  }
  for (const path of result.settings.unknown) {
    lines.push(`  SKIPPED  ${path}: Lisa does not know where to observe it`);
  }
  for (const action of result.plan) {
    lines.push(
      action.kind === "manual"
        ? `  ACTION   ${action.message}`
        : `  PLAN     ${describePlan(action)}`
    );
  }
  for (const outcome of result.outcomes) {
    if (outcome.action.kind === "manual") continue;
    lines.push(
      outcome.applied
        ? `  WROTE    ${describePlan(outcome.action)}`
        : `  FAILED   ${describePlan(outcome.action)}: ${outcome.note}`
    );
  }
  if (result.onDrift === "block" && result.verdict === VERDICT.DRIFT) {
    lines.push(
      result.blocking
        ? `  (on_drift=block: this run FAILS.)`
        : `  (on_drift=block: this run passes. The only difference is EXTRA ` +
            `context(s), which this script will not remove and which nothing ` +
            `declares — blocking on them would leave --prune as the only way ` +
            `out, and that deletes live protection.)`
    );
  }
  if (result.dryRun) lines.push(`  (--dry-run: nothing was written)`);
  return lines.join("\n");
}

/**
 * One line describing a planned write.
 * @param {RepairAction} action A non-manual plan action.
 * @returns {string} Description.
 */
function describePlan(action) {
  if (action.kind === "contexts") {
    const parts = [];
    if (action.add.length) parts.push(`require ${action.add.join(", ")}`);
    if (action.remove.length)
      parts.push(`stop requiring ${action.remove.join(", ")}`);
    return `ruleset "${action.ruleset}": ${parts.join("; ")}`;
  }
  return `repository settings: ${action.paths.join(", ")}`;
}

/**
 * Resolve `OWNER/NAME` from a flag, the config, or `gh`.
 *
 * Reports WHY it failed, not just that it did. A machine with no `gh` and no
 * `github` block in its config fails here first, and collapsing that into "no
 * repository could be resolved" sends the reader to edit a config file when the
 * fix is installing a CLI — the same conflation `ghRunner` exists to avoid one
 * layer down.
 * @param {string|null} flagged An explicit `--repo`.
 * @param {object} config Parsed `.lisa.config.json`.
 * @param {Function} gh Injected runner.
 * @returns {{repo: string|null, ghMissing: boolean}} The repository, or null
 *   with the reason it stayed null.
 */
export function resolveRepo(flagged, config, gh) {
  if (flagged) return { repo: flagged, ghMissing: false };
  const { org, repo } = config?.github ?? {};
  if (org && repo) return { repo: `${org}/${repo}`, ghMissing: false };
  let result;
  try {
    result = gh([
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "-q",
      ".nameWithOwner",
    ]);
  } catch {
    return { repo: null, ghMissing: false };
  }
  const name = result?.ok ? result.stdout.trim() : "";
  return { repo: name || null, ghMissing: Boolean(result?.missing) };
}

/**
 * CLI entry point.
 */
function main() {
  const argv = process.argv.slice(2);
  const flag = name => {
    const hit = argv.find(arg => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const { gates, policy, config } = readGates();
  const onDrift = flag("on-drift") ?? policy.on_drift ?? "repair";
  if (!ON_DRIFT.includes(onDrift)) {
    throw new Error(`--on-drift must be one of ${ON_DRIFT.join(", ")}`);
  }

  const { repo, ghMissing } = resolveRepo(flag("repo"), config, ghRunner);
  const result = reconcile({
    repo,
    ghMissing,
    gates,
    policy,
    requiredChecks: config?.github?.rulesets?.requiredChecks ?? {},
    gh: ghRunner,
    moment: flag("moment") ?? "pull-request",
    workflowName: flag("workflow") ?? "🔍 Quality Checks",
    previousLabels: (flag("previous") ?? "")
      .split(",")
      .map(entry => entry.trim())
      .filter(Boolean),
    dryRun: argv.includes("--dry-run"),
    prune: argv.includes("--prune"),
    onDrift,
    rulesetName: flag("ruleset"),
  });

  console.log(
    argv.includes("--json") ? JSON.stringify(result, null, 2) : render(result)
  );
  // `process.exit` truncates a pending stdout write when stdout is a pipe, and
  // this report is long enough to still be buffered. Setting the code instead
  // lets Node flush and exit on its own — measured: exiting here cut the report
  // off mid-sentence, so a piped run lost the very EXTRA-context warning the
  // script exists to print.
  process.exitCode = exitCodeFor(result);
}

if (invokedAsScript(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

/**
 * Assert `POLICY_SOURCES` still covers `POLICY_SCHEMA`.
 *
 * Exported for the test suite rather than run at import time: a module that
 * throws on load takes the whole doctor down over a config-shape mismatch.
 * @returns {string[]} Policy paths Lisa declares but this script cannot observe.
 */
export function unobservablePolicyFields() {
  const declared = Object.entries(POLICY_SCHEMA).flatMap(([section, fields]) =>
    Object.keys(fields).map(field => `${section}.${field}`)
  );
  return declared.filter(path => !Object.hasOwn(POLICY_SOURCES, path));
}
