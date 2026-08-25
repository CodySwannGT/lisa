#!/usr/bin/env node

/**
 * @file Build the `base` branch-ruleset payload from resolved Lisa config.
 *
 * This replaces `all/github-rulesets/base.json`, a shipped template that did
 * two jobs badly.
 *
 * Seven of its fields were ALREADY declared in `.lisa.config.json`'s `policy`
 * block — deletion, non-fast-forward, thread resolution, stale-review
 * dismissal, last-push approval, allowed merge methods, strict status checks.
 * Two writers therefore set the same settings from two files, whichever ran
 * last won, and nothing compared them. Four more fields — `bypass_actors`, the
 * `ref_name` conditions, `required_approving_review_count`, `enforcement` —
 * could not be declared in config at all, so the template's values were a
 * fleet-wide lock no project could override.
 *
 * And it pinned two vendor status checks by integration id, which every
 * repository inherited and none could drop, because the only config hook was
 * `github.rulesets.addRequiredChecks` — additive by construction. A project
 * proving credential leakage with a different scanner had no way to say so,
 * and a required context that nothing posts blocks every pull request in that
 * repository forever.
 *
 * ## Where the required checks come from now
 *
 * From `await` gate declarations, a mode `lisa-gates.mjs` has always carried
 * and nothing used. An awaited gate names a signal somebody else posts:
 *
 * ```json
 * "credential-leakage": {
 *   "pull-request": {
 *     "level": "required",
 *     "await": "GitGuardian Security Checks",
 *     "posted_by": 46505
 *   }
 * }
 * ```
 *
 * `contextsFor` already emits an awaited gate's context verbatim rather than
 * deriving `<workflow> / <label>`, so the same declaration feeds the branch
 * ruleset, the CI façade, and `lisa-reconcile-policy.mjs`'s drift comparison.
 * Declaring nothing requires nothing: that is the override the template could
 * not express.
 *
 * ## Defaults are the old template, minus its vendors
 *
 * A project with no `policy` block gets exactly the ruleset `base.json`
 * described, EXCEPT its two vendor checks. That is the deliberate difference:
 * the shape was never the objectionable part, the un-droppable vendor lock was.
 *
 * Usage:
 *   lisa-ruleset-payload.mjs [--project=PATH] [--moment=pull-request]
 * @module lisa-ruleset-payload
 */

import { invokedAsScript } from "../all/copy-overwrite/scripts/lib/invoked-as-script.mjs";
import {
  readGates,
  resolveMoment,
} from "../all/copy-overwrite/scripts/lisa-gates.mjs";

/**
 * The ruleset this module builds.
 *
 * Named rather than inferred because `lisa-reconcile-policy.mjs` compares the
 * declared `policy.ruleset` block against ONE live ruleset's shape, and a
 * comparison that guessed which one would report drift against whichever
 * ruleset happened to sort first.
 */
export const POLICY_RULESET_NAME = "base";

/**
 * The ruleset shape a project inherits when it declares none.
 *
 * Field-for-field the retired `all/github-rulesets/base.json`, so deleting the
 * template changes nothing for a project that declared nothing. The one
 * omission is its `required_status_checks` list: those two contexts are now
 * `await` declarations, and a default would put the lock straight back.
 */
export const RULESET_DEFAULTS = Object.freeze({
  enforcement: "active",
  include_refs: Object.freeze([
    "~DEFAULT_BRANCH",
    "refs/heads/dev",
    "refs/heads/staging",
    "refs/heads/main",
  ]),
  exclude_refs: Object.freeze([]),
  bypass_actors: Object.freeze([
    Object.freeze({
      actor_id: null,
      actor_type: "DeployKey",
      bypass_mode: "always",
    }),
    Object.freeze({
      actor_id: 5,
      actor_type: "RepositoryRole",
      bypass_mode: "always",
    }),
  ]),
});

/** Pull-request policy defaults, matching the retired template. */
export const REVIEW_DEFAULTS = Object.freeze({
  required_approving_review_count: 0,
  require_code_owner_review: false,
});

/**
 * The review parameter with no default here, on purpose.
 *
 * `require_extra_approval_for_unattributed_changes` is emitted only when the
 * project declares it, and is left out of the payload entirely otherwise. A
 * default of either polarity would be wrong:
 *
 * - `false` would send every repository a loosening it never asked for, and
 *   would flip a live `true` off on the next apply;
 * - `true` would send every repository a tightening it never asked for, and
 *   would make the negative control below impossible — a project that declares
 *   nothing must generate byte-for-byte the payload it generated before this
 *   field was declarable.
 *
 * Omission is not neutral either, and that is the finding rather than a
 * shortcoming of this choice. Measured against the live rulesets API on
 * 2026-08-25 (a `pull_request` rule POSTed to a disabled probe ruleset, then
 * PUT three times): omitted, it came back `true`; sent `false`, it came back
 * `false`; sent omitted again, it came back `true` — GitHub resets it to its
 * own default on every write that does not name it. Declaring it is therefore
 * the ONLY way to hold it at `false`, and the only way to record `true` as a
 * choice rather than as whatever GitHub's default happens to be that week.
 */
