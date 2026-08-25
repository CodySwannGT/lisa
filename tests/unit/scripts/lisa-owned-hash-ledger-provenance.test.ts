/**
 * A ledger digest has to say where it came from (CodySwannGT/lisa#3115).
 *
 * Two sources feed the ledger — the `git log --follow` walk, and carry-forward
 * of whatever is already checked in — and until this shipped, an entry from one
 * was indistinguishable from an entry from the other, and from an entry that
 * should never have been there. Settling a single flagged digest cost 10
 * reachable revisions of two candidate paths plus 14 reflog entries checked,
 * then a delete-and-regenerate to find out which source had produced it.
 *
 * The two states have OPPOSITE correct responses, which is why guessing is not
 * an option: a carried-forward digest must be KEPT — a clone that cannot derive
 * it is not evidence that Lisa never shipped it, and dropping one permanently
 * stops refresh recognising a genuinely older host copy — while an entry
 * nothing accounts for is worth asking about.
 *
 * `doesNotReportADerivableDigest` is the control that gives the rest their
 * meaning: a report that named everything would satisfy every other case here
 * and be worthless.
 *
 * Per the Test Isolation house rule, expected digests are HARDCODED rather than
 * recomputed from the fixture bytes by the code under test.
 * @module tests/unit/scripts/lisa-owned-hash-ledger-provenance
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  HISTORY_EXPORT,
  LEDGER_EXPORT,
  LEDGER_RELATIVE_PATH,
  runCheck,
  runGenerate,
} from "../../../scripts/generate-lisa-owned-hash-ledger.mjs";
import { mergeGeneratedArtifact } from "../../../scripts/merge-generated-artifact.mjs";
import { digestOrigin } from "../../../src/core/lisa-owned-provenance.js";
import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { cleanupTempDir } from "../../helpers/test-utils.js";
import { cleanGitEnv, resolveGit } from "../../support/git-executable.js";

useIoLatencyBudget();

const GIT = resolveGit();

/**
 * Fixture repositories to remove after each case.
 *
 * Not housekeeping: a saturated `$TMPDIR` on this machine has already killed a
 * gate from the outside and been read as a content failure
 * (CodySwannGT/lisa#2883).
 */
const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map(root => cleanupTempDir(root)));
});

/** Fixture template source, and the destination it installs to. */
const GUARD_SOURCE = "all/copy-overwrite/scripts/lisa-hooks/fixture-guard.sh";
const GUARD_DESTINATION = "scripts/lisa-hooks/fixture-guard.sh";

const OLD_BYTES = "old guard\n";
const NEW_BYTES = "new guard\n";

/** sha256 of `OLD_BYTES`. */
const OLD_DIGEST =
  "f13d37e56916505e0ecbc99886433d5594fe87b77c20c98a0024f43bb93f94a4";

/** sha256 of `NEW_BYTES`. */
const NEW_DIGEST =
  "9b3719aa0f7345deb57978c1992a0a3a47df4d81980e06f79b3c5b592feed699";

/**
 * A digest no revision of the fixture ever held.
 *
 * Stands in for the real one that produced this ticket: a line the history walk
 * cannot account for, which survived only because the generator carries the
 * checked-in ledger forward.
 */
const STRAY_DIGEST =
  "0000000000000000000000000000000000000000000000000000000000000abc";

/** The destination and digest whose excavation produced CodySwannGT/lisa#3115. */
const EXCAVATED_DESTINATION = "scripts/lisa-reconcile-policy.mjs";
const EXCAVATED_DIGEST =
  "e509bfe5f135f63974156ea3aaa1521c11a9fd2a954f80ebb01dd80c54c12881";

/** Captured process output, in the shape this repository's lint rules sanction. */
interface Sink {
  current: string;
}

/**
 * Run one git command in a fixture repository.
 * @param cwd - Fixture repository path
 * @param args - Literal git arguments
 * @returns Exit status
 */
function git(cwd: string, args: readonly string[]): number {
  const result = boundedSpawnSync({
    label: `git ${args[0]}`,
    command: GIT,
    args: [...args],
    cwd,
    env: cleanGitEnv(),
  });
  return result.status ?? 1;
}

/**
 * Write a file inside a fixture, creating its directory.
 * @param root - Fixture repository path
 * @param relative - Repo-relative path
 * @param contents - File contents
 */
