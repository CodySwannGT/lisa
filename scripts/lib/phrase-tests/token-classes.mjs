/**
 * Which Markdown phrase assertions are load-bearing (CodySwannGT/lisa#4867).
 *
 * A phrase pinned in a skill, rule, agent or command document is one of:
 *
 *  - MACHINE-TOKEN — a marker whose exact spelling shipped code reads. The
 *    document carries it so an agent following the document writes it, and a
 *    script or hook then parses it. Rewording it breaks the parser, so a test
 *    must protect it. Every entry names the parser and a `needle`, the literal
 *    that parser contains; `phrase-tests-token-classes.test.ts` fails if a
 *    parser file stops containing its needle, so a row cannot outlive the code
 *    that justified it.
 *  - STRUCTURAL — document shape that code reads: the frontmatter delimiter
 *    and a frontmatter key whose value is an identifier, not prose.
 *  - WORDING — everything else. Guidance prose needs review, not a test, and a
 *    marker that only agents or tests read is wording too: no parser breaks.
 *
 * Matching is deliberately narrow. A phrase is a token only when the WHOLE
 * phrase is the token (with its argument where the token takes one): a
 * sentence that merely mentions `[lisa-pr-link]` pins the sentence, so it is
 * WORDING. A regular-expression phrase is first reduced to the literal it
 * matches; a pattern with real regex syntax is matched against its source by
 * `sourcePattern` when the row has one, and is WORDING otherwise. Every doubt
 * resolves to WORDING.
 *
 * Markers considered and left out because no shipped code parses them (the
 * only hits are comments, documents or tests): `[lisa-ledger-saturated]`,
 * `[lisa-gardener]`, `[lisa-rejection-candidate]`, `[lisa-learning-drop]`,
 * `[lisa-learning-pr]`, `[lisa-learning-upstream-handoff]`,
 * `[lisa-repair-intake]`, `EVIDENCE-REF` (parse-plan.py deliberately does not
 * match it), and `[lisa-project-ideation]` (the idempotency harness takes the
 * marker as an argument rather than spelling it).
 * @module scripts/lib/phrase-tests/token-classes
 */

/** @typedef {"MACHINE-TOKEN" | "STRUCTURAL" | "WORDING"} PhraseClass */

/**
 * @typedef {object} TokenClass
 * @property {string} id - Stable rule name, reported with each verdict.
 * @property {"MACHINE-TOKEN" | "STRUCTURAL"} cls - The class it confers.
 * @property {RegExp} pattern - Matches the WHOLE literal phrase.
 * @property {RegExp} [sourcePattern] - Matches a regex phrase's source when
 *   the regex cannot be reduced to a literal.
 * @property {readonly string[]} parser - Repository paths of the code that
 *   reads the token.
 * @property {string} needle - A literal every parser file contains.
 */

const MACHINE_TOKEN = "MACHINE-TOKEN";
const STRUCTURAL = "STRUCTURAL";

/** Frontmatter keys the Codex and OpenCode transformers read. */
const FRONTMATTER_KEYS =
  "name|description|argument-hint|allowed-tools|skills|model|tools";

const COMMAND_TRANSFORMER = "src/codex/command-skill-transformer.ts";
const AGENT_TRANSFORMER = "src/opencode/agent-transformer.ts";
const WORK_ITEM_CLI = "all/copy-overwrite/scripts/lisa-work-item.mjs";
const DESIGN_SOURCE_GATE = "plugins/src/base/scripts/design-source-gate.mjs";

