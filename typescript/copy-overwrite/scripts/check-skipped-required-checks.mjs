#!/usr/bin/env node
/**
 * check-skipped-required-checks — refuse a `skip_jobs` token that silences a
 * ruleset-required status check.
 *
 * Shipped by Lisa (copy-overwrite). Generalized from tunnl's TUN-402 guard: the
 * logic is Lisa's and gets updated fleet-wide, the two REVIEWED SNAPSHOTS it
 * rests on are per-repo and live in `.github/required-checks.json` (create-only,
 * yours to edit).
 *
 * Usage:
 *   node scripts/check-skipped-required-checks.mjs [rootDir] [--remote] [--json]
 *
 * ## Why this exists
 *
 * **GitHub counts a `skipped` required status check as SATISFIED.** A job named
 * in a reusable workflow's `skip_jobs` input still reports a green checkmark
 * against its required context, having run zero steps in zero seconds. The merge
 * gate is then decorative: it can never be red, so it can never block anything.
 * A repository in that state looks fully gated while shipping code past a check
 * nobody ever ran.
 *
 * This is measured, not theoretical, in at least two repositories in this
 * portfolio — tunnl (`🔍 Quality Checks / 🧪 Run E2E Tests`, TUN-402) and gemini
 * (ruleset 14297996 requiring `🔍 Quality Checks / 🎭 Playwright E2E Tests`,
 * which `ci.yml` skipped unconditionally, so the ruleset enforced nothing).
 *
 * ## Why this is a DECLARATION guard, not a derivation guard
 *
 * The `skip_jobs` token → context-name map is not derivable inside an adopting
 * repository: the callee workflow is not vendored there, the mapping is not a
 * mechanical transform (one token can silence TWO jobs), and the required-context
 * list exists in NO repo file — it lives in the GitHub ruleset, which humans edit
 * in an admin console.
 *
 * So the guard commits two reviewed snapshots — `required_contexts` and
 * `skip_job_declarations` — and makes them POLICE EACH OTHER. Neither is
 * authoritative alone; the coherence rules below are what stop either rotting
 * into decoration.
 *
 * That mutual policing has one blind spot, and `--remote` exists for it: two
 * snapshots in one repo can only catch each other drifting from the CODE.
 * Neither can see the ruleset itself change in the admin console — which is
 * exactly how tunnl's list silently went from ten contexts to eleven, with every
 * test still green, because the "independent" transcription was made from the
 * same reading at the same moment.
 *
 * `--remote` is opt-in so the ENFORCED path stays offline. A guard that needed
 * network and `gh` auth on every run would flake, and a flaky guard gets
 * skipped — which reintroduces exactly the false-green class this file refuses.
 *
 * ## Exact string equality, everywhere
 *
 * Every comparison here is `===`. Repos routinely carry confusable pairs — an
 * external app's required `SonarCloud Code Analysis` beside a skippable,
 * NOT-required in-workflow `🔍 SonarCloud SAST`; `🧪 Run Tests` beside
 * `🧪 Run Unit Tests`. A `includes` / `startsWith` / case-folded match would
 * report a false positive on a legitimate skip, and the natural fix for a false
 * alarm is to delete the guard.
 *
 * @module scripts/check-skipped-required-checks
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Repo-relative path of the per-repo declaration file. */
export const DECLARATION_PATH = ".github/required-checks.json";

/**
 * Matches a `skip_jobs:` key and captures everything after the colon.
 *
 * The `^` anchor is load-bearing, not decoration. Without it the naive form
 * (`/skip_jobs\s*:\s*(.*)$/`) matches a key sitting inside a YAML COMMENT — and
 * workflow headers routinely quote `skip_jobs` in prose, so the unanchored
 * version really does harvest tokens out of documentation.
 *
 * `[ \t]` rather than `\s`: this matches one already-split LINE, so `\s`'s
 * newline class buys nothing and three adjacent `\s*` runs give a backtracking
 * engine work to do for no gain.
 */
const SKIP_JOBS_LINE = /^[ \t]*skip_jobs[ \t]*:[ \t]*(.*)$/;

