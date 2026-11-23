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

import { markdownSection } from "./completion-proof-markdown.mjs";

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
const WORK_ITEM_REF =
  /^(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*|#[1-9]\d*|[A-Z][A-Z0-9]+-[1-9]\d*)$/;
const LIVE = /^Live\s*[—-]\s*complete and proven at merge\.?$/i;
const SWITCHED_OFF = /^Switched off\s*[—-]\s*(.*)$/i;
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
    if (!isObject(base) || !isObject(override)) return override ?? base;
    const keys = new Set([...Object.keys(base), ...Object.keys(override)]);
    return Object.fromEntries(
      [...keys].map(key => [
        key,
        key in override ? merge(base[key], override[key]) : base[key],
      ])
    );
  };
  return merge(
    readJson(join(cwd, ".lisa.config.json")),
    readJson(join(cwd, ".lisa.config.local.json"))
  );
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
  const declaration = markdownSection(body, "Target Backend Environment");
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
  const owner = /^removed by\s+(.+?)\.?$/i.exec(rest.join(";").trim());
  const removedBy = owner ? owner[1].trim() : "";
  const ownerValid =
    removedBy.toLowerCase() === THIS_ITEM || WORK_ITEM_REF.test(removedBy);
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
  const declaration = markdownSection(body, RELEASE_SWITCH_HEADING);
  if (declaration === "") return null;
  if (declaration.includes("\n"))
    return {
      mode: "invalid",
      problems: [
        "The declaration must be the only line in the section; move any explanation into Technical Approach.",
      ],
    };
  if (LIVE.test(declaration)) return { mode: "live" };
  const off = SWITCHED_OFF.exec(declaration);
  if (off) return parseSwitchedOff(off[1]);
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

/**
 * Put a rendered declaration into a body, replacing the one that is there.
 * @param {string} body - Work-item body.
 * @param {string} section - Output of {@link renderDeclaration}.
 * @returns {string} Body with exactly one declaration.
 */
export function upsertDeclaration(body, section) {
  const heading = `## ${RELEASE_SWITCH_HEADING}`;
  const lines = body.split("\n");
  const starts = lines.flatMap((line, index) =>
    line.trim() === heading ? [index] : []
  );
  if (starts.length > 1)
    throw new ReleaseSwitchError(
      `The body has more than one ${heading} section; remove the extra copies first.`
    );
  if (starts.length === 0) return `${body.trimEnd()}\n\n${section}`;
  const [start] = starts;
  const offset = lines.slice(start + 1).findIndex(line => /^## /.test(line));
  const end = offset < 0 ? lines.length : start + 1 + offset;
  return [
    ...lines.slice(0, start),
    ...section.trimEnd().split("\n"),
    ...(end < lines.length ? ["", ...lines.slice(end)] : [""]),
  ].join("\n");
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
  const own = [THIS_ITEM, ref, ref?.replace(/^[^#]*(?=#)/, "")].filter(Boolean);
  return own.includes(declaration.removedBy)
    ? { switchName: declaration.switchName }
    : null;
}

const git = (args, cwd) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });

/**
 * Tracked files that still reference a switch.
 *
 * It searches `revision` when one is given (the production branch after a
 * merge) and the working tree otherwise. `git grep` exits 1 for "no match",
 * which is the answer and not an error; anything else is surfaced, because a
 * search that could not run must never read as "the switch is gone".
 * @param {string} switchName - Switch to look for, matched as fixed text.
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
  const args = [
    "grep",
    "-l",
    "-F",
    "-z",
    "-e",
    switchName,
    ...(revision ? [revision] : []),
    "--",
  ];
  try {
    return run(args, cwd)
      .split("\0")
      .filter(Boolean)
      .map(path => (revision ? path.slice(revision.length + 1) : path))
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error?.status === 1) return [];
    throw new ReleaseSwitchError(
      `Could not search tracked source for ${JSON.stringify(switchName)}: ${String(error?.stderr || error?.message || error).trim()}`
    );
  }
}

/**
 * The branch that deploys to production, from `deploy.branches`.
 *
 * `prod` and `production` are the same environment, but only when exactly one
 * of them is configured: with both present the project means two things and
 * neither is guessed.
 * @param {object} [config] - Effective project config.
 * @returns {string|null} Branch name, or `null` when it cannot be read.
 */
export function productionBranch(config = {}) {
  const branches = isObject(config?.deploy?.branches)
    ? config.deploy.branches
    : {};
  const keys = ["production", "prod"].filter(key => text(branches[key]));
  return keys.length === 1 ? branches[keys[0]].trim() : null;
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
  if (setting.liveUsers || base !== productionBranch(config)) return null;
  return [
    `Notice: this project is marked as having no live users (release.liveUsers is false in .lisa.config.json), so Lisa's always-promotable rule is off here.`,
    `This deployment from ${base} went to production, and unfinished work can reach production without being switched off.`,
    "When the project launches, set release.liveUsers to true or remove the line. Nothing was blocked.",
  ].join("\n");
}
