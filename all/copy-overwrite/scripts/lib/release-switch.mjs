// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The always-promotable contract (CodySwannGT/lisa#5188): one definition of
 * the project setting, the work-item declaration and the checks built on them.
 *
 * The rule: whatever is on a shared branch can be promoted to the next
 * environment as it stands. Most changes meet it by being complete and proven
 * when they merge. Only new behavior that merges before it is finished or
 * verified is switched off, and that switch is removed afterwards.
 *
 * Three things live here so that the validators, the writers, the completion
 * checker, the doctor check and the session-start hook cannot drift apart:
 *
 * 1. `release.*` in `.lisa.config.json`. `release.liveUsers` is a fact about
 *    the project, not an "off" flag for a rule: a project with no users has
 *    nothing to protect. Absent means the project HAS live users, and a value
 *    that is not a boolean is reported and treated as `true`, the stricter
 *    option (the same convention as `workItem.estimate.required`).
 * 2. The `## Release Switch` declaration on a work item: live, or switched off
 *    behind a named switch that a named work item removes.
 * 3. The switch-removal check: a work item that owns the removal of a switch
 *    is not finished while tracked source still references that switch.
 *
 * Lisa deliberately knows nothing about any flag service. A project names its
 * mechanism; this module only carries the name to the agent.
 * @module scripts/lib/release-switch
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  markdownSection,
  topLevelLines,
} from "./completion-proof-markdown.mjs";

/** Heading of the work-item section that carries the declaration. */
export const RELEASE_SWITCH_HEADING = "Release Switch";

/** The decision class a project lists in `humanGate.humanOnly` to reserve the production turn-on for a person. */
export const RELEASE_DECISION_CLASS = "feature-release";

/** What an agent uses when a project names no mechanism: a plain configuration value that defaults to off. */
export const FALLBACK_MECHANISM = "config-value";

/** The exact text of the live declaration. */
export const LIVE_DECLARATION = "Live — complete and proven at merge";

/** A switch-removal owner written as the item itself. */
export const THIS_ITEM = "this item";

/** Thrown for input this module cannot act on; the CLI maps it to exit 2. */
export class ReleaseSwitchError extends Error {}

const SWITCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,63}$/;
// One small pattern per tracker shape (owner/repo#12, #12, ENG-12) instead of
// one alternation: each stays linear to match and readable on its own.
const WORK_ITEM_REF_FORMS = [
  /^[\w.-]+\/[\w.-]+#[1-9]\d*$/,
  /^#[1-9]\d*$/,
  /^[A-Z][A-Z0-9]+-[1-9]\d*$/,
];
const isWorkItemRef = value =>
  WORK_ITEM_REF_FORMS.some(form => form.test(value));
// The rendered form uses an em dash. An en dash, a hyphen and a double hyphen
// are read as the same thing, because that is what people and editors type.
const LIVE = /^Live\s*(?:--|[—–-])\s*complete and proven at merge\.?$/i;
const SWITCHED_OFF_LABEL = "switched off";
const REMOVED_BY_LABEL = "removed by";
const DASHES = ["--", "—", "–", "-"];

/**
 * The text after `<label> —`, read with string operations so a long or odd
 * line cannot make a pattern backtrack.
 * @param {string} line - One declaration line.
 * @param {string} label - Lower-case label the line must start with.
 * @returns {string|null} Trimmed remainder, or `null` when the line has another shape.
 */
function afterLabel(line, label) {
  if (!line.toLowerCase().startsWith(label)) return null;
  const rest = line.slice(label.length).trimStart();
  const dash = DASHES.find(candidate => rest.startsWith(candidate));
  return dash === undefined ? null : rest.slice(dash.length).trim();
}

// JIRA descriptions are written in wiki markup, where a section heading is
// `h2. Name` and not `## Name`. Both spellings are the same heading here, so a
// ticket in the JIRA writer's own shape is read like any other.
//
// Wiki code blocks (`{code}` … `{code}`) are deliberately NOT understood. An
// earlier version skipped headings quoted inside them, and every way of
// pairing the markers could be fooled into hiding the real declaration below a
// stray one, which let the done gate close an item whose switch was still in
// use. Without it, a ticket that quotes the section inside a wiki code block
// has two declarations and is refused as ambiguous: it fails closed.
const WIKI_HEADING = /^h([1-6])\.[ \t]+/;

