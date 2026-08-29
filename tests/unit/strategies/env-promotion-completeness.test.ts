/**
 * Prose contract for the env-keyed `done` promotion-completeness gate (#3423).
 *
 * Env-keyed `done` resolution mapped a merged PR's base branch to an
 * environment and treated the production value as terminal, without ever asking
 * whether the *intermediate* environments carried the merge commit. A hotfix
 * merged straight to the production branch satisfied "reached production" by an
 * out-of-order route, so the work item closed while a lower environment had
 * none of the fix.
 *
 * The gate caps the resolved env at the highest contiguously reached rung of
 * `deploy.order`, proving ancestry for every rung at or below it and reading
 * each rung's most recent *concluded* deploy. It only ever lowers the resolved
 * env, so it can hold an item open but never close one that would otherwise
 * stay open.
 *
 * These are agent instructions, so the assertions cover the canonical plugin
 * source and the checked-in runtime projections. Per-agent parity gaps
 * (documented, not silently dropped): the agy variant ships no `rules/` tree
 * (its bounded AGENTS.md bridge covers rules), and Cursor projects rules to
 * flat `<name>-reference.mdc` files.
 * @module tests/unit/strategies/env-promotion-completeness
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Opening delimiter of the gate's reference bash implementation. */
const GATE_START = "<!-- promotion-completeness-gate:start -->";

/** Closing delimiter of the gate's reference bash implementation. */
const GATE_END = "<!-- promotion-completeness-gate:end -->";

/** Plugin roots carrying a `rules/reference/` tree. */
const RULE_ROOTS = [
  "plugins/src/base",
  "plugins/lisa",
  "plugins/lisa-copilot",
] as const;

/** Cursor projects the same two rules to flat `.mdc` files. */
const CURSOR_RULE_PATHS = [
  "plugins/lisa-cursor/rules/config-resolution-reference.mdc",
  "plugins/lisa-cursor/rules/leaf-only-lifecycle-reference.mdc",
] as const;

/** Every plugin root carrying a projected `skills/` tree. */
const SKILL_ROOTS = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa/.codex-plugin/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
] as const;

/** The three vendor scanners that restate the env-resolution algorithm. */
const VENDOR_BUILD_SKILLS = [
  "lisa-github-build-intake",
  "lisa-jira-build-intake",
  "lisa-linear-build-intake",
] as const;

const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

const readSkill = (root: string, slug: string): string =>
  read(path.join(root, slug, "SKILL.md"));

/**
 * Extracts the delimited gate implementation so verbatim embedding across the
 * vendor scanners can be asserted byte-for-byte.
 * @param body Markdown body carrying the delimited gate snippet.
 * @returns The snippet between the markers, inclusive.
 */
function extractGate(body: string): string {
  const start = body.indexOf(GATE_START);
  const end = body.indexOf(GATE_END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("promotion-completeness gate snippet not found");
  }
  const result = body.slice(start, end + GATE_END.length);
  return result;
}

/** The canonical gate implementation, from the rule that owns it. */
const CANONICAL_GATE = extractGate(
  read("plugins/src/base/rules/reference/config-resolution.md")
);

