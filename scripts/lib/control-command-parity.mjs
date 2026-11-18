/**
 * Check that the four control commands (audit, configure, enforce, attest)
 * are in place on every coding agent Lisa supports, and that an operator on
 * each agent is told how to start them (CodySwannGT/lisa#5002).
 *
 * `check-plugins-sync.sh` proves the built plugins reproduce from their
 * source. It cannot prove this: a skill dropped from the source, withheld
 * from one agent by its generator's policy file, or left out of the folder an
 * installer copies from regenerates exactly as faithfully as one that is
 * there. So the question is asked directly, of the files each agent is given.
 *
 * ## Who holds what
 *
 * - THIS MODULE holds the requirement: which commands
 *   ({@link CONTROL_COMMANDS}) and which agents ({@link SUPPORTED_AGENTS}). It
 *   is not read from the record below, so neither a command nor an agent can
 *   be dropped by editing a data file.
 * - `parity/control-commands.json` holds the facts about each agent: the
 *   folder its copy is built in or installed from, whether it is given
 *   command files or only the skill under its own name, the form an operator
 *   types, and what the agent cannot do the way a skill describes.
 *
 * ## What is checked, for each agent and each command
 *
 * 1. The skill file is there, is not empty, and goes by the name the agent
 *    starts it with (`lisa-<command>`). For an agent with no command files
 *    that name IS the way in, so it is the hyphenated alias the ticket asks
 *    for.
 * 2. Where the agent is given command files, the command file is there and
 *    hands over to that skill.
 * 3. Where the agent's copy is installed rather than built (OpenCode), the
 *    installer's own policy file does not withhold the skill. That the
 *    installer then copies it to where the agent reads it is proved by
 *    running the installer, in
 *    `tests/unit/opencode/control-commands-install.test.ts`.
 * 4. The agent's own copy of the skill says, in its "Running it." paragraph,
 *    in a sentence that names the agent, the form that agent's operator types.
 * 5. Every difference the record lists for the agent and the skill is stated
 *    in the copy's "Where coding agents differ" list, and every entry of that
 *    list that names the agent is in the record. A gap can be dropped from
 *    neither place without the other failing.
 *
 * Every violation names the agent and the skill.
 *
 * The enforcing surfaces are `bun run check:plugins`, which runs
 * `scripts/check-control-command-parity.mjs` at its end, and the vitest suites
 * `tests/unit/plugins/control-command-*.test.ts`, which break one thing at a
 * time in a copy and assert the check says so.
 * @module scripts/lib/control-command-parity
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The facts recorded about one coding agent.
 * @typedef {object} ParityAgent
 * @property {string} id The agent, as the `harness` setting names it.
 * @property {string} name The agent, as the skills name it to an operator.
 * @property {"built" | "installed"} delivery Whether the plugin build writes
 *   the agent's own folder, or an installer copies from another's.
 * @property {string} source The folder the agent's copy is in, or is
 *   installed from, from the repository root.
 * @property {string} skill The skill file below `source`; `{command}` stands
 *   for the command.
 * @property {string | null} command The command file below `source`, or null
 *   for an agent that is given none.
 * @property {string} invocation What an operator types; `{command}` stands
 *   for the command.
 * @property {{ by: string[], withheld_by: string, skill: string, command: string }} [installed]
 *   For an installed agent: the installer's source files, its policy file,
 *   and where the skill and the command land in a host repository.
 */

/**
 * One thing an agent cannot do the way a skill describes.
 * @typedef {object} ParityDifference
 * @property {string} id A stable name for the difference.
 * @property {string[]} skills The skills it applies to.
 * @property {string[]} agents The agents it applies to, by id.
 * @property {string} step The step of the skill it is about.
 * @property {string} difference What differs and what happens instead.
 * @property {string} stated_as Words the skill's own list entry must hold.
 */

/**
 * The record the check reads.
 * @typedef {object} ParityFixture
 * @property {ParityAgent[]} agents One entry for each coding agent.
 * @property {ParityDifference[]} differences What agents cannot do as described.
 */

/**
 * One thing that is wrong.
 * @typedef {object} ParityViolation
 * @property {string} kind One of {@link VIOLATION}.
 * @property {string} agent The agent, by the name an operator knows.
 * @property {string} skill The skill, for example `lisa-attest`.
 * @property {string} detail What is wrong, naming the file.
 */

