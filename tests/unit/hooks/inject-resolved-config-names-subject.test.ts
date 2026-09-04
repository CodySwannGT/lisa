import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  hookRunner,
  MAIN_CONFIG,
  project,
  writeJson,
} from "../../helpers/inject-resolved-config-harness.js";

/**
 * The injected block has to say WHAT it resolved for.
 *
 * It used to open with "these are this project's EFFECTIVE Lisa configuration
 * values" — a possessive with no referent anywhere in its text — and then, in
 * the next sentence, instruct the reader not to open the config files. Two
 * different repositories therefore produced blocks that were identical
 * character for character except for the values themselves.
 *
 * That combination is what makes it a manufacturing process rather than a
 * mistake. An agent standing in one directory while doing work governed by
 * another read something perfectly TRUE about the directory and WRONG about
 * the work, with no textual signal to catch it on and an explicit instruction
 * against the one check that would have revealed it. Six independent agent
 * cycles reached the same false conclusion from one such block; three stalled,
 * and one propagated the refusal into a shared brief that two more inherited
 * (CodySwannGT/lisa#3765).
 *
 * The two assertions that carry the criterion pull in opposite directions and
 * both must hold: the block must NAME its subject, and it must still
 * discourage re-reading for work in that same directory — the token saving is
 * legitimate and is scoped here, not removed.
 * @module tests/unit/hooks/inject-resolved-config-names-subject
 */

const { contextFor } = hookRunner(process.env);

/** The rule files that restate the hook's instruction. */
const EAGER_RULES = [
  "plugins/src/base/rules/eager/config-resolution.md",
  "plugins/lisa/rules/eager/config-resolution.md",
  "plugins/lisa-copilot/rules/eager/config-resolution.md",
  "plugins/lisa-cursor/rules/config-resolution.mdc",
];

/** The base hook and every generated copy of it. */
const HOOK_COPIES = [
  "plugins/src/base/hooks/inject-resolved-config.mjs",
  "plugins/lisa/hooks/inject-resolved-config.mjs",
  "plugins/lisa-cursor/hooks/inject-resolved-config.mjs",
  "plugins/lisa-copilot/hooks/inject-resolved-config.mjs",
];

/** The repository whose config actually governs the work. */
const GOVERNING = "governing-repo";

/** A sibling checkout an agent might be standing in while doing GOVERNING's work. */
const WRAPPER = "wrapper-repo";

/**
 * A project directory holding a valid config.
 * @param name - Directory name, so the subject is predictable
 * @returns Absolute path to the project root
 */
function configured(name: string): string {
  const parent = project();
  const root = path.join(parent, name);
  mkdirSync(root, { recursive: true });
  writeJson(root, MAIN_CONFIG, { tracker: "github" });
  return root;
}

describe("the emitted block names what it resolved for", () => {
  it("names the directory it resolved from", () => {
    // THE regression assertion. Against the pre-fix hook the block contained
    // no path at all — a grep for the project directory returned zero.
    const root = configured(GOVERNING);

    expect(contextFor(root)).toContain(root);
  });

  it("names the repository by its short name, not only the full path", () => {
    // The path is the unambiguous identifier; the short name is what a reader
    // actually compares against the work in front of them.
    expect(contextFor(configured(GOVERNING))).toContain(GOVERNING);
  });

  it("no longer asserts a subject it never names", () => {
    expect(contextFor(configured(GOVERNING))).not.toContain(
      "this project's EFFECTIVE"
    );
  });

  it("gives two sibling repositories distinguishable blocks", () => {
    // Pre-fix these differed only in their values, so an agent holding the
    // wrong one had nothing in the text to catch it on.
    const wrapper = configured(WRAPPER);
    const governing = configured(GOVERNING);

    const first = contextFor(wrapper).split("\n")[1];
    const second = contextFor(governing).split("\n")[1];

    expect(first).not.toEqual(second);
    expect(first).toContain(WRAPPER);
    expect(second).toContain(GOVERNING);
  });
});

describe("the instruction is scoped, not removed", () => {
  it("still tells an agent not to re-read the files for work in this directory", () => {
    // The token saving is legitimate. Removing it would trade one defect for
    // a different one, so the fix scopes the instruction rather than deleting
    // it — and this case is what stops a future simplification dropping it.
    expect(contextFor(configured("solo-repo"))).toContain(
      "do not re-read the config files"
    );
  });

  it("directs work that targets another repository to that repository's config", () => {
    expect(contextFor(configured("solo-repo"))).toContain(
      "read that repository's config"
    );
  });

  it("says the values describe the directory it resolved from", () => {
    expect(contextFor(configured("solo-repo"))).toContain(
      "describe THAT directory"
    );
  });
});

describe("every surface carries the same scoped wording", () => {
  it.each(EAGER_RULES)(
    "%s names the directory the block resolved for",
    file => {
      // A code-only fix leaves the documentation still telling agents not to
      // verify, which is the half that made the false conclusion durable.
      const source = readFileSync(path.resolve(file), "utf8");

      expect(source).toContain("names the directory it resolved for");
      expect(source).toContain("read that repository's config instead");
    }
  );

  it("keeps every generated hook copy byte-identical to the base", () => {
    // Fixing one variant and missing the other two is the parity failure
    // AGENTS.md forbids; all four are generated from the base.
    const digests = new Set(
      HOOK_COPIES.map(file => readFileSync(path.resolve(file), "utf8"))
    );

    expect(digests.size).toBe(1);
  });
});

describe("the fix is not paid for out of the context budget", () => {
  it.each([
    ["CONTEXT_BUDGET", "const CONTEXT_BUDGET = 4000;"],
    ["MAX_LINE", "const MAX_LINE = 400;"],
  ])("leaves the %s ratchet untouched", (_name, declaration) => {
    // Every defect in this family has a budget-raise pseudo-fix available.
    // Naming a subject costs one clause in the preamble, and the preamble is
    // not what CONTEXT_BUDGET caps — it bounds the rendered value body.
    const source = readFileSync(
      path.resolve("plugins/src/base/hooks/inject-resolved-config.mjs"),
      "utf8"
    );

    expect(source).toContain(declaration);
  });
});
