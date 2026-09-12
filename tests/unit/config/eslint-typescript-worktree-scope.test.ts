/** Verify typed linting includes this checkout, not parked sibling checkouts. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

const fixtures: string[] = [];
const ESLINT_CONFIG = "tsconfig.eslint.json";
const configs = [
  ESLINT_CONFIG,
  "typescript/copy-overwrite/tsconfig.eslint.json",
  "expo/copy-overwrite/tsconfig.eslint.json",
  "nestjs/copy-overwrite/tsconfig.eslint.json",
  "cdk/copy-overwrite/tsconfig.eslint.json",
  "phaser/copy-overwrite/tsconfig.eslint.json",
  "harper-fabric/copy-overwrite/tsconfig.eslint.json",
];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

describe("typed linting stays within its checkout", () => {
  it.each(configs)(
    "%s excludes sibling trees while retaining source and tests",
    config => {
      const fixture = fs.mkdtempSync(
        path.join(os.tmpdir(), "lisa-eslint-scope-")
      );
      fixtures.push(fixture);
      const ownFiles = [
        "src/index.ts",
        "src/worktrees/ordinary.ts",
        "tests/unit/example.test.ts",
      ];
      const foreignFiles = [
        "worktrees/other/src/index.ts",
        ".worktrees/other/src/index.ts",
        ".claude/worktrees/other/src/index.ts",
        ".codex/worktrees/other/src/index.ts",
        ".stryker-tmp/other/src/index.ts",
      ];
      for (const relative of [...ownFiles, ...foreignFiles]) {
        const file = path.join(fixture, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "export const value: number = 1;\n");
      }
      fs.writeFileSync(path.join(fixture, "tsconfig.json"), "{}");
      fs.copyFileSync(path.resolve(config), path.join(fixture, ESLINT_CONFIG));
      const parsed = ts.getParsedCommandLineOfConfigFile(
        path.join(fixture, ESLINT_CONFIG),
        {},
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: error => {
            throw new Error(String(error.messageText));
          },
        }
      );
      expect(parsed?.errors).toEqual([]);
      const included = parsed?.fileNames.map(file =>
        path.relative(fixture, file).replaceAll(path.sep, "/")
      );
      expect(included).toEqual(expect.arrayContaining(ownFiles));
      expect(included?.filter(file => foreignFiles.includes(file))).toEqual([]);
    }
  );
});
