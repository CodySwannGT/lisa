/**
 * Regression test for issue #552: every committed Codex per-skill
 * `plugins/<built>/skills/<name>/agents/openai.yaml` artifact (across the base
 * `lisa` plugin and every `lisa-<stack>` plugin) must equal what the generator
 * (scripts/generate-codex-plugin-artifacts.mjs) produces from that skill's own
 * SKILL.md — the in-repo, openai.yaml-surface analogue of the
 * `bun run check:plugins` sync gate (scripts/check-plugins-sync.sh).
 *
 * The ticket's acceptance criterion is empirical and gate-level:
 *
 *   Scenario: check:plugins passes after committing artifacts
 *     Given the regenerated plugins/lisa* artifacts are committed alongside plugins/src
 *     When bun run check:plugins runs
 *     Then it exits 0 and prints the in-sync and marketplace-coverage success lines
 *
 * check:plugins proves that the *entire* committed plugins/ tree reproduces from
 * plugins/src, but it is a bash gate run in CI, not a unit test, and it asserts
 * the whole tree generically. This suite pins the openai.yaml surface
 * specifically against the REAL committed artifacts (not a synthetic temp
 * fixture like #550/#551): for each committed
 * `plugins/<built>/skills/<name>/agents/openai.yaml`, it re-derives the expected
 * contents from the sibling `SKILL.md` via the generator's exported pure
 * functions and asserts byte-equality. A drift here is exactly the failure
 * check:plugins would catch — caught at unit speed, against the committed bytes,
 * with a per-artifact assertion that names the offending file.
 *
 * Distinct from the sibling codex suites:
 *  - source-authored-openai-yaml.test.ts (#550) builds a temp fixture and proves
 *    a hand-authored source openai.yaml survives the copy-through.
 *  - build-byte-stable.test.ts (#551) builds a temp fixture and proves the
 *    generator is byte-stable across repeated/independent runs.
 *  - This suite (#552) makes NO temp fixture and runs NO build — it reads the
 *    artifacts already committed to the repo and asserts they match a fresh
 *    derivation, the in-repo guarantee that the committed tree never drifts from
 *    what `bun run build:plugins` would emit.
 *
 * Hand-authored artifacts (a source-resident
 * `plugins/src/<plugin>/skills/<name>/agents/openai.yaml`) are intentionally
 * skipped here — their contract is #550's, and the generator copies them through
 * verbatim rather than deriving them.
 * @module tests/unit/codex/committed-openai-yaml-in-sync
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveSkillInterface,
  parseSkillFrontmatter,
  serializeInterfaceToYaml,
} from "../../../scripts/generate-codex-plugin-artifacts.mjs";

/** Repository root (two levels up from tests/unit/codex). */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
/** Built-plugins parent directory. */
const PLUGINS_DIR = path.join(REPO_ROOT, "plugins");
/** Source-of-truth parent directory for built plugins. */
const SRC_DIR = path.join(PLUGINS_DIR, "src");
/** Top-level per-plugin skills directory name. */
const SKILLS = "skills";
/** Per-skill agents directory name. */
const AGENTS = "agents";
/** The per-skill artifact filename. */
const OPENAI_YAML = "openai.yaml";
/** Per-skill source-of-truth manifest filename. */
const SKILL_MD = "SKILL.md";

/**
 * Map a built plugin directory name to its plugins/src source directory name.
 * The base plugin builds from plugins/src/base; every other plugin builds from
 * plugins/src/<name-with-the-lisa--prefix-stripped> (see scripts/build-plugins.sh).
 * @param builtName Built plugin directory name (e.g. "lisa", "lisa-expo").
 * @returns The corresponding plugins/src subdirectory name.
 */
function srcNameFor(builtName: string): string {
  return builtName === "lisa" ? "base" : builtName.replace(/^lisa-/, "");
}

/** One committed openai.yaml artifact to verify. */
interface CommittedArtifact {
  /** Built plugin directory name (e.g. "lisa-expo"). */
  readonly builtPlugin: string;
  /** Skill directory name owning the artifact. */
  readonly skillName: string;
  /** Absolute path to the committed openai.yaml. */
  readonly artifactPath: string;
  /** Absolute path to the sibling SKILL.md. */
  readonly skillMdPath: string;
  /**
   * True when a source-resident openai.yaml exists, meaning the generator
   * copies it through rather than deriving it (#550).
   */
  readonly sourceAuthored: boolean;
}

/**
 * Discover every committed `plugins/<built>/skills/<name>/agents/openai.yaml`
 * by walking the real on-disk plugin tree.
 * @returns The committed artifacts, sorted by repo-relative path for stable test
 *   ordering.
 */
function discoverCommittedArtifacts(): readonly CommittedArtifact[] {
  const builtPlugins = fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== "src")
    .map(entry => entry.name);

  const artifacts = builtPlugins.flatMap(builtPlugin => {
    const skillsDir = path.join(PLUGINS_DIR, builtPlugin, SKILLS);
    if (!fs.existsSync(skillsDir)) {
      return [];
    }
    const srcName = srcNameFor(builtPlugin);
    const skillNames = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);

    return skillNames.flatMap(skillName => {
      const artifactPath = path.join(skillsDir, skillName, AGENTS, OPENAI_YAML);
      if (!fs.existsSync(artifactPath)) {
        return [];
      }
      const sourceAuthored = fs.existsSync(
        path.join(SRC_DIR, srcName, SKILLS, skillName, AGENTS, OPENAI_YAML)
      );
      return [
        {
          builtPlugin,
          skillName,
          artifactPath,
          skillMdPath: path.join(skillsDir, skillName, SKILL_MD),
          sourceAuthored,
        },
      ];
    });
  });

  return [...artifacts].sort((a, b) =>
    a.artifactPath.localeCompare(b.artifactPath)
  );
}

const COMMITTED = discoverCommittedArtifacts();
const DERIVED = COMMITTED.filter(artifact => !artifact.sourceAuthored);

describe("codex/committed-openai-yaml-in-sync (#552)", () => {
  it("discovers committed openai.yaml artifacts to verify", () => {
    // A guard: if the discovery walk silently finds nothing (e.g. a refactor
    // moves the artifacts), the per-artifact assertions below would vacuously
    // pass. The repo currently ships many such artifacts across plugins.
    expect(COMMITTED.length).toBeGreaterThan(0);
    expect(DERIVED.length).toBeGreaterThan(0);
  });

  it.each(DERIVED)(
    "$builtPlugin/$skillName: committed openai.yaml matches a fresh derivation from SKILL.md",
    ({ artifactPath, skillMdPath, skillName }) => {
      // The artifact is generated from the sibling SKILL.md; SKILL.md must exist
      // for the generator to have emitted it.
      expect(fs.existsSync(skillMdPath)).toBe(true);

      const frontmatter = parseSkillFrontmatter(skillMdPath);
      const expected = serializeInterfaceToYaml(
        deriveSkillInterface(frontmatter, skillName)
      );
      const committed = fs.readFileSync(artifactPath, "utf8");

      // Byte-for-byte equality: the in-repo analogue of `git diff --quiet --
      // plugins/` over the openai.yaml surface that check:plugins enforces.
      expect(committed).toBe(expected);
    }
  );
});
