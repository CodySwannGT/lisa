/**
 * A failed tool lookup must be visible, not silently identical to an empty one.
 *
 * `tail` exits 0 whatever happened upstream, so reading the status after the
 * pipe reads the status of `tail`. Both outcomes still install the whole
 * catalogue — installing too much is the safe direction, and it is what this
 * field did before the vault had any say — but an operator who annotated the
 * notes and got the full catalogue anyway deserves to know which of the two
 * happened.
 *
 * Executed rather than pattern-matched: the field is a shell one-liner nobody
 * runs before pasting it into a settings box, and its failure mode there is a
 * session that will not start.
 * @module tests/unit/secrets/setup-field-lookup-status
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SETUP_FIELD } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/setup-remote-env.mjs";

/** The `npx`-free part of the field: everything the lookup itself does. */
const LOOKUP = [
  "tp=0",
  "w=$(fake_lookup 2>/dev/null) || tp=$?",
  'w=$(printf "%s\\n" "$w" | tail -1)',
  '[ "$tp" -eq 0 ] || echo "SETUP INCOMPLETE: could not read the tool list ' +
    'from the vault (exit $tp). Installing the full catalogue." >&2',
  'echo "tools=[$w]"',
].join("; ");

/**
 * Run the lookup fragment against a stub, under `sh` rather than the caller's
 * shell — the field runs wherever the vendor's setup script runs.
 * @param stub Body of the stubbed lookup command.
 * @returns Combined stdout and stderr.
 */
function runLookup(stub: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-lookup-"));
  const script = path.join(dir, "run.sh");
  // `exec 2>&1` because the diagnostic is deliberately on stderr — that is what
  // the vendor surfaces — and asserting only stdout would pass with it removed.
  writeFileSync(script, `exec 2>&1\nfake_lookup() { ${stub}; }\n${LOOKUP}\n`);
  // Absolute, not PATH-resolved: a test that runs whatever `sh` happens to be
  // first on PATH is both a weaker test and a lint failure.
  return execFileSync("/bin/sh", [script], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("the vault tool lookup in the setup field", () => {
  it("passes through the names a successful lookup prints", () => {
    const out = runLookup('echo "aws,sonar"');

    expect(out).toContain("tools=[aws,sonar]");
    expect(out).not.toContain("SETUP INCOMPLETE");
  });

  it("says nothing when a successful lookup names nothing", () => {
    // The documented no-op: an unannotated vault must look exactly like the
    // behaviour that predates this feature, warnings included.
    const out = runLookup("true");

    expect(out).toContain("tools=[]");
    expect(out).not.toContain("SETUP INCOMPLETE");
  });

  it("reports a FAILED lookup instead of reading it as an empty one", () => {
    // Captured before the pipe. Read after it, this is `tail`'s status and the
    // failure is invisible.
    const out = runLookup("return 3");

    expect(out).toContain("tools=[]");
    expect(out).toContain(
      "could not read the tool list from the vault (exit 3)"
    );
  });

  it("keeps that fragment in the field it was extracted from", () => {
    // The test above proves the shell works; this proves it is the shell that
    // ships. Without it the two could drift apart silently.
    expect(SETUP_FIELD).toContain("|| tp=$?");
    expect(SETUP_FIELD).toContain('w=$(printf "%s\\n" "$w" | tail -1)');
    expect(SETUP_FIELD).toContain(
      "could not read the tool list from the vault (exit $tp)"
    );
  });
});
