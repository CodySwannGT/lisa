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
 *
 * Four more routes to the same clean verdict were found afterwards, and they are
 * proved here by EXECUTION rather than by grep — the block is sliced out of each
 * hook and run against a stub `bun`, because a check that has never been watched
 * refusing is a claim:
 *
 * 1. `mktemp` was unchecked. The hook does not run under `set -e`, so a failure
 *    left the path empty, the redirect failed, and `[ ! -s "" ]` was true.
 * 2. Blank output became `{}`. Measured: a clean `bun audit --production --json`
 *    prints `{}` itself, so blank means the audit did not run.
 * 3. An unparseable payload was assigned raw, and the filter then found nothing.
 * 4. `jq empty` SUCCEEDS on an empty file, so a `gzip -dc` that failed and wrote
 *    nothing was accepted as valid JSON.
 * @module tests/unit/hooks/pre-push-audit-transport-parity
 */

import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { trackedHookCopies } from "../../helpers/hook-roster.js";

const ROOT = process.cwd();

/**
 * Every tracked copy of the pre-push hook, derived rather than written down.
 *
 * This roster was two entries long while a third tracked copy carried the exact
 * fail-open shape these tests were written to kill (CodySwannGT/lisa#2847). A
 * roster someone types is a roster that answers for the copies they remembered.
 */
const HOOKS = [...trackedHookCopies("pre-push")];

/** The success line the block prints, and must never print from a non-answer. */
const CLEAN_VERDICT = "No high or critical";
const CLEAN_PAYLOAD = "{}";
const DIRTY_PAYLOAD = JSON.stringify({
  "some-package": [
    {
      severity: "critical",
      url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
    },
  ],
});

const temporary: string[] = [];

afterAll(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
});

/**
 * Read one hook's source.
 * @param relative - Repo-relative path to the hook
 * @returns The hook's full text
 */
const hook = (relative: string) =>
  readFileSync(path.join(ROOT, relative), "utf8");

/**
 * Cut the bun audit block out of a hook, verbatim.
 *
 * Sliced rather than reimplemented: a copy of the logic would prove only that
 * the copy is right. Matched on the `AUDIT_OUTPUT` assignment rather than on the
 * guard around it, so the slice still finds the block in its fail-open shape —
 * a locator that only matches the fixed version cannot show the bug.
 * @param relative - Repo-relative path to the hook
 * @returns The block as a runnable script body
 */
function auditBlock(relative: string): string {
  const lines = hook(relative).split("\n");
  const start = lines.findIndex(line => /AUDIT_OUTPUT="\$\(/u.test(line));
  // Searched from `start`: the npm and yarn branches print the same success
  // line earlier in the hook, and the first match belongs to one of those.
  const end = lines.findIndex(
    (line, index) => index > start && line.includes(`✅ ${CLEAN_VERDICT}`)
  );
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join("\n");
}

/**
 * A directory holding a stub `bun` that emits one canned transport shape.
 * @param mode - What the stub should write
 * @returns The directory to prepend to PATH
 */
function stubBun(mode: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-bun-audit-"));
  const script = `#!/bin/sh
case "${mode}" in
  blank) echo "error: Lockfile not found" >&2; exit 1 ;;
  garbage) printf 'this is not json' ;;
  empty-success) exit 0 ;;
  gzipped) printf '%s' '${DIRTY_PAYLOAD}' | gzip -c ;;
  clean) printf '%s' '${CLEAN_PAYLOAD}' ;;
  dirty) printf '%s' '${DIRTY_PAYLOAD}' ;;
esac
`;
  const file = path.join(dir, "bun");
  temporary.push(dir);
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  return dir;
}

/**
 * Run one hook's audit block with a stubbed `bun`.
 * @param relative - Repo-relative path to the hook
 * @param mode - Which transport shape the stub emits
 * @returns Exit status and the two streams
 */
function runAudit(
  relative: string,
  mode: string
): { status: number; stdout: string; stderr: string } {
  const body = `AUDIT_EXCLUSIONS=""\n${auditBlock(relative)}\n`;
  const result = boundedSpawnSync({
    label: "pre-push audit block",
    command: "/bin/sh",
    args: ["-c", body],
    env: {
      ...process.env,
      PATH: `${stubBun(mode)}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

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

  it("keeps every copy's transport handling identical", () => {
    // The drift this file exists for was one copy gaining a fix the others
    // never received. Compare the handling itself, not the whole hook: the
    // copies legitimately differ elsewhere (Lisa runs project-specific checks a
    // host project does not). Every copy is compared to the first rather than
    // two being destructured, so a third copy is answered for and not ignored.
    const handling = HOOKS.map(path => [
      path,
      hook(path)
        .split("\n")
        .filter(line => /AUDIT_OUTPUT|gzip -dc|jq empty|AUDIT_JSON=/.test(line))
        .map(line => line.trim())
        .join("\n"),
    ]);
    const [reference] = handling;
    expect(reference).toBeDefined();
    for (const [path, block] of handling.slice(1)) {
      expect(`${path}\n${block}`).toBe(`${path}\n${reference?.[1] ?? ""}`);
    }
  });
});

describe.each(HOOKS)("%s blocks when it audited nothing", relative => {
  it("refuses when bun produced no output, and says why", () => {
    // This assertion used to require `AUDIT_JSON="{}"` — substituting an empty
    // advisory set for output that was never produced.
    const { status, stdout, stderr } = runAudit(relative, "blank");
    expect(status).toBe(1);
    expect(stdout).not.toContain(CLEAN_VERDICT);
    expect(stderr).toContain("nothing was audited");
    // bun's own diagnosis is the fastest route to the cause, so it is kept
    // rather than sent to /dev/null.
    expect(stderr).toContain("Lockfile not found");
  });

  it("refuses successful empty output as unaudited", () => {
    const { status, stdout, stderr } = runAudit(relative, "empty-success");
    expect(status).toBe(1);
    expect(stdout).not.toContain(CLEAN_VERDICT);
    expect(stderr).toContain("nothing was audited");
  });

  it("refuses a payload that is neither JSON nor gzip", () => {
    const { status, stdout, stderr } = runAudit(relative, "garbage");
    expect(status).toBe(1);
    expect(stdout).not.toContain(CLEAN_VERDICT);
    expect(stderr).toContain("neither JSON nor gzipped JSON");
  });

  it("still passes a genuinely clean audit", () => {
    // The half that must not weaken: fail-closed is worthless if it fails on
    // everything, and a gate nobody can pass gets deleted.
    const { status, stdout } = runAudit(relative, "clean");
    expect(status).toBe(0);
    expect(stdout).toContain(CLEAN_VERDICT);
  });

  it("still fails an audit reporting a critical advisory", () => {
    const { status, stdout } = runAudit(relative, "dirty");
    expect(status).toBe(1);
    expect(stdout).toContain("GHSA-aaaa-bbbb-cccc");
  });

  it("still reads the gzip transport shape that started this", () => {
    const { status, stdout } = runAudit(relative, "gzipped");
    expect(status).toBe(1);
    expect(stdout).toContain("GHSA-aaaa-bbbb-cccc");
  });
});
