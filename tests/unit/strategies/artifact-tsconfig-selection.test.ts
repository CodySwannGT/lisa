/** Run the repository's compiler with the real create-only stack selectors. */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const REPO = resolve(import.meta.dirname, "../../..");
const ARTIFACT_DIRECTORIES = [
  "evidence",
  "test-results",
  "playwright-report",
  "blob-report",
  "coverage",
] as const;
const EXPO_SOURCE = "src/evidence/control.ts";
const TS_SOURCE = "src/control.ts";
const MARKER = "artifact-probe";

/**
 * Compile ordinary source and artifact probes using the selected stack's actual template.
 * @param stack - Stack that owns the create-only template
 * @param source - Ordinary source path included by that template
 * @param invalidSource - Whether to introduce a type error in ordinary source
 * @returns Captured compiler invocation
 */
function compileFixture(stack: string, source: string, invalidSource = false) {
  const root = mkdtempSync(join(tmpdir(), "lisa-artifact-tsconfig-"));
  const ordinary = join(root, source);
  const actualTemplate = readFileSync(
    join(REPO, stack, "create-only", "tsconfig.local.json"),
    "utf8"
  );
  try {
    mkdirSync(dirname(ordinary), { recursive: true });
    writeFileSync(
      ordinary,
      `export const ordinary: string = ${invalidSource ? "123" : '"ok"'};\n`
    );
    writeFileSync(join(root, "tsconfig.local.json"), actualTemplate);
    // Extend the untouched local config like the host does. The explicit
    // already-included file avoids TS18002 from a standalone `files: []`.
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({
        extends: "./tsconfig.local.json",
        files: [source],
        compilerOptions: { jsx: "preserve", types: [] },
      })
    );
    for (const directory of ARTIFACT_DIRECTORIES) {
      const target = join(root, directory);
      mkdirSync(target);
      for (const extension of ["ts", "tsx"]) {
        writeFileSync(
          join(target, `${MARKER}-${extension}.${extension}`),
          "export const probe: string = 123;\n"
        );
      }
    }
    return boundedSpawnSync({
      label: `${stack} template compiler file selection`,
      command: process.execPath,
      args: [
        join(REPO, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "--pretty",
        "false",
        "--listFiles",
        "--project",
        "tsconfig.json",
      ],
      cwd: root,
      baseMs: 20_000,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("create-only artifact typecheck selection", () => {
  it.each([
    { stack: "expo", source: EXPO_SOURCE },
    { stack: "typescript", source: TS_SOURCE },
    { stack: "nestjs", source: TS_SOURCE },
    { stack: "cdk", source: "lib/control.ts" },
    { stack: "phaser", source: TS_SOURCE },
  ])(
    "$stack selects ordinary source without root artifact probes",
    ({ stack, source }) => {
      const outcome = compileFixture(stack, source);
      expect(outcome.status, outcome.stdout + outcome.stderr).toBe(0);
      expect(outcome.stdout.replaceAll("\\", "/")).toContain(source);
      expect(outcome.stdout).not.toContain(MARKER);
    }
  );

  it("Expo still reports a type error in source under a same-named nested directory", () => {
    const outcome = compileFixture("expo", EXPO_SOURCE, true);
    expect(outcome.status).not.toBe(0);
    expect(outcome.stdout).toMatch(
      /src\/evidence\/control\.ts\(1,14\): error TS2322/u
    );
    expect(outcome.stdout).not.toContain(MARKER);
  });
});
