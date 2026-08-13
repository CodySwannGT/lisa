/**
 * Change-level verdict coverage for the design-source gate (WU-F, issue #2430).
 *
 * These are the three acceptance criteria of the work item — undeclared UI
 * fails, the marker passes, a Figma source passes — plus the fail-closed paths
 * that are the entire point of the gate. A gate that returns PASS when it could
 * not resolve the diff, or could not read a changed file, proves nothing; every
 * such path must land on FAIL with a named reason.
 * @module tests/unit/strategies/design-source-gate-verdict
 */
import { describe, expect, it } from "vitest";

import { evaluateDesignSource } from "../../../plugins/src/base/scripts/design-source-gate.mjs";

import {
  FIGMA_URL,
  MARKER,
  PATHS,
  annotated,
  changed,
  unannotated,
} from "./design-source-gate-fixtures";

const FIGMA_ANNOTATION = `// DESIGN-SOURCE: ${FIGMA_URL}`;
const MARKER_ANNOTATION = `// ${MARKER}`;

describe("design-source gate — change verdict", () => {
  it("FAILs a UI change with no Figma source and no marker", () => {
    const result = evaluateDesignSource({
      files: [unannotated(PATHS.invented)],
    });

    expect(result.verdict).toBe("FAIL");
    expect(result.violations.map(v => v.path)).toEqual([PATHS.invented]);
    expect(result.violations[0]?.status).toBe("undeclared");
  });

  it("PASSes a UI change carrying the marker, reporting it as an exception", () => {
    const result = evaluateDesignSource({
      files: [annotated(PATHS.debugPanel, MARKER_ANNOTATION)],
    });

    expect(result.verdict).toBe("PASS");
    expect(result.violations).toEqual([]);
    expect(result.exceptions.map(e => e.path)).toEqual([PATHS.debugPanel]);
  });

  it("PASSes a UI change backed by a Figma source", () => {
    const result = evaluateDesignSource({
      files: [annotated(PATHS.button, FIGMA_ANNOTATION)],
    });

    expect(result.verdict).toBe("PASS");
    expect(result.violations).toEqual([]);
    expect(result.sealed.map(s => s.path)).toEqual([PATHS.button]);
    expect(result.exceptions).toEqual([]);
  });

  it("PASSes a change that touches no UI surface at all", () => {
    const result = evaluateDesignSource({
      files: [changed(PATHS.config, "export const a = 1;\n")],
    });

    expect(result.verdict).toBe("PASS");
    expect(result.notApplicable.map(n => n.path)).toEqual([PATHS.config]);
  });

  it("judges only the files this change touched, never the whole tree", () => {
    // Bootstrap clause: a repo full of unannotated legacy UI is burndown, not
    // this work item's blocker. Only the changed file is judged.
    const result = evaluateDesignSource({
      files: [annotated(PATHS.button, FIGMA_ANNOTATION)],
    });

    expect(result.verdict).toBe("PASS");
    expect(result.summary.judged).toBe(1);
  });

  it("fails closed when the changed-file set could not be resolved", () => {
    const result = evaluateDesignSource({ files: null });

    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toContain("changed-files-unresolved");
  });

  it("fails closed when a diff error is reported instead of a file list", () => {
    const result = evaluateDesignSource({
      files: [],
      diffError: "fatal: bad revision 'origin/main'",
    });

    expect(result.verdict).toBe("FAIL");
    expect(result.reasons).toContain("diff-unresolved");
  });

  it("aggregates every violating file rather than stopping at the first", () => {
    const result = evaluateDesignSource({
      files: [
        unannotated("src/components/A.tsx"),
        annotated("src/components/B.tsx", "// DESIGN-SOURCE: maybe?"),
        annotated("src/components/C.tsx", FIGMA_ANNOTATION),
      ],
    });

    expect(result.verdict).toBe("FAIL");
    expect(result.violations.map(v => v.path)).toEqual([
      "src/components/A.tsx",
      "src/components/B.tsx",
    ]);
  });

  it("flags reasonless exceptions for sync-back when Figma access is proven", () => {
    const result = evaluateDesignSource({
      figmaAccess: true,
      files: [
        annotated(PATHS.debugPanel, MARKER_ANNOTATION),
        annotated(
          "src/components/Toast.tsx",
          `${MARKER_ANNOTATION} — throwaway internal affordance`
        ),
      ],
    });

    // Sync-back is the preference, not a second blocking gate: the marker is
    // still a valid exit, but a reasonless one is surfaced for review.
    expect(result.verdict).toBe("PASS");
    expect(result.syncBackPreferred.map(e => e.path)).toEqual([
      PATHS.debugPanel,
    ]);
  });

  it("does not demand sync-back when Figma access was never proven", () => {
    const result = evaluateDesignSource({
      figmaAccess: false,
      files: [annotated(PATHS.debugPanel, MARKER_ANNOTATION)],
    });

    expect(result.verdict).toBe("PASS");
    expect(result.syncBackPreferred).toEqual([]);
  });
});
