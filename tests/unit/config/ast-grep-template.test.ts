/**
 * Regression coverage for Lisa-managed ast-grep templates.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const AST_GREP = path.join(REPO_ROOT, "node_modules/.bin/ast-grep");
const AST_GREP_RULES = "ast-grep/rules";

/**
 * Read a repository file as UTF-8 text.
 * @param relativePath - Path relative to the repository root
 * @returns File contents
 */
function readText(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
}

/**
 * Copy one stack's ast-grep template payload into a temporary project root.
 * @param stack - Stack template to copy
 * @returns Temporary project root
 */
function copyTemplateAstGrep(stack: "typescript" | "rails" | "phaser"): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `lisa-${stack}-sg-`));
  fs.cpSync(
    path.join(REPO_ROOT, stack, "copy-overwrite", AST_GREP_RULES, ".."),
    path.join(tempDir, "ast-grep"),
    { recursive: true }
  );
  fs.copyFileSync(
    path.join(REPO_ROOT, stack, "copy-overwrite", "sgconfig.yml"),
    path.join(tempDir, "sgconfig.yml")
  );
  return tempDir;
}

/**
 * Run the copied stack rules against a planted violation.
 * @param stack - Stack template under test
 * @param filePath - Project-relative file to write and scan
 * @param source - Source text containing a violation
 * @param expectedRuleId - Rule id expected in ast-grep output
 */
function scanExpectingDiagnostic(
  stack: "typescript" | "rails" | "phaser",
  filePath: string,
  source: string,
  expectedRuleId: string
): void {
  const tempDir = copyTemplateAstGrep(stack);
  const absoluteFile = path.join(tempDir, filePath);
  let status: number | null = null;
  let output = "";

  fs.mkdirSync(path.dirname(absoluteFile), { recursive: true });
  fs.writeFileSync(absoluteFile, source, "utf-8");
  ({ status, stdout: output } = spawnSync(
    AST_GREP,
    ["scan", "--json=compact", filePath],
    {
      cwd: tempDir,
      encoding: "utf-8",
    }
  ));

  fs.rmSync(tempDir, { recursive: true, force: true });
  expect(status).toBe(1);
  expect(output).toContain(expectedRuleId);
}
describe("ast-grep stack templates", () => {
  it("ships real TypeScript rules into downstream TypeScript-family projects", () => {
    expect(readText("typescript/copy-overwrite/sgconfig.yml")).toContain(
      AST_GREP_RULES
    );
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "typescript/copy-overwrite/ast-grep/rules/no-inline-component-in-view.yml"
        )
      )
    ).toBe(true);

    scanExpectingDiagnostic(
      "typescript",
      "src/features/demo/components/Foo/FooView.tsx",
      'const Foo = () => null;\nFoo.displayName = "Wrong";\n',
      "no-inline-component-in-view"
    );
  });

  it("ships Ruby security rules into downstream Rails projects", () => {
    expect(readText("rails/copy-overwrite/sgconfig.yml")).toContain(
      AST_GREP_RULES
    );
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "rails/copy-overwrite/ast-grep/rules/ruby/no-raw-sql-in-where.yml"
        )
      )
    ).toBe(true);

    scanExpectingDiagnostic(
      "rails",
      "app/models/user.rb",
      'class User < ApplicationRecord\n  scope :active, -> { where("name = #{params[:name]}") }\nend\n',
      "no-raw-sql-in-where"
    );
  });

  it("ships Phaser ast-grep rules with the Phaser stack", () => {
    expect(readText("phaser/copy-overwrite/sgconfig.yml")).toContain(
      AST_GREP_RULES
    );
    expect(
      fs.existsSync(
        path.join(
          REPO_ROOT,
          "phaser/copy-overwrite/ast-grep/rules/phaser/no-canvas-renderer.yml"
        )
      )
    ).toBe(true);

    scanExpectingDiagnostic(
      "phaser",
      "src/game/config.ts",
      "const renderer = Phaser.CANVAS;\n",
      "phaser-no-canvas-renderer"
    );
  });
});
