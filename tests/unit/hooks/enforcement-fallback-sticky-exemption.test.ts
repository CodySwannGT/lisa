/**
 * Whether the temp-root trust chain reads one verdict out of both spellings of
 * `stat`, and whether the marker's ownership revalidation still fails closed.
 *
 * `notice_directory_trusted` exempts a world-writable directory that carries
 * the sticky bit — the property that makes a shared temp root safe to hold
 * per-user state, because sticky is what stops another uid unlinking or
 * renaming your entry. The exemption is read out of `stat`, and `stat` has two
 * spellings:
 *
 * ```
 * BSD   stat -f '%Lp' <1777 dir>  ->  777    sticky bit DROPPED
 * BSD   stat -f '%p'  <1777 dir>  ->  41777  sticky bit present
 * GNU   stat -c '%a'  <1777 dir>  ->  1777   sticky bit present
 * ```
 *
 * So a suite that exercises only the local platform's branch reports green on
 * the other platform's branch by never evaluating it — and since CI is Linux,
 * the branch nobody evaluates is the one where the bug is. These cases put a
 * `stat` shim on `PATH` and drive the real, unmodified dispatcher through BOTH
 * spellings from either platform. The assertion is that the two AGREE, which is
 * a statement about the parsing rather than about the host.
 * @module tests/unit/hooks/enforcement-fallback-sticky-exemption
 */
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { env, execPath, getuid, platform } from "node:process";

import { afterEach, describe, expect, it } from "vitest";

import {
  BEHIND,
  CURRENT,
  HOST_TREE,
  PLUGIN_TREE,
  bash,
  cleanupScratchRoots,
  dateHostTree,
  datePluginTree,
  installRealGuards,
  runFallback,
  scratchRoot,
} from "../../helpers/enforcement-fallback-fixtures.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

afterEach(cleanupScratchRoots);

/** A session id shaped like the ones Claude Code sends. */
const SESSION = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** The line that only appears when the proactive notice speaks. */
const NOTICE = "not from npm";

/** Which platform's `stat` a shim answers as. */
type StatFlavor = "bsd" | "gnu";

/**
 * A `stat` that answers in exactly one platform's spelling.
 *
 * It reads the mode through `fs.lstatSync`, which is uniform on every platform,
 * and only the RENDERING differs — so the shim reproduces the format strings
 * without reproducing any of the arithmetic under test. It refuses the flag the
 * platform it emulates does not accept, because that refusal is what selects
 * the dispatcher's fallback branch.
 */
const STAT_SHIM_SOURCE = [
  `#!${execPath}`,
  'const fs = require("node:fs");',
  'const flavor = process.env["LISA_STAT_SHIM_FLAVOR"];',
  "const [flag, format, target] = process.argv.slice(2);",
  'if (flavor === "bsd" ? flag !== "-f" : flag !== "-c") process.exit(1);',
  "let stat;",
  "try {",
  "  stat = fs.lstatSync(target);",
  "} catch {",
  "  process.exit(1);",
  "}",
  "const fields = {",
  "  u: () => String(stat.uid),",
  "  p: () => (stat.mode & 0o177777).toString(8),",
  "  Lp: () => (stat.mode & 0o777).toString(8),",
  "  a: () => (stat.mode & 0o7777).toString(8),",
  "};",
  "const rendered = format.replace(/%(Lp|[upa])/g, (whole, token) =>",
  "  fields[token] === undefined ? whole : fields[token]()",
  ");",
  'process.stdout.write(rendered + "\\n");',
  "",
].join("\n");

/**
 * Install the shim and return the directory to prepend to `PATH`.
 * @returns Absolute path to a directory whose only entry is `stat`.
 */
function statShimDir(): string {
  const dir = scratchRoot();
  const file = path.join(dir, "stat");

  writeFileSync(file, STAT_SHIM_SOURCE);
  chmodSync(file, 0o755);
  return dir;
}

/**
 * Environment that makes the dispatcher read modes through one spelling.
 *
 * The real `PATH` is kept behind the shim: the dispatcher and the guards it
 * replays to run `id`, `mkdir`, `chmod`, `find` and `git`, and a `PATH` holding
 * only the shim would fail them for reasons that have nothing to do with the
 * property under test.
 * @param flavor - Platform whose `stat` spelling to answer in
 * @returns Environment overrides for {@link runFallback}
 */
