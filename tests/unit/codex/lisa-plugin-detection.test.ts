/**
 * Unit tests for src/codex/lisa-plugin-detection.ts pure helpers.
 *
 * The async file-reading `isLisaInstalledAsCodexPlugin` is exercised indirectly
 * through `tomlHasEnabledPlugin` here (the file-IO part is a thin wrapper).
 * @module tests/unit/codex/lisa-plugin-detection
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LISA_PLUGIN_KEY,
  LEGACY_LISA_PLUGIN_KEYS,
  SLASH_LISA_PLUGIN_KEY,
  tomlHasEnabledPlugin,
} from "../../../src/codex/lisa-plugin-detection.js";

const HEADER = `[plugins."${DEFAULT_LISA_PLUGIN_KEY}"]`;

describe("codex/lisa-plugin-detection", () => {
  describe("tomlHasEnabledPlugin", () => {
    it("uses the verified 0.125.0 marketplace key lisa@lisa", () => {
      expect(DEFAULT_LISA_PLUGIN_KEY).toBe("lisa@lisa");
    });

    it("retains the legacy repo-slug key shapes as fallbacks", () => {
      expect(LEGACY_LISA_PLUGIN_KEYS).toContain("lisa@CodySwannGT-lisa");
      expect(LEGACY_LISA_PLUGIN_KEYS).toContain("lisa@CodySwannGT/lisa");
    });

    it("detects an enabled legacy-key table when the verified key is absent", () => {
      const body = `[plugins."lisa@CodySwannGT-lisa"]\nenabled = true\n`;
      expect(tomlHasEnabledPlugin(body, "lisa@CodySwannGT-lisa")).toBe(true);
    });

    it("returns true on canonical Codex emitter shape", () => {
      const body = `${HEADER}\nenabled = true\n`;
      expect(tomlHasEnabledPlugin(body)).toBe(true);
    });

    it("tolerates no-space enabled=true", () => {
      const body = `${HEADER}\nenabled=true\n`;
      expect(tomlHasEnabledPlugin(body)).toBe(true);
    });

    it("tolerates trailing whitespace and comments", () => {
      const body = `${HEADER}\nenabled = true   # default since 0.125.0\n`;
      expect(tomlHasEnabledPlugin(body)).toBe(true);
    });

    it("tolerates trailing comment on header line", () => {
      const body = `${HEADER}  # lisa managed\nenabled = true\n`;
      expect(tomlHasEnabledPlugin(body)).toBe(true);
    });

    it("returns false when enabled is missing", () => {
      const body = `${HEADER}\nversion = "2.119.0"\n`;
      expect(tomlHasEnabledPlugin(body)).toBe(false);
    });

    it("returns false when enabled is false", () => {
      const body = `${HEADER}\nenabled = false\n`;
      expect(tomlHasEnabledPlugin(body)).toBe(false);
    });

    it("returns false when the header is for a different plugin", () => {
      const body = `[plugins."other@otherrepo"]\nenabled = true\n`;
      expect(tomlHasEnabledPlugin(body)).toBe(false);
    });

    it("does not cross section boundaries", () => {
      const body = `${HEADER}\nversion = "x"\n[other.section]\nenabled = true\n`;
      expect(tomlHasEnabledPlugin(body)).toBe(false);
    });

    it("returns false on empty body", () => {
      expect(tomlHasEnabledPlugin("")).toBe(false);
    });

    it("returns false on body without any [plugins.*] section", () => {
      expect(tomlHasEnabledPlugin('model = "gpt-5.5"\n')).toBe(false);
    });

    it("accepts the slash-form canonical key when explicitly passed", () => {
      const body = `[plugins."${SLASH_LISA_PLUGIN_KEY}"]\nenabled = true\n`;
      expect(tomlHasEnabledPlugin(body, SLASH_LISA_PLUGIN_KEY)).toBe(true);
    });
  });
});