/**
 * A body with wiki-markup headings rewritten as markdown ones, line for line.
 * @param {string} body - Work-item body.
 * @returns {string} The same lines, with `hN. ` headings as `#` headings.
 */
function markdownHeadings(body) {
  return body
    .split("\n")
    .map(line => {
      const wiki = WIKI_HEADING.exec(line);
      return wiki
        ? `${"#".repeat(Number(wiki[1]))} ${line.slice(wiki[0].length)}`
        : line;
    })
    .join("\n");
}

// A `None —` declaration is how `## Target Backend Environment` says the item
// changes no runtime behavior (or is a container). The em dash is the machine
// discriminator the validators already use (gate S8).
const NO_RUNTIME = /^None\s*[—-]/i;

const isObject = value =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const text = value =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readJson = path =>
  existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};

/**
 * The project's Lisa config with `.lisa.config.local.json` layered on top,
 * key by key. One reader for the CLI and the doctor check, so the two cannot
 * disagree about which file wins.
 * @param {string} cwd - Project root.
 * @returns {object} Effective config.
 */
export function readProjectConfig(cwd) {
  const merge = (base, override) => {
    // Only an ABSENT local key falls back. A local `null` is a declared value
    // (an invalid one), read the same way the session-start hook and the
    // completion checker read it.
    if (override === undefined) return base;
    if (!isObject(base) || !isObject(override)) return override;
    const keys = new Set([...Object.keys(base), ...Object.keys(override)]);
    return Object.fromEntries(
      [...keys].map(key => [
        key,
        key in override ? merge(base[key], override[key]) : base[key],
      ])
    );
  };
  const committed = readJson(join(cwd, ".lisa.config.json"));
  // A config file that is not an object is handed back as it is, so the
  // problem can be reported; merging would quietly turn it into `{}`.
  if (!isObject(committed)) return committed;
  return merge(committed, readJson(join(cwd, ".lisa.config.local.json")));
}

/**
 * Problems for keys a settings block carries that Lisa does not read.
 * @param {object} block - The settings block.
 * @param {string[]} known - Keys Lisa reads.
 * @param {string} path - Dotted path of the block, for the message.
 * @returns {string[]} One problem per unknown key.
 */
function unknownKeys(block, known, path) {
  return Object.keys(block)
    .filter(key => !known.includes(key) && !key.startsWith("_"))
    .map(key => {
      const near = known.find(
        candidate => candidate.toLowerCase() === key.toLowerCase()
      );
      return `${path}.${key} is not a setting Lisa reads${near ? `; did you mean ${path}.${near}?` : `; the settings are ${known.map(name => `${path}.${name}`).join(" and ")}.`}`;
    });
}

/**
 * The comparable form of a decision class: lower case, with hyphens,
 * underscores and slashes read as spaces. It mirrors `normalizeGateText` in
 * the plugin's `intake-blocker-reprobe.mjs` (not importable from a shipped
 * script), which is what decides whether a hold naming the class is valid; a
 * test pins the two together. Without it `"Feature Release"` would hold a
 * ticket for a person while this module told the agent to go ahead.
 * @param {unknown} value - A decision class as a project wrote it.
 * @returns {string} Normalized text.
 */
function decisionClassKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[-_/]+/g, " ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/'/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Who turns a finished, switched-off feature on in production: the agent,
 * unless the project reserved that decision for a person by listing
 * `feature-release` in `humanGate.humanOnly`.
 * @param {object} [config] - Effective project config.
 * @returns {"agent"|"human"} Who performs the turn-on.
 */
export function turnOnOwner(config = {}) {
  const declared = config?.humanGate?.humanOnly;
  // A project that wrote the class as a bare string meant to reserve the step.
  // Reading that as "not reserved" would hand a production turn-on to the
  // agent because of a typing mistake, so it is read as a one-item list here
  // and reported by {@link turnOnProblems}.
  const reserved = Array.isArray(declared)
    ? declared
    : typeof declared === "string"
      ? [declared]
      : [];
  const wanted = decisionClassKey(RELEASE_DECISION_CLASS);
  return reserved.some(entry => decisionClassKey(entry) === wanted)
    ? "human"
    : "agent";
}

