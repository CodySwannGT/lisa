/**
 * Regression test for issue #551: the Codex artifact build
 * (scripts/generate-codex-plugin-artifacts.mjs, invoked per plugin by
 * scripts/build-plugins.sh) must be byte-stable — running `bun run
 * build:plugins` a second time on an already-built tree produces no diff.
 *
 * The ticket's acceptance criterion is empirical:
 *
 *   Scenario: Second consecutive build produces no diff
 *     Given a clean tree with committed generated artifacts
 *     When bun run build:plugins runs a second time
 *     Then git status --porcelain reports no changes
 *
 * Shelling out to the full `bun run build:plugins` twice (it rebuilds nine
 * plugins and copies thousands of files) is too slow for a unit suite, so this
 * suite reproduces the exact per-plugin contract that determines stability —
 * `cp -r "$src/." "$out/"` then `node generate-codex-plugin-artifacts.mjs` — on
 * a small isolated fixture, and asserts three layers of determinism:
 *
 *  1. Re-running the generator on an ALREADY-built dir changes no byte (the
 *     direct analogue of "second build → empty git status --porcelain").
 *  2. Two independent build pipelines from the same source produce
 *     byte-identical generated artifacts (no run-to-run drift from key order,
 *     timestamps, or filesystem iteration order).
 *  3. The pure derivation+serialization path is a function of its input only,
 *     exercised against the specific risks #551 calls out: unstable key order,
 *     timestamps, and locale-dependent title-casing in display_name.
 *
 * The fixture deliberately includes the shapes most likely to expose
 * non-determinism: many sibling skills (filesystem ordering), acronyms and
 * mixed case (humanization), special YAML characters (quoting), a no-frontmatter
 * skill (fallback path), and a hand-authored openai.yaml (no-clobber guard).
 * @module tests/unit/codex/build-byte-stable
 */
import { spawnSync } from "node:child_process";
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deriveSkillInterface,
  parseSkillFrontmatter,
  serializeInterfaceToYaml,
} from "../../../scripts/generate-codex-plugin-artifacts.mjs";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Absolute path to the generator the build pipeline invokes per plugin. */
const GENERATOR_PATH = path.resolve(
  "scripts/generate-codex-plugin-artifacts.mjs"
);
/** The per-skill artifact filename. */
const OPENAI_YAML = "openai.yaml";
/** Per-skill agents directory name. */
const AGENTS = "agents";
/** Top-level skills directory name. */
const SKILLS = "skills";
/** Dummy release version passed positionally to the generator. */
const VERSION = "9.9.9";
/**
 * Absolute path to the Node interpreter running this suite. Using a fixed
 * executable rather than a bare "node" satisfies sonarjs
 * no-os-command-from-path and pins both pipeline runs to the same interpreter.
 */
const NODE_BIN = process.execPath;

/**
 * Fixture skills covering the shapes most likely to expose non-determinism.
 * Each entry is [skillName, frontmatterDescription]. The names mix kebab,
 * acronyms, and mixed case so humanization is exercised; descriptions include
 * boilerplate prefixes and special characters so summarization and YAML quoting
 * are exercised.
 */
const FIXTURE_SKILLS: readonly (readonly [string, string])[] = [
  ["alpha-skill", "First skill in the set."],
  [
    "lisa-exploratory-qa",
    "Playwright-backed exploratory QA workflow for web apps.",
  ],
  ["setup-jira-api", "This skill should be used when wiring up the JIRA API."],
  [
    "tricky-chars",
    'Has a colon: a "quote", and a # hash plus | pipe characters.',
  ],
  ["zeta-cli", "Last alphabetically; a CLI helper."],
];
/** A skill directory that ships a SKILL.md with no frontmatter (fallback path). */
const NO_FRONTMATTER_SKILL = "no-frontmatter";
/** A skill that ships a hand-authored openai.yaml (no-clobber guard). */
const HAND_AUTHORED_SKILL = "hand-authored";
/** Sentinel contents for the hand-authored openai.yaml. */
const HAND_AUTHORED_YAML =
  'display_name: "HAND AUTHORED #551"\n' +
  'short_description: "must survive every build byte-for-byte"\n' +
  "default_prompt:\n" +
  '  - "Use $hand-authored: sentinel"\n';

