#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Threshold ratchet gate — quality thresholds may tighten, never weaken.
 *
 * Deterministic comparator shared by three enforcement layers:
 *   1. Agent-time soft block: PostToolUse hook via threshold-ratchet.sh
 *      (`--hook`, exit 2 on weakening so the agent gets actionable feedback).
 *   2. Pre-commit backstop: husky / lefthook (`--staged`, exit 1).
 *   3. CI gate: reusable quality workflows (`--base <ref>`, exit 1),
 *      comparing against the merge-base so nothing weakened lands in a PR.
 *
 * Tier 1 — designed tunables: vitest/jest/simplecov/e2e thresholds
 * (minimums) and eslint/rubocop thresholds (maximums). Tier 2 — stryker's
 * break score and k6 expression bounds. Tier 3 — exemption additions
 * (stryker mutate exclusions, thresholdRatchet.allow entries) which weaken
 * a gate without touching a number. Audit ignore lists are deliberately NOT
 * watched: the security-audit-handling ladder authorizes agents to add
 * documented entries autonomously, and doctor readiness (B5) audits that
 * every entry carries a written decision.
 *
 * Human override: `.lisa.config.json` → `thresholdRatchet.allow` entries
 * ({ file, key, reason }). Honored ONLY from the baseline side (HEAD /
 * merge-base), never from the change under review — an agent cannot grant
 * itself an exception in the same change that weakens a gate. `key: "*"`
 * allows every key in the file.
 *
 * One exception, and only one: a PROMOTION between deploy-chain branches
 * (`--base` + `--head`, both named in `deploy.branches`, head upstream of
 * base, head fully containing base). There the allow list is read from the
 * head, because the change under review is the baseline plus history that has
 * already passed this same gate. See `isPromotion` for why that is the only
 * discriminator that holds.
 *
 * Extraction lives in threshold-ratchet-families.mjs; comparison rules in
 * threshold-ratchet-compare.mjs. Zero dependencies.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractAllowEntries,
  familyFor,
  parseJson,
} from "./threshold-ratchet-families.mjs";
import {
  applyAllowList,
  compareFile,
  formatReport,
} from "./threshold-ratchet-compare.mjs";

/**
 * Standard git locations, checked in order so the executable comes from a
 * fixed, unwriteable directory rather than a PATH lookup. The bare "git"
 * fallback keeps unusual layouts (e.g. Windows git-bash) working.
 *
 * Order within that constraint is set by measurement, not by convention. On
 * macOS `/usr/bin/git` is not git: it is Apple's `xcrun` shim, which locates a
 * developer directory and re-executes the real binary there. Dispatching
 * through it costs a **median 33 ms against 15 ms** for either
 * developer-directory git, and **100 ms against 21 ms at p90** — randomized
 * call order, fixed inter-call gaps, `git rev-parse --show-toplevel`, n=30 each
 * (lisa#2898). The call does no work at all; the difference is the dispatch.
 *
 * The two entries promoted ahead of it are the developer-directory gits the
 * shim itself re-executes. Both are `root:wheel` files in system locations, so
 * this is the same trust class as `/usr/bin/git` and not a relaxation: the
 * user-writable `/usr/local` and Homebrew entries stay behind it, exactly where
 * they already were. Neither promoted path exists on Linux, so every CI runner
 * resolves precisely what it resolved before.
 */
const GIT_LOCATIONS = [
  "/Library/Developer/CommandLineTools/usr/bin/git",
  "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
  "/usr/bin/git",
  "/usr/local/bin/git",
  "/opt/homebrew/bin/git",
];
const GIT = GIT_LOCATIONS.find(candidate => fs.existsSync(candidate)) ?? "git";

/** Git flag shared by every changed-file listing. */
const NAME_ONLY = "--name-only";
/**
 * Suppress rename detection when discovering changed files.
 *
 * With it on, `git diff --name-only` reports a rename as the destination path
 * only. Moving a watched threshold file to an unwatched path therefore lists
 * one name the ratchet does not watch, and the loosening at the old path is
 * never compared. Both sides have to be visible for the gate to mean anything.
 */
const NO_RENAMES = "--no-renames";

