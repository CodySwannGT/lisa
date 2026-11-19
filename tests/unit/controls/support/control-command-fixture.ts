/**
 * Scratch copies of what the control-command parity check reads.
 *
 * The copy is taken FROM the live repository, and holds exactly the files the
 * check itself says it reads ({@link controlCommandFiles}), so a suite never
 * perturbs the working tree and never tests a hand-typed tree that drifted
 * from what is shipped. Every suite asserts the untouched copy is clean before
 * it perturbs one, so a failure can never be read off a copy that was already
 * broken (CodySwannGT/lisa#5002).
 * @module tests/unit/controls/support/control-command-fixture
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  controlCommandFiles,
  PARITY_FIXTURE,
  readParityFixture,
  REPO_ROOT,
} from "../../../../scripts/lib/control-command-parity.mjs";

/** The recorded facts about one agent, as the fixture holds them. */
export interface RecordedAgent {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly skill: string;
  readonly command: string | null;
  readonly invocation: string;
}

/** One recorded difference, as the fixture holds it. */
export interface RecordedDifference {
  readonly id: string;
  readonly skills: readonly string[];
  readonly agents: readonly string[];
  readonly stated_as: string;
}

/** The fixture, as far as the suites read it. */
export interface RecordedFixture {
  readonly agents: readonly RecordedAgent[];
  readonly differences: readonly RecordedDifference[];
}

/**
 * Read the fixture of a root, failing loudly when it cannot be read.
 * @param root - The root to read it from
 * @returns The fixture
 * @throws {Error} When the fixture is absent or malformed
 */
export function recordedFixture(root: string = REPO_ROOT): RecordedFixture {
  const { fixture, problems } = readParityFixture(root);
  if (fixture === null) {
    throw new Error(`Cannot read ${PARITY_FIXTURE}: ${problems.join(" ")}`);
  }
  return fixture as RecordedFixture;
}

/**
 * Copy everything the check reads into a fresh folder the caller may change.
 * @param tempRoots - Accumulator the caller removes after each test
 * @returns Absolute path of the copy
 */
export function materializeControlCommands(tempRoots: string[]): string {
  const { fixture } = readParityFixture(REPO_ROOT);
  const files = [
    PARITY_FIXTURE,
    ...(fixture === null ? [] : controlCommandFiles(fixture)),
  ];
  const clone = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "lisa-control-commands-"))
  );
  tempRoots.push(clone);
  for (const relative of files) {
    const source = path.join(REPO_ROOT, relative);
    if (!fs.existsSync(source)) continue;
    const destination = path.join(clone, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
  return clone;
}

/**
 * Where one agent's copy of a command's skill is, in a root.
 * @param root - The root
 * @param agentId - The agent, as the fixture names it
 * @param command - The command, for example `attest`
 * @returns Absolute path of the skill file
 */
export function skillFileOf(
  root: string,
  agentId: string,
  command: string
): string {
  const agent = agentOf(root, agentId);
  return path.join(
    root,
    agent.source,
    agent.skill.replaceAll("{command}", command)
  );
}

/**
 * Where one agent's command file is, in a root.
 * @param root - The root
 * @param agentId - The agent, as the fixture names it
 * @param command - The command, for example `attest`
 * @returns Absolute path of the command file
 * @throws {Error} When the agent has no command files
 */
export function commandFileOf(
  root: string,
  agentId: string,
  command: string
): string {
  const agent = agentOf(root, agentId);
  if (agent.command === null) {
    throw new Error(`${agent.name} is given no command files`);
  }
  return path.join(
    root,
    agent.source,
    agent.command.replaceAll("{command}", command)
  );
}

/**
 * Rewrite one file of a copy.
 * @param file - Absolute path
 * @param change - Maps the old content to the new
 * @throws {Error} When the change leaves the file as it was, so a test can
 *   never pass because its perturbation silently matched nothing
 */
export function rewrite(file: string, change: (text: string) => string): void {
  const before = fs.readFileSync(file, "utf8");
  const after = change(before);
  if (after === before) {
    throw new Error(`The change left ${file} as it was`);
  }
  fs.writeFileSync(file, after);
}

/**
 * Rewrite the fixture of a copy.
 * @param root - The copy
 * @param change - Changes the parsed fixture in place
 */
export function rewriteFixture(
  root: string,
  change: (fixture: {
    agents: RecordedAgent[];
    differences: RecordedDifference[];
  }) => void
): void {
  rewrite(path.join(root, PARITY_FIXTURE), text => {
    const fixture = JSON.parse(text) as {
      agents: RecordedAgent[];
      differences: RecordedDifference[];
    };
    change(fixture);
    return `${JSON.stringify(fixture, null, 2)}\n`;
  });
}

/**
 * The recorded facts about one agent.
 * @param root - The root whose fixture is read
 * @param agentId - The agent, as the fixture names it
 * @returns The agent's entry
 * @throws {Error} When the fixture has no such agent
 */
function agentOf(root: string, agentId: string): RecordedAgent {
  const agent = recordedFixture(root).agents.find(
    entry => entry.id === agentId
  );
  if (agent === undefined) {
    throw new Error(`${PARITY_FIXTURE} records no agent "${agentId}"`);
  }
  return agent;
}