/**
 * One command as one agent is given it.
 * @typedef {object} ParityRow
 * @property {string} command For example `attest`.
 * @property {string} skill For example `lisa-attest`.
 * @property {string} invocation What an operator on this agent types.
 * @property {string[]} files The files that carry it, from the root.
 * @property {boolean} present Whether nothing is wrong with it.
 */

/**
 * What one agent is given.
 * @typedef {object} ParityAgentResult
 * @property {string} id The agent, as the `harness` setting names it.
 * @property {string} name The agent, as the skills name it to an operator.
 * @property {"built" | "installed"} delivery How the agent's copy reaches it.
 * @property {string} source The folder its copy is in, or is installed from.
 * @property {string[]} installedBy The installer's source files, when installed.
 * @property {"command" | "skill-alias"} surface Whether an operator starts
 *   it through a command file or by the skill's own name.
 * @property {ParityRow[]} commands The four commands, in the order they are run.
 */

/**
 * The result of one check.
 * @typedef {object} ParityResult
 * @property {string} fixture The record that was read, from the root.
 * @property {string[]} problems Why the check could not be carried out.
 * @property {ParityAgentResult[]} agents What each agent is given.
 * @property {number} differences How many differences the record holds.
 * @property {ParityViolation[]} violations What is wrong, naming agent and skill.
 */

/** Repository root, derived from this file's own location. */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/** The record of per-agent facts, from the repository root. */
export const PARITY_FIXTURE = "parity/control-commands.json";

/** The four commands every agent must be given, in the order they are run. */
export const CONTROL_COMMANDS = Object.freeze([
  "audit",
  "configure",
  "enforce",
  "attest",
]);

/**
 * The coding agents Lisa supports, as the `harness` setting names them.
 * `tests/unit/plugins/control-command-parity.test.ts` holds this equal to
 * `CODING_AGENTS` in `src/controls/coding-agents.ts`.
 */
export const SUPPORTED_AGENTS = Object.freeze([
  "claude",
  "codex",
  "cursor",
  "agy",
  "copilot",
  "opencode",
  "devin",
]);

/**
 * The first line of a failure. Declared as this repository's
 * `x-plugin-artifact-sync` failure shape, so the gate runner reports a
 * failure of this check as a failure rather than as a run it could not read.
 */
export const FAILURE_HEADING =
  "✗ The four control commands are not in place on every coding agent.";

/** How a skill opens the paragraph that says how each agent starts it. */
export const RUNNING_HEADING = "**Running it.**";

/** How a skill opens its list of what agents cannot do as described. */
export const DIFFERENCES_HEADING = "**Where coding agents differ.**";

/** The kinds of violation. */
export const VIOLATION = Object.freeze({
  AGENT_NOT_RECORDED: "agent-not-recorded",
  SKILL_MISSING: "skill-missing",
  ALIAS_MISNAMED: "alias-misnamed",
  COMMAND_MISSING: "command-missing",
  COMMAND_NOT_WIRED: "command-not-wired",
  SKILL_WITHHELD: "skill-withheld",
  INVOCATION_NOT_STATED: "invocation-not-stated",
  DIFFERENCE_NOT_STATED: "difference-not-stated",
  DIFFERENCE_NOT_RECORDED: "difference-not-recorded",
});

/** What stands for the command in a recorded path or form. */
const COMMAND_SLOT = "{command}";

/** The two ways an agent's copy reaches it. */
const DELIVERIES = Object.freeze(["built", "installed"]);

/**
 * The skill a command hands over to.
 * @param {string} command For example `attest`.
 * @returns {string} For example `lisa-attest`.
 */
export function skillNameOf(command) {
  return `lisa-${command}`;
}

/**
 * Put a command into a recorded path or form.
 * @param {string} template Text holding `{command}`.
 * @param {string} command The command.
 * @returns {string} The text for that command.
 */
function fill(template, command) {
  return template.replaceAll(COMMAND_SLOT, command);
}

/**
 * Join path pieces the way they are written in reports.
 * @param {...string} pieces Repository-relative pieces.
 * @returns {string} One repository-relative path with forward slashes.
 */
function joined(...pieces) {
  return path.posix.join(...pieces);
}

/**
 * Tell whether a value is non-blank text.
 * @param {unknown} value Any value.
 * @returns {value is string} Whether it is.
 */
