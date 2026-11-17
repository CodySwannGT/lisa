/**
 * Pins what an existing Lisa user gets today, before the control audit work
 * changes the gate registry and the gate runner.
 * @remarks
 * Two promises are held here. Gate resolution returns, at every moment, what
 * it returned before that work started. And the two commands people already
 * rely on, `/lisa:agent-ready` and `lisa standards-proof`, are still there.
 *
 * The resolution half compares against a committed snapshot file and never
 * writes it on its own. To record an INTENDED change, run this file with
 * `LISA_PAVED_ROAD_SNAPSHOT=record` and review the snapshot's diff, which is
 * one line per gate and moment.
 * @module tests/unit/controls/paved-road-regression
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createTestProgram } from "../cli/index-test-program.js";
import { resolutionDrift, type ResolvedGate } from "./paved-road-drift.js";
import {
  EVERY_DEFAULT_SUPPLIED,
  ONLY_ALIASES_SUPPLIED,
  PINNED_GATES,
  pinnedTaskAt,
} from "./paved-road-registry-pin.js";
import {
  momentsOf,
  PAVED_ROAD_CONFIGURATIONS,
  readSnapshots,
  resolveAt,
  resolveEverything,
  serialiseSnapshots,
  SNAPSHOT_PATH,
} from "./paved-road-snapshot.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const RECORD_VARIABLE = "LISA_PAVED_ROAD_SNAPSHOT";
const STANDARDS_PROOF = "standards-proof";
const AGENT_READY_SKILL = "/lisa-agent-ready";

/** What to do about a failure, appended to every drift report. */
const IF_INTENDED =
  "Existing Lisa users get a different result from the one recorded. If " +
  `that is intended, record it with ${RECORD_VARIABLE}=record and review ` +
  `the diff of ${path.basename(SNAPSHOT_PATH)}.`;

if (process.env[RECORD_VARIABLE] === "record") {
  // A pin that CI can rewrite is a pin that passes whatever it is given.
  if (process.env.CI) {
    throw new Error(`${RECORD_VARIABLE}=record is refused when CI is set.`);
  }
  writeFileSync(SNAPSHOT_PATH, serialiseSnapshots(resolveEverything()));
}

const STORED = readSnapshots();

/**
 * The stored gates for one configuration at one moment.
 * @param configuration - Configuration name
 * @param moment - Moment name
 * @returns The stored entries, or undefined when none are stored
 */
const storedAt = (
  configuration: string,
  moment: string
): readonly ResolvedGate[] | undefined => STORED[configuration]?.[moment];

/**
 * Names in one fixed order, so two lists compare by what they hold.
 * @param names - Any list of names
 * @returns A sorted copy
 */
const inOrder = (names: readonly string[]): string[] =>
  [...names].sort((left, right) => left.localeCompare(right));

/**
 * A repository file's text.
 * @param relative - Path from the repository root
 * @returns The file's contents
 */
const repoFile = (relative: string): string =>
  readFileSync(path.join(REPO_ROOT, relative), "utf8");

describe("gate resolution an existing Lisa user gets", () => {
  describe.each(PAVED_ROAD_CONFIGURATIONS)("$name", configuration => {
    it.each(momentsOf(configuration))("resolves %s as recorded", moment => {
      const drift = resolutionDrift({
        configuration: configuration.name,
        moment,
        recorded: storedAt(configuration.name, moment),
        received: resolveAt(configuration, moment),
      });

      expect(drift, [...drift, IF_INTENDED].join("\n")).toEqual([]);
    });
  });

  it("stores one snapshot per configuration and moment, and no others", () => {
    const expected = PAVED_ROAD_CONFIGURATIONS.flatMap(configuration =>
      momentsOf(configuration).map(
        moment => `${configuration.name} @ ${moment}`
      )
    );
    const stored = Object.entries(STORED).flatMap(([name, moments]) =>
      Object.keys(moments).map(moment => `${name} @ ${moment}`)
    );

    expect(new Set(expected).size).toBe(expected.length);
    expect(inOrder(stored)).toEqual(inOrder(expected));
  });
});