/** Matches the tail permitted after a quoted scalar's closing quote. */
const TRAILING_COMMENT_ONLY = /^\s*(?:#.*)?$/;

/** Matches a value that is a GitHub Actions expression, optionally quoted. */
const GITHUB_EXPRESSION = /^(['"]?)\$\{\{([\s\S]*)\}\}\1\s*(?:#.*)?$/;

/**
 * Matches a comparison and its operand — `== 'schedule'`, `!= 'main'`.
 *
 * Deleted from an expression BEFORE literals are read. Without this a
 * condition's own operand reads as a value, and `schedule` / `main` get reported
 * as skip tokens that silence nothing.
 */
const COMPARISON_OPERAND = /[=!]=[ \t]*'[^']*'/g;

/** Matches a single-quoted literal in value position. */
const QUOTED_LITERAL = /'([^']*)'/g;

/** Violation kinds, as stable tokens the tests assert on. */
export const VIOLATIONS = Object.freeze({
  undeclared: "undeclared_skip_token",
  suppressesRequired: "skipped_required_check",
  incoherent: "declaration_understates_requirement",
  stale: "declaration_overstates_requirement",
  orphaned: "orphaned_exemption",
  badExemption: "exemption_without_valid_ticket",
  remoteDrift: "ruleset_snapshot_drift",
});

/**
 * True when a line is a whole-line YAML comment.
 *
 * Redundant with `SKIP_JOBS_LINE`'s anchor today, and kept anyway: the anchor is
 * one character a refactor can delete without noticing, and comment exclusion is
 * the property that actually matters.
 *
 * @param {string} line - A single line
 * @returns {boolean} True when the whole line is a comment
 */
function isCommentLine(line) {
  return line.trimStart().startsWith("#");
}

/**
 * True when text after the colon is not an inline scalar this reader decodes.
 *
 * @param {string} rawValue - Trimmed text after the colon
 * @returns {boolean} True when the value cannot be read inline
 */
function isUnreadableScalar(rawValue) {
  return (
    rawValue === "" ||
    rawValue.startsWith(">") ||
    rawValue.startsWith("|") ||
    rawValue.startsWith("#")
  );
}

/**
 * Strips a surrounding matched quote pair and a trailing ` #` comment.
 *
 * Inside a quoted scalar a `#` is DATA, so the closing quote is located as the
 * first quote whose remainder is empty or a comment. That keeps `'a#b'` intact
 * while still reading `'a,b' # note` — a naive scan truncates the former, and an
 * `endsWith(quote)` test rejects the latter outright and falls through to the
 * bare branch, emitting `'a` and `b'` as two bogus tokens.
 *
 * @param {string} rawValue - Text after the colon, already trimmed
 * @returns {string} The scalar's value, unquoted and un-commented
 */
export function unquoteScalar(rawValue) {
  const quote = rawValue.slice(0, 1);
  if (quote === "'" || quote === '"') {
    for (let at = rawValue.indexOf(quote, 1); at > 0; ) {
      if (TRAILING_COMMENT_ONLY.test(rawValue.slice(at + 1))) {
        return rawValue.slice(1, at);
      }
      at = rawValue.indexOf(quote, at + 1);
    }
  }
  const commentAt = rawValue.indexOf(" #");
  return commentAt === -1 ? rawValue : rawValue.slice(0, commentAt).trim();
}

/**
 * Splits a comma list into unique, non-empty tokens.
 *
 * @param {string} commaList - Tokens joined by commas
 * @returns {string[]} Unique tokens in first-seen order
 */
function tokenize(commaList) {
  const out = [];
  for (const token of commaList.split(",").map(part => part.trim())) {
    if (token !== "" && !out.includes(token)) out.push(token);
  }
  return out;
}

/**
 * Reads every `skip_jobs` token declared in one workflow file.
 *
 * A `${{ … }}` expression is read CONSERVATIVELY: comparison operands are
 * deleted, every remaining single-quoted literal is tokenized, and all of it is
 * treated as reachable. A conditional that skips e2e only on the nightly
 * schedule therefore still demands a declaration. That over-reports rather than
 * under-reports on purpose — an under-reporting guard is the failure mode this
 * file exists to prevent, and the cost of over-reporting is one line in
 * `skip_job_declarations` explaining why the skip is fine.
 *
 * @param {string} contents - Full text of a workflow file
 * @param {string} sourcePath - Repo-relative path, used only to name the file in
 *   a throw. Never an absolute path.
 * @returns {string[]} Every declared skip token, de-duplicated
 * @throws {Error} When a `skip_jobs` key is not an inline scalar
 */
