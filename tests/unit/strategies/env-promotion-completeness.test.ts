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
  expect(section).toMatch(
    /every\*{0,2}\s+env(ironment)?\s+branch\s+at\s+or\s+below/i
  );
  expect(section).toMatch(
    /not\s+only\s+the\s+PR's\s+base|never\s+only\s+the\s+PR's\s+base/i
  );
  // A rung is reached only when its deploy CONCLUDED without failure. Reading
  // the status instead of the conclusion is how a pending run passes for green.
  expect(section).toMatch(/most\s+recent\s+\*{0,2}concluded\*{0,2}\s+deploy/i);
  expect(section).toMatch(/`conclusion`.*never.*`status`/is);
  // The written env is capped by contiguity from the bottom of the ladder.
  expect(section).toMatch(/contiguously\s+reached/i);
  expect(section).toMatch(/deploy\.order/);
};

describe("env-keyed `done` promotion completeness", () => {
  describe.each(ROOTS)("%s", root => {
    const reference = read(root, "rules/reference/config-resolution.md");
    const eager = read(root, "rules/eager/config-resolution.md");
    const repairIntake = read(root, "skills/lisa-repair-intake/SKILL.md");

    describe("config-resolution reference", () => {
      const envKeyedDone = slice(
        reference,
        "### Env-keyed `done`",
        "### Env → base branch"
      );

      it("caps branch inference with the promotion-completeness gate", () => {
        // Steps 1-2 resolve a candidate; the gate decides what is written. Without
        // step 4 the list ends at "fail loudly" and base inference is the answer.
        expect(envKeyedDone).toMatch(/\*\*Promotion completeness\*\*/);
        expect(envKeyedDone).toMatch(
          /Steps\s+1[–-]2\s+resolve\s+a\s+\*?candidate\*?/i
        );
        expectGate(envKeyedDone);
      });

      it("states that entering an environment is not reaching the ones below", () => {
        expect(envKeyedDone).toMatch(/\*\*entered\*\*/);
        expect(envKeyedDone).toMatch(/\*\*reached\*\*/);
        expect(envKeyedDone).toMatch(/out-of-order\s+route/i);
        // The concrete live shape: dev + main present, staging missing → dev.
        expect(envKeyedDone).toMatch(
          /`dev`\s+and\s+`main`\s+but\s+absent\s+from\s+`staging`/i
        );
        expect(envKeyedDone).toMatch(/never\s+a\s+higher\s+rung/i);
      });

      it("requires the refusal to name the environment that is missing", () => {
        expect(envKeyedDone).toMatch(/named,\s+never\s+silent/i);
        expect(envKeyedDone).toMatch(
          /name\s+the\s+first\s+unreached\s+rung,\s+its\s+branch/i
        );
        expect(envKeyedDone).toMatch(
          /failing\s+deploy\s+run\s+with\s+its\s+URL/i
        );
      });

      it("forbids reclassifying a skipped rung as branch hygiene", () => {
        // The live instance's closing note called the skipped-env back-fill PR
        // "branch hygiene, not outstanding delivery" and closed anyway.
        expect(envKeyedDone).toMatch(
          /back-fill\s+PR\*{0,2}\s+against\s+a\s+skipped\s+environment\s+branch\s+is\s+\*?outstanding\s+delivery\*?/i
        );
        expect(envKeyedDone).toMatch(/not\s+\*{0,2}?branch\s+hygiene/i);
        expect(envKeyedDone).toMatch(
          /never\s+a\s+reason\s+to\s+discount\s+the\s+gap/i
        );
      });

      it("treats an unconcluded deploy as unknown rather than green", () => {
        expect(envKeyedDone).toMatch(
          /in-flight\s+deploy\*{0,2}\s+is\s+unknown,\s+not\s+green/i
        );
        expect(envKeyedDone).toMatch(
          /Only\s+a\s+concluded\s+success\s+promotes/i
        );
        // Absence of a deploy system is not an unconcluded deploy.
        expect(envKeyedDone).toMatch(/no\*{0,2}\s+deploy\s+surface/i);
      });

      it("gates provider-native closure on a promotion-complete merge", () => {
        // Scoped to the terminal-value bullets, which are what authorize the
        // native close — the exact step the live instance reached wrongly.
        const terminal = slice(
          reference,
          "The true terminal `done` value is also the only value",
          "### Env order"
        );
        expect(terminal).toMatch(/\*\*promotion-complete\*\*\s+merge/i);
        expect(terminal).toMatch(
          /reached\s+the\s+terminal\s+environment\s+out\s+of\s+order\s+has\s+not\s+earned/i
        );
      });
    });

    describe("config-resolution eager rule", () => {
      const gate = slice(
        eager,
        "## Env-keyed `done` — promotion completeness",
        "Full reference:"
      );

      it("carries the gate, not only the forward env → base branch grammar", () => {
        expectGate(gate);
        expect(gate).toMatch(/entered\*{0,2},\s+never\s+the\s+environments/i);
        expect(gate).toMatch(/skipped\s+`staging`/);
        expect(gate).toMatch(
          /outstanding\s+delivery,\s+not\s+branch\s+hygiene/i
        );
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
        expect(gate).toMatch(/stopping\s+at\s+the\s+first\s+that\s+is\s+not/i);
        // When nothing is reached, write nothing — never fall back to the base.
        expect(gate).toMatch(/no\s+rung\s+is\s+reached,\s+write\s+nothing/i);
      });

      it("names the wrong inference the live instance made", () => {
        expect(gate).toMatch(/hotfix\s+merged\s+straight\s+to\s+`main`/i);
        // Real evidence, wrong inference — the point of the whole change.
        expect(gate).toMatch(
          /evidence\s+is\s+real.*inference\s+from\s+it\s+is\s+still\s+wrong/is
        );
        expect(gate).toMatch(/Do\s+not\s+classify\s+the\s+gap\s+away/i);
        expect(gate).toMatch(
          /branch\s+back-fill,\s+not\s+outstanding\s+delivery.*closing\s+anyway/is
        );
      });

      it("requires the capped write to name the missing rung in the note", () => {
        expect(gate).toMatch(/\[lisa-repair-intake\]`?\s+note\s+MUST\s+name/i);
        expect(gate).toMatch(/first\s+unreached\s+rung/i);
      });

      it("routes the merged-PR recovery through the gate", () => {
        // The path that fired: PR merged → apply env-resolved done. Scoped to
        // that step, because the skill mentions env resolution in several places
        // and only this one recovers a merged PR.
        const mergedRecovery = slice(
          repairIntake,
          "**2. PR already merged → recover, don't re-dispatch.**",
          "**3. PR only behind its base"
        );
        expect(mergedRecovery).toMatch(
          /capped\s+by\s+the\s+promotion-completeness\s+gate/i
        );
      });

      it("routes the post-agent claimed → done transition through the gate", () => {
        const resume = slice(
          repairIntake,
          "2. **On agent success**",
          "3. **On a surfaced blocker**"
        );
        expect(resume).toMatch(/cap\s+the\s+resolved\s+env\s+by/i);
        expect(resume).toMatch(/promotion-completeness\s+gate/i);
      });

      it("re-checks the gate before provider-native closure", () => {
        const terminalOpen = slice(
          repairIntake,
          "### Build terminal-open → native close / complete / resolve",
          "### Lifecycle label contradicts native state"
        );
        // A terminal label already worn is not evidence the ladder was walked.
        expect(terminalOpen).toMatch(
          /re-run\s+the\s+promotion-completeness\s+gate/i
        );
        expect(terminalOpen).toMatch(/do\s+\*\*not\*\*\s+close/i);
        expect(terminalOpen).toMatch(/Demote\s+the\s+item\s+to\s+the/i);
        expect(terminalOpen).toMatch(
          /label\s+alone\s+is\s+never\s+sufficient\s+evidence\s+to\s+close/i
        );
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
        expect(resolution).toMatch(
          /Promotion\s+completeness\s+caps\s+the\s+result/i
        );
        expect(resolution).toMatch(
          /outstanding\s+delivery,\s+not\s+branch\s+hygiene/i
        );
      });
    });
  });
});