/**
 * Run git, returning stdout or null on any failure.
 *
 * The swallow is CORRECT here and is kept, because #2777 already made the
 * consumer fail closed: a null change set reaches `threshold-ratchet: failing
 * closed — an enforcement gate that cannot read the change set has not verified
 * it`. That comment names the original defect exactly — "git() swallows every
 * failure, so the ratchet passed exactly when it had no evidence" — so a killed
 * child now joins the failures that already refuse. This call site needed the
 * DEADLINE and nothing else.
 *
 * The deadline is written inline rather than imported. This file is
 * materialized from `plugins/src/base/hooks/` into two stack lanes AND runs as
 * an agent-time hook inside a plugin payload, which has no `./lib/` to import
 * from — the same accommodation `preflight-secrets.mjs` makes, and the same one
 * the entry guard below is written out for.
 * @param {string[]} args Git arguments
 * @param {string} [cwd] Working directory
 * @returns {string | null} Captured stdout, or null when git failed
 */
function git(args, cwd) {
  try {
    return execFileSync(GIT, args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      // A hang detector, not a budget. `git` reached through PATH on macOS goes
      // via Apple's xcrun shim, measured over 20s under load in #2887.
      timeout: 30_000,
    });
  } catch {
    // probe-direction: fail-closed — null never reaches a verdict as "no
    // weakening found". `changePlan` turns it into `undeterminable`, which
    // REFUSES, and `isPromotion` falls to the strict reading that keeps the
    // allow list pinned to the baseline.
    return null;
  }
}

/**
 * Resolve mode-specific candidate files and content readers.
 * @param {"hook"|"staged"|"base"} mode Comparison mode
 * @param {string} root Repo root
 * @param {string | undefined} baseRef Base ref (base mode only)
 * @param {string[] | undefined} onlyFiles Restrict to these repo-relative
 *   paths (hook mode with a known edited file)
 * @returns {{ files: string[], baselineRef: string, readCurrent: (f: string) => string | null } | null}
 *   The comparison plan, or null when git state can't support the mode
 */
function resolvePlan(mode, root, baseRef, onlyFiles) {
  if (mode === "staged") {
    const diff = git(["diff", "--cached", NAME_ONLY, NO_RENAMES], root);
    if (diff === null) return null;
    return {
      files: diff.split("\n").filter(Boolean),
      baselineRef: "HEAD",
      readCurrent: f => git(["show", `:${f}`], root),
    };
  }
  if (mode === "base") {
    if (!baseRef) return null;
    const mergeBase = git(["merge-base", baseRef, "HEAD"], root)?.trim();
    if (!mergeBase) return null;
    const diff = git(["diff", NAME_ONLY, NO_RENAMES, mergeBase, "HEAD"], root);
    if (diff === null) return null;
    return {
      files: diff.split("\n").filter(Boolean),
      baselineRef: mergeBase,
      readCurrent: f => git(["show", `HEAD:${f}`], root),
    };
  }
  const diff = git(["diff", NAME_ONLY, NO_RENAMES, "HEAD"], root);
  if (diff === null) return null;
  return {
    files: onlyFiles ?? diff.split("\n").filter(Boolean),
    baselineRef: "HEAD",
    readCurrent: f => {
      try {
        return fs.readFileSync(path.join(root, f), "utf-8");
      } catch {
        // probe-direction: fail-closed — an unreadable current file compares as
        // absent against the baseline, which is the strict side of the ratchet.
        return null;
      }
    },
  };
}

/**
 * Strip a remote prefix so `origin/staging` and `staging` compare equal to a
 * branch name declared in `.lisa.config.json`.
 * @param {string} ref Git ref, possibly remote-qualified
 * @returns {string} Bare branch name
 */