/**
 * Problems with how the project reserved decisions for a person, as far as
 * they affect the production turn-on.
 * @param {object} [config] - Effective project config.
 * @returns {string[]} Problems, empty when `humanGate.humanOnly` is absent or a list.
 */
export function turnOnProblems(config = {}) {
  const declared = config?.humanGate?.humanOnly;
  return declared === undefined || Array.isArray(declared)
    ? []
    : [
        `humanGate.humanOnly is ${JSON.stringify(declared)}, which is not a list; write it as a list such as ["${RELEASE_DECISION_CLASS}"]. Until then the production turn-on is treated as ${turnOnOwner(config) === "human" ? "reserved for a person" : "the agent's"}.`,
      ];
}

/**
 * Every problem with how a project set this rule up: invalid `release.*`
 * values, a `humanGate.humanOnly` that is not a list, and a production branch
 * that cannot be read while the project is marked as having no live users (the
 * notice that keeps that opt-out visible could then never print). One list for
 * the CLI and the doctor check, so neither reports less than the other.
 * @param {object} [config] - Effective project config.
 * @returns {string[]} Problems, empty when the setup is sound.
 */
export function setupProblems(config = {}) {
  if (!isObject(config))
    return [
      "The Lisa configuration is not a JSON object, so no release setting can be read from it; the project is treated as having live users.",
    ];
  const setting = resolveReleaseSetting(config);
  return [
    ...setting.problems,
    ...turnOnProblems(config),
    ...(!setting.liveUsers && productionBranch(config) === null
      ? [
          "release.liveUsers is false, but deploy.branches does not name one production branch (it has no production environment, or prod and production name different branches), so the notice on production deployments cannot be printed.",
        ]
      : []),
  ];
}

/**
 * Resolve `release.*` from an effective project config.
 *
 * Nothing here throws on a bad value: a malformed setting is reported in
 * `problems` and the stricter reading is used, so one typo cannot silently
 * turn the rule off, and cannot stop a session either.
 * @param {object} [config] - Effective `.lisa.config.json` (local overrides applied).
 * @returns {{liveUsers: boolean, liveUsersSource: "declared"|"default"|"invalid", mechanism: string, mechanismSource: "declared"|"default", guide: string|null, problems: string[]}} Resolved setting.
 */
export function resolveReleaseSetting(config = {}) {
  const declared = isObject(config) ? config.release : undefined;
  const block = isObject(declared) ? declared : {};
  const switchBlock = isObject(block.switch) ? block.switch : {};
  const liveDeclared = Object.hasOwn(block, "liveUsers");
  const liveValid = typeof block.liveUsers === "boolean";
  const mechanism = text(switchBlock.mechanism);
  const problems = [
    ...(declared === undefined || isObject(declared)
      ? []
      : [
          `release is ${JSON.stringify(declared)}, which is not an object; treated as not set.`,
        ]),
    ...(liveDeclared && !liveValid
      ? [
          `release.liveUsers is ${JSON.stringify(block.liveUsers)}, which is not true or false; treated as true (the project has live users).`,
        ]
      : []),
    ...(block.switch === undefined || isObject(block.switch)
      ? []
      : [
          `release.switch is ${JSON.stringify(block.switch)}, which is not an object; treated as not set.`,
        ]),
    ...["mechanism", "guide"].flatMap(key =>
      Object.hasOwn(switchBlock, key) && text(switchBlock[key]) === null
        ? [
            `release.switch.${key} is ${JSON.stringify(switchBlock[key])}, which is not a non-empty string; treated as not set.`,
          ]
        : []
    ),
    // A misspelt key is the quiet way to believe the rule is off when it is
    // not, so every key Lisa does not read is named.
    ...unknownKeys(block, ["liveUsers", "switch"], "release"),
    ...unknownKeys(switchBlock, ["mechanism", "guide"], "release.switch"),
  ];
  return {
    liveUsers: liveValid ? block.liveUsers : true,
    liveUsersSource: !liveDeclared
      ? "default"
      : liveValid
        ? "declared"
        : "invalid",
    mechanism: mechanism ?? FALLBACK_MECHANISM,
    mechanismSource: mechanism === null ? "default" : "declared",
    guide: text(switchBlock.guide),
    problems,
  };
}

