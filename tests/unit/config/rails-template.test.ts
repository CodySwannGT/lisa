/**
 * Regression guards for Rails stack templates.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const RAILS_MERGE_SETTINGS = "rails/merge/.claude/settings.json";

/**
 * Read a JSON template from the Lisa repository.
 * @param relativePath - Repo-relative JSON path
 * @returns Parsed template content
 */
function readJson(relativePath: string): unknown {
  return JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8")
  );
}

/**
 * Read a text template from the Lisa repository.
 * @param relativePath - Repo-relative text path
 * @returns Template content
 */
function readText(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

describe("Rails templates", () => {
  it("does not ship the retired tired-boss prompt hook", () => {
    const settingsText = readText(RAILS_MERGE_SETTINGS);
    const settings = readJson(RAILS_MERGE_SETTINGS) as {
      readonly hooks?: {
        readonly UserPromptSubmit?: readonly {
          readonly hooks?: readonly { readonly command?: string }[];
        }[];
      };
    };

    expect(settingsText).not.toContain("tired boss");
    expect(settingsText).not.toContain("Start your response");
    expect(settings.hooks?.UserPromptSubmit?.[0]?.hooks).toEqual([
      {
        type: "command",
        command:
          "command -v entire >/dev/null 2>&1 && entire hooks claude-code user-prompt-submit || true",
      },
    ]);
  });
});
