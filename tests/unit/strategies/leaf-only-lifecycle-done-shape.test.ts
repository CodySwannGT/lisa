/**
 * Regression test for CodySwannGT/lisa#3774.
 *
 * The reference `leaf-only-lifecycle` rule described this repository's
 * `github.labels.build.done` role as "a single value, not a map", while
 * `.lisa.config.json` declares the generic three-key env map (`dev` /
 * `staging` / `production`). Nothing broke — `deploy.branches` maps only
 * `production → main`, so resolution lands on the production rung either way —
 * but the sentence told the next reader that no env resolution happens here,
 * which terminates the search for any lifecycle defect living on the env-keyed
 * path. The config is right and the prose was wrong: `lisa-setup-github`
 * creates the env-keyed map by default, so the collapse belongs to resolution,
 * not to declaration.
 *
 * The guard compares the shape the rule DESCRIBES against the shape the config
 * DECLARES and fails on disagreement in either direction. Both directions are
 * exercised below against fixtures — the pre-fix prose over the real map
 * config, and the corrected prose over a scalar config — so the comparison is
 * proved to discriminate rather than to pass for any shape.
 *
 * Every generated copy of the rule is asserted alongside the source of truth,
 * so an artifact-only edit or a missed `bun run build:plugins` fails the suite.
 * @module tests/unit/strategies/leaf-only-lifecycle-done-shape
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Path of the reference rule variant within a Claude-shaped plugin root. */
const RULE_REL = "rules/reference/leaf-only-lifecycle.md";

/** Source of truth plus every generated artifact that carries the rule. */
const RULE_COPIES = [
  `plugins/src/base/${RULE_REL}`,
  `plugins/lisa/${RULE_REL}`,
  `plugins/lisa-copilot/${RULE_REL}`,
  "plugins/lisa-cursor/rules/leaf-only-lifecycle-reference.mdc",
] as const;

/** The paragraph as it shipped before #3774 — the wrong-shape fixture. */
const PRE_FIX_PARAGRAPH =
  "**Single-environment collapse (this repo).** Lisa's own deploy has only " +
  "`main`/`production` (no dev/staging), so `done` is a single value, not a " +
  "map. For GitHub, the build lifecycle collapses to one chain: `ready → " +
  "claimed (in-progress) → done`. The rollup terminal state is simply `done`. " +
  "This is the *collapsed* case of the generic rule, not a different rule — " +
  "projects with more environments keep the env-keyed map.";

/**
 *
 */
type DoneShape = "ambiguous" | "map" | "scalar";

/** Resolved `.lisa.config.json` for this repository. */
const REPO_CONFIG: unknown = JSON.parse(
  readFileSync(path.resolve(".lisa.config.json"), "utf8")
);

/**
 * Isolates the paragraph that makes a claim about THIS repository's `done`.
 * @param rule Full markdown text of one copy of the leaf-only-lifecycle rule.
 * @returns The single-environment-collapse paragraph.
 */
const collapseParagraph = (rule: string): string => {
  const paragraph = rule
    .split("\n\n")
    .find(block => block.startsWith("**Single-environment collapse"));
  if (paragraph === undefined) {
    throw new Error("no single-environment-collapse paragraph in the rule");
  }
  return paragraph;
};

/**
 * Sentences scoped to OTHER projects ("projects with more deploy branches …")
 * describe the generic rule, so they must not count toward what the paragraph
 * claims about this repository's own declaration.
 * @param paragraph The single-environment-collapse paragraph.
 * @returns The paragraph's this-repo sentences, rejoined.
 */
const thisRepoSentences = (paragraph: string): string =>
  paragraph
    .split(/(?<=\.)\s+/u)
    .filter(sentence => !/\bprojects\s+with\b/iu.test(sentence))
    .join(" ");

/**
 * The `done` shape the rule's prose asserts for this repository.
 * @param paragraph The single-environment-collapse paragraph.
 * @returns `map`, `scalar`, or `ambiguous` when the prose claims both or neither.
 */
const documentedDoneShape = (paragraph: string): DoneShape => {
  const scoped = thisRepoSentences(paragraph);
  const claimsScalar =
    /\bnot a map\b/iu.test(scoped) || /`done` is a single value/iu.test(scoped);
  const claimsMap =
    /\bdeclares\b/iu.test(scoped) && /env-keyed\W{0,4}map/iu.test(scoped);
  if (claimsScalar === claimsMap) {
    return "ambiguous";
  }
  return claimsScalar ? "scalar" : "map";
};

/**
 * The `done` shape a resolved Lisa config actually declares.
 * @param config A parsed `.lisa.config.json`.
 * @returns `map`, `scalar`, or `ambiguous` when no `done` role is declared.
 */
const declaredDoneShape = (config: unknown): DoneShape => {
  const done = (
    config as {
      readonly github?: {
        readonly labels?: { readonly build?: { readonly done?: unknown } };
      };
    }
  )?.github?.labels?.build?.done;
  if (typeof done === "string" && done.trim().length > 0) {
    return "scalar";
  }
  if (typeof done === "object" && done !== null) {
    return "map";
  }
  return "ambiguous";
};

describe("leaf-only-lifecycle `done` shape claim (#3774)", () => {
  it("this repository declares the env-keyed map, not a scalar", () => {
    expect(declaredDoneShape(REPO_CONFIG)).toBe("map");
  });

  describe.each(RULE_COPIES)("%s", copy => {
    const paragraph = collapseParagraph(
      readFileSync(path.resolve(copy), "utf8")
    );

    it("describes the shape the config declares", () => {
      expect(documentedDoneShape(paragraph)).toBe(
        declaredDoneShape(REPO_CONFIG)
      );
    });

    it("attributes the collapse to resolution through deploy.branches", () => {
      expect(paragraph).toMatch(/resolution/iu);
      expect(paragraph).toMatch(/deploy\.branches/u);
    });
  });
});

describe("the shape comparison fails on the wrong shape (#3774)", () => {
  it("rejects the pre-fix prose, which claimed a scalar over a map config", () => {
    expect(documentedDoneShape(PRE_FIX_PARAGRAPH)).toBe("scalar");
    expect(documentedDoneShape(PRE_FIX_PARAGRAPH)).not.toBe(
      declaredDoneShape(REPO_CONFIG)
    );
  });

  it("rejects the corrected prose over a scalar config", () => {
    const scalarConfig = {
      github: { labels: { build: { done: "status:done" } } },
    };
    const shipped = collapseParagraph(
      readFileSync(path.resolve(`plugins/src/base/${RULE_REL}`), "utf8")
    );
    expect(declaredDoneShape(scalarConfig)).toBe("scalar");
    expect(documentedDoneShape(shipped)).toBe("map");
    expect(documentedDoneShape(shipped)).not.toBe(
      declaredDoneShape(scalarConfig)
    );
  });
});
