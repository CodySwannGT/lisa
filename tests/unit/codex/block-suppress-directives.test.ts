/**
 * Tests for block-suppress-directives.sh — the PreToolUse hook that refuses
 * edits introducing error-suppression directives (@ts-ignore, @ts-nocheck,
 * eslint-disable, biome-ignore, prettier-ignore) into JS/TS source.
 *
 * For Edit/Write/MultiEdit the hook refuses only directive GROWTH
 * (CodySwannGT/lisa#4492): it compares the directives before the write (the
 * file on disk, or each edit's old text) with those after it. For apply_patch
 * it compares each file's `-` lines with its `+` lines. It is scoped to JS/TS
 * files, and matches the directive only in comment syntax so prose, strings,
 * and identifiers that merely mention the tokens are not flagged. @ts-expect-
 * error is intentionally allowed as the safer alternative.
 *
 * Directive tokens are assembled from parts at runtime so this source file does
 * not itself contain a literal comment-directive (which would otherwise be
 * caught by the very hook under test when this file is later edited).
 * @module tests/unit/codex/block-suppress-directives
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  FILE_WIDE_DISABLE,
  GROWTH_CASES,
  hookEnvelope,
  NEXT_LINE_DISABLE,
  prepareDisk,
  RUNS_AS_ROOT,
  TS_IGNORE as GROWTH_TS_IGNORE,
} from "../../helpers/suppress-directive-growth-cases.js";

const SCRIPT_PATH = path.resolve(
  "src/codex/scripts/block-suppress-directives.sh"
);
const BASH_PATH = "/bin/bash";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

// Comment marker kept out of the literal source (see module note).
const SLASH = "//";
const TS_IGNORE = `${SLASH} @ts-ignore`;
const TS_NOCHECK = `${SLASH} @ts-nocheck`;
const TS_EXPECT_ERROR = `${SLASH} @ts-expect-error`;
const ESLINT_DISABLE = `${SLASH} eslint-disable-next-line no-console`;
const PRETTIER_IGNORE = `${SLASH} prettier-ignore`;

const editEnvelope = (filePath: string, newString: string): string =>
  JSON.stringify({
    tool_name: "Edit",
    tool_input: { file_path: filePath, new_string: newString },
  });

const writeEnvelope = (filePath: string, content: string): string =>
  JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: filePath, content },
  });

const multiEditEnvelope = (
  filePath: string,
  newStrings: readonly string[]
): string =>
  JSON.stringify({
    tool_name: "MultiEdit",
    tool_input: {
      file_path: filePath,
      edits: newStrings.map(s => ({ new_string: s })),
    },
  });

const applyPatchEnvelope = (patch: string): string =>
  JSON.stringify({
    tool_name: "apply_patch",
    tool_input: { command: patch },
  });

const run = (envelope: string): { status: number | null; stderr: string } => {
  const result = boundedSpawnSync({
    label: "block-suppress-directives.sh",
    command: BASH_PATH,
    args: [SCRIPT_PATH],
    input: envelope,
  });
  return { status: result.status, stderr: result.stderr };
};

describe("block-suppress-directives.sh", () => {
  describe("Edit / Write / MultiEdit", () => {
    it("blocks an Edit adding @ts-ignore to a .ts file", () => {
      const { status, stderr } = run(
        editEnvelope("src/a.ts", `const x = 1; ${TS_IGNORE}`)
      );
      expect(status).toBe(EXIT_BLOCKED);
      expect(stderr).toContain("block-suppress-directives");
    });

    it("blocks a Write adding eslint-disable to a .tsx file", () => {
      const { status } = run(
        writeEnvelope("src/a.tsx", `export const x = 1; ${ESLINT_DISABLE}`)
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks a Write adding @ts-nocheck to a .js file", () => {
      const { status } = run(writeEnvelope("src/a.js", `${TS_NOCHECK}\nx()`));
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks prettier-ignore in a JSX expression comment", () => {
      const { status } = run(
        editEnvelope("src/a.tsx", `{/* ${PRETTIER_IGNORE.slice(3)} */}`)
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("blocks when any one MultiEdit chunk introduces a directive", () => {
      const { status } = run(
        multiEditEnvelope("src/a.ts", [
          "const ok = 1;",
          `const y = 2; ${TS_IGNORE}`,
        ])
      );
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("allows @ts-expect-error (the safer alternative)", () => {
      const { status } = run(
        editEnvelope("src/a.ts", `${TS_EXPECT_ERROR}\nbadCall();`)
      );
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows a directive token in a non-JS/TS file", () => {
      const { status } = run(
        writeEnvelope("README.md", `Document the ${ESLINT_DISABLE} directive.`)
      );
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows directive-looking text that is not a comment (string/identifier)", () => {
      const { status } = run(
        editEnvelope(
          "src/a.ts",
          'const url = "https://x"; const eslint_disable = true;'
        )
      );
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("allows a clean edit", () => {
      const { status } = run(
        editEnvelope(
          "src/a.ts",
          "export const sum = (a: number, b: number) => a + b;"
        )
      );
      expect(status).toBe(EXIT_ALLOWED);
    });
  });

  describe("apply_patch", () => {
    it("blocks an added line introducing a directive in a .ts file", () => {
      const patch = `*** Begin Patch\n*** Update File: src/a.ts\n@@\n context\n+const x = 1; ${TS_IGNORE}\n*** End Patch\n`;
      const { status } = run(applyPatchEnvelope(patch));
      expect(status).toBe(EXIT_BLOCKED);
    });

    it("ignores a directive that appears only on an unchanged context line", () => {
      const patch = `*** Begin Patch\n*** Update File: src/a.ts\n@@\n const existing = 1; ${TS_IGNORE}\n-const old = 1;\n+const next = 2;\n*** End Patch\n`;
      const { status } = run(applyPatchEnvelope(patch));
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("ignores an added directive line in a non-JS/TS file", () => {
      const patch = `*** Begin Patch\n*** Add File: notes.md\n+mentions ${ESLINT_DISABLE}\n*** End Patch\n`;
      const { status } = run(applyPatchEnvelope(patch));
      expect(status).toBe(EXIT_ALLOWED);
    });

    it("blocks when one of several files in a patch adds a directive", () => {
      const patch =
        "*** Begin Patch\n" +
        "*** Add File: src/clean.ts\n+export const ok = 1;\n" +
        `*** Update File: src/bad.ts\n@@\n+const y = 2; ${TS_IGNORE}\n` +
        "*** End Patch\n";
      const { status } = run(applyPatchEnvelope(patch));
      expect(status).toBe(EXIT_BLOCKED);
    });

    describe("growth semantics (CodySwannGT/lisa#4492)", () => {
      const update = (file: string, body: string): string =>
        `*** Begin Patch\n*** Update File: ${file}\n@@\n${body}*** End Patch\n`;

      it("allows re-indenting a block that keeps its existing directive", () => {
        const patch = update(
          "src/a.ts",
          `-${NEXT_LINE_DISABLE}\n-console.log(1);\n` +
            `+  ${NEXT_LINE_DISABLE}\n+  console.log(1);\n`
        );
        expect(run(applyPatchEnvelope(patch)).status).toBe(EXIT_ALLOWED);
      });

      it("allows removing a directive", () => {
        const patch = update(
          "src/a.ts",
          `-${GROWTH_TS_IGNORE}\n-badCall();\n+goodCall();\n`
        );
        expect(run(applyPatchEnvelope(patch)).status).toBe(EXIT_ALLOWED);
      });

      it("refuses a hunk that adds a new directive beside the old line", () => {
        const patch = update(
          "src/a.ts",
          "-const a = 1;\n" + `+const a = 1; ${GROWTH_TS_IGNORE}\n`
        );
        expect(run(applyPatchEnvelope(patch)).status).toBe(EXIT_BLOCKED);
      });

      it("refuses widening a next-line disable into a file-wide one", () => {
        const patch = update(
          "src/a.ts",
          `-${NEXT_LINE_DISABLE}\n+${FILE_WIDE_DISABLE}\n`
        );
        expect(run(applyPatchEnvelope(patch)).status).toBe(EXIT_BLOCKED);
      });

      it("refuses an Add File that carries a directive", () => {
        const patch =
          "*** Begin Patch\n*** Add File: src/new.ts\n" +
          `+${NEXT_LINE_DISABLE}\n+console.log(1);\n*** End Patch\n`;
        expect(run(applyPatchEnvelope(patch)).status).toBe(EXIT_BLOCKED);
      });

      it("allows deleting a file that carried a directive", () => {
        const patch =
          "*** Begin Patch\n*** Delete File: src/old.ts\n*** End Patch\n";
        expect(run(applyPatchEnvelope(patch)).status).toBe(EXIT_ALLOWED);
      });

      it("refuses moving a directive from one file into another", () => {
        // Growth is judged per file: removing it from a.ts does not license
        // adding it to b.ts.
        const patch =
          "*** Begin Patch\n" +
          `*** Update File: src/a.ts\n@@\n-${GROWTH_TS_IGNORE}\n+ok();\n` +
          `*** Update File: src/b.ts\n@@\n-ok();\n+${GROWTH_TS_IGNORE}\n` +
          "*** End Patch\n";
        expect(run(applyPatchEnvelope(patch)).status).toBe(EXIT_BLOCKED);
      });
    });
  });

  describe("growth semantics (CodySwannGT/lisa#4492)", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(path.join(os.tmpdir(), "lisa-codex-suppress-growth-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it.each(GROWTH_CASES)("$name", growthCase => {
      if (growthCase.disk.kind === "unreadable" && RUNS_AS_ROOT) return;
      const target = prepareDisk(dir, growthCase.disk);
      const { status } = run(hookEnvelope(target, growthCase.call));
      expect(status).toBe(growthCase.refused ? EXIT_BLOCKED : EXIT_ALLOWED);
    });
  });

  it("fails open (allows) when stdin is not a recognized envelope", () => {
    const { status } = run(JSON.stringify({ tool_name: "Bash" }));
    expect(status).toBe(EXIT_ALLOWED);
  });
});
