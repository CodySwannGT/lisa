/**
 * Regression coverage for the env-keyed `done` promotion-completeness gate.
 *
 * Env resolution used to map a merged PR's base branch to an environment and
 * treat the production value as terminal, with nothing asking whether the
 * *intermediate* environments carried the merge. A hotfix straight to `main`
 * satisfied "reached production" by an out-of-order route, so the item closed
 * while `staging` lacked the fix and could not deploy.
 *
 * Every assertion here is scoped to the section slice that contains the defect.
 * `deploy.branches`, "environment", and "deploy" appear all over these files, so
 * a whole-file match would pass on unrelated mentions while the resolution path
 * stayed ungated — which is the defect.
 * @module tests/unit/strategies/env-promotion-completeness
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

const read = (root: string, relative: string): string =>
  readFileSync(path.resolve(root, relative), "utf8");

const slice = (content: string, from: string, to: string): string => {
  const start = content.indexOf(from);
  const end = content.indexOf(to, start + from.length);
  expect(start, `missing section start: ${from}`).toBeGreaterThan(-1);
  expect(end, `missing section end: ${to}`).toBeGreaterThan(-1);
  return content.slice(start, end);
};

/**
 * Asserts the gate itself: ladder-wide ancestry plus concluded deploy health.
 * @param section - the section slice expected to carry the gate
 */
const expectGate = (section: string): void => {
  // Ancestry is asserted for the whole ladder, not only the PR's base branch.
  expect(section).toMatch(/merge-base\s+--is-ancestor/);
  expect(section).toMatch(/timed_out/);
};

describe("env-keyed `done` promotion completeness", () => {
  describe.each(ROOTS)("%s", root => {
    const reference = read(root, "rules/reference/config-resolution.md");
    const repairIntake = read(root, "skills/lisa-repair-intake/SKILL.md");

    describe("config-resolution reference", () => {
      const envKeyedDone = slice(
        reference,
        "### Env-keyed `done`",
        "### Env → base branch"
      );

      it("caps branch inference with the promotion-completeness gate", () => {
        expectGate(envKeyedDone);
      });

      it("promotes on a concluded success only, not on 'did not fail'", () => {
        expect(envKeyedDone).toMatch(/action_required/);
      });
    });

    // #3992 moved this gate out of the always-on head into the reference body:
    // it is tracker-write mechanics, consulted when a flow writes an env-keyed
    // `done`, not on every session. The head keeps the resolution pointer.
    describe("config-resolution reference — promotion completeness", () => {
      const gate = slice(
        reference,
        "## Env-keyed `done` — promotion completeness",
        "---"
      );

      it("carries the gate, not only the forward env → base branch grammar", () => {
        expectGate(gate);
      });
    });

    describe("repair-intake", () => {
      const gate = slice(
        repairIntake,
        "#### Promotion completeness: the base branch is not the delivery",
        "### Build `blocked` → re-evaluate"
      );

      it("gates the env-resolved write behind the ladder check", () => {
        expectGate(gate);
      });

      it("requires the capped write to name the missing rung in the note", () => {
        expect(gate).toMatch(/\[lisa-repair-intake\]`?\s+note\s+MUST\s+carry/i);
      });
    });

    describe.each([
      "lisa-jira-build-intake",
      "lisa-github-build-intake",
      "lisa-linear-build-intake",
    ])("%s", slug => {
      it("caps its env-keyed `done` resolution with the gate", () => {
        const skill = read(root, `skills/${slug}/SKILL.md`);
        const resolution = slice(
          skill,
          "For env-keyed `done`, resolve the env first",
          "```bash"
        );
        expectGate(resolution);
      });
    });
  });
});
