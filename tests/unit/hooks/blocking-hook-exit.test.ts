import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const BLOCKING_HOOKS = [
  "plugins/src/typescript/hooks/sg-scan-on-edit.sh",
  "plugins/src/rails/hooks/sg-scan-on-edit.sh",
  "plugins/src/rails/hooks/rubocop-on-edit.sh",
] as const;

describe("blocking Claude hooks", () => {
  it.each(BLOCKING_HOOKS)(
    "%s exits 2 when findings must be fed back to Claude",
    hookPath => {
      const content = readFileSync(path.resolve(hookPath), "utf8");

      expect(content).toMatch(/\bexit 2\b/);
      expect(content).not.toMatch(
        /(?:issues found|unfixable errors remain|RuboCop found unfixable errors|ast-grep found issues)[\s\S]{0,240}\bexit 1\b/
      );
    }
  );

  it("documents exit 2 for blocking hook authoring", () => {
    const projectRules = readFileSync(
      path.resolve(".claude/rules/PROJECT_RULES.md"),
      "utf8"
    );

    expect(projectRules).toContain(
      "always use blocking behavior (exit 2 on failures)"
    );
    expect(projectRules).not.toContain(
      "always use blocking behavior (exit 1 on failures)"
    );
  });
});
