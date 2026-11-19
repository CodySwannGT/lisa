/**
 * Three things the enforce and attest skills have an agent tell an operator
 * as fact, held to what the code can back (CodySwannGT/lisa#4994).
 *
 * The guidance prose of a skill is not pinned by its own suite, and
 * rewording it must not fail a test. These passages are pinned because each
 * is a statement about the operator's repository that the agent passes on,
 * and each one said something the commands do not establish:
 *
 * - that a check which could not be judged says nothing about the code,
 *   when the code may really fail it;
 * - that the run changes only the files a list names, when the carriers
 *   command also edits a hook the repository owns;
 * - that nothing was created where no draft pull request could be opened,
 *   when a branch was pushed and removed.
 *
 * Each case names the behaviour first, from the code, and then the passage.
 * @module tests/unit/controls/skill-statements
 */
import { afterEach, describe, expect, it } from "vitest";

import { CANARY_BRANCH_PREFIX } from "../../../src/controls/canary-names.js";
import { attestSkill } from "../../helpers/attest-skill.js";
import { enforceSkill } from "../../helpers/enforce-skill.js";
import { canaryPlatform, settleWithCanaries } from "./support/canary-run.js";
import { removeCopies } from "./support/proof-run.js";
import { PULL_ONLY_GATES } from "./support/pull-request-run.js";
import { removeFixtures } from "./support/report-check-run.js";

/**
 * Write a passage on one line, so that where its lines wrap does not matter.
 * @param text - The passage
 * @returns The passage with every run of white space as one space
 */
function flat(text: string | undefined): string {
  return (text ?? "").replaceAll(/\s+/gu, " ").trim();
}

/**
 * Take the text between two markers of a document.
 * @param text - The document
 * @param from - Where the passage starts
 * @param to - Where it ends
 * @returns The passage on one line; empty when a marker is not there
 */
function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  return start === -1 || end === -1 ? "" : flat(text.slice(start, end));
}

afterEach(() => {
  removeCopies();
  removeFixtures();
});

describe("what the enforce skill says of a check that could not be judged", () => {
  const passage = between(
    enforceSkill(),
    "- `unproved`:",
    "Then each entry of `currently_failing.not_measured`"
  );

  it("says that Lisa cannot tell a broken rule from a command that could not run", () => {
    expect(passage).toContain("cannot tell");
    expect(passage).toContain("command that could not run");
  });

  it("has the agent quote what the command printed", () => {
    expect(passage).toContain("`output_excerpt`");
  });

  it("says the next commit or push is stopped if the failure is real", () => {
    expect(passage).toMatch(/next commit or push is stopped/u);
  });

  it("tells the operator neither that the code fails the check nor that it does not", () => {
    expect(passage).toContain(
      "Do not tell the operator that the code on the main branch fails this check"
    );
    expect(passage).toContain("do not tell them that it passes");
    expect(passage).not.toContain("not a statement about the code");
    expect(passage).not.toContain("does not show a broken rule");
  });
});

describe("what the enforce skill says the run changes in a hook the repository owns", () => {
  const skill = enforceSkill();
  const rule = between(
    skill,
    "1. **Change only what the three steps write.**",
    "2. **Enforce adds no check.**"
  );
  const lastCheck = between(
    skill,
    "### Step 9: Confirm what changed, and clear up",
    "### Step 10:"
  );

  it.each([".husky/pre-commit", "lefthook.yml", ".pre-commit-config.yaml"])(
    "names %s among what the carriers command may edit",
    file => {
      expect(rule).toContain(`\`${file}\``);
    }
  );

  it("says the result names that edit", () => {
    expect(rule).toContain("`changes`");
  });

  it("expects that edit where the working copy is compared with what was there before", () => {
    expect(lastCheck).toContain("hook the repository already had");
    expect(lastCheck).toContain("expected");
  });
});

describe("what the attest skill says where no draft pull request can be opened", () => {
  const passage = between(
    attestSkill(),
    "Where GitHub does not offer draft pull requests",
    "### Step 4:"
  );

  it("is said of a run that pushed a branch and removed it", async () => {
    const platform = canaryPlatform({ drafts: false });

    await settleWithCanaries(PULL_ONLY_GATES, platform);
    const created = platform.log.flatMap(request =>
      request.method === "POST" && request.path.endsWith("/git/refs")
        ? [String((request.body as { ref?: unknown }).ref)]
        : []
    );
    const removed = platform.log.filter(
      request =>
        request.method === "DELETE" &&
        request.path.includes(`/git/refs/heads/${CANARY_BRANCH_PREFIX}`)
    );

    expect(created.length).toBeGreaterThan(0);
    expect(
      created.filter(
        ref => !ref.startsWith(`refs/heads/${CANARY_BRANCH_PREFIX}`)
      )
    ).toEqual([]);
    expect(removed).toHaveLength(created.length);
    expect(platform.branches()).toEqual(["main"]);
    expect(platform.pulls()).toEqual([]);
  });

  it("says a branch was created and removed, and that no pull request was", () => {
    expect(passage).toContain("`lisa-attest/`");
    expect(passage).toMatch(/pushed .* and removed/u);
    expect(passage).toContain("no pull request was created");
    expect(passage).not.toContain("nothing was created");
  });
});
