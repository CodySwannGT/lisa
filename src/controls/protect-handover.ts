/**
 * The file that hands a merge-protection change to an administrator.
 *
 * Many organisations do not let a tool change what a repository requires
 * before a merge, and on platforms other than GitHub this command cannot. In
 * both cases the change still has to happen, so it is written down for the
 * person who can make it. That person may never have heard of Lisa. The file
 * therefore says, in plain words: which platform, which repository, which
 * branch, which setting, the exact value, and why.
 *
 * Its content depends only on what was found, never on when: there is no date
 * in it, so a second run that finds the same thing writes the same bytes.
 * @module controls/protect-handover
 */
import type { ProtectedEntry } from "./protect-derive.js";
import {
  GITHUB_ENTERPRISE_PLATFORM,
  platformLabel,
} from "./protect-platform.js";
import {
  GITHUB_PLATFORM,
  UNKNOWN_PLATFORM,
  type PlatformFacts,
  type RequiredCheck,
} from "./protect-types.js";
import { branchName } from "./protect-wording.js";
import { CONTROL_REGISTER_PATH } from "./register-types.js";

/** What the file is written from. */
export interface HandoverFacts {
  readonly platform: PlatformFacts;
  /** The branch to protect, or `null` when none is known. */
  readonly branch: string | null;
  /** Why the change was not made automatically. */
  readonly reason: string;
  /** Every derived check, with where it stands. */
  readonly checks: readonly RequiredCheck[];
  /** The register entries those checks prove. */
  readonly entries: readonly ProtectedEntry[];
}

/**
 * Where the setting usually is, on platforms this command cannot read.
 *
 * These are pointers, not instructions: the command never reads these
 * platforms, their menus move, and each sentence says "usually" for that
 * reason. The line above each one states the setting in words that hold
 * wherever the menu is.
 */
const SETTING_HINTS: Readonly<Record<string, string>> = {
  gitlab:
    'On GitLab this is usually Settings → Merge requests → Merge checks → "Pipelines must succeed", together with a protected-branch rule for the branch.',
  bitbucket:
    "On Bitbucket this is usually Repository settings → Branch restrictions → the restriction for the branch → merge checks → a minimum number of successful builds.",
  "azure-devops":
    "On Azure DevOps this is usually Project settings → Repositories → Policies → the branch policy for the branch → Build validation.",
};

/**
 * Write the platform's name, or say that it is not known.
 * @param platform - The platform facts
 * @returns The words for a sentence
 */
function platformName(platform: PlatformFacts): string {
  return platform.name === UNKNOWN_PLATFORM
    ? "not known (the repository has no remote address on a known platform)"
    : platformLabel(platform.name);
}

/**
 * Tell whether a platform shows GitHub's settings.
 * @param platform - The platform facts
 * @returns Whether the GitHub wording applies
 */
function isGithub(platform: PlatformFacts): boolean {
  return (
    platform.name === GITHUB_PLATFORM ||
    platform.name === GITHUB_ENTERPRISE_PLATFORM
  );
}

/**
 * Name a folder of the repository in a sentence.
 * @param scope - The register entry's scope
 * @returns `the whole repository`, or the folder in backticks
 */
function scopeName(scope: string): string {
  return scope === "." ? "the whole repository" : `\`${scope}\``;
}

/**
 * Say what one gate's entries cover and which requirements they serve.
 * @param gate - The gate's id
 * @param entries - Every protected entry
 * @returns For example `the rule "code-style" for `api` and `web` (SI7)`
 */
function ruleSentence(
  gate: string,
  entries: readonly ProtectedEntry[]
): string {
  const own = entries.filter(item => item.entry.gate === gate);
  const scopes = own.map(item => scopeName(item.entry.scope)).join(" and ");
  const criteria = [...new Set(own.flatMap(item => item.entry.criteria))];
  const serves =
    criteria.length === 0
      ? ""
      : ` (requirement${criteria.length === 1 ? "" : "s"} ${criteria.join(", ")})`;
  return `the rule "${gate}" for ${scopes}${serves}`;
}

/**
 * Say who reports a check.
 * @param check - The check
 * @returns The words for the table
 */
function reporter(check: RequiredCheck): string {
  if (check.source === "workflow") return "GitHub Actions";
  return check.app_id === null
    ? "another app (any source)"
    : `another app (GitHub App id ${String(check.app_id)})`;
}

/** What the "Ready to require" column says for each state that is listed. */
const READINESS: Readonly<Record<string, string>> = {
  missing: "Yes",
  unknown: "Not confirmed",
  "not-ready": "Not yet",
  excluded: "No",
};

/**
 * Write the table of checks to require on GitHub.
 * @param open - The checks that are not required
 * @param entries - Every protected entry
 * @returns The table's lines
 */
function githubTable(
  open: readonly RequiredCheck[],
  entries: readonly ProtectedEntry[]
): readonly string[] {
  return [
    "| Check name | Reported by | Ready to require | What it proves |",
    "| --- | --- | --- | --- |",
    ...open.map(
      check =>
        `| \`${check.context}\` | ${reporter(check)} | ${READINESS[check.state] ?? "Yes"} | It proves ${check.gates.map(gate => ruleSentence(gate, entries)).join("; ")}. |`
    ),
  ];
}