export function readSkipJobs(contents, sourcePath) {
  const all = [];
  contents.split("\n").forEach((line, index) => {
    if (isCommentLine(line)) return;
    const match = SKIP_JOBS_LINE.exec(line);
    if (match === null) return;

    const rawValue = (match[1] ?? "").trim();
    if (isUnreadableScalar(rawValue)) {
      throw new Error(
        `check-skipped-required-checks: cannot read the \`skip_jobs\` value on line ${index + 1} of ${sourcePath} as an inline scalar. Only the inline form (\`skip_jobs: 'a,b'\`, double-quoted, or bare) is understood — a block scalar, a sequence, or a bare key would otherwise read as "nothing is skipped", which is a silent pass rather than a check.`
      );
    }

    const expression = GITHUB_EXPRESSION.exec(rawValue);
    const source =
      expression === null
        ? unquoteScalar(rawValue)
        : [
            ...expression[2]
              .replace(COMPARISON_OPERAND, " ")
              .matchAll(QUOTED_LITERAL),
          ]
            .map(found => found[1])
            .join(",");

    for (const token of tokenize(source)) {
      if (!all.includes(token)) all.push(token);
    }
  });
  return all;
}

/**
 * Loads and validates the per-repo declaration.
 *
 * @param {string} rootDir - Repository root
 * @returns {object} The parsed declaration
 * @throws {Error} When the file is absent or structurally unusable
 */
export function loadDeclaration(rootDir) {
  const path = resolve(rootDir, DECLARATION_PATH);
  if (!existsSync(path)) {
    throw new Error(
      `check-skipped-required-checks: ${DECLARATION_PATH} does not exist. This guard rests on two REVIEWED SNAPSHOTS that cannot be derived from the repository — the ruleset's required contexts, and what each \`skip_jobs\` token silences. Create it (Lisa ships a seed) rather than deleting the guard.`
    );
  }
  const declaration = JSON.parse(readFileSync(path, "utf8"));
  for (const key of [
    "required_contexts",
    "workflows",
    "skip_job_declarations",
  ]) {
    if (declaration[key] === undefined) {
      throw new Error(
        `check-skipped-required-checks: ${DECLARATION_PATH} is missing \`${key}\`.`
      );
    }
  }
  if (!Array.isArray(declaration.required_contexts)) {
    throw new Error(
      `check-skipped-required-checks: \`required_contexts\` must be an array of context strings, transcribed byte for byte from the ruleset (emoji and the \` / \` separator included).`
    );
  }
  if (
    !Array.isArray(declaration.workflows) ||
    declaration.workflows.length === 0
  ) {
    throw new Error(
      `check-skipped-required-checks: \`workflows\` must list at least one workflow file whose \`skip_jobs\` this guard reads.`
    );
  }
  return declaration;
}

/**
 * Reads every skip token across every declared workflow.
 *
 * A declared workflow that does not exist is an ERROR, not an empty read: a
 * guard that silently reads nothing reports a clean bill of health for a
 * repository it never looked at.
 *
 * @param {string} rootDir - Repository root
 * @param {ReadonlyArray<string>} workflows - Repo-relative workflow paths
 * @returns {{tokens: string[], sources: Record<string, string[]>}} Tokens and where each came from
 */
export function collectSkipJobTokens(rootDir, workflows) {
  const tokens = [];
  /** @type {Record<string, string[]>} */
  const sources = {};
  for (const relative of workflows) {
    const path = resolve(rootDir, relative);
    if (!existsSync(path)) {
      throw new Error(
        `check-skipped-required-checks: \`workflows\` names ${relative}, which does not exist. A guard that reads nothing reports a clean bill of health for a repository it never looked at.`
      );
    }
    for (const token of readSkipJobs(readFileSync(path, "utf8"), relative)) {
      if (!tokens.includes(token)) tokens.push(token);
      sources[token] = [...(sources[token] ?? []), relative];
    }
  }
  return { tokens, sources };
}

