/** Continued workflow commands must retain the same status checks. */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  inspectShellSource,
  sweep,
} from "../../../scripts/check-pipeline-status-reads.mjs";

const roots: string[] = [];
const COMMAND = "node gate.mjs --strict | tee output";

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("continued workflow pipelines", () => {
  it.each([false, true])(
    "preserves findings with explicit bash=%s",
    explicitBash => {
      const root = mkdtempSync(
        path.join(tmpdir(), "lisa-pipeline-continuation-")
      );
      roots.push(root);
      const directory = path.join(root, ".github/workflows");
      mkdirSync(directory, { recursive: true });
      for (const [name, body] of [
        ["one-line", [COMMAND]],
        ["continued", ["node gate.mjs \\", "  --strict \\", "  | tee output"]],
      ] as const) {
        writeFileSync(
          path.join(directory, `${name}.yml`),
          [
            "jobs:",
            "  gate:",
            "    steps:",
            ...(explicitBash
              ? ["      - shell: bash", "        run: |"]
              : ["      - run: |"]),
            ...body.map(line => `          ${line}`),
            "",
          ].join("\n")
        );
      }
      const result = sweep(root, [".github/workflows"]);
      expect(result.inspected).toBe(2);
      expect(result.findings).toHaveLength(explicitBash ? 0 : 2);
      if (!explicitBash)
        expect(result.findings.map(finding => finding.file)).toEqual([
          ".github/workflows/continued.yml",
          ".github/workflows/one-line.yml",
        ]);
    }
  );

  it("retains physical line numbers after joining a command", () => {
    const result = inspectShellSource({
      text: [
        "# heading",
        "node gate.mjs \\",
        "  --strict \\",
        "  | tee output",
        COMMAND,
      ].join("\n"),
      file: "example.sh",
      location: "script",
      statusAlwaysRead: true,
      pipefail: false,
    });
    expect(result.findings.map(finding => finding.line)).toEqual([2, 5]);
  });

  it("does not continue an escaped backslash or a comment", () => {
    const result = inspectShellSource({
      text: ["# comment \\", COMMAND, "echo text \\\\", COMMAND].join("\n"),
      file: "example.sh",
      location: "script",
      statusAlwaysRead: true,
      pipefail: false,
    });
    expect(result.findings.map(finding => finding.line)).toEqual([2, 4]);
  });
});
