/**
 * On the paved road, configure produces the register from the declarations
 * Lisa ships, and two runs produce the same bytes.
 *
 * An agent carries out the configure step, so no suite can run all of it.
 * This one runs the deterministic part for real: every shell command the
 * configure skill writes down, exactly as written and in order, using the
 * built CLI, inside a fixture repository on a supported project type where
 * Lisa was never applied. The paved road asks nothing of the agent, so the
 * stand-in does nothing (CodySwannGT/lisa#4984).
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { registerSchemaErrors } from "../helpers/control-register.js";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  CHANGED_BLOCK,
  CONFIG,
  PACKAGE_WITH_TASKS,
  REGISTER,
  configureRepository,
  hashOf,
  useConfigureRepositories,
  writtenRegister,
} from "./support/configure-repositories.js";
import {
  DECLARATION_CHECK_BLOCK,
  PROPOSE_BLOCK,
  REGISTER_BLOCK,
  REGISTER_CHECK_BLOCK,
  SEED_BLOCK,
  configureStep,
  runConfigureSkillCommands,
} from "./support/configure-skill-run.js";

useIoLatencyBudget();

const lisaFolder = useConfigureRepositories();
const WITH_TASKS = { "package.json": PACKAGE_WITH_TASKS };

describe("configure on F-paved, the paved road", () => {
  it("produces byte-identical registers on two consecutive runs", () => {
    const repoPath = configureRepository("F-paved", WITH_TASKS);

    const first = runConfigureSkillCommands(repoPath, lisaFolder());
    const hashes = [hashOf(repoPath, REGISTER), hashOf(repoPath, CONFIG)];
    const second = runConfigureSkillCommands(repoPath, lisaFolder());

    expect(first.filter(step => step.status !== 0)).toEqual([]);
    expect(second.filter(step => step.status !== 0)).toEqual([]);
    expect([hashOf(repoPath, REGISTER), hashOf(repoPath, CONFIG)]).toEqual(
      hashes
    );
    expect(JSON.parse(configureStep(first, SEED_BLOCK).stdout)).toMatchObject({
      road: "paved",
      wrote: true,
    });
    expect(JSON.parse(configureStep(second, SEED_BLOCK).stdout)).toMatchObject({
      road: "paved",
      wrote: false,
      seeded: [],
    });
    expect(configureStep(second, REGISTER_BLOCK).stdout).toMatch(
      /^register: PASS\. 3 entries from 3 gates; \.lisa\/controls\/register\.json is already up to date/u
    );
  });

  it("needs no audit report and no decision, and writes a register the schema accepts", () => {
    const repoPath = configureRepository("F-paved", WITH_TASKS);

    const steps = runConfigureSkillCommands(repoPath, lisaFolder());
    const register = writtenRegister(repoPath);

    expect(existsSync(path.join(repoPath, ".lisa/audit"))).toBe(false);
    expect(steps.filter(step => step.block.includes(PROPOSE_BLOCK))).toEqual(
      []
    );
    expect(configureStep(steps, DECLARATION_CHECK_BLOCK).stdout).toMatch(
      /^declaration-check: PASS\. No gate in \.lisa\.config\.json declares a part/u
    );
    expect(configureStep(steps, REGISTER_CHECK_BLOCK).status).toBe(0);
    expect(registerSchemaErrors(register)).toEqual([]);
    expect(register.entries.map(entry => entry.id)).toEqual([
      "build-integrity@.",
      "code-style@.",
      "type-correctness@.",
    ]);
    expect(register.entries.filter(entry => "evidence" in entry)).toEqual([]);
  });

  it("changes nothing but the declaration and the register", () => {
    const repoPath = configureRepository("F-paved", WITH_TASKS);

    const steps = runConfigureSkillCommands(repoPath, lisaFolder());

    expect(
      configureStep(steps, CHANGED_BLOCK).stdout.trim().split("\n")
    ).toEqual([`?? ${CONFIG}`, `?? ${REGISTER}`]);
  });

  it("is byte-identical twice on the bare fixture too, where nothing can be declared yet", () => {
    const repoPath = configureRepository("F-paved");

    runConfigureSkillCommands(repoPath, lisaFolder());
    const first = hashOf(repoPath, REGISTER);
    const steps = runConfigureSkillCommands(repoPath, lisaFolder());

    expect(hashOf(repoPath, REGISTER)).toBe(first);
    expect(writtenRegister(repoPath).entries).toEqual([]);
    expect(JSON.parse(configureStep(steps, SEED_BLOCK).stdout)).toMatchObject({
      road: "paved",
      declared_gates: 0,
    });
    expect(configureStep(steps, CHANGED_BLOCK).stdout.trim()).toBe(
      `?? ${REGISTER}`
    );
  });
});