function write(root: string, relative: string, contents: string): void {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

/**
 * Read the generated ledger out of a fixture.
 * @param root - Fixture repository path
 * @returns Module source
 */
function readLedger(root: string): string {
  return readFileSync(path.join(root, LEDGER_RELATIVE_PATH), "utf8");
}

/**
 * The entries of one exported record, as raw source.
 * @param source - Module source
 * @param name - Exported constant name
 * @returns The declaration's text
 */
function section(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`);
  return start === -1
    ? ""
    : source.slice(start, source.indexOf("\n});", start));
}

/**
 * A fixture repository with one Lisa-owned template and two revisions of it.
 * @param revisions - Contents to commit, oldest first
 * @returns Fixture repository path
 */
function fixture(revisions: readonly string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-3115-"));
  created.push(root);
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test"]);
  mkdirSync(path.join(root, path.dirname(LEDGER_RELATIVE_PATH)), {
    recursive: true,
  });
  for (const [index, contents] of revisions.entries()) {
    write(root, GUARD_SOURCE, contents);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-m", `revision ${index}`]);
  }
  return root;
}

/**
 * Regenerate the ledger in a fixture, capturing what it reported.
 * @param root - Fixture repository path
 * @returns Exit code and captured streams
 */
function generate(root: string): { code: number; out: string; err: string } {
  const out: Sink = { current: "" };
  const err: Sink = { current: "" };
  const code = runGenerate(
    root,
    message => {
      out.current += message;
    },
    message => {
      err.current += message;
    }
  );
  return { code, out: out.current, err: err.current };
}

/**
 * Run the check in a fixture, capturing what it reported.
 * @param root - Fixture repository path
 * @returns Exit code and captured streams
 */
function check(root: string): { code: number; out: string; err: string } {
  const out: Sink = { current: "" };
  const err: Sink = { current: "" };
  const code = runCheck(
    root,
    message => {
      out.current += message;
    },
    message => {
      err.current += message;
    }
  );
  return { code, out: out.current, err: err.current };
}

/**
 * One `"destination": Object.freeze([...])` record, written out literally.
 * @param name - Exported constant name
 * @param entries - Digests recorded per destination
 * @returns Declaration source
 */
function recordDeclaration(
  name: string,
  entries: readonly (readonly [string, readonly string[]])[]
): string {
  const body = entries
    .map(
      ([destination, hashes]) =>
        `  ${JSON.stringify(destination)}: Object.freeze([\n${hashes
          .map(hash => `    "${hash}",`)
          .join("\n")}\n  ]),`
    )
    .join("\n");
  return `export const ${name}: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
${body}
});
`;
}

/**
 * A hand-built ledger module, so a case can put the file in a state the
 * generator would never produce.
 *
 * Spelled out here rather than produced by the generator's own `render`: a
 * fixture built by the code under test agrees with that code by construction,
 * and would keep agreeing with it after a change to either one.
 * @param ledger - Digests recorded per destination
 * @param historyDerived - Digests attested per destination, omitted entirely when undefined
 * @returns Module source
 */
function ledgerModule(
  ledger: readonly (readonly [string, readonly string[]])[],
  historyDerived?: readonly (readonly [string, readonly string[]])[]
): string {
  // The pre-#3115 artifact is exactly this file minus the second record.
  const provenance =
    historyDerived === undefined
      ? ""
      : `\n${recordDeclaration(HISTORY_EXPORT, historyDerived)}`;
  return `/** Generated. Do not edit. */