const EXTRA_APPROVAL = "require_extra_approval_for_unattributed_changes";

/** Branch-protection defaults, matching the retired template. */
export const PROTECT_DEFAULTS = Object.freeze({
  deletion: true,
  force_push: true,
  conversation_resolution: true,
  dismiss_stale_reviews: false,
  require_last_push_approval: false,
  up_to_date_before_merge: false,
});

/** Merge-method defaults, matching the retired template. */
export const MERGE_DEFAULTS = Object.freeze({
  merge_commit: true,
  squash: false,
  rebase: false,
});

/** GitHub's spelling of each allowed merge method. */
const MERGE_METHODS = Object.freeze({
  merge_commit: "merge",
  squash: "squash",
  rebase: "rebase",
});

/**
 * Read a declared value, falling back to the default.
 * @param {object|undefined} section The declared section.
 * @param {string} field The field name.
 * @param {object} defaults The defaults for that section.
 * @returns {*} The resolved value.
 */
function resolved(section, field, defaults) {
  const declared = section?.[field];
  return declared === undefined ? defaults[field] : declared;
}

/**
 * The awaited signals a project requires at one moment.
 *
 * Only `required` gates. An awaited gate at `optional` says the signal exists
 * and is read, not that a pull request waits for it, and promoting it to a
 * required context would turn advisory information into a merge block nobody
 * declared.
 * @param {object} gates The gates block.
 * @param {string} moment The moment to resolve.
 * @returns {Array<{context: string, integration_id?: number}>} Required checks.
 */
export function awaitedChecks(gates, moment) {
  return resolveMoment({ gates, moment })
    .filter(gate => gate.level === "required" && gate.mode === "await")
    .filter(gate => Boolean(gate.awaits))
    .map(gate =>
      gate.postedBy === null
        ? { context: gate.awaits }
        : { context: gate.awaits, integration_id: gate.postedBy }
    );
}

/**
 * Collapse exact duplicate awaited checks, and refuse conflicting ones.
 *
 * A ruleset carries one entry per context. Two required gates awaiting the same
 * signal is legitimate, so an exact duplicate — same context, same pin, both
 * unpinned included — collapses to one entry. Two DIFFERENT pins for one
 * context cannot both be honoured, and keeping whichever came first would
 * discard a declaration silently: the repository would then require the context
 * pinned to an app the project never named for it.
 *
 * `validateGates` refuses this too. Both, because this function is what
 * actually writes the payload, and a writer that trusts its caller to have
 * validated is a writer that ships the conflict the day some path skips
 * validation.
 * @param {Array<{context: string, integration_id?: number}>} checks Awaited checks.
 * @returns {Array<{context: string, integration_id?: number}>} One per context.
 * @throws {Error} When one context is declared with two different pins.
 */
function collapseAwaited(checks) {
  const byContext = new Map();
  for (const check of checks) {
    const previous = byContext.get(check.context);
    if (previous === undefined) {
      byContext.set(check.context, check);
      continue;
    }
    if ((previous.integration_id ?? null) === (check.integration_id ?? null)) {
      continue;
    }
    throw new Error(
      `"${check.context}" is awaited by two required gates naming different ` +
        `apps (${JSON.stringify(check.integration_id ?? null)} and ` +
        `${JSON.stringify(previous.integration_id ?? null)}). A ruleset carries ` +
        `one entry per context, so one pin would be dropped silently. An ` +
        `omitted posted_by means unpinned, which is a different requirement ` +
        `from a pinned one.`
    );
  }
  return [...byContext.values()];
}

/**
 * The `pull_request` rule, built from `policy.protect` and `policy.review`.
 * @param {object} policy The policy block.
 * @returns {object} The rule.
 */