/**
 * Whether an item changes runtime behavior, read off its stored
 * `## Target Backend Environment` declaration.
 *
 * An absent section is `underivable`, never "no": reading absence as "no" is
 * the assumption that once made the environment gates undecidable on a live
 * item, and this gate inherits the same case table on purpose.
 * @param {string} body - Work-item body.
 * @returns {"runtime"|"none"|"underivable"} The item's scope.
 */
export function runtimeScope(body) {
  const declaration = markdownSection(
    markdownHeadings(body),
    "Target Backend Environment"
  );
  if (declaration === "") return "underivable";
  return NO_RUNTIME.test(declaration) ? "none" : "runtime";
}

/**
 * Parse the switched-off form's tail: `<switch>; removed by <owner>`.
 * @param {string} tail - Text after `Switched off —`.
 * @returns {{mode: "off", switchName: string, removedBy: string} | {mode: "invalid", problems: string[]}} Parsed form.
 */
function parseSwitchedOff(tail) {
  const [nameText = "", ...rest] = tail.split(";");
  const switchName = nameText.trim();
  const ownerText = rest.join(";").trim();
  const named =
    ownerText.toLowerCase().startsWith(REMOVED_BY_LABEL) &&
    /\s/.test(ownerText[REMOVED_BY_LABEL.length] ?? "");
  const removedBy = named
    ? ownerText.slice(REMOVED_BY_LABEL.length).trim().replace(/\.$/, "")
    : "";
  const ownerValid =
    removedBy.toLowerCase() === THIS_ITEM || isWorkItemRef(removedBy);
  const problems = [
    ...(SWITCH_NAME.test(switchName)
      ? []
      : [
          switchName === ""
            ? "It names no switch."
            : `Switch name ${JSON.stringify(switchName)} must be 3 to 64 letters, digits, dots, colons, slashes, underscores or hyphens, with no spaces.`,
        ]),
    ...(ownerValid
      ? []
      : [
          removedBy === ""
            ? `It does not say which work item removes the switch: end it with "; removed by ${THIS_ITEM}" or "; removed by <work-item ref>".`
            : `${JSON.stringify(removedBy)} is not "${THIS_ITEM}" or a work-item reference such as #123, owner/repo#123 or ENG-123.`,
        ]),
  ];
  return problems.length
    ? { mode: "invalid", problems }
    : {
        mode: "off",
        switchName,
        removedBy:
          removedBy.toLowerCase() === THIS_ITEM ? THIS_ITEM : removedBy,
      };
}

/**
 * Parse an item's `## Release Switch` declaration.
 *
 * The declaration is the whole section, on one line: a second line could say
 * anything, and a checker that read only the first would pass an item whose
 * real plan is in the part it skipped.
 * @param {string} body - Work-item body.
 * @returns {null | {mode: "live"} | {mode: "off", switchName: string, removedBy: string} | {mode: "invalid", problems: string[]}} `null` when the section is absent.
 */
export function parseDeclaration(body) {
  const declaration = markdownSection(
    markdownHeadings(body),
    RELEASE_SWITCH_HEADING,
    { anyCase: true }
  );
  if (declaration === "") return null;
  if (declaration.includes("\n"))
    return {
      mode: "invalid",
      problems: [
        "The declaration must be the only line in the section; move any explanation into Technical Approach.",
      ],
    };
  if (LIVE.test(declaration)) return { mode: "live" };
  const off = afterLabel(declaration, SWITCHED_OFF_LABEL);
  if (off !== null) return parseSwitchedOff(off);
  return {
    mode: "invalid",
    problems: [`${JSON.stringify(declaration)} is neither of the two forms.`],
  };
}

