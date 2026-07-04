/**
 * Regression test for issue #667: the generated Codex runtime metadata for the
 * `project-ideation` skill must expose ideation prompts covering all three
 * themes the PRD (#661) requires — practical feature ideas, external public
 * inspiration, and practical self-verifiable improvements.
 *
 * The acceptance criterion is empirical and metadata-level:
 *
 *   Scenario: Skill metadata exposes ideation prompts
 *     Given the Lisa plugin build runs
 *     When generated skill metadata is inspected
 *     Then project-ideation includes prompts for feature ideas, external
 *          inspiration, and practical self-verifiable improvements
 *
 * The runtime metadata is the per-skill `agents/openai.yaml` artifact. Because a
 * single generic auto-derived `default_prompt` cannot carry all three themes,
 * the skill ships a source-authored `agents/openai.yaml` under
 * `plugins/src/base/skills/lisa-project-ideation/` (the #550 carry-through contract),
 * which the build copies verbatim into `plugins/lisa/`. This suite reads the
 * REAL committed artifacts (no temp fixture, no build) and asserts each theme is
 * present, so the three prompts can never silently regress.
 *
 * Distinct from the sibling codex suites:
 *  - source-authored-openai-yaml.test.ts (#550) proves the generic copy-through
 *    contract against a synthetic fixture.
 *  - committed-openai-yaml-in-sync.test.ts (#552) proves derived artifacts match
 *    a fresh derivation; it intentionally skips source-authored artifacts like
 *    this one.
 *  - This suite (#667) pins the project-ideation *content* — the specific three
 *    themes — against the committed bytes.
 * @module tests/unit/codex/project-ideation-runtime-metadata
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/** Repository root (three levels up from tests/unit/codex). */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
/** Source-authored runtime metadata (the build's input). */
const SOURCE_YAML = path.join(
  REPO_ROOT,
  "plugins",
  "src",
  "base",
  "skills",
  "lisa-project-ideation",
  "agents",
  "openai.yaml"
);
/** Generated runtime metadata (the build's output, inspected by the AC). */
const GENERATED_YAML = path.join(
  REPO_ROOT,
  "plugins",
  "lisa",
  "skills",
  "lisa-project-ideation",
  "agents",
  "openai.yaml"
);

/** The three ideation themes the AC requires, with a probe substring each. */
const REQUIRED_THEMES: readonly {
  readonly theme: string;
  readonly probe: string;
}[] = [
  { theme: "practical feature ideas", probe: "feature ideas" },
  {
    theme: "external public inspiration",
    probe: "external public product",
  },
  {
    theme: "practical self-verifiable improvements",
    probe: "improvements we can verify ourselves",
  },
];

describe("codex/project-ideation-runtime-metadata (#667)", () => {
  it("ships source-authored runtime metadata for project-ideation", () => {
    expect(fs.existsSync(SOURCE_YAML)).toBe(true);
  });

  it("emits the generated runtime metadata artifact", () => {
    expect(fs.existsSync(GENERATED_YAML)).toBe(true);
  });

  it("copies the source metadata through to the generated artifact byte-for-byte", () => {
    const source = fs.readFileSync(SOURCE_YAML, "utf8");
    const generated = fs.readFileSync(GENERATED_YAML, "utf8");
    expect(generated).toBe(source);
  });

  it.each(REQUIRED_THEMES)(
    "generated default_prompt covers the '$theme' theme",
    ({ probe }) => {
      const generated = fs.readFileSync(GENERATED_YAML, "utf8").toLowerCase();
      expect(generated).toContain(probe.toLowerCase());
    }
  );

  it("exposes the three themes as distinct default_prompt entries", () => {
    const generated = fs.readFileSync(GENERATED_YAML, "utf8");
    const promptLines = generated
      .split("\n")
      .filter(line => line.trim().startsWith("- "));
    // At least one prompt per required theme, kept distinct so each theme is
    // independently invocable rather than collapsed into one generic starter.
    expect(promptLines.length).toBeGreaterThanOrEqual(REQUIRED_THEMES.length);
    for (const { probe } of REQUIRED_THEMES) {
      const matching = promptLines.filter(line =>
        line.toLowerCase().includes(probe.toLowerCase())
      );
      expect(matching.length).toBeGreaterThan(0);
    }
  });
});
