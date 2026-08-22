/**
 * The hook parity roster is derived from the tree, not written down.
 *
 * Measured defect (CodySwannGT/lisa#2847): a third tracked copy of the pre-push
 * hook sat six commits behind the other two for four weeks. Nothing reported
 * it, because every test that could have — three of them literally named parity
 * tests — hardcoded its own two-entry roster and stopped there. Each proved
 * parity across the copies it happened to list, so the answer to "do the copies
 * agree" changed silently the moment a third copy existed.
 *
 * These tests pin the two halves of the fix: the roster comes from the set of
 * tracked paths, and the copies of one hook must declare the same features.
 * @module tests/unit/core/hook-copy-parity
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  declaredHookFeatures,
  deriveHookCopyGroups,
  describeHookCopyFinding,
  findHookCopyDrift,
  type HookCopy,
} from "../../../src/core/hook-copy-parity.js";
import { trackedHookGroups } from "../../helpers/hook-roster.js";

const ROOT = process.cwd();
const LISA_COPY = ".husky/pre-push";
const TEMPLATE_COPY = "typescript/copy-contents/.husky/pre-push";
const SNAPSHOT_COPY = ".claude-pr/.husky/pre-push";
const FOURTH_COPY = "vendor/snapshot/.husky/pre-push";
const PRE_PUSH = "pre-push";
const TRACEABILITY = "gate:traceability";
const CODE_STYLE = "gate:code-style";

/**
 * A hook body declaring exactly the gate ids given.
 * @param gates - Gate ids whose built-in steps this hook can stand down
 * @returns Hook source
 */
function hookDeclaring(...gates: readonly string[]): string {
  return [
    "#!/bin/sh",
    "lisa_gate_covers() {",
    '  grep -Fqx -- "$1" "$LISA_GATE_COVERAGE"',
    "}",
    ...gates.map(gate => `if lisa_gate_covers ${gate}; then :; fi`),
  ].join("\n");
}

describe("deriveHookCopyGroups", () => {
  it("groups copies of one hook that live at different paths", () => {
    const groups = deriveHookCopyGroups([
      LISA_COPY,
      TEMPLATE_COPY,
      "src/index.ts",
    ]);

    expect(groups).toEqual([
      { hook: PRE_PUSH, paths: [LISA_COPY, TEMPLATE_COPY] },
    ]);
  });

  it("covers a fourth copy without any roster being edited", () => {
    const known = [LISA_COPY, TEMPLATE_COPY, SNAPSHOT_COPY];

    const before = deriveHookCopyGroups(known);
    const after = deriveHookCopyGroups([...known, FOURTH_COPY]);

    expect(before[0]?.paths).toHaveLength(3);
    expect(after[0]?.paths).toHaveLength(4);
    expect(after[0]?.paths).toContain(FOURTH_COPY);
  });

  it("ignores files that only resemble a hook path", () => {
    expect(
      deriveHookCopyGroups([
        "docs/.husky/nested/pre-push",
        "notes/husky/pre-push",
      ])
    ).toEqual([]);
  });
});

describe("declaredHookFeatures", () => {
  it("reads every gate id a call site names, including multi-argument calls", () => {
    const source = `${hookDeclaring("credential-leakage")}
if lisa_gate_covers code-style format-conformance; then :; fi
`;

    expect(declaredHookFeatures(source)).toEqual([
      CODE_STYLE,
      "gate:credential-leakage",
      "gate:format-conformance",
    ]);
  });

  it("does not mistake the helper's own definition for a declaration", () => {
    expect(declaredHookFeatures(hookDeclaring())).toEqual([]);
  });
});

describe("findHookCopyDrift", () => {
  it("names both paths and the feature one copy is missing", () => {
    const copies: readonly HookCopy[] = [
      { path: LISA_COPY, features: [TRACEABILITY] },
      { path: SNAPSHOT_COPY, features: [] },
    ];

    const findings = findHookCopyDrift(PRE_PUSH, copies);

    expect(findings).toEqual([
      {
        hook: PRE_PUSH,
        feature: TRACEABILITY,
        present: [LISA_COPY],
        absent: [SNAPSHOT_COPY],
      },
    ]);
    expect(describeHookCopyFinding(findings[0]!)).toBe(
      `pre-push: ${TRACEABILITY} is declared by ${LISA_COPY} but absent from ${SNAPSHOT_COPY}`
    );
  });

  it("stays quiet for a hook with exactly one tracked copy", () => {
    expect(
      findHookCopyDrift("post-checkout", [
        { path: ".husky/post-checkout", features: [TRACEABILITY] },
      ])
    ).toEqual([]);
  });

  it("stays quiet when copies differ in text but agree on features", () => {
    expect(
      findHookCopyDrift("pre-commit", [
        { path: "a/.husky/pre-commit", features: [CODE_STYLE] },
        { path: "b/.husky/pre-commit", features: [CODE_STYLE] },
      ])
    ).toEqual([]);
  });
});

describe("this repository", () => {
  it("has no hook whose tracked copies disagree about a declared feature", () => {
    const groups = trackedHookGroups(ROOT).filter(
      group => group.paths.length > 1
    );
    expect(groups.length).toBeGreaterThan(0);

    const findings = groups.flatMap(group =>
      findHookCopyDrift(
        group.hook,
        group.paths.map(relative => ({
          path: relative,
          features: declaredHookFeatures(
            readFileSync(path.join(ROOT, relative), "utf8")
          ),
        }))
      )
    );

    expect(findings.map(describeHookCopyFinding)).toEqual([]);
  });
});
