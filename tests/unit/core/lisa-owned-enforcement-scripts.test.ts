/**
 * Every enforcement script Lisa ships is Lisa's, whatever it happens to be named.
 *
 * #2374 made the `lisa-` path segment the marker for "Lisa owns this outright",
 * and refresh only ever looked at files carrying it. That is a naming
 * convention standing in for a property, and a convention nobody enforces
 * drifts: `scripts/check-state-classification.mjs` shipped without the segment,
 * so no adopter who already had the file ever received a content fix to it — at
 * any version bump, forever — while CI ran the frozen copy and stayed green.
 *
 * The population was never one file. Across the stack trees, 21 shipped gates
 * were frozen this way, including `check-bdd-coverage.mjs`, whose fix for six
 * ways the gate could report what it had not proven landed days before this and
 * could not reach anybody who already had it.
 *
 * So ownership is no longer read off a filename. Lisa's `scripts/` tree is its
 * enforcement territory — the gates themselves and the machinery they call —
 * and a host tunes those gates through config (`.lisa.config.json`,
 * `*.thresholds.json`) or opts out through `.lisaignore`, never by editing the
 * checker. These tests pin both directions of that line, and the lockstep
 * between the predicate and the provenance ledger that makes widening it safe.
 * @module tests/unit/core/lisa-owned-enforcement-scripts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { LISA_OWNED_HASH_LEDGER } from "../../../src/core/lisa-owned-hash-ledger.js";
import {
  classifyHostCopy,
  mayRefreshLisaOwned,
} from "../../../src/core/lisa-owned-provenance.js";
import { isLisaOwnedTemplate } from "../../../src/core/lisa-owned-templates.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
/** Pinned git binary — resolving `git` via $PATH trips no-os-command-from-path. */
const GIT_BIN = "/usr/bin/git";
const MARKER = "/copy-overwrite/";
const STATE_GATE = "scripts/check-state-classification.mjs";
const STATE_GATE_SOURCE = `all/copy-overwrite/${STATE_GATE}`;

/** One shipped template: where it installs, and which file produces it. */
interface Shipped {
  readonly destination: string;
  readonly source: string;
}

/**
 * Run git in the repository, reading bytes so arbitrary content survives.
 * @param args - Arguments passed to git
 * @returns Command stdout as a latin1 string
 */
function git(args: readonly string[]): string {
  return execFileSync(GIT_BIN, [...args], {
    cwd: REPO_ROOT,
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  }).toString("binary");
}

/**
 * Every enforcement script Lisa ships, across all stack trees.
 *
 * Read from git rather than a hardcoded list precisely because the defect was a
 * file nobody remembered to add to something.
 * @returns Destination/source pairs for templates installing under `scripts/`
 */
function shippedEnforcementScripts(): readonly Shipped[] {
  return git(["ls-files"])
    .split("\n")
    .flatMap(tracked => {
      const at = tracked.indexOf(MARKER);
      if (at === -1) return [];
      const destination = tracked.slice(at + MARKER.length);
      return destination.startsWith("scripts/")
        ? [{ destination, source: tracked }]
        : [];
    });
}

describe("Lisa-owned enforcement scripts (#2551)", () => {
  it("owns every enforcement script it ships, namespaced or not", () => {
    const shipped = shippedEnforcementScripts();

    // Without this the sweep passes by testing nothing the moment the trees
    // move — the same shape of vacuous green that hid the original defect.
    expect(shipped.length).toBeGreaterThan(30);

    const frozen = shipped
      .filter(({ destination }) => !isLisaOwnedTemplate(destination))
      .map(({ source }) => source);

    expect(frozen).toEqual([]);
  });

  it("owns the state-classification gate that could not be delivered", () => {
    // The file the ticket is about, asserted by name so the class sweep above
    // cannot be narrowed later without this failing too.
    expect(isLisaOwnedTemplate(STATE_GATE)).toBe(true);
  });

  it("enrols every artifact it owns in the provenance ledger", () => {
    // The direction nothing asserted before. `classifyHostCopy` returns
    // `unenrolled` for a path with no ledger entry, and refresh treats that as
    // permission to overwrite — so widening the predicate without widening
    // enrolment in the same change converts a frozen guard into an
    // unconditional clobber, which is #2470's defect wearing this ticket's hat.
    const unenrolled = [
      ...new Set(
        shippedEnforcementScripts()
          .filter(({ destination }) => isLisaOwnedTemplate(destination))
          .map(({ destination }) => destination)
      ),
    ].filter(destination => LISA_OWNED_HASH_LEDGER[destination] === undefined);

    expect(unenrolled).toEqual([]);
  });

  it("still leaves files a project legitimately customises alone", () => {
    // Widening must not become "overwrite whatever Lisa seeded". These are
    // seeded once and then edited downstream, and none of them is a gate.
    for (const hostOwned of [
      "tsconfig.json",
      "knip.json",
      "eslint.config.ts",
      ".prettierrc.json",
      "lefthook.yml",
      ".github/workflows/ci.yml",
      ".lisa.config.json",
      ".lisa/PROJECT_LEARNINGS.md",
    ]) {
      expect(isLisaOwnedTemplate(hostOwned), hostOwned).toBe(false);
    }
  });

  it("refreshes a newly-owned gate whose bytes are a past Lisa release", () => {
    // End to end against the REAL shipped ledger, not a fixture: the bytes of
    // the previous release of this gate are what a lagging adopter is actually
    // running, and delivering to them is the entire point of the ticket.
    const [, previous] = git([
      "log",
      "--follow",
      "--format=%H",
      "--",
      STATE_GATE_SOURCE,
    ])
      .split("\n")
      .filter(line => line !== "");

    // A one-revision history would make this pass while proving nothing.
    expect(previous).toBeDefined();

    const hostBytes = Buffer.from(
      git(["show", `${previous}:${STATE_GATE_SOURCE}`]),
      "binary"
    );
    const lisaBytes = readFileSync(path.join(REPO_ROOT, STATE_GATE_SOURCE));
    expect(hostBytes.equals(lisaBytes)).toBe(false);

    const verdict = classifyHostCopy(STATE_GATE, hostBytes, lisaBytes);

    expect(verdict.kind).toBe("provably-stale");
    expect(mayRefreshLisaOwned(verdict)).toBe(true);
  });

  it("preserves a newly-owned gate the host edited downstream", () => {
    // The other direction, and the one that would make this fix worse than the
    // bug. Also against the real ledger: a host hardening a Lisa script edits a
    // copy of Lisa's file, so it keeps every marker Lisa's copy carries and
    // differs only in bytes nobody declared. Nothing may read that as stale.
    const lisaBytes = readFileSync(path.join(REPO_ROOT, STATE_GATE_SOURCE));
    const hostBytes = Buffer.concat([
      lisaBytes,
      Buffer.from("\n// locally hardened\n"),
    ]);

    const verdict = classifyHostCopy(STATE_GATE, hostBytes, lisaBytes);

    expect(verdict.kind).toBe("host-modified");
    expect(mayRefreshLisaOwned(verdict)).toBe(false);
  });
});
