/** Contract for rendering canonical and generated wiki role-agent templates. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";
import { parse as parseToml } from "smol-toml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../../..");
const TEMPLATE_ROOTS = [
  "plugins/src/wiki",
  "plugins/lisa-wiki",
  "plugins/lisa-wiki-cursor",
  "plugins/lisa-wiki-agy",
  "plugins/lisa-wiki-copilot",
] as const;
const ADVERSARIAL_DESCRIPTION =
  'Owns finance: says "quarterly"; reads C:\\wiki\\roles\nEscalates exceptions.';
const TEMPLATE_VALUES = Object.freeze({
  id: "finance",
  role: "Finance lead",
  roleDescriptionSerialized: JSON.stringify(ADVERSARIAL_DESCRIPTION),
  org: "Example Org",
  expertise: "financial operations",
  ownedPaths: "wiki/finance/",
  sensitivity: "confidential",
});

/**
 * Render one role template using the same literal placeholder contract as the skill.
 * @param template Raw role-agent template.
 * @returns Fully rendered agent text.
 */
function renderTemplate(template: string): string {
  return Object.entries(TEMPLATE_VALUES).reduce(
    (rendered, [key, value]) => rendered.replaceAll(`{{${key}}}`, value),
    template
  );
}

/**
 * Parse the leading YAML mapping from one rendered Claude agent.
 * @param markdown Rendered Claude agent Markdown.
 * @returns Parsed frontmatter mapping.
 */
function parseYamlFrontmatter(markdown: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (match === null) {
    throw new Error("rendered Claude agent has no YAML frontmatter");
  }
  const parsed = loadYaml(match[1]);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("rendered Claude agent frontmatter is not a mapping");
  }
  return parsed as Record<string, unknown>;
}

describe("wiki role-agent template render contract", () => {
  for (const templateRoot of TEMPLATE_ROOTS) {
    it(`${templateRoot} preserves adversarial descriptions in YAML and TOML`, () => {
      const claudeTemplate = readFileSync(
        join(REPO_ROOT, templateRoot, "templates/agents/role-agent.claude.md"),
        "utf8"
      );
      const codexTemplate = readFileSync(
        join(REPO_ROOT, templateRoot, "templates/agents/role-agent.codex.toml"),
        "utf8"
      );

      expect(claudeTemplate).toContain("{{roleDescriptionSerialized}}");
      expect(codexTemplate).toContain("{{roleDescriptionSerialized}}");

      const claudeAgent = parseYamlFrontmatter(renderTemplate(claudeTemplate));
      const codexAgent = parseToml(renderTemplate(codexTemplate));

      expect(claudeAgent["name"]).toBe(TEMPLATE_VALUES.id);
      expect(claudeAgent["description"]).toBe(ADVERSARIAL_DESCRIPTION);
      expect(codexAgent.name).toBe(TEMPLATE_VALUES.id);
      expect(codexAgent.description).toBe(ADVERSARIAL_DESCRIPTION);
    });
  }
});