/**
 * The whole verdict, as a pure function of the two snapshots and what the
 * workflows actually declare.
 *
 * The coherence rules are what stop either snapshot rotting into decoration:
 *
 *  1. Every token a workflow skips must be DECLARED. An undeclared skip is a
 *     skip nobody reviewed.
 *  2. A declaration whose `suppressed_contexts` intersect `required_contexts`
 *     but whose `ruleset_required` says `false` is INCOHERENT — the declaration
 *     is out of date with the ruleset snapshot beside it.
 *  3. A declaration claiming `ruleset_required: true` whose contexts intersect
 *     nothing is STALE — the context was de-required or renamed, and the
 *     declaration is now describing a world that no longer exists.
 *  4. A token that is ACTUALLY SKIPPED and suppresses a required context is the
 *     false green this guard exists to refuse. It fails unless it carries an
 *     exemption naming a real tracker ticket — an exemption is a decision
 *     someone owns, not a way to silence the check.
 *  5. An exemption for a token nobody skips any more is ORPHANED. Deleting it is
 *     one line, and leaving it teaches readers the exemption list is fiction.
 *
 * @param {object} declaration - The per-repo declaration
 * @param {ReadonlyArray<string>} skipped - Tokens the workflows actually skip
 * @returns {{violations: object[], checked: number}} Violations and how many tokens were examined
 */
export function evaluateSkippedRequiredChecks(declaration, skipped) {
  const required = new Set(declaration.required_contexts);
  const declarations = declaration.skip_job_declarations ?? {};
  const ticketPattern = new RegExp(
    declaration.exemption_ticket_pattern ?? "^[A-Z][A-Z0-9]+-\\d+$"
  );
  const violations = [];

  for (const token of skipped) {
    const entry = declarations[token];
    if (!entry) {
      violations.push({
        kind: VIOLATIONS.undeclared,
        token,
        message: `\`${token}\` is skipped but not declared in ${DECLARATION_PATH}. Declare what it silences and whether any of that is ruleset-required — an undeclared skip is a skip nobody reviewed.`,
      });
      continue;
    }
    const suppressed = entry.suppressed_contexts ?? [];
    const hits = suppressed.filter(context => required.has(context));

    if (hits.length > 0 && entry.ruleset_required !== true) {
      violations.push({
        kind: VIOLATIONS.incoherent,
        token,
        message: `\`${token}\` declares \`ruleset_required: false\`, but it suppresses ${hits.map(hit => `"${hit}"`).join(", ")}, which \`required_contexts\` says IS required. One of the two snapshots is out of date — fix the one that is wrong, do not delete the check.`,
      });
    }
    if (hits.length === 0 && entry.ruleset_required === true) {
      violations.push({
        kind: VIOLATIONS.stale,
        token,
        message: `\`${token}\` declares \`ruleset_required: true\`, but none of ${suppressed.map(name => `"${name}"`).join(", ") || "(nothing)"} appears in \`required_contexts\`. The context was renamed or de-required and this declaration now describes a world that no longer exists.`,
      });
    }
    if (hits.length > 0) {
      const exemption = entry.exemption;
      if (!exemption) {
        violations.push({
          kind: VIOLATIONS.suppressesRequired,
          token,
          contexts: hits,
          message: `\`${token}\` silences the ruleset-required context(s) ${hits.map(hit => `"${hit}"`).join(", ")}. GitHub counts a SKIPPED required check as SATISFIED, so that context reports green having run zero steps — the gate is decorative. Fix the suite, de-require the context, or record an exemption with a tracker ticket.`,
        });
      } else if (
        typeof exemption.ticket !== "string" ||
        !ticketPattern.test(exemption.ticket)
      ) {
        violations.push({
          kind: VIOLATIONS.badExemption,
          token,
          message: `\`${token}\` carries an exemption whose ticket ${JSON.stringify(exemption.ticket)} does not match ${ticketPattern}. An exemption is a decision someone owns; without a ticket it is just a way to silence this guard.`,
        });
      }
    }
  }

  for (const [token, entry] of Object.entries(declarations)) {
    if (entry.exemption && !skipped.includes(token)) {
      violations.push({
        kind: VIOLATIONS.orphaned,
        token,
        message: `\`${token}\` carries an exemption but is no longer skipped anywhere. Delete the exemption — leaving it teaches readers that the exemption list is fiction.`,
      });
    }
  }

  return { violations, checked: skipped.length };
}

/**
 * Fetches the live required contexts for every declared ruleset.
 *
 * @param {object} ruleset - `{ repo, ids }` from the declaration
 * @returns {string[]} Live contexts across all declared rulesets
 * @throws {Error} When `gh` is unavailable or the API cannot be read
 */
