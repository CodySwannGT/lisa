/**
 * Unit tests for the agent-agnostic Lisa source discovery helpers.
 *
 * Focused on `isHarnessVariantPlugin`, the canonical-vs-variant classifier used
 * by the OpenCode (and any canonical-Markdown) overlay to skip per-harness
 * fanout plugins (`*-agy`, `*-copilot`, `*-cursor`).
 */
import { describe, expect, it } from "vitest";
import {
  HARNESS_VARIANT_PLUGIN_SUFFIXES,
  commandSegmentsToLisaDisplayName,
  commandSegmentsToLisaSkillName,
  isHarnessVariantPlugin,
} from "../../../src/core/lisa-skill-sources.js";

describe("core/lisa-skill-sources isHarnessVariantPlugin", () => {
  it("treats the base and stack plugins as canonical", () => {
    for (const name of [
      "lisa",
      "lisa-typescript",
      "lisa-expo",
      "lisa-cdk",
      "lisa-nestjs",
      "lisa-rails",
      "lisa-harper-fabric",
      "lisa-phaser",
      "lisa-openclaw",
      "lisa-wiki",
    ]) {
      expect(isHarnessVariantPlugin(name)).toBe(false);
    }
  });

  it("flags every per-harness fanout variant", () => {
    for (const name of [
      "lisa-agy",
      "lisa-copilot",
      "lisa-cursor",
      "lisa-cdk-copilot",
      "lisa-expo-cursor",
      "lisa-wiki-agy",
    ]) {
      expect(isHarnessVariantPlugin(name)).toBe(true);
    }
  });

  it("matches each documented suffix", () => {
    for (const suffix of HARNESS_VARIANT_PLUGIN_SUFFIXES) {
      expect(isHarnessVariantPlugin(`lisa-stack${suffix}`)).toBe(true);
    }
  });
});

describe("core/lisa-skill-sources command naming", () => {
  it("uses colon-scoped display names and hyphenated skill aliases", () => {
    const segments = ["git", "commit"];

    expect(commandSegmentsToLisaDisplayName(segments)).toBe("lisa:git:commit");
    expect(commandSegmentsToLisaSkillName(segments)).toBe("lisa-git-commit");
  });
});
