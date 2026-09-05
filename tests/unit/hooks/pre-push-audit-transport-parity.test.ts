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
  existsSync,
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
/** The advisory the dirty payload carries, and the id the gate must name. */
const ADVISORY_ID = "GHSA-aaaa-bbbb-cccc";
/** The refusal that says the audit did not happen, as distinct from found-nothing. */
const UNAUDITED = "nothing was audited";
const DIRTY_PAYLOAD = JSON.stringify({
  "some-package": [
    {
      severity: "critical",
      url: `https://github.com/advisories/${ADVISORY_ID}`,
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
 *
 * The stub counts its own invocations into a sibling file, because the
 * discriminating property of a retry is not only what the block finally decides
 * but HOW MANY TIMES it asked. A retry that quietly re-runs a determinate answer
 * would pass every verdict assertion here and still be the defect
 * (CodySwannGT/lisa#3790): "a real advisory must fail on the first call" is a
 * claim about the call count, so the call count is measured.
 *
 * Modes suffixed `-then-` are the intermittent middle the ticket names: a first
 * attempt that fails followed by one that succeeds. A retry proved only against
 * always-succeeds and always-fails has not been tested against the actual
 * failure.
 * @param mode - What the stub should write
 * @returns The directory to prepend to PATH and the invocation-counter path
 */
function stubBun(mode: string): { dir: string; counter: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-bun-audit-"));
  const counter = path.join(dir, "calls");
  const script = `#!/bin/sh
printf 'x' >> "${counter}"
CALLS=$(wc -c < "${counter}" | tr -d ' ')
case "${mode}" in
  blank) echo "error: Lockfile not found" >&2; exit 1 ;;
  garbage) printf 'this is not json' ;;
  empty-success) exit 0 ;;
  gzipped) printf '%s' '${DIRTY_PAYLOAD}' | gzip -c ;;
  clean) printf '%s' '${CLEAN_PAYLOAD}' ;;
  dirty) printf '%s' '${DIRTY_PAYLOAD}' ;;
  timeout) echo "Timeout: audit request failed" >&2; exit 1 ;;
  timeout-then-clean)
    if [ "$CALLS" -eq 1 ]; then
      echo "Timeout: audit request failed" >&2; exit 1
    fi
    printf '%s' '${CLEAN_PAYLOAD}' ;;
  timeout-then-dirty)
    if [ "$CALLS" -eq 1 ]; then
      echo "Timeout: audit request failed" >&2; exit 1
    fi
    printf '%s' '${DIRTY_PAYLOAD}' ;;
  garbage-then-clean)
    if [ "$CALLS" -eq 1 ]; then
      printf 'this is not json'; exit 0
    fi
    printf '%s' '${CLEAN_PAYLOAD}' ;;
esac
`;
  const file = path.join(dir, "bun");
  temporary.push(dir);
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  return { dir, counter };
}

/**
 * Run one hook's audit block with a stubbed `bun`.
 *
 * `LISA_AUDIT_RETRY_DELAY=0` removes the backoff sleep, not the retry: the loop
 * still makes every attempt, so the always-fails cases still prove the block
 * exhausts its budget rather than proving a shortened one.
 * @param relative - Repo-relative path to the hook
 * @param mode - Which transport shape the stub emits
 * @param env - Extra environment for the block, e.g. a retry budget
 * @returns Exit status, the two streams, and how many times `bun` was invoked
 */
function runAudit(
  relative: string,
  mode: string,
  env: Record<string, string> = {}
): { status: number; stdout: string; stderr: string; calls: number } {
  const body = `AUDIT_EXCLUSIONS=""\n${auditBlock(relative)}\n`;
  const stub = stubBun(mode);
  const result = boundedSpawnSync({
    label: "pre-push audit block",
    command: "/bin/sh",
    args: ["-c", body],
    env: {
      ...process.env,
      LISA_AUDIT_RETRY_DELAY: "0",
      ...env,
      PATH: `${stub.dir}${path.delimiter}${process.env.PATH ?? ""}`,
    },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    calls: existsSync(stub.counter)
      ? readFileSync(stub.counter, "utf8").length
      : 0,
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
    // never received. The retry budget is compared alongside the transport for
    // the same reason: a copy that retried a determinate answer, or that did not
    // retry at all, would be the next silent divergence. Compare the handling itself, not the whole hook: the
    // copies legitimately differ elsewhere (Lisa runs project-specific checks a
    // host project does not). Every copy is compared to the first rather than
    // two being destructured, so a third copy is answered for and not ignored.
    const handling = HOOKS.map(path => [
      path,
      hook(path)
        .split("\n")
        .filter(line =>
          /AUDIT_OUTPUT|gzip -dc|jq empty|AUDIT_JSON=|AUDIT_ATTEMPT|AUDIT_INDETERMINATE|LISA_AUDIT/.test(
            line
          )
        )
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
    expect(stderr).toContain(UNAUDITED);
    // bun's own diagnosis is the fastest route to the cause, so it is kept
    // rather than sent to /dev/null.
    expect(stderr).toContain("Lockfile not found");
  });

  it("refuses successful empty output as unaudited", () => {
    const { status, stdout, stderr } = runAudit(relative, "empty-success");
    expect(status).toBe(1);
    expect(stdout).not.toContain(CLEAN_VERDICT);
    expect(stderr).toContain(UNAUDITED);
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
    expect(stdout).toContain(ADVISORY_ID);
  });

  it("still reads the gzip transport shape that started this", () => {
    const { status, stdout } = runAudit(relative, "gzipped");
    expect(status).toBe(1);
    expect(stdout).toContain(ADVISORY_ID);
  });
});

/**
 * The retry, and the direction that makes it safe (CodySwannGT/lisa#3790).
 *
 * `bun audit` is a network call. Measured 2026-09-04: one of three consecutive
 * invocations in one directory, seconds apart, returned zero bytes with
 * `Timeout: audit request failed` while the other two returned 6036 bytes of
 * valid JSON. The block above correctly refuses to read zero bytes as clean, so
 * that flake blocked a `git push` — which had already paid for the entire gate
 * chain, since the audit sits near the end of it.
 *
 * A retry is the fix, but retry policy has a direction, and the wrong direction
 * is strictly worse than the flake it removes. Only the INDETERMINATE outcome —
 * nothing parsed, so the audit did not happen — may be retried. A determinate
 * answer is final in both of its forms: a critical advisory blocks on the first
 * call and is never retried into a pass, and a clean audit costs exactly one
 * call.
 *
 * That distinction is not visible in an exit code, so these cases assert the
 * INVOCATION COUNT alongside the verdict. Every verdict assertion here would
 * also pass against a block that re-ran a finding three times before reporting
 * it; the counts are what separate the fix from that.
 */
describe.each(HOOKS)(
  "%s retries only what it could not determine",
  relative => {
    it("clears a transient timeout and evaluates the successful attempt", () => {
      // The discriminating case the ticket names: a first attempt that fails
      // followed by one that succeeds. Always-succeeds and always-fails between
      // them never exercise the intermittent middle, which is the actual failure.
      const { status, stdout, calls } = runAudit(
        relative,
        "timeout-then-clean"
      );
      expect(calls).toBe(2);
      expect(status).toBe(0);
      expect(stdout).toContain(CLEAN_VERDICT);
    });

    it("clears a transient unparseable payload the same way", () => {
      const { status, stdout, calls } = runAudit(
        relative,
        "garbage-then-clean"
      );
      expect(calls).toBe(2);
      expect(status).toBe(0);
      expect(stdout).toContain(CLEAN_VERDICT);
    });

    it("still names an advisory found only on the retried attempt", () => {
      // A retry must not lose the finding it eventually reaches. The verdict from
      // the successful attempt is the verdict, whichever way it points.
      const { status, stdout, calls } = runAudit(
        relative,
        "timeout-then-dirty"
      );
      expect(calls).toBe(2);
      expect(status).toBe(1);
      expect(stdout).toContain(ADVISORY_ID);
    });

    it("never retries an audit that found a critical advisory", () => {
      // The control that matters most. A retry that swallowed a real vulnerability
      // would be a worse defect than the flake this fix removes, and no exit code
      // distinguishes "blocked on attempt 1" from "blocked on attempt 3" — the
      // call count does.
      const { status, stdout, calls } = runAudit(relative, "dirty");
      expect(calls).toBe(1);
      expect(status).toBe(1);
      expect(stdout).toContain(ADVISORY_ID);
    });

    it("never retries a clean audit", () => {
      const { status, stdout, calls } = runAudit(relative, "clean");
      expect(calls).toBe(1);
      expect(status).toBe(0);
      expect(stdout).toContain(CLEAN_VERDICT);
    });

    it("exhausts its budget before refusing a persistent timeout", () => {
      const { status, stdout, stderr, calls } = runAudit(relative, "timeout");
      expect(calls).toBe(3);
      expect(status).toBe(1);
      expect(stdout).not.toContain(CLEAN_VERDICT);
      expect(stderr).toContain(UNAUDITED);
      // bun's own line is the diagnosis, and it survives every attempt.
      expect(stderr).toContain("Timeout: audit request failed");
    });

    it("honours a caller-supplied attempt budget", () => {
      const { calls, status } = runAudit(relative, "timeout", {
        LISA_AUDIT_ATTEMPTS: "2",
      });
      expect(calls).toBe(2);
      expect(status).toBe(1);
    });

    it("falls back to the default budget when the knob is not a number", () => {
      // A typo in an env var must not silently disarm the retry. Without the
      // numeric guard this reaches `[ abc -le 3 ]`, which is not an instruction
      // anyone gave — the hook does not run under `set -e`, so it would not even
      // stop.
      const { calls } = runAudit(relative, "timeout", {
        LISA_AUDIT_ATTEMPTS: "three",
      });
      expect(calls).toBe(3);
    });

    it("keeps a budget of zero from skipping the audit entirely", () => {
      // Floor of one attempt: a gate that can be told to make no network call at
      // all and then decide is the fail-open wearing a knob.
      const { calls, status, stderr } = runAudit(relative, "timeout", {
        LISA_AUDIT_ATTEMPTS: "0",
      });
      expect(calls).toBe(1);
      expect(status).toBe(1);
      expect(stderr).toContain(UNAUDITED);
    });

    it("reports the retry as an audit that did not run, not as a finding", () => {
      // The compounding hazard in the ticket: a reader who takes the retry notice
      // for a vulnerability report goes hunting a CVE that was never measured.
      const { stderr } = runAudit(relative, "timeout");
      expect(stderr).toContain("the audit did not run");
      expect(stderr).not.toContain("Unresolved high/critical");
    });

    it("keeps the two blocking failures distinguishable", () => {
      // Three outcomes, three sentences. Collapsing "could not be performed" into
      // either "clean" or "found something" is a defect in both directions.
      const timedOut = runAudit(relative, "timeout");
      const garbled = runAudit(relative, "garbage");
      expect(timedOut.stderr).toContain("produced no output");
      expect(timedOut.stderr).not.toContain("neither JSON nor gzipped");
      expect(garbled.stderr).toContain("neither JSON nor gzipped");
      expect(garbled.stderr).not.toContain("produced no output");
    });
  }
);