const VALID_FORMS = [
  `  ${LIVE_DECLARATION}`,
  `  Switched off — <switch-name>; removed by ${THIS_ITEM}`,
  "  Switched off — <switch-name>; removed by <work-item ref>",
];

const HOW_TO_CHOOSE =
  "Ask one question: if this were promoted to production right now, would a user see something unfinished or unproven? If no, it is live and needs no switch (bug fixes, small tweaks, refactors and dependency updates are live). If yes, it is switched off.";

/**
 * Gate S22: does this item say how it is safe to promote?
 *
 * `existing` separates the two populations the readiness gates already treat
 * differently. A proposed item with no declaration fails, because the writer
 * can still add one. An item already in the tracker with none is not
 * applicable: failing it would turn every legacy queue red for a section
 * nobody had a way to add.
 * @param {string} body - Work-item body.
 * @param {{liveUsers: boolean}} setting - Resolved `release.*` setting.
 * @param {{existing?: boolean}} [options] - Whether the item is already stored in the tracker.
 * @returns {{verdict: "PASS"|"FAIL"|"N/A", lines: string[]}} Verdict and reader-facing lines.
 */
export function checkDeclaration(body, setting, { existing = false } = {}) {
  if (!setting.liveUsers)
    return {
      verdict: "N/A",
      lines: [
        "This project is marked as having no live users (release.liveUsers is false), so no declaration is needed.",
      ],
    };
  const scope = runtimeScope(body);
  if (scope === "none")
    return {
      verdict: "N/A",
      lines: [
        "The item changes no runtime behavior (or is a container), so there is nothing to promote.",
      ],
    };
  const declaration = parseDeclaration(body);
  if (declaration === null) {
    if (existing || scope === "underivable")
      return {
        verdict: existing ? "N/A" : "FAIL",
        lines: existing
          ? [
              `This existing item has no ## ${RELEASE_SWITCH_HEADING} section. Repair note: whoever claims it adds one of:`,
              ...VALID_FORMS,
            ]
          : [
              "The item has no ## Target Backend Environment section, so whether it changes runtime behavior cannot be read. Add that section first.",
            ],
      };
    return {
      verdict: "FAIL",
      lines: [
        `The item changes runtime behavior but has no ## ${RELEASE_SWITCH_HEADING} section saying how it is safe to promote. Add the section with exactly one of:`,
        ...VALID_FORMS,
        HOW_TO_CHOOSE,
      ],
    };
  }
  if (declaration.mode === "invalid")
    return {
      verdict: "FAIL",
      lines: [
        `The ## ${RELEASE_SWITCH_HEADING} declaration is not valid.`,
        ...declaration.problems,
        "Valid forms:",
        ...VALID_FORMS,
      ],
    };
  return {
    verdict: "PASS",
    lines: [
      declaration.mode === "live"
        ? "Declared live: complete and proven at merge, no switch."
        : `Declared switched off behind ${JSON.stringify(declaration.switchName)}; removed by ${declaration.removedBy}.`,
    ],
  };
}

/**
 * Render the `## Release Switch` section.
 * @param {{mode: string, switchName?: string, removedBy?: string}} input - `live`, or `off` with a switch and its removal owner.
 * @returns {string} The section, ending in a newline.
 */
export function renderDeclaration({ mode, switchName, removedBy = THIS_ITEM }) {
  if (mode === "live")
    return `## ${RELEASE_SWITCH_HEADING}\n\n${LIVE_DECLARATION}\n`;
  if (mode !== "off")
    throw new ReleaseSwitchError(
      `--mode must be live or off, not ${JSON.stringify(mode ?? "")}.`
    );
  const parsed = parseSwitchedOff(
    `${switchName ?? ""}; removed by ${removedBy}`
  );
  if (parsed.mode === "invalid")
    throw new ReleaseSwitchError(parsed.problems.join(" "));
  return `## ${RELEASE_SWITCH_HEADING}\n\nSwitched off — ${parsed.switchName}; removed by ${parsed.removedBy}\n`;
}

/** The declaration heading as a reader compares it: case and spacing do not matter. */
const HEADING_KEY = RELEASE_SWITCH_HEADING.toLowerCase();