function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Tell whether a recorded path stays inside the repository.
 * @param {unknown} value The recorded path.
 * @returns {boolean} Whether it is relative and never climbs out.
 */
function staysInside(value) {
  return (
    isText(value) &&
    !path.posix.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}

/**
 * Read a file below a root.
 * @param {string} root Absolute root.
 * @param {string} relative Repository-relative path.
 * @returns {string | null} Its text, or null when it is absent or blank.
 */
function readText(root, relative) {
  const file = path.join(root, ...relative.split("/"));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  const text = fs.readFileSync(file, "utf8");
  return text.trim() === "" ? null : text;
}

/**
 * Say what is wrong with one recorded agent.
 * @param {unknown} agent The entry.
 * @param {number} index Its position, for the message.
 * @returns {string[]} One sentence per problem.
 */
function agentProblems(agent, index) {
  const where = `${PARITY_FIXTURE}: agents[${index}]`;
  if (agent === null || typeof agent !== "object") {
    return [`${where} is not an object.`];
  }
  const entry = /** @type {Record<string, unknown>} */ (agent);
  const problems = [];
  for (const key of ["id", "name", "invocation"]) {
    if (!isText(entry[key])) problems.push(`${where}.${key} must be text.`);
  }
  if (isText(entry.id) && !SUPPORTED_AGENTS.includes(entry.id)) {
    problems.push(
      `${where}.id "${entry.id}" is not a coding agent Lisa supports (${SUPPORTED_AGENTS.join(", ")}).`
    );
  }
  if (!DELIVERIES.includes(/** @type {string} */ (entry.delivery))) {
    problems.push(`${where}.delivery must be one of ${DELIVERIES.join(", ")}.`);
  }
  if (!staysInside(entry.source)) {
    problems.push(`${where}.source must be a path inside the repository.`);
  }
  const templates = [
    ["skill", entry.skill],
    ["invocation", entry.invocation],
    ...(entry.command === null ? [] : [["command", entry.command]]),
  ];
  for (const [key, value] of templates) {
    if (!isText(value) || !value.includes(COMMAND_SLOT)) {
      problems.push(`${where}.${key} must hold ${COMMAND_SLOT}.`);
    }
  }
  if (entry.delivery === "installed") {
    problems.push(...installedProblems(entry.installed, where));
  }
  return problems;
}

/**
 * Say what is wrong with the record of how an agent's copy is installed.
 * @param {unknown} installed The `installed` entry.
 * @param {string} where The entry it belongs to, for the message.
 * @returns {string[]} One sentence per problem.
 */
function installedProblems(installed, where) {
  if (installed === null || typeof installed !== "object") {
    return [
      `${where}.installed must say which code installs the agent's copy.`,
    ];
  }
  const entry = /** @type {Record<string, unknown>} */ (installed);
  const by = Array.isArray(entry.by) ? entry.by : [];
  return [
    ...(by.length > 0 && by.every(staysInside)
      ? []
      : [`${where}.installed.by must list the installer's source files.`]),
    ...(staysInside(entry.withheld_by)
      ? []
      : [
          `${where}.installed.withheld_by must name the installer's policy file.`,
        ]),
  ];
}

/**
 * Say what is wrong with one recorded difference.
 * @param {unknown} difference The entry.
 * @param {number} index Its position, for the message.
 * @param {string[]} agentIds The agents the record holds.
 * @returns {string[]} One sentence per problem.
 */
function differenceProblems(difference, index, agentIds) {
  const where = `${PARITY_FIXTURE}: differences[${index}]`;
  if (difference === null || typeof difference !== "object") {
    return [`${where} is not an object.`];
  }
  const entry = /** @type {Record<string, unknown>} */ (difference);
  const skills = Array.isArray(entry.skills) ? entry.skills : [];
  const agents = Array.isArray(entry.agents) ? entry.agents : [];
  const known = CONTROL_COMMANDS.map(skillNameOf);
  return [
    ...["id", "step", "difference", "stated_as"]
      .filter(key => !isText(entry[key]))
      .map(key => `${where}.${key} must be text.`),
    ...(skills.length > 0 && skills.every(skill => known.includes(skill))
      ? []
      : [`${where}.skills must list one or more of ${known.join(", ")}.`]),
    ...(agents.length > 0 && agents.every(agent => agentIds.includes(agent))
      ? []
      : [`${where}.agents must list one or more agents the record holds.`]),
  ];
}

/**
 * Find the values that appear more than once.
 * @param {string[]} values The values.
 * @returns {string[]} Each repeated value, once.
 */
function repeated(values) {
  return [
    ...new Set(values.filter((value, at) => values.indexOf(value) !== at)),
  ];
}

/**
 * Read the record of per-agent facts.
 * @param {string} [root] Root to read it below.
 * @returns {{ fixture: ParityFixture | null, problems: string[] }} The record,
 *   or null with the reasons it cannot be relied on.
 */
export function readParityFixture(root = REPO_ROOT) {
  const text = readText(root, PARITY_FIXTURE);
  if (text === null) {
    return {
      fixture: null,
      problems: [`${PARITY_FIXTURE} is missing or empty.`],
    };
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      fixture: null,
      problems: [
        `${PARITY_FIXTURE} is not valid JSON: ${/** @type {Error} */ (error).message}`,
      ],
    };
  }
  const document = /** @type {Record<string, unknown>} */ (parsed ?? {});
  const agents = Array.isArray(document.agents) ? document.agents : [];
  const differences = Array.isArray(document.differences)
    ? document.differences
    : null;
  const agentIds = agents
    .map(agent => agent?.id)
    .filter(id => typeof id === "string");
  const problems = [
    ...(agents.length === 0
      ? [`${PARITY_FIXTURE}: "agents" must list the coding agents.`]
      : []),
    ...(differences === null
      ? [`${PARITY_FIXTURE}: "differences" must be a list.`]
      : []),
    ...agents.flatMap(agentProblems),
    ...repeated(agentIds).map(
      id => `${PARITY_FIXTURE}: the agent "${id}" is recorded twice.`
    ),
    ...(differences ?? []).flatMap((difference, index) =>
      differenceProblems(difference, index, agentIds)
    ),
    ...repeated((differences ?? []).map(difference => difference?.id)).map(
      id => `${PARITY_FIXTURE}: the difference "${id}" is recorded twice.`
    ),
  ];
  return problems.length > 0
    ? { fixture: null, problems }
    : { fixture: /** @type {ParityFixture} */ (parsed), problems: [] };
}