/** @type {readonly TokenClass[]} */
export const TOKEN_CLASSES = Object.freeze([
  {
    id: "lisa-pr-link",
    cls: MACHINE_TOKEN,
    pattern: /^\[lisa-pr-link\]$/u,
    parser: [WORK_ITEM_CLI],
    needle: "[lisa-pr-link]",
  },
  {
    id: "lisa-human-gate",
    cls: MACHINE_TOKEN,
    pattern: /^(?:<!-- )?\[lisa-human-gate\](?: reason=\S+)?(?: -->)?$/u,
    parser: [
      "all/copy-overwrite/scripts/lisa-hooks/block-direct-issue-create.sh",
    ],
    needle: 'HUMAN_GATE_MARKER = "[lisa-human-gate]"',
  },
  {
    id: "lisa-ci-failed",
    cls: MACHINE_TOKEN,
    pattern: /^(?:<!-- )?\[lisa-ci-failed\](?: run=\S+)?(?: -->)?$/u,
    parser: ["scripts/lisa-ci-rework-route.mjs"],
    needle: "[lisa-ci-failed]",
  },
  {
    id: "lisa-ci-cleared",
    cls: MACHINE_TOKEN,
    pattern: /^(?:<!-- )?\[lisa-ci-cleared\](?: run=\S+)?(?: -->)?$/u,
    parser: ["scripts/lisa-ci-failure-redispatch.mjs"],
    needle: "lisa-ci-cleared",
  },
  {
    id: "lisa-tracker-claim",
    cls: MACHINE_TOKEN,
    pattern: /^\[lisa-tracker-claim\]$/u,
    parser: ["scripts/lisa-ci-failure-redispatch.mjs"],
    needle: "lisa-tracker-claim",
  },
  {
    id: "lisa-auto-merge-off",
    cls: MACHINE_TOKEN,
    pattern: /^(?:<!-- )?\[lisa-auto-merge-off\](?: -->)?$/u,
    parser: ["plugins/src/base/scripts/pr-arming-sweep.mjs"],
    needle: '"[lisa-auto-merge-off]"',
  },
  {
    id: "lisa-qa-queue",
    cls: MACHINE_TOKEN,
    pattern: /^\[lisa-qa-queue\](?: QA (?:pass|fail))?$/u,
    parser: ["plugins/src/base/scripts/qa-signal-lifecycle.mjs"],
    needle: "lisa-qa-queue",
  },
  {
    id: "lisa-upstream-attribution",
    cls: MACHINE_TOKEN,
    pattern:
      /^(?:<!-- )?\[lisa-upstream-attribution(?:-occurrence)?\](?: key=\S*)?(?: -->)?$/u,
    parser: ["src/core/upstream-attribution-body.ts"],
    needle: "[lisa-upstream-attribution",
  },
  {
    id: "lisa-completion-authorization",
    cls: MACHINE_TOKEN,
    pattern: /^\[lisa-completion-authorization\]$/u,
    parser: ["all/copy-overwrite/scripts/lib/completion-authorization.mjs"],
    needle: "[lisa-completion-authorization]",
  },
  {
    id: "lisa-npm-checkpoint",
    cls: MACHINE_TOKEN,
    pattern: /^\[lisa-npm-checkpoint\]$/u,
    parser: ["all/copy-overwrite/scripts/lib/npm-update-checkpoint.mjs"],
    needle: "[lisa-npm-checkpoint]",
  },
  {
    id: "lisa-npm-filing",
    cls: MACHINE_TOKEN,
    pattern: /^(?:<!-- )?\[lisa-npm-(?:filing|proposal)\]$/u,
    parser: ["all/copy-overwrite/scripts/lib/npm-update-leaf-contract.mjs"],
    needle: "[lisa-npm-filing]",
  },
  {
    id: "work-item-trailer",
    cls: MACHINE_TOKEN,
    pattern: /^Work-Item:(?: \S+)?$/u,
    parser: [WORK_ITEM_CLI],
    needle: "Work-Item:",
  },
  {
    id: "lisa-usage-heading",
    cls: MACHINE_TOKEN,
    pattern: /^## Lisa Usage$/u,
    parser: ["all/copy-overwrite/scripts/lib/usage-ledger.mjs"],
    needle: '"## Lisa Usage"',
  },
  {
    id: "lisa-usage-token",
    cls: MACHINE_TOKEN,
    pattern:
      /^<!-- lisa:usage-(?:entry|entry-measured-subset|rollup)\b[^\n]*$/u,
    parser: ["src/utils/usage-accounting.ts"],
    needle: "<!-- lisa:usage-entry",
  },
  {
    id: "lisa-learnings-contract",
    cls: MACHINE_TOKEN,
    pattern: /^<!-- lisa-learnings-contract:v\d+(?: -->)?$/u,
    parser: ["src/core/learnings-document.ts"],
    needle: "<!-- lisa-learnings-contract:v",
  },
  {
    id: "lisa-review-substitute",
    cls: MACHINE_TOKEN,
    pattern: /^<!-- lisa:review-substitute\b[^\n]*$/u,
    parser: [
      "all/copy-overwrite/scripts/check-third-party-review-evidence.mjs",
    ],
    needle: '"lisa:review-substitute"',
  },
  {
    id: "design-source-none",
    cls: MACHINE_TOKEN,
    pattern:
      /^(?:<!-- )?DESIGN-SOURCE: none — not in Figma(?: — [^\n]+?)?(?: -->)?$/u,
    parser: [DESIGN_SOURCE_GATE],
    needle: 'DESIGN_SOURCE_NONE_MARKER = "DESIGN-SOURCE: none — not in Figma"',
  },
  {
    id: "design-source-figma",
    cls: MACHINE_TOKEN,
    pattern:
      /^(?:<!-- )?DESIGN-SOURCE:(?: (?:<figma-url>|https:\/\/(?:[\w-]+\.)*figma\.com\/\S+))?(?: -->)?$/u,
    parser: [DESIGN_SOURCE_GATE],
    needle: "const ANNOTATION = /DESIGN-SOURCE:",
  },
  {
    id: "local-evidence-claim",
    cls: MACHINE_TOKEN,
    pattern: /^\[(?:EVIDENCE|SCREENSHOT): [^\]\n]+\]$/u,
    parser: ["plugins/src/base/skills/lisa-jira-journey/scripts/parse-plan.py"],
    needle: "(SCREENSHOT|EVIDENCE)",
  },
  {
    id: "frontmatter-delimiter",
    cls: STRUCTURAL,
    pattern: /^---\n?$/u,
    sourcePattern: /^\^---(?:\\n|\$|\\r\?\\n)?$/u,
    parser: [COMMAND_TRANSFORMER, AGENT_TRANSFORMER],
    needle: "---",
  },
  {
    id: "frontmatter-key",
    cls: STRUCTURAL,
    pattern: new RegExp(`^(?:${FRONTMATTER_KEYS}):(?: [\\w@./:-]*)?$`, "u"),
    sourcePattern: new RegExp(
      String.raw`^\^(?:${FRONTMATTER_KEYS}):(?:\\s[*+]| )?(?:\\S\+|\.\+|\.\*)?\$?$`,
      "u"
    ),
    parser: [COMMAND_TRANSFORMER, AGENT_TRANSFORMER],
    needle: "description",
  },
]);