describe("the snapshots reach every registry default", () => {
  // Hardcoded against the pin, not read back off the registry: the snapshot
  // must SHOW each gate's default, or changing that default would change
  // nothing a comparison could see.
  it.each(Object.entries(PINNED_GATES))(
    "shows the default task of %s at each moment it may run",
    (id, gate) => {
      const shown = gate.moments.map(moment => {
        const entry = storedAt(EVERY_DEFAULT_SUPPLIED, moment)?.find(
          candidate => candidate.id === id
        );
        return { moment, declared: entry?.declared, task: entry?.task };
      });

      expect(shown).toEqual(
        gate.moments.map(moment => ({
          moment,
          declared: null,
          task: pinnedTaskAt(gate, moment),
        }))
      );
    }
  );

  it.each(
    Object.entries(PINNED_GATES).filter(
      ([, gate]) => gate.shippedAs !== undefined
    )
  )("shows the shipped alias of %s at each moment it may run", (id, gate) => {
    const aliases = gate.moments.map(
      moment =>
        storedAt(ONLY_ALIASES_SUPPLIED, moment)?.find(
          candidate => candidate.id === id
        )?.alias
    );

    expect(aliases).toEqual(
      gate.moments.map(() => ({ from: gate.task, to: gate.shippedAs }))
    );
  });
});

describe("a changed resolution is reported by gate and moment", () => {
  const configuration = EVERY_DEFAULT_SUPPLIED;

  it("names the gate and the moment for every pinned default task", () => {
    const cases = Object.entries(PINNED_GATES).flatMap(([id, gate]) =>
      gate.moments.map(moment => ({
        id,
        moment,
        task: pinnedTaskAt(gate, moment),
      }))
    );
    const reports = cases.map(({ id, moment }) => {
      const recorded = storedAt(configuration, moment) ?? [];
      return resolutionDrift({
        configuration,
        moment,
        recorded,
        received: recorded.map(entry =>
          entry.id === id ? { ...entry, task: "some:other-task" } : entry
        ),
      });
    });

    expect(reports).toEqual(
      cases.map(({ id, moment, task }) => [
        `Gate "${id}" at moment "${moment}" no longer resolves as recorded ` +
          `(configuration "${configuration}"): task was "${task}", is now ` +
          `"some:other-task".`,
      ])
    );
  });

  it("names a gate that left, one that arrived, and a changed order", () => {
    const lint = { id: "code-style", task: "lint" };
    const build = { id: "build-integrity", task: "build" };
    const at = { configuration: "example", moment: "push" };

    expect(
      resolutionDrift({ ...at, recorded: [lint, build], received: [build] })
    ).toEqual([
      'Gate "code-style" at moment "push" no longer resolves at all ' +
        '(configuration "example"). It was recorded as ' +
        '{"id":"code-style","task":"lint"}.',
    ]);
    expect(
      resolutionDrift({ ...at, recorded: [lint], received: [lint, build] })
    ).toEqual([
      'Gate "build-integrity" at moment "push" resolves now and was never ' +
        'recorded (configuration "example"). It resolves as ' +
        '{"id":"build-integrity","task":"build"}.',
    ]);
    expect(
      resolutionDrift({
        ...at,
        recorded: [lint, build],
        received: [build, lint],
      })
    ).toEqual([
      'The gates at moment "push" run in a different order (configuration ' +
        '"example"): recorded code-style, build-integrity; now ' +
        "build-integrity, code-style.",
    ]);
  });

  it("refuses a moment that has no stored snapshot", () => {
    expect(
      resolutionDrift({
        configuration: "example",
        moment: "commit",
        recorded: undefined,
        received: [],
      })
    ).toEqual([
      'No snapshot is stored for moment "commit" (configuration "example"). ' +
        "Every configuration needs one snapshot per moment.",
    ]);
  });
});

describe("the commands an existing Lisa user relies on", () => {
  it.each([
    "plugins/src/base/commands/agent-ready.md",
    "plugins/lisa/commands/agent-ready.md",
  ])("still ships the agent-ready command in %s", commandFile => {
    expect(repoFile(commandFile)).toContain(
      `Use the ${AGENT_READY_SKILL} skill`
    );
  });

  it("still ships the skill the agent-ready command hands off to", () => {
    expect(
      existsSync(
        path.join(
          REPO_ROOT,
          "plugins/src/base/skills/lisa-agent-ready/SKILL.md"
        )
      )
    ).toBe(true);
  });

  it("still registers standards-proof and routes it to its runner", async () => {
    const { program, runStandardsProofCli } = createTestProgram();
    const command = program.commands.find(
      candidate => candidate.name() === STANDARDS_PROOF
    );

    expect(
      command?.registeredArguments.map(argument => argument.name())
    ).toEqual(["path"]);

    await program.parseAsync([STANDARDS_PROOF, "api"], { from: "user" });

    expect(runStandardsProofCli).toHaveBeenCalledWith("api");
  });
});