/**
 * The comparable name of a top-level heading line.
 * @param {string} line - A trimmed `## Name` line.
 * @returns {string} Lower-case name with runs of whitespace folded.
 */
const headingName = line => {
  const text = line.replace(/^#+/, "").trim();
  // A closing `#` sequence (`## Name ##`) is decoration, not part of the name.
  const bare = text.slice(
    0,
    [...text].findLastIndex(character => character !== "#") + 1
  );
  const name = bare.length < text.length && bare.endsWith(" ") ? bare : text;
  return name.trim().split(/\s+/).join(" ").toLowerCase();
};

/**
 * What survives of an old section when its declaration is replaced: everything
 * after the declaration's own paragraph. Deleting it would lose text a person
 * put there; keeping it means the checker still says it must move.
 * @param {string[]} lines - The old section's lines, heading excluded.
 * @returns {string[]} Lines to keep, with no blank edges.
 */
function keptAfterDeclaration(lines) {
  const first = lines.findIndex(line => line.trim() !== "");
  if (first < 0) return [];
  const gap = lines.findIndex(
    (line, index) => index > first && line.trim() === ""
  );
  if (gap < 0) return [];
  const rest = lines.slice(gap);
  const start = rest.findIndex(line => line.trim() !== "");
  if (start < 0) return [];
  const end = rest.findLastIndex(line => line.trim() !== "");
  return rest.slice(start, end + 1);
}

/**
 * Put a rendered declaration into a body, replacing the one that is there.
 *
 * The section is found the way the parser finds it: top-level headings only, so
 * a quoted example inside a code fence or a comment is never rewritten. The
 * body keeps its own line endings and its own heading spelling (`## Name`, or
 * `h2. Name` in JIRA wiki markup).
 * @param {string} body - Work-item body.
 * @param {string} section - Output of {@link renderDeclaration}.
 * @returns {string} Body with exactly one declaration.
 */
export function upsertDeclaration(body, section) {
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body
    .split("\n")
    .map(line => (line.endsWith("\r") ? line.slice(0, -1) : line));
  const normalized = markdownHeadings(lines.join("\n"));
  const lineAt = offset => normalized.slice(0, offset).split("\n").length - 1;
  const headings = topLevelLines(normalized)
    .filter(row => row.heading)
    .map(row => ({ line: lineAt(row.start), name: headingName(row.text) }));
  const wiki = headings.some(({ line }) => WIKI_HEADING.test(lines[line]));
  const declaration = section.trimEnd().split("\n").at(-1);
  const rendered = [
    `${wiki ? "h2." : "##"} ${RELEASE_SWITCH_HEADING}`,
    "",
    declaration,
  ];
  const matches = headings.filter(({ name }) => name === HEADING_KEY);
  if (matches.length > 1)
    throw new ReleaseSwitchError(
      `The body has more than one ${RELEASE_SWITCH_HEADING} section; remove the extra copies first.`
    );
  if (matches.length === 0)
    return `${lines.join(eol).trimEnd()}${eol}${eol}${rendered.join(eol)}${eol}`;
  const start = matches[0].line;
  const next = headings.find(({ line }) => line > start);
  const end = next ? next.line : lines.length;
  const kept = keptAfterDeclaration(lines.slice(start + 1, end));
  return [
    ...lines.slice(0, start),
    ...rendered,
    ...(kept.length ? ["", ...kept] : []),
    ...(end < lines.length ? ["", ...lines.slice(end)] : [""]),
  ].join(eol);
}

/**
 * The switch this item must remove before it can finish, if any.
 * @param {string} body - Work-item body.
 * @param {string} [ref] - The item's own reference, so `removed by <own ref>` counts too.
 * @returns {null | {switchName: string}} The obligation, or `null`.
 */
export function removalObligation(body, ref) {
  const declaration = parseDeclaration(body);
  if (declaration?.mode !== "off") return null;
  // Tracker references are not case-sensitive (owner/Repo#7 is owner/repo#7),
  // and a remover this item fails to recognise as itself is a gate that never
  // fires.
  const own = [THIS_ITEM, ref, ref?.replace(/^[^#]*(?=#)/, "")]
    .filter(Boolean)
    .map(value => value.toLowerCase());
  return own.includes(declaration.removedBy.toLowerCase())
    ? { switchName: declaration.switchName }
    : null;
}

// A search "in cwd" means cwd's repository. Git run from inside a hook inherits
// GIT_DIR and friends, which would silently point this search at the hook's
// repository instead, so those are dropped.
const gitEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        ![
          "GIT_DIR",
          "GIT_WORK_TREE",
          "GIT_INDEX_FILE",
          "GIT_COMMON_DIR",
        ].includes(name)
    )
  );

const git = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    env: gitEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });

const CHANGELOG_FILE = /^changelog(?:\.(?:md|markdown|txt|rst|adoc))?$/i;

/**
 * Files that are records of work and are never executed, so a mention in one
 * cannot keep a switch alive:
 *
 * - committed evidence, `evidence/<ticket>/…` at the repository root. The
 *   read-back that proves a switch is off in production names the switch.
 * - a changelog (`CHANGELOG`, `CHANGELOG.md`, …), which says what was removed.
 * - Lisa's own machine state under `.lisa/`, such as the learnings ledger.
 *
 * Everything inside those two folders is treated as a record, code included,
 * so nothing that reads a switch belongs there. A submodule that is not
 * checked out has no files to search and is not reported.
 *
 * Everything else counts, prose included: Markdown and MDX can carry template
 * conditionals, a text file can be a flag list, and `ChangelogPage.tsx` or a
 * script sitting directly in `evidence/` is code. This is one definition of
 * "record" for every switch, not a list anyone adds a failing file to.
 * @param {string} path - Repository-relative path.
 * @returns {boolean} True when the file can hold a reference that matters.
 */
function isSource(path) {
  const segments = path.split("/");
  const evidence = segments[0] === "evidence" && segments.length >= 3;
  const machineState = segments[0] === ".lisa" && segments.length >= 2;
  return !(
    evidence ||
    machineState ||
    CHANGELOG_FILE.test(segments.at(-1) ?? "")
  );
}

/**
 * An extended regular expression that matches the switch name as a whole
 * token: not glued to a letter or digit on either side. `new-checkout` then
 * matches `flags["new-checkout"]`, `new-checkout.enabled` and
 * `new-checkout_v2`, and does not match the unrelated `renew-checkout-banner`.
 * @param {string} switchName - A validated switch name.
 * @returns {string} Pattern for `git grep -E`.
 */
const tokenPattern = switchName =>
  `(^|[^A-Za-z0-9])${switchName.replaceAll(".", "[.]")}($|[^A-Za-z0-9])`;

/**
 * The root of the repository `cwd` is in.
 * @param {Function} run - Git runner.
 * @param {string} cwd - A directory inside the repository.
 * @param {Function} failed - Builds the error for a search that cannot run.
 * @returns {string} Absolute path of the repository root.
 */
function repositoryRoot(run, cwd, failed) {
  try {
    return run(["rev-parse", "--show-toplevel"], cwd).trim();
  } catch (error) {
    throw failed(error);
  }
}

/**
 * Tracked source files that still reference a switch.
 *
 * It searches `revision` when one is given (the production commit after a
 * merge) and the working tree otherwise, always from the repository root, in
 * any letter case. `git grep` exits 1 for "no match", which is the answer and
 * not an error; anything else is surfaced, because a search that could not run
 * must never read as "the switch is gone".
 *
 * What it cannot find is a different spelling of the same switch
 * (`NEW_CHECKOUT` for `new-checkout`): a project uses one spelling everywhere.
 * @param {string} switchName - Switch to look for, matched as a whole token.
 * @param {{cwd?: string, revision?: string, run?: Function}} [options] - Where to search; `run` is injectable for tests.
 * @returns {string[]} Repository-relative paths, sorted.
 */