describe("codex/build-byte-stable (#551)", () => {
  let srcDir: string;

  beforeEach(async () => {
    srcDir = await createTempDir();
    await seedSource(srcDir);
  });

  afterEach(async () => {
    await cleanupTempDir(srcDir);
  });

  /**
   * Seed a source plugin tree: a minimal Claude manifest (the generator exits
   * early without it), the fixture skills, a no-frontmatter skill, and a
   * hand-authored openai.yaml.
   * @param dir Source plugin directory to populate.
   */
  async function seedSource(dir: string): Promise<void> {
    await fs.ensureDir(path.join(dir, ".claude-plugin"));
    await fs.writeJson(path.join(dir, ".claude-plugin", "plugin.json"), {
      name: "lisa-fixture",
      version: "0.0.0",
      description: "Byte-stability fixture plugin",
    });
    for (const [name, description] of FIXTURE_SKILLS) {
      const skillDir = path.join(dir, SKILLS, name);
      await fs.ensureDir(skillDir);
      await fs.writeFile(
        path.join(skillDir, "SKILL.md"),
        `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
      );
    }
    // SKILL.md with no frontmatter block — exercises the derivation fallback.
    const noFmDir = path.join(dir, SKILLS, NO_FRONTMATTER_SKILL);
    await fs.ensureDir(noFmDir);
    await fs.writeFile(
      path.join(noFmDir, "SKILL.md"),
      `# ${NO_FRONTMATTER_SKILL}\n\nNo frontmatter here.\n`
    );
    // Skill carrying a hand-authored openai.yaml that must be preserved.
    const handDir = path.join(dir, SKILLS, HAND_AUTHORED_SKILL, AGENTS);
    await fs.ensureDir(handDir);
    await fs.writeFile(path.join(handDir, OPENAI_YAML), HAND_AUTHORED_YAML);
    await fs.writeFile(
      path.join(dir, SKILLS, HAND_AUTHORED_SKILL, "SKILL.md"),
      `---\nname: ${HAND_AUTHORED_SKILL}\ndescription: Ships its own interface.\n---\n\n# ${HAND_AUTHORED_SKILL}\n`
    );
  }

  /**
   * Reproduce one per-plugin build step from scripts/build-plugins.sh:
   * `cp -r "$src/." "$out/"` then invoke the generator on the built dir.
   * @param outDir Destination plugin directory (the build artifact).
   * @returns The spawnSync result for the generator invocation.
   */
  function buildInto(outDir: string): ReturnType<typeof spawnSync> {
    fs.copySync(srcDir, outDir);
    return spawnSync(NODE_BIN, [GENERATOR_PATH, outDir, VERSION], {
      encoding: "utf-8",
    });
  }

  /**
   * Snapshot every generated/copied artifact under a built plugin dir as a
   * relative-path -> contents map, so two builds can be compared structurally
   * (a true "git status --porcelain" analogue rather than a single hash).
   * @param dir Built plugin directory to walk.
   * @returns Sorted map of POSIX relative paths to file contents.
   */
  async function snapshotTree(dir: string): Promise<Record<string, string>> {
    const snapshot: Record<string, string> = {};
    const walk = async (current: string): Promise<void> => {
      const entries = await fs.readdir(current, { withFileTypes: true });
      const sorted = entries.toSorted((a, b) => a.name.localeCompare(b.name));
      for (const entry of sorted) {
        const abs = path.join(current, entry.name);
        if (entry.isDirectory()) {
          await walk(abs);
        } else {
          const rel = path.relative(dir, abs).split(path.sep).join("/");
          snapshot[rel] = await fs.readFile(abs, "utf8");
        }
      }
    };
    await walk(dir);
    return snapshot;
  }

  it("re-running the generator on an already-built dir changes no byte (AC: second build → no diff)", async () => {
    const outDir = await createTempDir();
    try {
      const first = buildInto(outDir);
      expect(first.status).toBe(0);
      const before = await snapshotTree(outDir);

      // Second consecutive generator pass over the SAME built tree — this is
      // the direct analogue of `bun run build:plugins` running a second time.
      const second = spawnSync(NODE_BIN, [GENERATOR_PATH, outDir, VERSION], {
        encoding: "utf-8",
      });
      expect(second.status).toBe(0);
      const after = await snapshotTree(outDir);

      expect(after).toEqual(before);
    } finally {
      await cleanupTempDir(outDir);
    }
  });

  it("produces byte-identical generated artifacts across two independent builds", async () => {
    const outA = await createTempDir();
    const outB = await createTempDir();
    try {
      expect(buildInto(outA).status).toBe(0);
      expect(buildInto(outB).status).toBe(0);

      const snapA = await snapshotTree(outA);
      const snapB = await snapshotTree(outB);

      const keysA = Object.keys(snapA).toSorted((a, b) => a.localeCompare(b));
      const keysB = Object.keys(snapB).toSorted((a, b) => a.localeCompare(b));
      expect(keysA).toEqual(keysB);
      for (const rel of Object.keys(snapA)) {
        expect(snapB[rel]).toBe(snapA[rel]);
      }
    } finally {
      await cleanupTempDir(outA);
      await cleanupTempDir(outB);
    }
  });

  it("preserves the hand-authored openai.yaml byte-for-byte on every build", async () => {
    const outDir = await createTempDir();
    try {
      expect(buildInto(outDir).status).toBe(0);
      const built = await fs.readFile(
        path.join(outDir, SKILLS, HAND_AUTHORED_SKILL, AGENTS, OPENAI_YAML),
        "utf8"
      );
      expect(built).toBe(HAND_AUTHORED_YAML);
    } finally {
      await cleanupTempDir(outDir);
    }
  });

  it("derives byte-identical openai.yaml for every fixture skill across repeated invocations (pure function)", () => {
    for (const [name] of FIXTURE_SKILLS) {
      const skillMd = path.join(srcDir, SKILLS, name, "SKILL.md");
      const frontmatter = parseSkillFrontmatter(skillMd);

      const first = serializeInterfaceToYaml(
        deriveSkillInterface(frontmatter, name)
      );
      const second = serializeInterfaceToYaml(
        deriveSkillInterface(frontmatter, name)
      );

      expect(second).toBe(first);
      // Key order is fixed (#546): display_name before short_description
      // before default_prompt. A reordering would be a determinism regression.
      const displayIndex = first.indexOf("display_name:");
      const shortIndex = first.indexOf("short_description:");
      const promptIndex = first.indexOf("default_prompt:");
      expect(shortIndex).toBeGreaterThan(displayIndex);
      expect(promptIndex).toBeGreaterThan(shortIndex);
    }
  });

  it("title-cases display_name independent of host locale (no locale-dependent casing)", () => {
    // #551 explicitly flags locale-dependent title-casing as a non-determinism
    // risk (e.g. the Turkish dotless-i: "id" upper-cases to "I", not "İ").
    // The generator must use locale-independent casing so the same input always
    // yields the same display_name regardless of the build machine's locale.
    const iface = deriveSkillInterface(
      { name: "id-index", description: "Identifier index." },
      "id-index"
    );
    expect(iface.display_name).toBe("ID Index");
  });
});