function bareBranch(ref) {
  return ref.replace(/^refs\/heads\//u, "").replace(/^origin\//u, "");
}

/**
 * The deploy chain, earliest environment first, from `deploy.branches`.
 *
 * Declaration order IS the chain order — that is already how Lisa reads it
 * (dev → staging → production), and it is what makes "upstream of" decidable.
 * @param {unknown} config Parsed `.lisa.config.json`
 * @returns {string[]} Branch names in chain order
 */
function deployChain(config) {
  const branches = config?.deploy?.branches;
  if (!branches || typeof branches !== "object") return [];
  return Object.values(branches).filter(b => typeof b === "string" && b !== "");
}

/**
 * Whether this is a promotion of one deploy-chain branch into the next.
 *
 * A promotion carries approved history into a branch that is behind, so the
 * exemptions it brings with it are not new — each one already faced this gate
 * on the upstream branch. Reading the allow list from the baseline there
 * reports every one of them as newly added, and the documented remedy is
 * circular: recording them means adding `thresholdRatchet.allow` entries,
 * which is itself the Tier 3 change being blocked. That deadlocked the whole
 * promotion lane (#2531).
 *
 * The discriminator is branch IDENTITY, not ancestry. "The head contains the
 * base" is true of any ordinary topic branch that is up to date with its base
 * — and a repository with a strict up-to-date branch-protection rule REQUIRES
 * that of every PR — so ancestry alone would hand self-approval to exactly the
 * changes Tier 3 exists to stop. Being a deploy-chain branch cannot be
 * arranged by a topic branch: those branches are protected, so everything on
 * them arrived through a reviewed PR that passed this same ratchet.
 *
 * Ancestry is still required, as a second condition rather than the only one:
 * a head that has diverged from its base is not "the baseline plus approved
 * history", and the strict reading should stand.
 *
 * The chain is read from the BASELINE config, so a change cannot declare
 * itself a promotion by adding `deploy.branches` entries in the same commit.
 * @param {string} root Repo root
 * @param {unknown} baselineConfig `.lisa.config.json` at the baseline
 * @param {string | undefined} baseRef Ref being merged into
 * @param {string | undefined} headRef Ref being merged from
 * @returns {boolean} True when the allow list may be read from the head
 */
function isPromotion(root, baselineConfig, baseRef, headRef) {
  if (!baseRef || !headRef) return false;
  const chain = deployChain(baselineConfig);
  const basePosition = chain.indexOf(bareBranch(baseRef));
  const headPosition = chain.indexOf(bareBranch(headRef));
  if (basePosition === -1 || headPosition === -1) return false;
  if (headPosition >= basePosition) return false;
  // Empty string on success, null when git exits non-zero or the ref is bogus.
  if (git(["merge-base", "--is-ancestor", baseRef, headRef], root) !== null) {
    return true;
  }
  // Both ARE deploy-chain branches, so this is a promotion that has diverged —
  // typically a hotfix that landed on the base and was never synced down. The
  // strict reading is correct here, but silence would leave an operator
  // guessing why this promotion behaves differently from the last one.
  process.stderr.write(
    `threshold-ratchet: ${bareBranch(headRef)} does not contain ` +
      `${bareBranch(baseRef)}, so this promotion is not the baseline plus ` +
      `approved history and the allow list is read from the baseline. Sync ` +
      `${bareBranch(baseRef)} down into ${bareBranch(headRef)} first.\n`
  );
  return false;
}

/**
 * Resolve the allow list and say where it came from.
 * @param {string} root Repo root
 * @param {string} baselineRef Ref the comparison baselines against
 * @param {"hook"|"staged"|"base"} mode Comparison mode
 * @param {string | undefined} baseRef Base ref (base mode only)
 * @param {string | undefined} headRef Head ref (base mode only)
 * @returns {{ entries: object[], promotion: boolean, note: string | null }}
 *   Entries, whether this is a promotion, and an audit line to print when the
 *   entries came from anywhere but the baseline
 */
function resolveAllowList(root, baselineRef, mode, baseRef, headRef) {
  const baselineConfig = parseJson(
    git(["show", `${baselineRef}:.lisa.config.json`], root)
  );
  if (mode !== "base" || !isPromotion(root, baselineConfig, baseRef, headRef)) {
    return {
      entries: extractAllowEntries(baselineConfig),
      promotion: false,
      note: null,
    };
  }
  return {
    entries: extractAllowEntries(
      parseJson(git(["show", "HEAD:.lisa.config.json"], root))
    ),
    promotion: true,
    note:
      `threshold-ratchet: promotion ${bareBranch(headRef)} → ` +
      `${bareBranch(baseRef)}; both are deploy-chain branches declared at ` +
      `${baselineRef} and the head fully contains the base, so the allow list ` +
      `is read from the head. Exemptions below were approved upstream, not by ` +
      `this change.`,
  };
}

/**
 * Split off the allow-entry additions a promotion is carrying forward.
 *
 * `applyAllowList` never drops an `allow-added` finding, from either side —
 * an exception must not approve its own creation. That is right for an
 * ordinary PR and wrong for a promotion, where the entry is not being created:
 * it already exists on the upstream branch, where its creation faced this same
 * unconditional block and needed a human to clear it. Without this the fix
 * would be cosmetic — a promotion carrying an approved exemption also carries
 * the `.lisa.config.json` diff that records it, so it would still be blocked
 * by the finding for the record of its own approval.
 *
 * Only `allow-added` is carried. An actual threshold weakening in the same
 * promotion still has to be covered by an allow entry.
 * @param {Array<{ type: string }>} findings All findings from the change
 * @param {boolean} promotion Whether the change is a recognised promotion
 * @returns {{ carried: object[], rest: object[] }} Findings excused as already
 *   approved upstream, and findings still subject to the allow list
 */
function partitionCarriedEntries(findings, promotion) {
  if (!promotion) return { carried: [], rest: findings };
  return {
    carried: findings.filter(f => f.type === "allow-added"),
    rest: findings.filter(f => f.type !== "allow-added"),
  };
}

/**
 * Decide the exit code when the ratchet cannot determine what changed.
 *
 * `staged` and `base` are enforcement gates — pre-commit and CI. A gate that
 * cannot see the change set has not found the change set clean, and returning 0
 * reports exactly that. It fails closed, loudly.
 *
 * `hook` is advisory feedback to an agent mid-edit, fires on every tool call,
 * and blocks nothing downstream. Failing it closed on a transient git hiccup
 * would turn a hint into an outage, so it stays permissive — but still says so.
 * @param {"hook"|"staged"|"base"} mode Comparison mode
 * @param {string} reason What could not be determined
 * @returns {number} Process exit code
 */
function undeterminable(mode, reason) {
  process.stderr.write(
    `threshold-ratchet: ${reason}; the ratchet could not run in ${mode} mode\n`
  );
  if (mode === "hook") return 0;
  process.stderr.write(
    "threshold-ratchet: failing closed — an enforcement gate that cannot read the change set has not verified it\n"
  );
  return 1;
}

/**
 * Run the ratchet for a mode, print the report, and return the exit code.
 * @param {"hook"|"staged"|"base"} mode Comparison mode
 * @param {string | undefined} [baseRef] Base ref (base mode only)
 * @param {string[] | undefined} [onlyFiles] Restrict to these paths (hook mode)
 * @param {string | undefined} [headRef] Head ref (base mode only), used solely
 *   to recognise a promotion between deploy-chain branches
 * @returns {number} Process exit code (2 for hook mode, 1 otherwise; 0 clean)
 */
function run(mode, baseRef, onlyFiles, headRef) {
  const root = git(["rev-parse", "--show-toplevel"])?.trim();
  if (!root) return undeterminable(mode, "not a git repository");
  const plan = resolvePlan(mode, root, baseRef, onlyFiles);
  if (!plan) return undeterminable(mode, "could not resolve the changed files");

  const watched = plan.files.filter(f => familyFor(f));
  if (watched.length === 0) return 0;

  // A null baseline means one of two opposite things, and they must not be
  // conflated: the file is NEW (nothing to weaken — pass), or it exists at the
  // baseline and could not be read (nothing could be COMPARED — the one case
  // where the ratchet cannot do its job). Both arrive here as null because
  // `git()` swallows every failure, so the ratchet passed exactly when it had
  // no evidence — failing open in its blind spot.
  //
  // `cat-file -e` answers the question `git show` cannot: does this path exist
  // at that ref? Absent means new; present-but-unreadable means undeterminable,
  // and an undeterminable ratchet must refuse rather than wave the change on.
  const unreadable = watched.filter(
    f =>
      git(["show", `${plan.baselineRef}:${f}`], root) === null &&
      git(["cat-file", "-e", `${plan.baselineRef}:${f}`], root) !== null
  );
  if (unreadable.length > 0) {
    return undeterminable(
      mode,
      `could not read the baseline for ${unreadable.join(", ")} — ` +
        `the file exists at ${plan.baselineRef} but its contents could not be ` +
        `retrieved, so a loosened threshold could not be detected`
    );
  }

  const findings = watched.flatMap(f =>
    compareFile(
      f,
      git(["show", `${plan.baselineRef}:${f}`], root),
      plan.readCurrent(f)
    )
  );
  if (findings.length === 0) return 0;

  const allow = resolveAllowList(
    root,
    plan.baselineRef,
    mode,
    baseRef,
    headRef
  );
  const split = partitionCarriedEntries(findings, allow.promotion);
  const { blocked, allowed } = applyAllowList(split.rest, allow.entries);
  if (allow.note) process.stdout.write(`${allow.note}\n`);
  for (const finding of split.carried) {
    process.stdout.write(
      `threshold-ratchet: carried forward by this promotion, approved upstream — ${finding.message}\n`
    );
  }
  for (const finding of allowed) {
    process.stdout.write(
      `threshold-ratchet: allowed by .lisa.config.json exception — ${finding.message}\n`
    );
  }
  if (blocked.length === 0) return 0;
  process.stderr.write(`${formatReport(blocked)}\n`);
  return mode === "hook" ? 2 : 1;
}

/**
 * Handle `--hook` mode: parse the tool-use event from stdin and scope the
 * check to the edited file (Edit/Write/NotebookEdit) or every changed
 * watched file (Bash).
 * @returns {number} Process exit code
 */
function runHookMode() {
  const state = { stdin: "" };
  try {
    state.stdin = fs.readFileSync(0, "utf-8");
  } catch {
    return 0;
  }
  const input = parseJson(state.stdin);
  if (!input || typeof input !== "object") return 0;
  if (input.tool_name === "Bash") return run("hook");
  if (!["Edit", "Write", "NotebookEdit"].includes(input.tool_name)) return 0;
  const filePath = input.tool_input?.file_path;
  if (typeof filePath !== "string") return 0;
  const root = git(["rev-parse", "--show-toplevel"])?.trim();
  if (!root) return 0;
  const rel = path
    .relative(root, path.resolve(filePath))
    .split(path.sep)
    .join("/");
  if (rel.startsWith("..") || !familyFor(rel)) return 0;
  return run("hook", undefined, [rel]);
}

/**
 * CLI entrypoint.
 * @returns {number} Process exit code
 */
function main() {
  const args = process.argv.slice(2);
  const headIndex = args.indexOf("--head");
  const headRef = headIndex === -1 ? undefined : args[headIndex + 1];
  if (args[0] === "--staged") return run("staged");
  // `--head` is optional and additive: a caller that omits it gets exactly the
  // behavior that shipped before promotions were recognised, so an older
  // workflow driving a newer script stays strict rather than silently relaxing.
  if (args[0] === "--base") return run("base", args[1], undefined, headRef);
  if (args[0] === "--hook") return runHookMode();
  process.stderr.write(
    "usage: threshold-ratchet.mjs --hook | --staged | --base <ref> [--head <ref>]\n"
  );
  return 0;
}

/**
 * True when `moduleUrl` names the module node was asked to run.
 *
 * The one implementation of this lives at `scripts/lib/invoked-as-script.mjs`,
 * and every other shipped entry point imports it. This file cannot: it is
 * materialized from `plugins/src/base/hooks/`, where it also runs as an
 * agent-time hook, and a plugin payload has no `./lib/` to import from. So the
 * rule is written out here rather than pointed at — the same accommodation
 * `preflight-secrets.mjs` makes, for the same reason.
 *
 * Both sides are realpath'd. The previous spelling compared
 * `fileURLToPath(import.meta.url)` against `path.resolve(process.argv[1])`, and
 * `resolve` makes a path absolute without following symlinks. `import.meta.url`
 * is the REAL path — node resolves ESM through realpath unless
 * `--preserve-symlinks` or `--preserve-symlinks-main` is set — while `argv[1]`
 * is whatever the caller typed. Reached through a symlinked checkout, a git
 * worktree, or a `/tmp` path on macOS (`/tmp` being a symlink to `/private/tmp`),
 * the two disagreed, `main()` never ran, and the process exited 0.
 *
 * For a CHECK that is a fail-OPEN, not a mild degradation: no output, exit 0,
 * the npm script "succeeds", and the ratchet silently stops having an opinion.
 * It was measured, not theorised — every control in the #2531 promotion tests
 * no-opped until the fixture directory was realpath'd.
 *
 * Realpathing BOTH sides rather than only `argv[1]` matters under
 * `--preserve-symlinks-main`, which tells node not to resolve the main entry:
 * normalizing one side then compares a real path against a symlinked one and
 * answers `false` for an entry point that WAS invoked directly. Any resolution
 * error returns `false` — node loaded the entry from that path moments ago, so
 * a path that will not resolve now is not the path this module came through.
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  process.exit(main());
}
