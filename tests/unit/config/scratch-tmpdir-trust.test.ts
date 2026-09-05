/**
 * Whether the scratch guard refuses the same temp roots the enforcement
 * fallback refuses, and says enough about the refusal to act on it.
 *
 * The guard is a SECOND expression of arithmetic the shell already performs,
 * and the copy that decides real behaviour is the shell's. Two copies can
 * drift, and the two disagreeing would be a worse failure than the one being
 * fixed — a guard refusing a root the fallback would have trusted, or waving
 * through one it would not. So the agreement is not asserted on fabricated
 * mode strings but measured: every root in the table below is a real directory,
 * and the shell's verdict is read out of the real dispatcher's behaviour.
 * @module tests/unit/config/scratch-tmpdir-trust
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { env, getuid, platform } from "node:process";

import { afterEach, describe, expect, it } from "vitest";

import {
  PLUGIN_TREE,
  bash,
  cleanupScratchRoots,
  installRealGuards,
  runFallback,
  scratchRoot,
} from "../../helpers/enforcement-fallback-fixtures.js";
import { setup } from "../../../src/configs/vitest/scratch-global-setup.js";
import {
  ancestorChain,
  describeTmpdirTrustFailure,
  findUntrustedAncestor,
  octalMode,
} from "../../../src/configs/vitest/scratch-tmpdir-trust.js";

afterEach(cleanupScratchRoots);

/** A session id shaped like the ones Claude Code sends. */
const SESSION = "cccccccc-dddd-eeee-ffff-000000000000";

/**
 * A private leaf directory beneath a parent with the given mode.
 * @param parentMode - Mode to give the parent rung
 * @returns Absolute path to the leaf, for use as TMPDIR
 */
function leafUnderParent(parentMode: number): string {
  const parent = path.join(scratchRoot(), "parent");
  const leaf = path.join(parent, "leaf");

  mkdirSync(parent);
  chmodSync(parent, parentMode);
  mkdirSync(leaf);
  chmodSync(leaf, 0o700);
  return leaf;
}

/**
 * A directory of the test's own with the given mode.
 * @param mode - Mode to give it
 * @returns Absolute path to the directory
 */
function directoryWithMode(mode: number): string {
  const dir = path.join(scratchRoot(), "subject");

  mkdirSync(dir);
  chmodSync(dir, mode);
  return dir;
}

/**
 * The enforcement fallback's own verdict on a temp root.
 *
 * Read out of the observable the ticket names: the dispatcher creates its
 * marker state directory ONLY inside the branch guarded by
 * `notice_parent_chain_trusted`, so the directory's presence after one real run
 * is that predicate's answer, measured rather than reimplemented. Its ABSENCE
 * is what the reported `ENOENT` failure was.
 *
 * The project root must carry REAL guards. A dispatcher that resolves none
 * refuses at `guard_count -eq 0` and exits long before the trust chain is
 * walked, so a bare root would report "untrusted" for every input — an
 * instrument reading the same value for every subject, which is no reading at
 * all. Measured: the first draft of this helper did exactly that.
 * @param tmp - Temp root to run the dispatcher under
 * @returns True when the shell trusted the chain
 */
function shellTrusts(tmp: string): boolean {
  const root = scratchRoot();

  installRealGuards(path.join(root, PLUGIN_TREE));
  runFallback(bash("ls -la", SESSION), root, tmp);
  return existsSync(
    path.join(
      realpathSync(tmp),
      `lisa-enforcement-notice-${String(getuid?.() ?? 0)}`
    )
  );
}

/**
 * Run a function with TMPDIR pointed somewhere else, then put it back.
 *
 * The guard reads `os.tmpdir()`, which re-reads the environment on every call,
 * so imposing the environment IS the fixture — there is no seam to inject.
 * @param tmp - Temp root to impose for the duration
 * @param body - What to run under it
 * @returns Whatever `body` returned
 */
function underTmpdir<T>(tmp: string, body: () => T): T {
  const original = env["TMPDIR"];

  try {
    Object.assign(env, { TMPDIR: tmp });
    return body();
  } finally {
    Object.assign(env, { TMPDIR: original });
  }
}

describe("the ancestor chain", () => {
  it("walks from the filesystem root down to the path itself", () => {
    // A spelled-out path rather than a real temp root: this function is pure
    // string work, and naming the shared per-user root even as a literal is
    // what `test-scratch-guard` refuses — correctly, since it cannot tell a
    // string from a path something is about to write to.
    expect(ancestorChain("/opt/example/deep/leaf")).toEqual([
      "/",
      "/opt",
      "/opt/example",
      "/opt/example/deep",
      "/opt/example/deep/leaf",
    ]);
  });

  it("trusts the filesystem root, which every valid chain passes through", () => {
    // Asserted on the predicate rather than through the dispatcher: `/` is not
    // writable, and the dispatcher's verdict is only observable where it can
    // create its marker.
    expect(findUntrustedAncestor("/")).toBeUndefined();
  });

  it("renders modes the way chmod spells them", () => {
    expect([0o700, 0o1777, 0o755, 0o2755].map(octalMode)).toEqual([
      "0700",
      "1777",
      "0755",
      "2755",
    ]);
  });
});

