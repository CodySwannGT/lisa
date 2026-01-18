/**
 * Unit tests for the plugin index
 *
 * Verifies that all rules are properly registered and exported from the plugin.
 * Also verifies that the plugin has proper ESLint 9 flat config metadata.
 * @module eslint-plugin-component-structure/tests/plugin-index
 */

const plugin = require("../index");

describe("eslint-plugin-component-structure", () => {
  describe("plugin meta (ESLint 9 flat config)", () => {
    it("should export a meta object", () => {
      expect(plugin).toHaveProperty("meta");
      expect(typeof plugin.meta).toBe("object");
    });

    it("should have name property in meta", () => {
      expect(plugin.meta).toHaveProperty("name");
      expect(plugin.meta.name).toBe("eslint-plugin-component-structure");
    });

    it("should have version property in meta", () => {
      expect(plugin.meta).toHaveProperty("version");
      expect(plugin.meta.version).toBe("1.0.0");
    });
  });

  describe("plugin exports", () => {
    it("should export a rules object", () => {
      expect(plugin).toHaveProperty("rules");
      expect(typeof plugin.rules).toBe("object");
    });

    it("should export enforce-component-structure rule", () => {
      expect(plugin.rules).toHaveProperty("enforce-component-structure");
      expect(typeof plugin.rules["enforce-component-structure"]).toBe("object");
      expect(plugin.rules["enforce-component-structure"]).toHaveProperty(
        "create"
      );
      expect(plugin.rules["enforce-component-structure"]).toHaveProperty(
        "meta"
      );
    });

    it("should export no-return-in-view rule", () => {
      expect(plugin.rules).toHaveProperty("no-return-in-view");
      expect(typeof plugin.rules["no-return-in-view"]).toBe("object");
      expect(plugin.rules["no-return-in-view"]).toHaveProperty("create");
      expect(plugin.rules["no-return-in-view"]).toHaveProperty("meta");
    });

    it("should export require-memo-in-view rule", () => {
      expect(plugin.rules).toHaveProperty("require-memo-in-view");
      expect(typeof plugin.rules["require-memo-in-view"]).toBe("object");
      expect(plugin.rules["require-memo-in-view"]).toHaveProperty("create");
      expect(plugin.rules["require-memo-in-view"]).toHaveProperty("meta");
    });

    it("should export single-component-per-file rule", () => {
      expect(plugin.rules).toHaveProperty("single-component-per-file");
      expect(typeof plugin.rules["single-component-per-file"]).toBe("object");
      expect(plugin.rules["single-component-per-file"]).toHaveProperty(
        "create"
      );
      expect(plugin.rules["single-component-per-file"]).toHaveProperty("meta");
    });

    it("should have correct number of rules", () => {
      const ruleCount = Object.keys(plugin.rules).length;
      expect(ruleCount).toBe(4);
    });
  });

  describe("rule metadata", () => {
    it("single-component-per-file should have correct metadata", () => {
      const rule = plugin.rules["single-component-per-file"];
      expect(rule.meta.type).toBe("problem");
      expect(rule.meta.docs).toHaveProperty("description");
      expect(rule.meta.docs.description).toContain("one React component");
      expect(rule.meta.messages).toHaveProperty("multipleComponents");
    });
  });
});