/**
 * Write the notes that explain every check that is not simply ready.
 *
 * Only a check marked "Yes" should be required now. Each other check gets
 * one line saying why, in the words the result document uses for it.
 * @param open - The checks that are not required
 * @returns The notes, followed by a blank line; nothing when all are ready
 */
function readinessNotes(open: readonly RequiredCheck[]): readonly string[] {
  const held = open.filter(check => check.detail !== null);
  const unread = open.some(
    check => check.state === "unknown" && check.detail === null
  );
  return [
    ...(held.length === 0
      ? []
      : [
          'Require only the checks marked "Yes". Do not require the others yet:',
          "",
          ...held.map(
            check => `- \`${check.context}\`: ${String(check.detail)}`
          ),
          "",
        ]),
    ...(unread
      ? [
          '"Not confirmed" means it could not be read whether the check is already required, or whether it has ever run. If it is already required, leave it as it is. Before requiring one, confirm that it has run on the branch itself or on a pull request that was merged into it: a required check that never reports leaves every pull request waiting.',
          "",
        ]
      : []),
  ];
}

/**
 * Write the "The change" section.
 * @param facts - What the file is written from
 * @returns The section's lines
 */
function changeSection(facts: HandoverFacts): readonly string[] {
  const { platform } = facts;
  const on = branchName(facts.branch);
  const setting = isGithub(platform)
    ? `in the repository's Settings, under Rules → Rulesets, the ruleset that applies to ${on} → "Require status checks to pass". If no active ruleset applies to ${on} yet, create a branch ruleset for it with that one rule. Use a ruleset, not a classic branch protection rule: the command that wrote this file reads rulesets only, so it could not confirm a check that is required the classic way.`
    : `the setting that refuses a merge into ${on} until its checks or pipeline have passed (often called branch protection, a merge check or a branch policy). ${SETTING_HINTS[platform.name] ?? ""}`.trim();
  const value = isGithub(platform)
    ? 'every check name listed under "Checks to require", spelled exactly as written there, symbols included.'
    : `turned on for ${on}, for a pipeline that runs every rule listed under "Rules the pipeline must run" on each pull or merge request.`;
  return [
    "## The change",
    "",
    `- Platform: ${platformName(platform)}`,
    `- Repository: ${platform.repository ?? "this repository"}`,
    `- Branch: ${on}`,
    `- Setting: ${setting}`,
    `- Value: ${value}`,
    "",
  ];
}

/**
 * Write the section that lists what to require.
 * @param facts - What the file is written from
 * @returns The section's lines
 */
function checksSection(facts: HandoverFacts): readonly string[] {
  const open = facts.checks.filter(check => check.state !== "required");
  if (isGithub(facts.platform)) {
    return [
      "## Checks to require",
      "",
      ...githubTable(open, facts.entries),
      "",
      ...readinessNotes(open),
    ];
  }
  const gates = [...new Set(open.flatMap(check => check.gates))];
  return [
    "## Rules the pipeline must run",
    "",
    ...gates.map(gate => `- ${ruleSentence(gate, facts.entries)}`),
    "",
    "The tool that wrote this file works out exact check names for GitHub only, so no check names are given here. What matters is that a merge is refused unless a pipeline that runs these rules has passed.",
    "",
  ];
}

/**
 * Write the administrator handover.
 * @param facts - What was found
 * @returns The file content, ending with one newline
 */
export function renderHandover(facts: HandoverFacts): string {
  const required = facts.checks.filter(check => check.state === "required");
  const on = branchName(facts.branch);
  const after =
    isGithub(facts.platform) && facts.platform.reachable
      ? `Run \`lisa controls protect\` in this repository again; read access is enough. It reads the settings back and deletes this file once every check above is required on ${on}.`
      : "The tool that wrote this file cannot read this platform's settings, so it cannot confirm the change for you and it will keep writing this file. Tell whoever asked for the change that it is done.";
  return `${[
    "# Merge protection change needed",
    "",
    "_Written by the command `lisa controls protect`. It is rewritten each time that command runs and deleted when nothing is left to change, so edits made here by hand are lost._",
    "",
    "## Who needs to act",
    "",
    `Someone with administrator access to this repository on its hosting platform (${platformName(facts.platform)}). Nothing else about the tool that wrote this file needs to be known to make the change.`,
    "",
    "## What is being asked",
    "",
    "This repository runs automated checks on every pull request. A check only stops a bad change when the hosting platform refuses to merge until that check has passed, and that refusal is a repository setting. Right now the setting does not cover every check it should.",
    "",
    `The setting was not changed automatically. ${facts.reason}`,
    "",
    ...changeSection(facts),
    ...checksSection(facts),
    ...(required.length === 0
      ? []
      : [
          "## Already required",
          "",
          "These need no change:",
          "",
          ...required.map(check => `- \`${check.context}\``),
          "",
        ]),
    "## Why this matters",
    "",
    `Until the change is made, a pull request can be merged into ${on} while one of these checks is failing or has not run. The repository's control register (\`${CONTROL_REGISTER_PATH}\`) lists each of them as a rule the hosting platform enforces, so at the moment the register says more than the platform does.`,
    "",
    "## When it is done",
    "",
    after,
  ].join("\n")}\n`;
}
