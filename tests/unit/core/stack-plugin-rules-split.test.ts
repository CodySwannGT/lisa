/**
 * The three stack plugins that never adopted the eager/reference rule split,
 * and the two silences that kept it invisible (#3993).
 *
 * `lisa-rails`, `lisa-phaser` and `lisa-harper-fabric` shipped their whole rule
 * body as a flat `rules/<slug>.md`. Two consequences, neither of which produced
 * an error anywhere:
 *
 *  1. **Claude/Copilot paid the full body every session.** Each stack plugin
 *     ships its OWN `hooks/inject-rules.sh`, and all three read `$ROOT/rules`
 *     directly — they never had an `eager/` branch at all. So the reference-tier
 *     prose was injected at every SessionStart AND SubagentStart, which is what
 *     the split exists to stop.
 *  2. **Codex and OpenCode received nothing.** `mirrorLisaRules` does copy a
 *     flat root `.md`, but it lands at the mirror root — and the surfaces that
 *     READ the mirror are scoped to the eager tier (`.codex/lisa-rules/eager/`
 *     via the Codex injector, `.opencode/lisa-rules/eager/*.md` via OpenCode's
 *     native `instructions` glob). A file at the root is mirrored and then never
 *     read.
 *
 * These assertions bind the split itself, so an unsplit plugin fails loudly
 * instead of being absorbed by a fallback.
 * @module tests/unit/core/stack-plugin-rules-split
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectType } from "../../../src/core/config.js";
import { mirrorLisaRules } from "../../../src/core/lisa-rules-mirror.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const REPO_ROOT = process.cwd();

/** The three stack plugins this issue is about, as `<type>` + rule slug. */
const STACK_RULES: readonly {
  readonly type: ProjectType;
  readonly slug: string;
}[] = [
  { type: "rails", slug: "rails-conventions" },
  { type: "phaser", slug: "phaser" },
  { type: "harper-fabric", slug: "harper-fabric" },
];

/**
 * Every `rules/` root the build produces or consumes, source and artifact.
 * @returns Absolute paths to each existing plugin `rules` directory.
 */
function allRuleRoots(): readonly string[] {
  const roots = [
    path.join(REPO_ROOT, "plugins"),
    path.join(REPO_ROOT, "plugins", "src"),
  ];
  return roots.flatMap(parent =>
    readdirSync(parent, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(parent, entry.name, "rules"))
      .filter(dir => existsSync(dir) && statSync(dir).isDirectory())
  );
}

/**
 * List the `.md` files sitting directly in a `rules/` root, outside either tier.
 * @param rulesRoot - Absolute path to a plugin's `rules/` directory.
 * @returns Basenames of every untiered rule body in that root.
 */
function flatMarkdownRules(rulesRoot: string): readonly string[] {
  return readdirSync(rulesRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".md"))
    .map(entry => entry.name);
}

describe("stack plugin rules adopt the eager/reference split", () => {
  it("ships no rule body outside the eager/ and reference/ tiers", () => {
    const offenders = allRuleRoots()
      .map(root => ({ root, flat: flatMarkdownRules(root) }))
      .filter(({ flat }) => flat.length > 0)
      .map(
        ({ root, flat }) =>
          `${path.relative(REPO_ROOT, root)}: ${flat.join(", ")}`
      );

    expect(offenders).toEqual([]);
  });

  it.each(STACK_RULES)(
    "splits $type into a paired eager head and reference body",
    ({ type, slug }) => {
      for (const pluginDir of [
        path.join(REPO_ROOT, "plugins", "src", type, "rules"),
        path.join(REPO_ROOT, "plugins", `lisa-${type}`, "rules"),
      ]) {
        expect(existsSync(path.join(pluginDir, "eager", `${slug}.md`))).toBe(
          true
        );
        expect(
          existsSync(path.join(pluginDir, "reference", `${slug}.md`))
        ).toBe(true);
      }
    }
  );

  it.each(STACK_RULES)(
    "$type's own injector reads the eager tier with no flat fallback",
    ({ type }) => {
      const script = readFileSync(
        path.join(
          REPO_ROOT,
          "plugins",
          `lisa-${type}`,
          "hooks",
          "inject-rules.sh"
        ),
        "utf8"
      );

      expect(script).toContain('RULES_DIR="$ROOT/rules/eager"');
      // The flat fallback is what made four months of unsplit plugins invisible.
      expect(script).not.toMatch(/RULES_DIR="\$ROOT\/rules"/);
    }
  );

  it.each(STACK_RULES)(
    "$type's eager head is smaller than the body it replaced at the root",
    ({ type, slug }) => {
      const tier = (sub: string): number =>
        Buffer.byteLength(
          readFileSync(
            path.join(
              REPO_ROOT,
              "plugins",
              `lisa-${type}`,
              "rules",
              sub,
              `${slug}.md`
            )
          )
        );

      expect(tier("eager")).toBeLessThan(tier("reference"));
    }
  );
});

describe("mirrorLisaRules reaches Codex and OpenCode with stack rules", () => {
  let destDir = "";

  beforeEach(async () => {
    destDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(destDir);
  });

  it.each(STACK_RULES)(
    "mirrors $type's rule into the eager tier the mirror consumers read",
    async ({ type, slug }) => {
      const mirrored = await mirrorLisaRules(REPO_ROOT, destDir, [type]);

      expect(mirrored).toContain(path.join("eager", `${slug}.md`));
      expect(mirrored).toContain(path.join("reference", `${slug}.md`));
      // Nothing may land at the mirror root: neither consumer reads it there.
      expect(mirrored.filter(rel => !rel.includes(path.sep))).toEqual([]);
    }
  );
});