function shimEnv(flavor: StatFlavor): Readonly<Record<string, string>> {
  return {
    PATH: `${statShimDir()}:${env["PATH"] ?? ""}`,
    LISA_STAT_SHIM_FLAVOR: flavor,
  };
}

/**
 * A checkout whose host tree is behind, so the notice has something to say.
 * @returns The project root.
 */
function staleRoot(): string {
  const root = scratchRoot();

  installRealGuards(path.join(root, HOST_TREE));
  dateHostTree(root, BEHIND);
  installRealGuards(path.join(root, PLUGIN_TREE));
  datePluginTree(root, CURRENT);
  return root;
}

/**
 * A TMPDIR whose chain is trusted except for one sticky world-writable rung.
 *
 * That rung is the whole fixture: it is trusted under a spelling that keeps the
 * sticky bit and untrusted under one that drops it, and every other rung is
 * trusted under both. So a difference in verdict can only have come from the
 * sticky exemption.
 * @returns Absolute path to the leaf to use as TMPDIR.
 */
function stickyChainTmpdir(): string {
  const sticky = path.join(scratchRoot(), "sticky");
  const leaf = path.join(sticky, "leaf");

  mkdirSync(sticky);
  chmodSync(sticky, 0o1777);
  mkdirSync(leaf);
  chmodSync(leaf, 0o700);
  return leaf;
}

/**
 * Whether the notice spoke on each of two calls of one session.
 *
 * Speaking once is the trusted outcome: the rate limit claimed its marker.
 * Speaking twice is the untrusted one — the marker directory was never created,
 * so the limit stands down and the notice repeats, which is the observable
 * behind all four of the originally-reported failures.
 * @param flavor - Platform whose `stat` spelling to answer in
 * @param tmp - TMPDIR shared by both calls
 * @returns One boolean per call
 */
function spokeOnEachCall(flavor: StatFlavor, tmp: string): readonly boolean[] {
  const root = staleRoot();
  const overrides = shimEnv(flavor);

  return [1, 2].map(_ =>
    runFallback(bash("ls -la", SESSION), root, tmp, overrides).output.includes(
      NOTICE
    )
  );
}

describe("the stat shim, as a measuring instrument", () => {
  // A shim with a format bug produces a red that looks like the defect or a
  // green that hides it, and either way it reports confidently. So it is
  // checked against the platform's own stat before anything is concluded from
  // it. Only the spelling THIS platform answers can be checked here, which is
  // the point: it is the half that is checkable, and the half that is not is
  // the half the shim exists to supply.
  it("renders what the platform's own stat renders, for the spelling it answers", () => {
    const flavor: StatFlavor = platform === "darwin" ? "bsd" : "gnu";
    const formats = flavor === "bsd" ? ["%u %p", "%u %Lp"] : ["%u %a"];
    const flag = flavor === "bsd" ? "-f" : "-c";
    const shim = path.join(statShimDir(), "stat");
    const subjects = [stickyChainTmpdir(), scratchRoot(), "/"];

    const readings = subjects.flatMap(subject =>
      formats.map(format => {
        /**
         * Run one `stat` and return its trimmed first line.
         * @param command - Absolute path to the `stat` to run
         * @returns What that `stat` printed
         */
        const read = (command: string): string =>
          boundedSpawnSync({
            label: `${command} ${flag} ${format} ${subject}`,
            command,
            args: [flag, format, subject],
            env: { ...shimEnv(flavor), LISA_STAT_SHIM_FLAVOR: flavor },
          }).stdout.trim();

        return {
          subject,
          format,
          real: read("/usr/bin/stat"),
          shimmed: read(shim),
        };
      })
    );

    expect(readings.map(r => r.shimmed)).toEqual(readings.map(r => r.real));
    expect(readings.every(r => r.real !== "")).toBe(true);
  });
});

