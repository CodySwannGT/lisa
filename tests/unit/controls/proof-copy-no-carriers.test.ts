/**
 * The disposable copy built with no carriers: a fresh clone, wired as a
 * fresh clone is (CodySwannGT/lisa#5001).
 *
 * `lisa controls attest --before-enforce` asks what happens to a bad change
 * before anything is installed, so its copy must not have what a plain run
 * installs. These cases build both copies of the same repository and compare
 * what git would run in each, and then make the same real commit in each.
 * @module tests/unit/controls/proof-copy-no-carriers
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { cloneWiring } from "../../../src/controls/before-enforce-workspace.js";
import { NO_CARRIERS_REASON } from "../../../src/controls/proof-copy.js";
import { proofCopyWorkspace } from "../../../src/controls/proof-copy-workspace.js";
import { loadProofTools } from "../../../src/controls/proof-tools.js";
import { generateControlRegister } from "../../../src/controls/register.js";
import type {
  CommandMechanism,
  ControlRegisterEntry,
} from "../../../src/controls/register-types.js";
import {
  buildProofFixture,
  checks,
  F_NONE_SOURCE,
  proofPatches,
  provedGates,
} from "../../helpers/control-proofs.js";
import {
  copyOf,
  gitIn,
  hookEnvironment,
  removeScratch,
} from "./support/proof-copy-run.js";
import { keep, removeFixtures } from "./support/report-check-run.js";

const GATES = provedGates([{ command: checks(F_NONE_SOURCE) }]);
const { violation: VIOLATION } = proofPatches("F-none", F_NONE_SOURCE);
const RUNNER = path.join("scripts", "lisa-run-gates.mjs");

/**
 * Build F-none with a working check declared and committed.
 * @returns The repository's path
 */
function repository(): string {
  return keep(buildProofFixture(GATES)).repoPath;
}

/**
 * The only register entry of a repository, and the command that measures it.
 * @param repoPath - The repository
 * @returns The entry and its mechanism
 */
async function onlyEntry(repoPath: string): Promise<{
  readonly entry: ControlRegisterEntry;
  readonly mechanism: CommandMechanism;
}> {
  const generated = await generateControlRegister(repoPath);
  const [entry] = generated.problems === null ? generated.register.entries : [];
  if (entry === undefined || entry.measuring_mechanism.kind !== "command") {
    throw new Error("the fixture has no entry measured by a command");
  }
  return { entry, mechanism: entry.measuring_mechanism };
}

beforeEach(() => {
  hookEnvironment();
});

afterEach(() => {
  removeScratch();
  removeFixtures();
});

describe("a disposable copy built with no carriers", () => {
  it("has no hook folder set, no hook file and no gate runner, and says why at both moments", async () => {
    const copy = await copyOf(repository(), { carriers: "none" });

    expect(cloneWiring(copy)).toMatchObject({
      carriers_installed: false,
      hooks_path: null,
      hooks: [],
    });
    expect(existsSync(path.join(copy.clone, RUNNER))).toBe(false);
    expect(existsSync(path.join(copy.clone, ".lisa", "hooks"))).toBe(false);
    expect(copy.unwired).toEqual({
      commit: NO_CARRIERS_REASON,
      push: NO_CARRIERS_REASON,
    });
    expect(gitIn(copy.clone, "status", "--porcelain")).toBe("");
  });

  it("differs from the copy a plain run builds, which has the carriers", async () => {
    const copy = await copyOf(repository());

    expect(cloneWiring(copy).hooks_path).toBe(".lisa/hooks");
    expect(existsSync(path.join(copy.clone, RUNNER))).toBe(true);
    expect(copy.unwired).toEqual({ commit: null, push: null });
  });
});

describe("a real commit of a violating change, answered by git alone", () => {
  it("goes through in the copy with no carriers, and is refused in the copy that has them", async () => {
    const repoPath = repository();
    const tools = await loadProofTools();
    const request = { ...(await onlyEntry(repoPath)), moment: "commit" };
    const attempt = async (
      carriers: "installed" | "none"
    ): Promise<number | null> => {
      const copy = await copyOf(repoPath, { carriers });
      const workspace = proofCopyWorkspace(copy, tools, { answeredBy: "git" });
      await workspace.apply(VIOLATION);
      const answer = await workspace.trigger({ ...request, timeoutMs: 60_000 });
      await workspace.restore(VIOLATION);
      expect(answer.notStarted).toBeUndefined();
      expect(gitIn(copy.clone, "rev-parse", "HEAD")).toBe(copy.base);
      return answer.code;
    };

    expect(await attempt("none")).toBe(0);
    expect(await attempt("installed")).not.toBe(0);
  });

  it("is not triggered at all by the carrier-answered workspace, which has no carrier to ask", async () => {
    const repoPath = repository();
    const copy = await copyOf(repoPath, { carriers: "none" });
    const workspace = proofCopyWorkspace(copy, await loadProofTools());
    await workspace.apply(VIOLATION);

    const answer = await workspace.trigger({
      ...(await onlyEntry(repoPath)),
      moment: "commit",
      timeoutMs: 60_000,
    });

    expect(answer.code).toBeNull();
    expect(answer.notStarted).toContain(NO_CARRIERS_REASON);
  });
});