/** Regex metacharacters that make a source more than a literal. */
const METACHARACTERS = new Set("[](){}*+?|^$.");

/**
 * Reduce a regular-expression source to the literal string it matches, when
 * it matches exactly one: escapes of punctuation are unescaped, and a leading
 * `^` / trailing `$` anchor is dropped. Any other syntax returns undefined.
 * @param {string} source - A RegExp source.
 * @returns {string | undefined} The literal, or undefined.
 */
export function literalOf(source) {
  const body = source.replace(/^\^/u, "").replace(/(?<!\\)\$$/u, "");
  let literal = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "\\") {
      const next = body[index + 1];
      if (next === undefined || /[A-Za-z0-9]/u.test(next)) return undefined;
      literal += next;
      index += 1;
    } else if (METACHARACTERS.has(char)) {
      return undefined;
    } else {
      literal += char;
    }
  }
  return literal;
}

/**
 * Classify one pinned phrase.
 * @param {string} phrase - A literal phrase, or a RegExp source when
 *   `isPattern` is set.
 * @param {{ isPattern?: boolean }} [options] - Whether `phrase` is a source.
 * @returns {{ cls: PhraseClass, rule: string, parser: readonly string[] }}
 *   The class, the rule that decided it, and the parser that reads it.
 */
export function classifyPhrase(phrase, { isPattern = false } = {}) {
  const literal = isPattern ? literalOf(phrase) : phrase;
  const row = TOKEN_CLASSES.find(candidate =>
    literal === undefined
      ? candidate.sourcePattern?.test(phrase) === true
      : candidate.pattern.test(literal.trim())
  );
  if (row) return { cls: row.cls, rule: row.id, parser: row.parser };
  return {
    cls: "WORDING",
    rule: literal === undefined ? "regex-prose" : "prose",
    parser: [],
  };
}