describe("the sticky exemption, across both spellings of stat", () => {
  it("reaches the same verdict on a sticky world-writable ancestor", () => {
    // The primary control. Before the format repair the BSD spelling reports
    // 777 for a 1777 directory, the exemption cannot fire, the chain is
    // rejected and the notice repeats; the GNU spelling reports 1777 and the
    // notice speaks once. The two disagreeing IS the defect, and it is visible
    // from either platform because neither arm depends on the host's own stat.
    const bsd = spokeOnEachCall("bsd", stickyChainTmpdir());
    const gnu = spokeOnEachCall("gnu", stickyChainTmpdir());

    expect(bsd).toEqual(gnu);
  });

  it("rate-limits the notice under the BSD spelling", () => {
    // Stated directly as well as by agreement, so a future change that broke
    // BOTH spellings identically could not satisfy the case above in silence.
    expect(spokeOnEachCall("bsd", stickyChainTmpdir())).toEqual([true, false]);
  });

  it("rate-limits the notice under the GNU spelling", () => {
    expect(spokeOnEachCall("gnu", stickyChainTmpdir())).toEqual([true, false]);
  });

  it("still rejects a world-writable ancestor with no sticky bit", () => {
    // The exemption must widen to sticky and no further. Without this, a repair
    // that simply stopped testing the write bits would pass every case above.
    const open = path.join(scratchRoot(), "open");
    const leaf = path.join(open, "leaf");

    mkdirSync(open);
    chmodSync(open, 0o777);
    mkdirSync(leaf);
    chmodSync(leaf, 0o700);

    expect(spokeOnEachCall("bsd", leaf)).toEqual([true, true]);
    expect(spokeOnEachCall("gnu", leaf)).toEqual([true, true]);
  });
});

describe("the marker's ownership revalidation, under a squatted state dir", () => {
  // Under a per-user 0700 root nobody else can create the marker directory.
  // Under a sticky 1777 root anyone can, and its name is predictable
  // (`lisa-enforcement-notice-<uid>`) — sticky stops another uid REPLACING an
  // entry, not creating one first. Trusting a sticky root therefore makes the
  // `[ ! -L ]` / `[ -O ]` revalidation the load-bearing defence rather than a
  // belt-and-braces check, so it is measured here rather than assumed.
  //
  // A directory owned by a second uid cannot be created without root, so the
  // symlink squat stands in — which is also the variant an attacker would
  // actually use, since it needs no privilege at all.

  /** A state-directory name claimed before the dispatcher could create it. */
  interface StateDirSquat {
    /** The path the dispatcher will resolve its state directory to. */
    readonly link: string;
    /** Where that name redirects to, and where nothing may be written. */
    readonly target: string;
  }

  /**
   * Point the state directory's name at somewhere the dispatcher must not write.
   * @param tmp - TMPDIR the dispatcher will resolve its state directory under
   * @returns The squatted path and the directory it redirects to
   */
  function squatStateDir(tmp: string): StateDirSquat {
    const target = scratchRoot();
    const link = path.join(
      realpathSync(tmp),
      `lisa-enforcement-notice-${String(getuid?.() ?? 0)}`
    );

    symlinkSync(target, link);
    return { link, target };
  }

  /**
   * Drive two calls of one session and report what the squat survived as.
   * @param flavor - Platform whose `stat` spelling to answer in
   * @param tmp - TMPDIR whose state directory has been squatted
   * @param squat - What {@link squatStateDir} planted
   * @returns Observable outcomes of the squat
   */
  function outcomeOfSquat(
    flavor: StatFlavor,
    tmp: string,
    squat: StateDirSquat
  ): Record<string, unknown> {
    const spoke = spokeOnEachCall(flavor, tmp);

    return {
      spoke,
      wroteThrough: readdirSync(squat.target),
      stillASymlink: lstatSync(squat.link).isSymbolicLink(),
      stillPointsAtTarget: readlinkSync(squat.link),
    };
  }

  it("neither adopts nor writes through it, under a 0700 root", () => {
    const tmp = scratchRoot();
    const squat = squatStateDir(tmp);

    expect(outcomeOfSquat("gnu", tmp, squat)).toEqual({
      spoke: [true, true],
      wroteThrough: [],
      stillASymlink: true,
      stillPointsAtTarget: squat.target,
    });
  });

  it("neither adopts nor writes through it, under a trusted sticky root", () => {
    // The arm that matters after the exemption is repaired: the chain is now
    // TRUSTED, so nothing upstream of the revalidation is refusing any more and
    // the outcome rests entirely on `[ ! -L ]`. Driven through the GNU spelling
    // so the chain is trusted on either platform and in either state of the
    // repair — otherwise this case would pass on macOS today for the wrong
    // reason, by being refused one step earlier.
    const tmp = stickyChainTmpdir();
    const squat = squatStateDir(tmp);

    expect(outcomeOfSquat("gnu", tmp, squat)).toEqual({
      spoke: [true, true],
      wroteThrough: [],
      stillASymlink: true,
      stillPointsAtTarget: squat.target,
    });
  });
});