/**
 * Every file the check reads besides the record itself.
 * @param {ParityFixture} fixture The record.
 * @returns {string[]} Repository-relative paths, each once, sorted.
 */
export function controlCommandFiles(fixture) {
  const files = fixture.agents.flatMap(agent => [
    ...CONTROL_COMMANDS.flatMap(command => [
      joined(agent.source, fill(agent.skill, command)),
      ...(agent.command === null
        ? []
        : [joined(agent.source, fill(agent.command, command))]),
    ]),
    ...(agent.installed === undefined
      ? []
      : [...agent.installed.by, agent.installed.withheld_by]),
  ]);
  return [...new Set(files)].sort();
}

/**
 * The name a skill file gives itself.
 * @param {string} text The skill file.
 * @returns {string | null} Its frontmatter `name`, or null when it has none.
 */
function declaredName(text) {
  const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(text)?.[1] ?? "";
  const name = /^name:[ \t]*(.+?)[ \t]*$/mu.exec(frontmatter)?.[1] ?? null;
  return name === null ? null : name.replace(/^(["'])(.*)\1$/u, "$2");
}

/**
 * Tell whether text names an agent as a word of its own.
 * @param {string} text The text.
 * @param {string} name The agent's name.
 * @returns {boolean} Whether it does.
 */
function names(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, "u").test(text);
}

/**
 * The sentences of the paragraph that says how each agent starts the skill.
 * @param {string} text The skill file.
 * @returns {string[]} Its sentences; empty when the skill has no such paragraph.
 */
function runningSentences(text) {
  const at = text.indexOf(RUNNING_HEADING);
  if (at === -1) return [];
  const paragraph = text
    .slice(at + RUNNING_HEADING.length)
    .split(/\n[ \t]*\n/u)[0];
  return (paragraph ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .split(/(?<=[.!?]) (?=[A-Z])/u);
}

/**
 * The entries of a skill's list of what agents cannot do as described.
 * @param {string} text The skill file.
 * @returns {{ agents: string[], text: string }[]} Each entry with the agents
 *   its opening names; an entry that names none has an empty list.
 */
function differenceEntries(text) {
  const at = text.indexOf(DIFFERENCES_HEADING);
  if (at === -1) return [];
  /** @type {string[]} */
  const entries = [];
  const lines = text.slice(at).split("\n").slice(1);
  for (const line of lines) {
    if (/^#{1,6} /u.test(line)) break;
    if (line.startsWith("- ")) entries.push(line);
    else if (line.trim() === "") continue;
    else if (/^\s/u.test(line) && entries.length > 0) {
      entries[entries.length - 1] += ` ${line.trim()}`;
    } else if (entries.length > 0) break;
  }
  return entries.map(entry => {
    const lead = /^- \*\*(.+?):\*\*/u.exec(entry)?.[1] ?? "";
    return {
      agents: lead
        .split(/,|\band\b/u)
        .map(name => name.trim())
        .filter(Boolean),
      text: entry.replace(/\s+/gu, " "),
    };
  });
}

/**
 * The skills an installer's policy file withholds.
 *
 * Read exactly as the installer reads it (`loadSkillDenylist` in
 * `src/core/lisa-skill-sources.ts`): a file that is absent, unreadable or
 * holds no list withholds nothing.
 * @param {string} root Absolute root.
 * @param {string} policy The policy file, from the root.
 * @returns {string[]} The withheld skill names.
 */
function withheldSkills(root, policy) {
  const text = readText(root, policy);
  if (text === null) return [];
  try {
    const listed = JSON.parse(text)?.denylistedSkills;
    return Array.isArray(listed)
      ? listed.filter(name => typeof name === "string")
      : [];
  } catch {
    // The installer treats a policy file it cannot parse as withholding
    // nothing. Reading it more strictly here would report a skill withheld
    // that is in fact installed.
    return [];
  }
}

/**
 * Check what one agent's copy of a skill says about that agent.
 * @param {object} subject What is being checked.
 * @param {ParityFixture} subject.fixture The record.
 * @param {ParityAgent} subject.agent The agent.
 * @param {string} subject.command The command.
 * @param {string} subject.file The agent's copy of the skill, from the root.
 * @param {string} subject.text That file's text.
 * @returns {{ kind: string, agent: string, detail: string }[]} What is wrong.
 */
function statementViolations({ fixture, agent, command, file, text }) {
  const skill = skillNameOf(command);
  const form = fill(agent.invocation, command);
  const found = [];
  if (declaredName(text) !== skill) {
    found.push({
      kind: VIOLATION.ALIAS_MISNAMED,
      agent: agent.name,
      detail: `${file} does not name itself ${skill}, the name ${agent.name} starts it by (${form}).`,
    });
  }
  const stated = runningSentences(text).some(
    sentence => names(sentence, agent.name) && sentence.includes(`\`${form}\``)
  );
  if (!stated) {
    found.push({
      kind: VIOLATION.INVOCATION_NOT_STATED,
      agent: agent.name,
      detail: `${file} does not say how ${agent.name} runs it. Its "${RUNNING_HEADING}" paragraph needs a sentence that names ${agent.name} and holds \`${form}\`.`,
    });
  }
  const entries = differenceEntries(text);
  const recorded = fixture.differences.filter(
    difference =>
      difference.skills.includes(skill) && difference.agents.includes(agent.id)
  );
  const mine = entries.filter(entry => entry.agents.includes(agent.name));
  for (const difference of recorded) {
    if (mine.some(entry => entry.text.includes(difference.stated_as))) continue;
    found.push({
      kind: VIOLATION.DIFFERENCE_NOT_STATED,
      agent: agent.name,
      detail: `${file} does not state the difference ${PARITY_FIXTURE} records as "${difference.id}": ${difference.difference} Its "${DIFFERENCES_HEADING}" list needs an entry that names ${agent.name} and holds ${difference.stated_as}.`,
    });
  }
  for (const entry of mine) {
    if (recorded.some(difference => entry.text.includes(difference.stated_as)))
      continue;
    found.push({
      kind: VIOLATION.DIFFERENCE_NOT_RECORDED,
      agent: agent.name,
      detail: `${file} states a difference for ${agent.name} that ${PARITY_FIXTURE} does not record for ${skill}: "${entry.text}". Record it there, with the words the entry holds as "stated_as".`,
    });
  }
  const known = fixture.agents.map(candidate => candidate.name);
  for (const entry of entries) {
    const strangers =
      entry.agents.length === 0
        ? ["an agent it does not name"]
        : entry.agents.filter(name => !known.includes(name));
    for (const stranger of strangers) {
      found.push({
        kind: VIOLATION.DIFFERENCE_NOT_RECORDED,
        agent: stranger,
        detail: `${file} states a difference for ${stranger}, and ${PARITY_FIXTURE} records no such agent: "${entry.text}". An entry opens with the agents it is about, in bold, as the record names them (${known.join(", ")}).`,
      });
    }
  }
  return found;
}

/**
 * Check one command as one agent is given it.
 * @param {string} root Absolute root.
 * @param {ParityFixture} fixture The record.
 * @param {ParityAgent} agent The agent.
 * @param {string} command The command.
 * @returns {{ row: ParityRow, violations: ParityViolation[] }} The row for
 *   the report, and what is wrong with it.
 */
function inspect(root, fixture, agent, command) {
  const skill = skillNameOf(command);
  const skillFile = joined(agent.source, fill(agent.skill, command));
  const skillText = readText(root, skillFile);
  const found = [];
  if (skillText === null) {
    found.push({
      kind: VIOLATION.SKILL_MISSING,
      agent: agent.name,
      detail: `${skillFile} is missing or empty, so ${agent.name} has no ${skill} skill.`,
    });
  } else {
    found.push(
      ...statementViolations({
        fixture,
        agent,
        command,
        file: skillFile,
        text: skillText,
      })
    );
  }
  const commandFile =
    agent.command === null
      ? null
      : joined(agent.source, fill(agent.command, command));
  const commandText = commandFile === null ? null : readText(root, commandFile);
  if (commandFile !== null && commandText === null) {
    found.push({
      kind: VIOLATION.COMMAND_MISSING,
      agent: agent.name,
      detail: `${commandFile} is missing or empty, so ${fill(agent.invocation, command)} does not exist on ${agent.name}.`,
    });
  }
  if (commandText !== null && !names(commandText, skill)) {
    found.push({
      kind: VIOLATION.COMMAND_NOT_WIRED,
      agent: agent.name,
      detail: `${commandFile} does not hand over to the ${skill} skill.`,
    });
  }
  if (
    agent.installed !== undefined &&
    withheldSkills(root, agent.installed.withheld_by).includes(skill)
  ) {
    found.push({
      kind: VIOLATION.SKILL_WITHHELD,
      agent: agent.name,
      detail: `${agent.installed.withheld_by} withholds ${skill}, so the installer never gives it to ${agent.name}.`,
    });
  }
  return {
    row: {
      command,
      skill,
      invocation: fill(agent.invocation, command),
      files: [
        ...(commandText === null ? [] : [/** @type {string} */ (commandFile)]),
        ...(skillText === null ? [] : [skillFile]),
      ],
      present: found.length === 0,
    },
    violations: found.map(violation => ({ ...violation, skill })),
  };
}

/**
 * Say why an installed agent's installer cannot be relied on.
 * @param {string} root Absolute root.
 * @param {ParityAgent} agent The agent.
 * @returns {string[]} One sentence per installer file that is not there.
 */
function installerProblems(root, agent) {
  return (agent.installed?.by ?? [])
    .filter(file => readText(root, file) === null)
    .map(
      file =>
        `${PARITY_FIXTURE} says ${file} installs ${agent.name}'s copy, and that file is missing or empty.`
    );
}

/**
 * Check the four control commands on every coding agent.
 * @param {{ root?: string }} [options] `root` is the tree to check; this
 *   repository when omitted. A test passes a copy.
 * @returns {ParityResult} What each agent is given and what is wrong.
 */
export function auditControlCommandParity({ root = REPO_ROOT } = {}) {
  const { fixture, problems } = readParityFixture(root);
  if (fixture === null) {
    return {
      fixture: PARITY_FIXTURE,
      problems,
      agents: [],
      differences: 0,
      violations: [],
    };
  }
  const inspected = fixture.agents.map(agent => ({
    agent,
    commands: CONTROL_COMMANDS.map(command =>
      inspect(root, fixture, agent, command)
    ),
  }));
  const recordedIds = fixture.agents.map(agent => agent.id);
  const unrecorded = SUPPORTED_AGENTS.filter(id => !recordedIds.includes(id));
  const violations = [
    ...unrecorded.flatMap(id =>
      CONTROL_COMMANDS.map(command => ({
        kind: VIOLATION.AGENT_NOT_RECORDED,
        agent: id,
        skill: skillNameOf(command),
        detail: `${PARITY_FIXTURE} records nothing for the coding agent "${id}", so ${skillNameOf(command)} was not checked there.`,
      }))
    ),
    ...inspected.flatMap(({ commands }) =>
      commands.flatMap(command => command.violations)
    ),
  ];
  const seen = new Set();
  return {
    fixture: PARITY_FIXTURE,
    problems: fixture.agents.flatMap(agent => installerProblems(root, agent)),
    agents: inspected.map(({ agent, commands }) => ({
      id: agent.id,
      name: agent.name,
      delivery: agent.delivery,
      source: agent.source,
      installedBy: [...(agent.installed?.by ?? [])],
      surface: agent.command === null ? "skill-alias" : "command",
      commands: commands.map(command => command.row),
    })),
    differences: fixture.differences.length,
    // Two agents can be given the same file, so the same statement about a
    // third agent would otherwise be reported once for each of them.
    violations: violations.filter(violation => {
      const key = [
        violation.kind,
        violation.agent,
        violation.skill,
        violation.detail,
      ].join("\u0000");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

/**
 * The exit status a result calls for.
 * @param {ParityResult} result A result.
 * @returns {0 | 1 | 2} 0 when everything is in place, 1 when something is
 *   wrong, 2 when the check could not be carried out.
 */
export function exitStatusOf(result) {
  if (result.problems.length > 0 || result.agents.length === 0) return 2;
  return result.violations.length > 0 ? 1 : 0;
}

/**
 * Describe where an agent's copy comes from.
 * @param {ParityAgentResult} agent The agent's result.
 * @returns {string} One line an operator can read.
 */
function origin(agent) {
  const through =
    agent.surface === "command"
      ? "commands and skills"
      : "skills only: it has no command files";
  return agent.delivery === "built"
    ? `built in ${agent.source}, ${through}`
    : `no folder of its own: installed from ${agent.source} by ${agent.installedBy.join(" and ")}, ${through}`;
}

/**
 * The listing of every agent and its four commands.
 * @param {ParityResult} result A result.
 * @returns {string[]} The lines.
 */
function listing(result) {
  const width = Math.max(
    ...result.agents.flatMap(agent =>
      agent.commands.map(row => row.invocation.length)
    )
  );
  return result.agents.flatMap(agent => [
    `  ${agent.name} — ${origin(agent)}`,
    ...agent.commands.map(
      row =>
        `    ${row.present ? "✓" : "✗"} ${row.skill.padEnd(15)} ${row.invocation.padEnd(width)}  ${row.files.join(" + ") || "(nothing found)"}`
    ),
    "",
  ]);
}

/**
 * Render a result for a person.
 * @param {ParityResult} result A result.
 * @returns {string} The report.
 */
export function formatControlCommandParity(result) {
  if (exitStatusOf(result) === 2) {
    return [
      "The control commands could not be checked on every coding agent:",
      ...result.problems.map(problem => `  ${problem}`),
      ...(result.problems.length === 0
        ? [`  ${result.fixture} records no coding agent.`]
        : []),
    ].join("\n");
  }
  const total = result.agents.length * CONTROL_COMMANDS.length;
  const heading = `The control commands on every coding agent, from ${result.fixture}:`;
  if (result.violations.length === 0) {
    return [
      heading,
      "",
      ...listing(result),
      `✓ ${CONTROL_COMMANDS.length} commands on ${result.agents.length} coding agents: all ${total} are in place, each skill says how its agent starts it, and the ${result.differences} recorded differences are stated in the skills they apply to.`,
    ].join("\n");
  }
  return [
    FAILURE_HEADING,
    "",
    ...result.violations.map(
      violation =>
        `  ✗ ${violation.agent}: ${violation.skill} [${violation.kind}]\n      ${violation.detail}`
    ),
    "",
    heading,
    "",
    ...listing(result),
    "  The skills are written under plugins/src/base/skills/ and the commands under",
    "  plugins/src/base/commands/; `bun run build:plugins` builds every agent's copy",
    "  from them. Edit the source and rebuild. Never edit a built copy.",
    `  What each agent is given, and what it cannot do, is recorded in ${result.fixture}.`,
  ].join("\n");
}
