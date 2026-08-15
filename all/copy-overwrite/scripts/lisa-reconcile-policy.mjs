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
 *   0  matched, or drift under `repair`/`report`
 *   1  drift under `block`, or a repair write that failed
 *   2  UNPROVEN — nothing was measured
 * @module lisa-reconcile-policy
 */

import { spawnSync } from "node:child_process";

import { contextsFor, POLICY_SCHEMA, readGates } from "./lisa-gates.mjs";

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
 * @property {string[]} missing Declared, not required on GitHub.
 * @property {LiveContext[]} extra Required on GitHub, not declared.
 * @property {string[]} matched Present on both sides.
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
});

/**
 * Run `gh` and report the outcome without throwing.
 *
 * A missing executable is reported as `missing` rather than as a failed call,
 * because "gh is not installed here" and "gh said no" are different findings
 * with different fixes, and collapsing them is how an unauthenticated machine
 * gets told to install a CLI it already has.
 * @param {string[]} args Arguments to `gh`.
 * @param {object} [options] Runner options.
 * @param {string} [options.input] Body to pipe to stdin.
 * @returns {{ok: boolean, stdout: string, stderr: string, missing?: boolean}} Outcome.
 */
export function ghRunner(args, options = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    input: options.input,
  });
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
 * @param {Ruleset[]} rulesets Full ruleset objects.
 * @returns {Record<string, boolean>} Observed ruleset-surface policy.
 */
export function rulesetSignals(rulesets) {
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
  return signals;
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
 * carries confusable pairs — an app's required `SonarCloud Code Analysis`
 * beside a not-required `SonarCloud SAST`, `🧹 Lint` beside `🐢 Slow Lint
 * Rules` — and a fuzzy match raises a false alarm whose obvious fix is deleting
 * the guard.
 * @param {object} options Comparison inputs.
 * @param {string[]} options.declared Contexts `contextsFor` derived.
 * @param {LiveContext[]} options.live Contexts read from the rulesets.
 * @returns {ContextDrift} Three sets.
 */
export function reconcileContexts({ declared, live }) {
  const liveNames = new Set((live ?? []).map(entry => entry.context));
  const declaredNames = new Set(declared ?? []);
  const byName = (a, b) => a.localeCompare(b);

  return {
    missing: [...declaredNames]
      .filter(name => !liveNames.has(name))
      .sort(byName),
    extra: (live ?? [])
      .filter(entry => !declaredNames.has(entry.context))
      .sort((a, b) => a.context.localeCompare(b.context)),
    matched: [...declaredNames]
      .filter(name => liveNames.has(name))
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
      if (observed === declared) matched.push(finding);
      else drift.push(finding);
    }
  }
  return { drift, matched, unknown };
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
 * Rewrite a ruleset's required contexts, returning a writable payload.
 * @param {Ruleset} ruleset The live ruleset.
 * @param {object} [options] Edit inputs.
 * @param {string[]} [options.add] Contexts to require.
 * @param {string[]} [options.remove] Contexts to stop requiring.
 * @returns {Ruleset} A payload with read-only fields stripped.
 */
export function rulesetPayload(ruleset, { add = [], remove = [] } = {}) {
  const payload = structuredClone(ruleset);
  for (const field of READ_ONLY_RULESET_FIELDS) delete payload[field];

  const rules = payload.rules ?? [];
  const rule = rules.find(entry => entry?.type === "required_status_checks");
  const additions = add.map(context => ({
    context,
    integration_id: ACTIONS_INTEGRATION_ID,
  }));

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

  const kept = (rule.parameters?.required_status_checks ?? []).filter(
    check => !remove.includes(check?.context)
  );
  const present = new Set(kept.map(check => check?.context));
  rule.parameters = {
    ...rule.parameters,
    required_status_checks: [
      ...kept,
      ...additions.filter(check => !present.has(check.context)),
    ],
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
 * @returns {RepairAction[]} Planned actions.
 */
export function planRepairs({ contexts, settings, live, prune, rulesetName }) {
  const plan = [];
  const removable = prune ? contexts.extra.map(entry => entry.context) : [];

  if (contexts.missing.length || removable.length) {
    const { ruleset, problem } = repairTarget(live.rulesets, rulesetName);
    if (!ruleset) {
      plan.push({ kind: "manual", message: problem });
    } else {
      plan.push({
        kind: "contexts",
        ruleset: ruleset.name,
        rulesetId: ruleset.id,
        add: contexts.missing,
        remove: removable,
        payload: rulesetPayload(ruleset, {
          add: contexts.missing,
          remove: removable,
        }),
      });
    }
  }

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
 * @returns {Reconciliation} The reconciliation result.
 */
export function reconcile({
  repo,
  gates = {},
  policy = {},
  gh = ghRunner,
  moment = "pull-request",
  workflowName = "🔍 Quality Checks",
  previousLabels = [],
  dryRun = false,
  prune = false,
  onDrift = policy?.on_drift ?? "repair",
  rulesetName = null,
}) {
  const declared = contextsFor(gates, { moment, workflowName, previousLabels });
  const base = { repo, moment, declared, onDrift, dryRun, prune };

  if (!repo) {
    return {
      ...base,
      verdict: VERDICT.UNPROVEN,
      unproven: unproven(
        UNPROVEN.NO_REPO,
        "no OWNER/NAME could be resolved from --repo, .lisa.config.json " +
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
      unproven: live.unproven,
      contexts: null,
      settings: null,
      plan: [],
      outcomes: [],
    };
  }

  const contexts = reconcileContexts({ declared, live: live.contexts });
  const settings = reconcileSettings({ policy, live });
  const drifted =
    contexts.missing.length > 0 ||
    contexts.extra.length > 0 ||
    settings.drift.length > 0;
  const plan = drifted
    ? planRepairs({ contexts, settings, live, prune, rulesetName })
    : [];
  const outcomes =
    drifted && onDrift === "repair" && !dryRun
      ? applyRepairs({ repo, gh, plan })
      : [];

  return {
    ...base,
    verdict: drifted ? VERDICT.DRIFT : VERDICT.MATCHED,
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
  if (result.outcomes.some(outcome => outcome.note && !outcome.applied)) {
    return 1;
  }
  return result.onDrift === "block" ? 1 : 0;
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
  for (const name of result.contexts.missing) {
    lines.push(`  MISSING  ${name}  (declared, not required on GitHub)`);
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
 * @param {string|null} flagged An explicit `--repo`.
 * @param {object} config Parsed `.lisa.config.json`.
 * @param {Function} gh Injected runner.
 * @returns {string|null} The repository, or null when nothing resolved it.
 */
export function resolveRepo(flagged, config, gh) {
  if (flagged) return flagged;
  const { org, repo } = config?.github ?? {};
  if (org && repo) return `${org}/${repo}`;
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
    return null;
  }
  const name = result?.ok ? result.stdout.trim() : "";
  return name || null;
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

  const result = reconcile({
    repo: resolveRepo(flag("repo"), config, ghRunner),
    gates,
    policy,
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

if (import.meta.url === `file://${process.argv[1]}`) {
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