export function fetchLiveRequiredContexts(ruleset) {
  if (
    !ruleset?.repo ||
    !Array.isArray(ruleset.ids) ||
    ruleset.ids.length === 0
  ) {
    throw new Error(
      `check-skipped-required-checks: --remote needs \`ruleset.repo\` and \`ruleset.ids\` in ${DECLARATION_PATH}.`
    );
  }
  const contexts = [];
  for (const id of ruleset.ids) {
    const raw = execFileSync(
      "gh",
      [
        "api",
        `repos/${ruleset.repo}/rulesets/${id}`,
        "--jq",
        '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context',
      ],
      { encoding: "utf8" }
    );
    for (const line of raw.split("\n").map(value => value.trim())) {
      if (line !== "" && !contexts.includes(line)) contexts.push(line);
    }
  }
  return contexts;
}

/**
 * Diffs the committed snapshot against the live ruleset, in BOTH directions.
 *
 * Both directions matter. A context added in the admin console makes the
 * snapshot UNDER-detect (tunnl's ten-to-eleven drift, unnoticed for a day with
 * every test green). A context removed there makes it OVER-detect, and the
 * obvious fix for a false alarm is to weaken the guard.
 *
 * @param {ReadonlyArray<string>} snapshot - Committed contexts
 * @param {ReadonlyArray<string>} live - Contexts from the API
 * @returns {object[]} Drift violations
 */
export function compareRulesetBaseline(snapshot, live) {
  const added = live.filter(context => !snapshot.includes(context));
  const removed = snapshot.filter(context => !live.includes(context));
  if (added.length === 0 && removed.length === 0) return [];
  return [
    {
      kind: VIOLATIONS.remoteDrift,
      token: null,
      message: `\`required_contexts\` has drifted from the live ruleset.${added.length ? `\n  Live but not committed (the snapshot UNDER-detects): ${added.map(name => `"${name}"`).join(", ")}` : ""}${removed.length ? `\n  Committed but not live (the snapshot OVER-detects): ${removed.map(name => `"${name}"`).join(", ")}` : ""}\n  Update the snapshot and re-read what it now implies about the skip declarations.`,
    },
  ];
}

/**
 * Runs the guard.
 *
 * @param {ReadonlyArray<string>} argv - CLI arguments
 * @returns {{violations: object[], checked: number, tokens: string[]}} The result
 */
export function runGuard(argv) {
  const positional = argv.filter(arg => !arg.startsWith("--"));
  const rootDir = positional[0] ?? process.cwd();
  const declaration = loadDeclaration(rootDir);
  const { tokens } = collectSkipJobTokens(rootDir, declaration.workflows);
  const result = evaluateSkippedRequiredChecks(declaration, tokens);
  const violations = [...result.violations];
  if (argv.includes("--remote")) {
    violations.push(
      ...compareRulesetBaseline(
        declaration.required_contexts,
        fetchLiveRequiredContexts(declaration.ruleset)
      )
    );
  }
  return { violations, checked: result.checked, tokens };
}

/**
 * CLI entry point.
 *
 * @param {ReadonlyArray<string>} argv - Arguments
 * @returns {void}
 */
function main(argv) {
  /** @type {{violations: object[], checked: number, tokens: string[]}} */
  let result;
  try {
    result = runGuard(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (argv.includes("--json")) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: message }, null, 2)}\n`
      );
    } else {
      process.stderr.write(
        `::error title=Skipped-required-check guard::${message}\n`
      );
      process.stdout.write(`❌ ${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (argv.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify({ ok: result.violations.length === 0, ...result }, null, 2)}\n`
    );
    return;
  }

  const lines = ["## 🔒 Skipped required checks", ""];
  if (result.violations.length === 0) {
    lines.push(
      `✅ ${result.checked} \`skip_jobs\` token(s) examined; none silences a ruleset-required status check.`
    );
  } else {
    lines.push(
      `❌ ${result.violations.length} violation(s) across ${result.checked} \`skip_jobs\` token(s):`,
      ""
    );
    for (const violation of result.violations) {
      lines.push(`- **${violation.kind}** — ${violation.message}`);
      process.stderr.write(
        `::error title=${violation.kind}::${violation.message.split("\n")[0]}\n`
      );
    }
  }
  const report = `${lines.join("\n")}\n`;
  process.stdout.write(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    import("node:fs").then(({ appendFileSync }) => {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    });
  }
  if (result.violations.length > 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2));
}
