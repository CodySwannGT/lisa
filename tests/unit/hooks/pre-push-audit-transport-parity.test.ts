/**
 * The pre-push security audit must not fail open, in Lisa or in what it ships.
 *
 * Measured defect (2026-08-15): Lisa's own `.husky/pre-push` normalized bun's
 * gzip transport before parsing; the shipped `typescript/copy-contents/.husky/
 * pre-push` did not. On that transport shape the host copy captured binary into
 * `AUDIT_JSON`, the jq filter returned nothing, `UNFIXED_COUNT` resolved to
 * empty, `[ "" -gt 0 ]` was false, and the hook printed "No high or critical
 * vulnerabilities found" and allowed the push.
 *
 * So the gate reported success having parsed nothing — in every host project on
 * this template — on a transport shape Lisa had already patched for itself.
 *
 * These tests exist because the two copies drifted silently and nothing noticed.
 * Two implementations of one check cannot be kept in step by intention; the
 * durable fix is one shared script, and until that lands this asserts parity so
 * the next divergence fails here instead of in a fleet of host projects.
 * @module tests/unit/hooks/pre-push-audit-transport-parity
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Both copies of the pre-push hook that carry the audit block. */
const HOOKS = [
  ".husky/pre-push",
  "typescript/copy-contents/.husky/pre-push",
] as const;

/**
 * Read one hook's source.
 * @param relative - Repo-relative path to the hook
 * @returns The hook's full text
 */
const hook = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

describe("pre-push audit transport", () => {
  it.each(HOOKS)("%s normalizes bun's gzip transport before parsing", path => {
    const source = hook(path);

    // The single-line form `AUDIT_JSON=$(bun audit ... )` is the fail-open
    // shape: it captures binary straight into the variable the jq filter reads.
    expect(source).toContain("bun audit --production --json");
    expect(source).not.toMatch(
      /AUDIT_JSON=\$\(bun audit --production --json[^)]*\)/
    );

    // Redirect to a file, validate it parses, and fall back to gunzip if not.
    expect(source).toContain('bun audit --production --json > "$AUDIT_OUTPUT"');
    expect(source).toContain("gzip -dc");
    expect(source).toContain("jq empty");
  });

  it.each(HOOKS)("%s treats an empty audit as {} rather than blank", path => {
    // A blank `AUDIT_JSON` reaches the same jq filter as binary does and yields
    // the same empty count, so "no output" must become valid empty JSON rather
    // than an empty string.
    expect(hook(path)).toContain('AUDIT_JSON="{}"');
  });

  it("keeps both copies' transport handling identical", () => {
    // The drift this file exists for was one copy gaining a fix the other
    // never received. Compare the handling itself, not the whole hook: the
    // two legitimately differ elsewhere (Lisa runs project-specific checks a
    // host project does not).
    const [lisa, shipped] = HOOKS.map(path =>
      hook(path)
        .split("\n")
        .filter(line => /AUDIT_OUTPUT|gzip -dc|jq empty|AUDIT_JSON=/.test(line))
        .map(line => line.trim())
        .join("\n")
    );
    expect(shipped).toBe(lisa);
  });
});
