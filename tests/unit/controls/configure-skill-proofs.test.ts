/**
 * The configure skill's step that writes each check's two test changes
 * (CodySwannGT/lisa#5011).
 *
 * The step is carried out by an agent, so its guidance is not pinned here
 * word for word. What is checked is what a program can hold it to: the
 * command that tries the pairs runs where the skill promises it does, the
 * commands that write a patch file ask only for the two values the agent
 * has, the proof the skill shows is one the register accepts and is named
 * the way the skill says, and the attest skill sends an operator back to
 * the right step for a missing pair. The commands themselves are run for
 * real by `tests/integration/controls-configure-proofs.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  controlEntryId,
  WHOLE_REPOSITORY_SCOPE,
} from "../../../src/controls/register-types.js";
import { attestSkill } from "../../helpers/attest-skill.js";
import { fencedBlocks } from "../../helpers/audit-skill.js";
import {
  configureSkill,
  configureSkillShellBlocks,
} from "../../helpers/configure-skill.js";
import { registerOf } from "./support/register-build.js";

const PROOF_CHECK = "lisa controls proof-check";
const PROOFS = ".lisa/controls/proofs/";

/** A part as the skill shows it once it has a proof. */
interface ShownPart {
  readonly scope: string;
  readonly proof: {
    readonly violation: string;
    readonly clean: string;
    readonly failure_shape: readonly string[];
  };
}

/**
 * The parts the skill shows with a proof on them.
 * @returns The parsed content of each `json` block that holds a `proof`
 */
function shownParts(): readonly ShownPart[] {
  return fencedBlocks(configureSkill())
    .filter(block => block.language === "json")
    .map(block => JSON.parse(block.content) as Partial<ShownPart>)
    .filter((part): part is ShownPart => part.proof !== undefined);
}

/**
 * The name the skill says a check's two patch files carry.
 * @param gate - The gate's name
 * @param scope - The part's folder
 * @returns The start of both file names
 */
function conventionalName(gate: string, scope: string): string {
  return scope === WHOLE_REPOSITORY_SCOPE
    ? gate
    : controlEntryId(gate, scope.replaceAll("/", "-"));
}

describe("the configure skill's test-change step", () => {
  const blocks = configureSkillShellBlocks().map(block => block.trim());

  it("has the pairs tried after the declaration is checked and before the register is written", () => {
    expect(blocks.indexOf(PROOF_CHECK)).toBeGreaterThan(
      blocks.indexOf("lisa controls declaration-check")
    );
    expect(blocks.indexOf(PROOF_CHECK)).toBeLessThan(
      blocks.indexOf("lisa controls register")
    );
  });

  it("writes a patch file with git, in a scratch copy and never in the repository's own files", () => {
    const patchWriting = blocks.filter(block => block.startsWith("git "));

    expect(patchWriting.length).toBeGreaterThan(0);
    expect(
      patchWriting.filter(
        block =>
          !block.startsWith('git -C "<scratch folder>" ') &&
          !block.startsWith("git clone ") &&
          !block.startsWith("git rev-parse ") &&
          !block.startsWith("git status ")
      )
    ).toEqual([]);
    expect(
      patchWriting.some(block => block.includes('--output="<patch file>"'))
    ).toBe(true);
  });

  it("asks the agent for nothing but the scratch folder and the patch file in those commands", () => {
    const asked = blocks
      .filter(block => block.startsWith("git "))
      .flatMap(block =>
        [...block.matchAll(/"<([a-z ]+)>"/gu)].map(match => match[1])
      );

    expect(new Set(asked)).toEqual(new Set(["patch file", "scratch folder"]));
  });

  it("names the paths it may change in its ground rules and where it confirms what changed", () => {
    const sections = configureSkill().split(/^#{2,3} /mu);
    const naming = (heading: string): string =>
      sections.find(section => section.startsWith(heading)) ?? "";

    expect(naming("Ground rules")).toContain(PROOFS);
    expect(naming("Step 10: Confirm what changed")).toContain(PROOFS);
  });
});

describe("the proof the configure skill shows", () => {
  const shown = shownParts();

  it("is shown at least once", () => {
    expect(shown.length).toBeGreaterThan(0);
  });

  it.each(shown)(
    "is one the register accepts, with both changes and the failure text (example %#)",
    async part => {
      const register = await registerOf({
        "code-style": { commit: "required", parts: [part] },
      });

      expect(register.entries.map(entry => entry.proof)).toEqual([
        {
          violation: part.proof.violation,
          clean: part.proof.clean,
          failure_shape: part.proof.failure_shape,
          timeout_seconds: null,
          external_effects: null,
        },
      ]);
      expect(part.proof.failure_shape.length).toBeGreaterThan(0);
    }
  );

  it.each(shown)(
    "names its two patch files the way the skill says they are named (example %#)",
    part => {
      const name = conventionalName("code-style", part.scope);

      expect(part.proof).toMatchObject({
        violation: `${PROOFS}${name}.violation.patch`,
        clean: `${PROOFS}${name}.clean.patch`,
      });
    }
  );
});

describe("the attest skill, on a check with no test changes", () => {
  /** The lines that say where test changes come from or get corrected. */
  const lines = attestSkill()
    .split("\n")
    .filter(line => /test changes? /u.test(line) && line.includes("step"));

  it("never says the enforce step writes them", () => {
    expect(
      lines.filter(line => /enforce step (?:writes|repairs these)/u.test(line))
    ).toEqual([]);
  });

  it("sends the operator back to configure for them", () => {
    expect(
      attestSkill()
        .split("\n")
        .filter(line => line.includes("/lisa:configure")).length
    ).toBeGreaterThan(2);
    expect(attestSkill()).toContain(PROOF_CHECK);
  });
});
