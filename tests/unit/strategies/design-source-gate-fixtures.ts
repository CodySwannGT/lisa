/**
 * Shared fixtures for the design-source gate tests (WU-F, issue #2430).
 *
 * The gate's inputs are ordinary changed-file records, so the fixtures are
 * deliberately tiny: a path, a change type, and the file body the annotation
 * would live in. Keeping them here lets the classification and verdict suites
 * assert against the same paths without either file re-declaring them.
 * @module tests/unit/strategies/design-source-gate-fixtures
 */

/** A Figma design-file URL with a node id — the positive annotation form. */
export const FIGMA_URL =
  "https://www.figma.com/design/AbC123/Checkout?node-id=412-1187";

/** The one designated marker. Hardcoded — drift is the thing under test. */
export const MARKER = "DESIGN-SOURCE: none — not in Figma";

/** Paths reused across both suites, named so the literals are declared once. */
export const PATHS = {
  button: "src/components/Button.tsx",
  debugPanel: "src/components/DebugPanel.tsx",
  invented: "src/components/Invented.tsx",
  config: "src/core/config.ts",
} as const;

/** A changed-file record as the gate consumes it. */
export type ChangedFile = {
  readonly path: string;
  readonly changeType: string;
  readonly content: string | null;
};

/**
 * Build a modified-file record.
 *
 * @param relPath Repo-relative path of the changed file.
 * @param content The file body at the head of the change.
 * @returns The changed-file record the gate consumes.
 */
export const changed = (relPath: string, content: string): ChangedFile => ({
  path: relPath,
  changeType: "modified",
  content,
});

/**
 * Build a modified UI file whose body carries the given annotation line.
 *
 * @param relPath Repo-relative path of the changed file.
 * @param annotation The full comment line to place above the export.
 * @returns The changed-file record the gate consumes.
 */
export const annotated = (relPath: string, annotation: string): ChangedFile =>
  changed(relPath, `${annotation}\nexport const Component = () => null;\n`);

/**
 * Build a modified UI file with no design-source annotation at all.
 *
 * @param relPath Repo-relative path of the changed file.
 * @returns The changed-file record the gate consumes.
 */
export const unannotated = (relPath: string): ChangedFile =>
  changed(relPath, "export const Component = () => null;\n");

/**
 * Every per-file status that must fail the whole change, paired with a changed
 * file that provably produces it.
 *
 * Stated here as an independent, hardcoded list rather than derived from the
 * gate's own `VIOLATION_STATUSES`. A table driven by the set under test is
 * self-matching: deleting a member deletes its own case and stays green, which
 * is precisely the inertness issue #2492 found. Driving the table from this
 * list instead — and pinning the gate's set against these keys — makes a
 * removal fail its own case and an addition fail the pin.
 */
export const VIOLATION_VERDICT_CASES: readonly (readonly [
  string,
  ChangedFile,
])[] = [
  ["undeclared", unannotated("src/components/Undeclared.tsx")],
  [
    "malformed",
    annotated(
      "src/components/Malformed.tsx",
      "// DESIGN-SOURCE: see the Slack mock"
    ),
  ],
  [
    "conflicting",
    annotated(
      "src/components/Conflicting.tsx",
      `// DESIGN-SOURCE: ${FIGMA_URL}\n// ${MARKER}`
    ),
  ],
  [
    "unreadable",
    {
      path: "src/components/Unreadable.tsx",
      changeType: "modified",
      content: null,
    },
  ],
];