${recordDeclaration(LEDGER_EXPORT, ledger)}${provenance}`;
}

describe("Lisa-owned hash ledger digest provenance", () => {
  it("namesTheSourceOfEveryDigestItDerives: a fresh generation records what history produced", () => {
    const root = fixture([OLD_BYTES, NEW_BYTES]);

    expect(generate(root).code).toBe(0);

    const attested = section(readLedger(root), HISTORY_EXPORT);
    expect(attested).toContain(GUARD_DESTINATION);
    expect(attested).toContain(OLD_DIGEST);
    expect(attested).toContain(NEW_DIGEST);
  });

  it("keepsAndReportsACarriedForwardDigest: an entry this clone cannot derive survives and is named", () => {
    const root = fixture([OLD_BYTES, NEW_BYTES]);
    expect(generate(root).code).toBe(0);
    // Put a digest in the ledger that no revision of the fixture ever held —
    // the state the excavation on #3029 was trying to explain.
    writeFileSync(
      path.join(root, LEDGER_RELATIVE_PATH),
      ledgerModule(
        [[GUARD_DESTINATION, [NEW_DIGEST, OLD_DIGEST, STRAY_DIGEST]]],
        [[GUARD_DESTINATION, [NEW_DIGEST, OLD_DIGEST]]]
      )
    );

    const regenerated = generate(root);

    expect(regenerated.code).toBe(0);
    const source = readLedger(root);
    // Kept, not pruned: deleting it is the harm the design forbids.
    expect(section(source, LEDGER_EXPORT)).toContain(STRAY_DIGEST);
    // And distinguishable: it is absent from the record of what history derived.
    expect(section(source, HISTORY_EXPORT)).not.toContain(STRAY_DIGEST);
    expect(regenerated.out).toContain(STRAY_DIGEST);
    expect(regenerated.out).toContain("carried forward only");
  });

  it("doesNotReportADerivableDigest: the control — a digest history accounts for is never listed as carried forward", () => {
    const root = fixture([OLD_BYTES, NEW_BYTES]);

    const generated = generate(root);

    expect(generated.code).toBe(0);
    // Both revisions are reachable here, so the report names neither of them.
    // Without this, a report that listed every digest would pass every other
    // case in this file.
    expect(generated.out).not.toContain(OLD_DIGEST);
    expect(generated.out).not.toContain(NEW_DIGEST);
    expect(generated.out).toContain("Digest provenance:");
  });

  it("neverLosesAHashUnderAShallowerClone: a digest recorded by a deeper clone survives, provenance and all", () => {
    // One commit, holding only the newer bytes: the older revision is
    // unreachable here, exactly as it would be in a truncated clone.
    const root = fixture([NEW_BYTES]);
    writeFileSync(
      path.join(root, LEDGER_RELATIVE_PATH),
      ledgerModule(
        [[GUARD_DESTINATION, [NEW_DIGEST, OLD_DIGEST]]],
        [[GUARD_DESTINATION, [NEW_DIGEST, OLD_DIGEST]]]
      )
    );

    expect(generate(root).code).toBe(0);

    const source = readLedger(root);
    expect(section(source, LEDGER_EXPORT)).toContain(OLD_DIGEST);
    // Provenance is an accumulator too: a shallower clone adds nothing and
    // downgrades nothing, so what a deeper clone attested stays attested.
    expect(section(source, HISTORY_EXPORT)).toContain(OLD_DIGEST);
  });

  it("failsOnALedgerItCouldNotRead: an unreadable artifact is not an all-clear", () => {
    const root = fixture([NEW_BYTES]);

    const result = check(root);

    expect(result.code).toBe(1);
    expect(result.err).toContain("could not read");
    expect(result.out).not.toContain("records every shipped artifact");
  });

  it("failsOnAZeroDigestLedger: an inspection that saw nothing is not an all-clear", () => {
    const root = fixture([NEW_BYTES]);
    writeFileSync(path.join(root, LEDGER_RELATIVE_PATH), ledgerModule([], []));

    const result = check(root);

    expect(result.code).toBe(1);
    expect(result.err).toContain("zero digests");
  });

  it("failsWhenThereIsNothingToInspect: no Lisa-owned sources is not an all-clear", () => {
    // A repository with a populated ledger and no templates at all: every
    // recorded digest still there, nothing to check it against.
    const root = mkdtempSync(path.join(tmpdir(), "lisa-3115-empty-"));
    created.push(root);
    git(root, ["init", "--initial-branch=main"]);
    mkdirSync(path.join(root, path.dirname(LEDGER_RELATIVE_PATH)), {
      recursive: true,
    });
    writeFileSync(
      path.join(root, LEDGER_RELATIVE_PATH),
      ledgerModule(
        [[GUARD_DESTINATION, [NEW_DIGEST]]],
        [[GUARD_DESTINATION, [NEW_DIGEST]]]
      )
    );

    const result = check(root);

    expect(result.code).toBe(1);
    expect(result.err).toContain("no Lisa-owned copy-overwrite sources");
  });

  it("failsOnALedgerWithNoProvenanceRecord: the pre-#3115 artifact is out of date, not acceptable", () => {
    const root = fixture([NEW_BYTES]);
    writeFileSync(
      path.join(root, LEDGER_RELATIVE_PATH),
      ledgerModule([[GUARD_DESTINATION, [NEW_DIGEST]]])
    );

    const result = check(root);

    expect(result.code).toBe(1);
    expect(result.err).toContain(HISTORY_EXPORT);
    expect(result.err).toContain("bun run build:lisa-owned-hash-ledger");
  });

  it("failsWhenProvenanceVouchesForDigestsTheLedgerLacks: a hand-edited artifact is refused", () => {
    const root = fixture([NEW_BYTES]);
    writeFileSync(
      path.join(root, LEDGER_RELATIVE_PATH),
      ledgerModule(
        [[GUARD_DESTINATION, [NEW_DIGEST]]],
        [[GUARD_DESTINATION, [NEW_DIGEST, STRAY_DIGEST]]]
      )
    );

    const result = check(root);

    expect(result.code).toBe(1);
    expect(result.err).toContain(STRAY_DIGEST);
  });

  it("failsWhenShippedBytesAreMissingFromTheProvenanceRecord: provenance may not go stale on its own", () => {
    const root = fixture([NEW_BYTES]);
    writeFileSync(
      path.join(root, LEDGER_RELATIVE_PATH),
      ledgerModule(
        [[GUARD_DESTINATION, [NEW_DIGEST, OLD_DIGEST]]],
        [[GUARD_DESTINATION, [OLD_DIGEST]]]
      )
    );

    const result = check(root);

    expect(result.code).toBe(1);
    expect(result.err).toContain(GUARD_SOURCE);
  });

  it("passesOnACurrentLedger: the same fixture is green once regenerated", () => {
    const root = fixture([OLD_BYTES, NEW_BYTES]);
    expect(generate(root).code).toBe(0);

    const result = check(root);

    expect(result.code).toBe(0);
    expect(result.out).toContain("records every shipped artifact");
    expect(result.out).toContain("Digest provenance:");
  });

  it("namesADigestsOriginInOneLookup: what previously took an excavation", () => {
    const ledger = { [GUARD_DESTINATION]: [NEW_DIGEST, STRAY_DIGEST] };
    const attested = { [GUARD_DESTINATION]: [NEW_DIGEST] };

    expect(digestOrigin(GUARD_DESTINATION, NEW_DIGEST, ledger, attested)).toBe(
      "history"
    );
    expect(
      digestOrigin(GUARD_DESTINATION, STRAY_DIGEST, ledger, attested)
    ).toBe("carry-forward");
    expect(digestOrigin(GUARD_DESTINATION, OLD_DIGEST, ledger, attested)).toBe(
      "unrecorded"
    );
  });

  it("keptTheExcavatedDigest: the digest that produced this ticket is still recorded", () => {
    // Report, do not prune. The line was proved unreachable from 10 revisions
    // and 14 reflog entries and is still correct to keep, because a clone that
    // cannot derive a digest is not evidence that Lisa never shipped it.
    expect(digestOrigin(EXCAVATED_DESTINATION, EXCAVATED_DIGEST)).not.toBe(
      "unrecorded"
    );
  });

  it("mergesPointwiseAcrossBothRecords: the CodySwannGT/lisa#3084 driver still unions the new shape", () => {
    // Two branches that each add a digest the other does not have. The driver
    // has to reconstruct what regeneration against the merged tree would
    // produce — in BOTH blocks — rather than pick a side.
    const base = ledgerModule(
      [[GUARD_DESTINATION, [OLD_DIGEST]]],
      [[GUARD_DESTINATION, [OLD_DIGEST]]]
    );
    const ours = ledgerModule(
      [[GUARD_DESTINATION, [NEW_DIGEST, OLD_DIGEST]]],
      [[GUARD_DESTINATION, [NEW_DIGEST, OLD_DIGEST]]]
    );
    const theirs = ledgerModule(
      [[GUARD_DESTINATION, [OLD_DIGEST, STRAY_DIGEST]]],
      [[GUARD_DESTINATION, [OLD_DIGEST]]]
    );

    const merged = mergeGeneratedArtifact(base, ours, theirs);

    expect(merged.ok).toBe(true);
    const text = merged.ok === true ? merged.text : "";
    expect(section(text, LEDGER_EXPORT)).toContain(NEW_DIGEST);
    expect(section(text, LEDGER_EXPORT)).toContain(STRAY_DIGEST);
    expect(section(text, HISTORY_EXPORT)).toContain(NEW_DIGEST);
    expect(section(text, HISTORY_EXPORT)).not.toContain(STRAY_DIGEST);
  });
});