describe("env-keyed done promotion-completeness gate", () => {
  describe.each(RULE_ROOTS)("config-resolution (%s)", root => {
    const content = read(
      path.join(root, "rules/reference/config-resolution.md")
    );

    it("makes the gate a mandatory step of env resolution", () => {
      expect(content).toContain("#### Promotion-completeness gate");
      expect(content).toMatch(/4\. \*\*Promotion-completeness gate\*\*/);
      expect(content).toMatch(/only \*claimed\*/);
      expect(content).toMatch(/applies to an explicit `target_env` too/i);
    });

    it("requires ancestry for every rung at or below the resolved env", () => {
      expect(content).toContain(
        "git merge-base --is-ancestor <merge-sha> origin/<branch>"
      );
      expect(content).toMatch(
        /asserted for \*\*every\*\* rung at or below the resolved env, not only the PR's base/
      );
      expect(content).toMatch(/highest \*\*contiguously reached\*\* rung/);
      expect(content).toMatch(
        /Rungs \*\*above\*\* an unreached rung are not reached/
      );
    });

    it("reads deploy conclusion, never status", () => {
      expect(content).toMatch(
        /most recent \*\*concluded\*\* deploy did not conclude failure/
      );
      expect(content).toMatch(
        /Read the `conclusion` field, \*\*never\*\* the `status`/
      );
      expect(content).toMatch(
        /in-flight deploy has a `null` conclusion and is indistinguishable from a pass/
      );
      expect(content).toMatch(/no concluded deploy observed/);
    });

    it("only ever lowers the resolved env", () => {
      expect(content).toMatch(
        /gate only ever lowers the resolved env; it never raises one/
      );
      expect(content).toMatch(
        /can never close one the ungated resolution would have left open/
      );
      expect(content).toMatch(
        /still-running deploy on the merged-into branch keeps the item at `claimed`/
      );
    });

    it("names the first unreached rung, its branch, and the failing half", () => {
      expect(content).toMatch(
        /MUST name the first unreached rung, its branch, and which half failed/
      );
      expect(content).toMatch(/is not an ancestor/);
      expect(content).toMatch(/concluded deploy run <id> concluded failure/);
      expect(content).toMatch(
        /bare "blocked on promotion" is not an acceptable reason/i
      );
    });

    it("refuses a terminal write when the ladder is unknowable", () => {
      expect(content).toMatch(/When the ladder is unknowable/);
      expect(content).toMatch(
        /single distinct branch\*\* → there is no promotion chain/
      );
      expect(content).toMatch(
        /no `deploy.order`\*\* → refuse to write a terminal value/
      );
      expect(content).toMatch(
        /Never write a terminal value on an unevaluated gate/
      );
    });

    it("classifies a promotion gap as incomplete delivery, not hygiene", () => {
      expect(content).toMatch(
        /promotion gap is incomplete delivery, not branch hygiene/i
      );
      expect(content).toMatch(/back-fill PR/);
      expect(content).toMatch(/lisa-sync-down/);
    });

    it("documents the gate's inputs and the cancelled-conclusion carve-out", () => {
      expect(content).toMatch(/`MERGE_SHA`/);
      expect(content).toMatch(/mergeCommit/);
      expect(content).toMatch(
        /`cancelled` is deliberately \*\*not\*\* treated as a concluded failure/
      );
      expect(content).toMatch(/concurrency groups/);
    });

    it("carries the canonical gate implementation verbatim", () => {
      expect(extractGate(content)).toBe(CANONICAL_GATE);
    });
  });

  describe.each(RULE_ROOTS)("leaf-only-lifecycle (%s)", root => {
    const content = read(
      path.join(root, "rules/reference/leaf-only-lifecycle.md")
    );

    it("gates terminal native closure on the promotion-completeness gate", () => {
      expect(content).toMatch(
        /terminal value must have survived the promotion-completeness gate/i
      );
      expect(content).toMatch(
        /Reaching the production branch is not the same as having been promoted/
      );
      expect(content).toMatch(
        /authorized by a \*gated\* terminal value, never by a raw base-branch reverse-lookup/
      );
    });
  });

  describe.each(CURSOR_RULE_PATHS)("cursor rule projection (%s)", rulePath => {
    const content = read(rulePath);

    it("carries the gate contract", () => {
      expect(content).toMatch(/promotion-completeness gate/i);
    });
  });

  describe.each(SKILL_ROOTS)("%s", root => {
    describe.each(VENDOR_BUILD_SKILLS)("%s", slug => {
      const content = readSkill(root, slug);

      it("adds the gate as step 5 of env resolution", () => {
        expect(content).toMatch(
          /5\. Then apply the \*\*promotion-completeness gate\*\*/
        );
        expect(content).toMatch(/only a \*claimed\* env/);
        expect(content).toMatch(/read `conclusion`, never `status`/);
        expect(content).toMatch(/only ever lowers the env, never raises it/);
      });

      it("embeds the canonical gate implementation verbatim", () => {
        expect(extractGate(content)).toBe(CANONICAL_GATE);
      });

      it("gates the merged-PR closure path specifically", () => {
        expect(content).toMatch(
          /The env written is the \*\*gated\*\* env \(resolution step 5\)/
        );
        expect(content).toMatch(
          /hotfix straight to the production branch while a lower environment lacks it/
        );
        expect(content).toMatch(
          /back-fill PR against the skipped environment is incomplete delivery, not branch hygiene/
        );
      });
    });

    describe("lisa-tracker-build-intake", () => {
      const content = readSkill(root, "lisa-tracker-build-intake");

      it("forwards one vendor-neutral gate contract", () => {
        expect(content).toContain(
          "## Promotion-completeness gate (forwarded to every vendor)"
        );
        expect(content).toMatch(
          /produces a \*\*claimed\*\* env, not a delivered one/
        );
        expect(content).toMatch(
          /embed that snippet verbatim rather than restating it/
        );
        expect(content).toMatch(
          /only ever lowers the resolved env, never raises it/
        );
        expect(content).toMatch(/incomplete delivery, not branch hygiene/i);
      });
    });

    describe("lisa-repair-intake", () => {
      const content = readSkill(root, "lisa-repair-intake");

      it("gates the post-agent claimed → done transition", () => {
        expect(content).toMatch(
          /That resolution yields only a \*\*claimed\*\* env: apply\s+the \*\*promotion-completeness gate\*\*/
        );
      });

      it("gates merged-PR recovery, the incident's own path", () => {
        expect(content).toMatch(
          /A merged PR is not by itself proof of delivery/
        );
        expect(content).toMatch(
          /asserts an incident is resolved while a lower environment\s+is still broken/
        );
        expect(content).toMatch(
          /Do \*\*not\*\* classify a skipped environment as branch hygiene/
        );
      });

      it("re-evaluates the gate before native closure rather than trusting a prior label", () => {
        expect(content).toMatch(
          /Re-evaluate the promotion-completeness gate before closing/
        );
        expect(content).toMatch(
          /is a \*claim\* left by an\s+earlier pass, not proof/
        );
        expect(content).toMatch(
          /a second sweep reading the first sweep's label is not corroboration/
        );
      });
    });
  });
});
