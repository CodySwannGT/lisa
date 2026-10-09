/**
 * Unknown and differing evidence cannot become current through version equality.
 * Every case still drives the original real no-verify refusal with file input.
 * @module tests/integration/enforcement-fallback-freshness-edges
 */
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupScratchRoots,
  dateHostTree,
} from "../helpers/enforcement-fallback-fixtures.js";
import {
  currentHost,
  driveFreshness,
  INSTALLED_VERSION,
  template,
} from "../helpers/host-guard-freshness-fixtures.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

afterEach(cleanupScratchRoots);

const APPLY_COMMAND = "npx @codyswann/lisa apply";

/**
 * Each honest evidence outcome keeps the actual guard's policy intact.
 * @param root Owned fixture project.
 * @param label Expected attribution content state.
 * @returns Actual refusal output.
 */
function refusal(root: string, label: string): string {
  const result = driveFreshness(root);
  expect(result.status).toBe(2);
  expect(result.output).toContain("Blocked: this command bypasses");
  expect(result.output).toMatch(
    new RegExp(`Refused by .*block-no-verify\\.sh \\(${label}`, "u")
  );
  return result.output;
}

describe("host content evidence edge cases", () => {
  it("reports different bytes even when installed and last-applied versions agree", () => {
    const root = currentHost();
    dateHostTree(root, INSTALLED_VERSION);
    writeFileSync(
      template(root),
      `${readFileSync(template(root), "utf8")}\n# different authoritative bytes\n`
    );
    const output = refusal(root, "DIFFERENT from installed template");
    expect(output).toContain(APPLY_COMMAND);
    expect(output).not.toContain("STALE");
  });

  it.each(["missing", "malformed", "compact"])(
    "preserves content proof with %s historical receipt",
    kind => {
      const root = currentHost();
      const receipt = path.join(root, ".lisa/apply-receipt.json");
      if (kind === "missing") rmSync(receipt);
      else
        writeFileSync(
          receipt,
          kind === "compact"
            ? '{"schema_version":1,"lisa_version":"4.33.1","applied_at":"2026-09-12"}'
            : '{"lisa_version":"4.33.1", broken}'
        );
      const output = refusal(root, "matches installed template");
      expect(output).toContain(
        kind === "compact"
          ? "last applied lisa 4.33.1"
          : "last applied lisa unknown"
      );
      expect(output).not.toContain(APPLY_COMMAND);
    }
  );

  it.each([
    "missing",
    "unreadable",
    "directory",
    "oversized",
    "dangling-link",
    "fifo",
  ])(
    "reports unknown for %s template evidence without changing refusal",
    kind => {
      const root = currentHost();
      const file = template(root);
      if (kind === "unreadable") chmodSync(file, 0o000);
      else if (kind === "oversized")
        writeFileSync(file, Buffer.alloc(1024 * 1024 + 1));
      else {
        rmSync(file);
        if (kind === "directory") mkdirSync(file);
        if (kind === "dangling-link")
          symlinkSync(path.join(root, "absent-template"), file);
        if (kind === "fifo") {
          const made = boundedSpawnSync({
            label: "owned FIFO comparison evidence",
            command: "/usr/bin/mkfifo",
            args: [file],
          });
          expect(made.status).toBe(0);
        }
      }
      const output = refusal(root, "host content unknown");
      expect(output).toContain("inspect the selected guard");
      expect(output).not.toContain(APPLY_COMMAND);
    }
  );

  it.each([
    "missing",
    "unreadable",
    "oversized",
    "malformed",
    "wrong-identity",
    "wrong-version",
    "directory",
  ])("reports unknown for %s installed manifest", kind => {
    const root = currentHost();
    const file = path.join(root, "node_modules/@codyswann/lisa/package.json");
    if (kind === "missing") rmSync(file);
    if (kind === "unreadable") chmodSync(file, 0o000);
    if (kind === "oversized") writeFileSync(file, " ".repeat(65537));
    if (kind === "malformed")
      writeFileSync(file, '{"name":"@codyswann/lisa","version":"4.72.7",oops}');
    if (kind === "wrong-identity")
      writeFileSync(file, '{"name":"some-other-package","version":"4.72.7"}');
    if (kind === "wrong-version")
      writeFileSync(
        file,
        '{"name":"@codyswann/lisa","version":"not-a-version"}'
      );
    if (kind === "directory") {
      rmSync(file);
      mkdirSync(file);
    }
    const output = refusal(root, "host content unknown");
    expect(output).toContain("installed lisa unknown");
    expect(output).not.toContain(APPLY_COMMAND);
  });

  it("does not borrow the refusing guard's content state from a different selected guard", () => {
    const root = currentHost();
    writeFileSync(template(root, "parity-safety-net"), "different\n");
    const output = refusal(root, "matches installed template");
    expect(output).toMatch(
      /parity-safety-net\.sh — DIFFERENT from installed template/u
    );
    expect(output.split("Refused by")[1]).not.toContain(
      "THIS VERDICT MAY NOT REFLECT"
    );
  });
});