describe("the guard and the enforcement fallback, on real roots", () => {
  it("agrees with it on every representative root", () => {
    // AC scenario 3. Asserted against the shell's measured behaviour AND
    // against a written-down expectation, because agreement alone is satisfied
    // by two copies that are wrong in the same direction.
    //
    // Every root here must be WRITABLE by this process. The instrument reads
    // the shell's verdict out of a directory the shell creates, so an
    // unwritable root reports "untrusted" no matter what the chain says — `/`
    // is trusted by both predicates and was still read as a disagreement,
    // because the reading was about permission to create rather than about
    // trust. Unwritable roots are outside what this instrument can see, and
    // they are not plausible temp roots either.
    const table = [
      {
        label: "this run's own temp root",
        root: realpathSync(tmpdir()),
        trusted: true,
      },
      {
        label: "a private 0700 directory",
        root: directoryWithMode(0o700),
        trusted: true,
      },
      {
        label: "a 0755 directory",
        root: directoryWithMode(0o755),
        trusted: true,
      },
      {
        label: "a setgid 2755 directory",
        root: directoryWithMode(0o2755),
        trusted: true,
      },
      {
        label: "a leaf under a sticky 1777 parent",
        root: leafUnderParent(0o1777),
        trusted: true,
      },
      {
        label: "a leaf under a 0777 parent with no sticky bit",
        root: leafUnderParent(0o777),
        trusted: false,
      },
      {
        label: "a leaf under a 0770 group-writable parent",
        root: leafUnderParent(0o770),
        trusted: false,
      },
    ];
    const readings = table.map(entry => ({
      label: entry.label,
      guard: findUntrustedAncestor(entry.root) === undefined,
      shell: shellTrusts(entry.root),
    }));

    expect(readings).toEqual(
      table.map(entry => ({
        label: entry.label,
        guard: entry.trusted,
        shell: entry.trusted,
      }))
    );
  });
});

describe("the refusal, on a genuinely untrusted root", () => {
  // A control on the FIX rather than on the defect: before this change there
  // was no guard at all, so it can only ever be red-then-green. What it proves
  // is that the refusal fires and names the rung — not anything about the
  // parsing bug, which is covered by the stat-shim cases in
  // tests/unit/hooks/enforcement-fallback-sticky-exemption.test.ts.
  it("names the rejected ancestor, its mode, and why it failed", () => {
    const leaf = leafUnderParent(0o777);
    const parent = path.dirname(leaf);
    const failure = underTmpdir(leaf, describeTmpdirTrustFailure);

    expect(failure).toContain(realpathSync(parent));
    expect(failure).toContain("mode 0777");
    expect(failure).toContain("WITHOUT the sticky bit");
  });

  it("shows a remedy the operator can run on this platform", () => {
    const failure = underTmpdir(
      leafUnderParent(0o777),
      describeTmpdirTrustFailure
    );
    const expected =
      platform === "darwin"
        ? "getconf DARWIN_USER_TEMP_DIR"
        : "XDG_RUNTIME_DIR";

    expect(failure).toContain(expected);
    expect(failure).toContain("export TMPDIR=");
  });

  it("refuses the run rather than warning about it", () => {
    // The real globalSetup entry point, not the predicate. `announceRefusal`
    // is inert inside a pool worker by construction, so calling it here cannot
    // put a refusal banner on this run's own transcript.
    expect(() => {
      underTmpdir(leafUnderParent(0o777), setup);
    }).toThrow(/ancestor chain is trusted/);
  });

  it("stays silent under a trusted root", () => {
    // AC scenario 2. Without this, a guard that refused unconditionally would
    // satisfy every case above.
    const verdict = underTmpdir(
      directoryWithMode(0o700),
      describeTmpdirTrustFailure
    );

    expect(verdict).toBeUndefined();
  });
});

describe("the trust boundary this repair moves", () => {
  // Repairing the BSD format string makes the sticky exemption reachable on
  // macOS, so /private/tmp becomes TRUSTED there where it was previously
  // rejected. That is a deliberate posture change — it is the posture Linux
  // has always shipped, and CI is Linux — and a posture change whose basis is
  // asserted rather than measured is the shape that gets waved through. So the
  // basis is measured here, on the real path.
  const skipReason =
    "not evaluated on this platform: /private/tmp is a Darwin path and the " +
    "BSD stat branch is only reached there — the parsing itself is covered on " +
    "every platform by the stat-shim cases";

  it.skipIf(platform !== "darwin")(
    platform === "darwin"
      ? "/private/tmp is world-writable AND sticky, which is the basis for trusting it"
      : `/private/tmp trust — ${skipReason}`,
    () => {
      expect(octalMode(statSync("/private/tmp").mode & 0o7777)).toBe("1777");
      expect(findUntrustedAncestor("/private/tmp")).toBeUndefined();
    }
  );
});