function pullRequestRule(policy) {
  const merge = policy?.merge ?? {};
  const allowed = Object.entries(MERGE_METHODS)
    .filter(([field]) => resolved(merge, field, MERGE_DEFAULTS) === true)
    .map(([, method]) => method);

  return {
    type: "pull_request",
    parameters: {
      required_approving_review_count: resolved(
        policy?.review,
        "required_approving_review_count",
        REVIEW_DEFAULTS
      ),
      dismiss_stale_reviews_on_push: resolved(
        policy?.protect,
        "dismiss_stale_reviews",
        PROTECT_DEFAULTS
      ),
      require_code_owner_review: resolved(
        policy?.review,
        "require_code_owner_review",
        REVIEW_DEFAULTS
      ),
      require_last_push_approval: resolved(
        policy?.protect,
        "require_last_push_approval",
        PROTECT_DEFAULTS
      ),
      required_review_thread_resolution: resolved(
        policy?.protect,
        "conversation_resolution",
        PROTECT_DEFAULTS
      ),
      // Spread, not `resolved`, because there is no default to resolve to.
      // See EXTRA_APPROVAL: an undeclared project sends no such key at all.
      ...(policy?.review?.[EXTRA_APPROVAL] === undefined
        ? {}
        : { [EXTRA_APPROVAL]: policy.review[EXTRA_APPROVAL] }),
      allowed_merge_methods: allowed,
    },
  };
}

/**
 * Build the ruleset payload GitHub is sent.
 *
 * Deliberately reads only `gates` and `policy`. The per-ruleset opt-ins —
 * `github.rulesets.requiredChecks` and `dropRequiredChecks` — are applied by
 * `scripts/lisa-github-rulesets.sh` to EVERY ruleset it sends, this one
 * included, and applying them here as well would mean two writers with two
 * different defaults for `integration_id` racing over the same list.
 * @param {object} options Build inputs.
 * @param {object} [options.gates] The gates block.
 * @param {object} [options.policy] The policy block.
 * @param {string} [options.moment] Moment to derive awaited checks for.
 * @returns {object} A create/update payload for the `base` ruleset.
 */
export function buildRulesetPayload({
  gates = {},
  policy = {},
  moment = "pull-request",
} = {}) {
  const protect = policy?.protect ?? {};
  const history = policy?.history ?? {};
  const ruleset = policy?.ruleset ?? {};

  const rules = [];
  if (resolved(protect, "deletion", PROTECT_DEFAULTS)) {
    rules.push({ type: "deletion" });
  }
  if (resolved(protect, "force_push", PROTECT_DEFAULTS)) {
    rules.push({ type: "non_fast_forward" });
  }
  if (history.linear === true) rules.push({ type: "required_linear_history" });
  if (history.signed_commits === true) {
    rules.push({ type: "required_signatures" });
  }
  rules.push(pullRequestRule(policy));

  const checks = collapseAwaited(awaitedChecks(gates, moment));

  // An empty required_status_checks rule is not a weaker rule, it is a rule
  // GitHub rejects. Omitting it is also what makes "this project requires no
  // external signal" representable at all, which the template could not say.
  if (checks.length > 0) {
    rules.push({
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: resolved(
          protect,
          "up_to_date_before_merge",
          PROTECT_DEFAULTS
        ),
        do_not_enforce_on_create: false,
        required_status_checks: checks,
      },
    });
  }

  return {
    name: POLICY_RULESET_NAME,
    target: "branch",
    enforcement: resolved(ruleset, "enforcement", RULESET_DEFAULTS),
    conditions: {
      ref_name: {
        exclude: [...resolved(ruleset, "exclude_refs", RULESET_DEFAULTS)],
        include: [...resolved(ruleset, "include_refs", RULESET_DEFAULTS)],
      },
    },
    bypass_actors: [...resolved(ruleset, "bypass_actors", RULESET_DEFAULTS)],
    rules,
  };
}

/**
 * Read a project's config without failing on its absence.
 *
 * A project with no `.lisa.config.json` still gets the default ruleset, which
 * is what the deleted template gave it. Refusing here would turn "no config"
 * into "no branch protection", a silent downgrade at exactly the moment
 * governance is being applied.
 * @param {string} projectPath The project directory.
 * @returns {{gates: object, policy: object}} Resolved config.
 */
export function readProjectConfig(projectPath) {
  const { gates, policy } = readGates(projectPath);
  return { gates, policy };
}

/**
 * CLI entry point: print the payload as JSON.
 */
function main() {
  const argv = process.argv.slice(2);
  const flag = name => {
    const hit = argv.find(arg => arg.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const projectPath = flag("project") ?? process.cwd();
  const { gates, policy } = readProjectConfig(projectPath);
  process.stdout.write(
    `${JSON.stringify(
      buildRulesetPayload({
        gates,
        policy,
        moment: flag("moment") ?? "pull-request",
      }),
      null,
      2
    )}\n`
  );
}

// Not `import.meta.url === process.argv[1]`. Node resolves the module URL
// through realpath while argv[1] keeps whatever spelling the caller typed, so
// on a symlinked path — a macOS temp dir, a git worktree — they differ, main()
// never runs, and this generator prints NOTHING and exits 0. Measured: the
// applier then read an empty template and skipped the only ruleset carrying
// branch protection, reporting success.
if (invokedAsScript(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