export function switchReferences(
  switchName,
  { cwd = process.cwd(), revision, run = git } = {}
) {
  if (!SWITCH_NAME.test(switchName))
    throw new ReleaseSwitchError(
      `${JSON.stringify(switchName)} is not a valid switch name.`
    );
  const failed = error =>
    new ReleaseSwitchError(
      `Could not search tracked source for ${JSON.stringify(switchName)}: ${String(error?.stderr || error?.message || error).trim()}`
    );
  // The search runs from the repository root with no pathspec at all. Git run
  // from a subfolder searches only that folder, and the `:/` pathspec that
  // would widen it stops meaning "the root" when a hook or alias runs under
  // `git --literal-pathspecs`; either way a switch still in use elsewhere would
  // be reported as gone.
  // A value that starts with a dash would be read by git as an option.
  if (revision !== undefined && !/^[A-Za-z0-9]/.test(revision))
    throw new ReleaseSwitchError(
      `${JSON.stringify(revision)} is not a revision this search accepts.`
    );
  const root = repositoryRoot(run, cwd, failed);
  // The closing `--` with nothing after it still means "the whole tree", and
  // it makes git read the value before it as a revision or fail: without it a
  // folder that happens to carry the same name would be searched instead, and
  // the answer would be "not referenced" for a tree that was never looked at.
  const args = [
    "-C",
    root,
    "grep",
    "-l",
    "-i",
    "-E",
    "-z",
    "--full-name",
    "--recurse-submodules",
    "-e",
    tokenPattern(switchName),
    ...(revision ? [revision] : []),
    "--",
  ];
  try {
    return run(args, cwd)
      .split("\0")
      .filter(Boolean)
      .map(path => (revision ? path.slice(revision.length + 1) : path))
      .filter(isSource)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error?.status === 1) return [];
    throw failed(error);
  }
}

const HEADS_PREFIX = "refs/heads/";

/**
 * A branch name without the `refs/heads/` prefix some tools report.
 * @param {unknown} value - Branch as configured or as reported.
 * @returns {string} Short branch name, or "" when there is none.
 */
const branchName = value => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.startsWith(HEADS_PREFIX)
    ? trimmed.slice(HEADS_PREFIX.length)
    : trimmed;
};

/**
 * The branch that deploys to production.
 *
 * It reads `deploy.branches` the way the completion checker does, so the two
 * agree on what "production" is: environment names are not case-sensitive, a
 * `refs/heads/` prefix is ignored, and a project that configures no deploy
 * branches at all deploys production from its default branch
 * (`policy.repository.default_branch`, else `main`). `prod` and `production`
 * are the same environment; when a project configures both and they name
 * different branches, it means two things and neither is guessed.
 * @param {object} [config] - Effective project config.
 * @returns {string|null} Branch name, or `null` when it cannot be read.
 */
export function productionBranch(config = {}) {
  const configured = isObject(config?.deploy?.branches)
    ? Object.entries(config.deploy.branches)
    : [];
  const mapped = configured
    .map(([environment, branch]) => [
      String(environment).trim().toLowerCase(),
      branchName(branch),
    ])
    .filter(([, branch]) => branch !== "");
  if (mapped.length === 0)
    return text(config?.policy?.repository?.default_branch) ?? "main";
  const production = new Set(
    mapped
      .filter(([environment]) => ["production", "prod"].includes(environment))
      .map(([, branch]) => branch)
  );
  return production.size === 1 ? [...production][0] : null;
}

/**
 * The plain-English notice for a production deployment in a project that is
 * marked as having no live users. It keeps the opt-out visible on the one day
 * it matters most, launch day, without ever blocking a deployment.
 * @param {object} config - Effective project config.
 * @param {string} base - Branch the deployment came from.
 * @returns {string|null} The notice, or `null` when none applies.
 */
export function productionNotice(config, base) {
  const setting = resolveReleaseSetting(config);
  const branch = branchName(base);
  if (setting.liveUsers || branch === "" || branch !== productionBranch(config))
    return null;
  return [
    `Notice: this project is marked as having no live users (release.liveUsers is false in its Lisa configuration: .lisa.config.json, or the local override .lisa.config.local.json), so Lisa's always-promotable rule is off here.`,
    `This deployment from ${branch} went to production, and unfinished work can reach production without being switched off.`,
    "When the project launches, set release.liveUsers to true or remove the line. Nothing was blocked.",
  ].join("\n");
}
