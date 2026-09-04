/**
 * Closed authored/generated parity for the trusted classifier ladder (#3383).
 * @module tests/unit/strategies/rollup-classifier-ladder-parity
 */
import { describe, expect, it } from "vitest";

import {
  extractShellFunction,
  filesBelow,
  GITHUB_CLASSIFIER_GUARD,
  GITHUB_SYNC_SURFACES,
  LADDER_FUNCTION,
  LEGACY_CLASSIFIER_EXPRESSION,
  occurrences,
  readRepositoryFile,
  SOURCE_TRACKER_SYNC,
  TRACKER_SYNC_SURFACES,
} from "../../helpers/rollup-classifier-ladder-harness.js";

describe("closed authored and generated tracker-sync parity", () => {
  it("discovers exactly the six registered tracker-sync surfaces", () => {
    const discovered = filesBelow("plugins").filter(file =>
      file.endsWith("/skills/lisa-tracker-sync/SKILL.md")
    );
    expect(discovered).toEqual(
      [...TRACKER_SYNC_SURFACES]
        .slice()
        .sort((left, right) => left.localeCompare(right))
    );
  });

  it.each(TRACKER_SYNC_SURFACES)("pins the exact ladder in %s", surface => {
    const sourceBlock = extractShellFunction(
      readRepositoryFile(SOURCE_TRACKER_SYNC),
      LADDER_FUNCTION
    );
    const body = readRepositoryFile(surface);
    const block = extractShellFunction(body, LADDER_FUNCTION);

    expect(block).toBe(sourceBlock);
    expect(block.indexOf("${CLAUDE_PLUGIN_ROOT")).toBeLessThan(
      block.indexOf("${PLUGIN_ROOT")
    );
    expect(block).toContain("rollup-blocker-classification.mjs");
    expect(block).not.toContain("plugins/lisa");
    expect(block).not.toMatch(/\beval\b|\$PWD|\$\{?PATH\}?/u);
    expect(body).not.toContain(LEGACY_CLASSIFIER_EXPRESSION);
    expect(body).toMatch(
      /strict \*\*no-write\*\*[\s\S]{0,240}lifecycle[\s\S]{0,160}comment/iu
    );
    expect(body).toMatch(/attempted paths/iu);
    expect(body).toMatch(/environment values/iu);
    expect(body).toMatch(/child payloads/iu);
  });
});

describe("closed real GitHub rollup caller parity", () => {
  it("discovers exactly the six registered GitHub sync surfaces", () => {
    const discovered = filesBelow("plugins").filter(file =>
      file.endsWith("/skills/lisa-github-sync/SKILL.md")
    );
    expect(discovered).toEqual(
      [...GITHUB_SYNC_SURFACES]
        .slice()
        .sort((left, right) => left.localeCompare(right))
    );
  });

  it.each(GITHUB_SYNC_SURFACES)("binds the live ladder call in %s", surface => {
    const canonical = extractShellFunction(
      readRepositoryFile(SOURCE_TRACKER_SYNC),
      LADDER_FUNCTION
    );
    const body = readRepositoryFile(surface);
    const guardIndex = body.indexOf(GITHUB_CLASSIFIER_GUARD);

    expect(extractShellFunction(body, LADDER_FUNCTION)).toBe(canonical);
    expect(occurrences(body, GITHUB_CLASSIFIER_GUARD)).toBe(1);
    expect(occurrences(body, `${LADDER_FUNCTION} "<graph.json>"`)).toBe(1);
    expect(occurrences(body, "rollup-blocker-classification.mjs")).toBe(1);
    expect(body).not.toContain("CLASSIFIER_ROOT=");
    expect(body).not.toContain(LEGACY_CLASSIFIER_EXPRESSION);
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(body.indexOf("gh issue edit")).toBeGreaterThan(guardIndex);
    expect(body.indexOf("Post an idempotent")).toBeGreaterThan(guardIndex);
  });
});
