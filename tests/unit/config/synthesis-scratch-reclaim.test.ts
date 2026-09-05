/**
 * Both arms of the synthesis-assembly reclaim.
 *
 * The stale arm proves the accumulated population actually shrinks; the live
 * arm proves a synthesis in progress survives. Only the second direction is
 * unrecoverable when wrong, so it is tested from several independent angles:
 * an assembly with no completion manifest, one inside the quiescence window,
 * one that is not a directory at all, and one swapped underneath the reclaim
 * after it has already decided to remove it.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  COMPLETION_MANIFEST,
  DEFAULT_QUIESCENCE_MS,
  SYNTHESIS_PREFIX,
  classifySynthesisEntry,
  reclaimSynthesisScratch,
  readSynthesisEntryFacts,
} from "../../../src/configs/vitest/synthesis-scratch-reclaim.js";

const SAMPLE_NAME = `${SYNTHESIS_PREFIX}AAAAAA`;

const roots: string[] = [];

const makeRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "derived-reclaim-"));
  roots.push(root);
  return root;
};

/**
 * Build one assembly directory with a chosen completeness and age.
 * @param root - Temp root to build inside
 * @param name - Directory basename
 * @param complete - Whether to write the completion manifest
 * @param ageMs - How far in the past to stamp the mtime
 * @returns Absolute path of the assembly
 */
const makeAssembly = (
  root: string,
  name: string,
  complete: boolean,
  ageMs: number
): string => {
  const dir = path.join(root, name);
  const stamp = new Date(Date.now() - ageMs);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "tree.json"), "{}", "utf8");
  if (complete)
    fs.writeFileSync(path.join(dir, COMPLETION_MANIFEST), "{}", "utf8");
  fs.utimesSync(dir, stamp, stamp);
  return dir;
};

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { force: true, recursive: true });
});

describe("classifying one assembly", () => {
  it("reclaims a completed assembly that has been untouched past the window", () => {
    const verdict = classifySynthesisEntry({
      ageMs: 48 * 60 * 60 * 1000,
      complete: true,
      directory: true,
      name: SAMPLE_NAME,
      readable: true,
    });
    expect(verdict.disposition).toBe("reclaimable");
    expect(verdict.reason).toContain("completed assembly");
  });

  it("keeps a completed assembly that was touched inside the window", () => {
    const verdict = classifySynthesisEntry({
      ageMs: 60 * 1000,
      complete: true,
      directory: true,
      name: SAMPLE_NAME,
      readable: true,
    });
    expect(verdict.disposition).toBe("live");
  });

  it("refuses an old assembly with no completion manifest, rather than guessing", () => {
    const verdict = classifySynthesisEntry({
      ageMs: 30 * 24 * 60 * 60 * 1000,
      complete: false,
      directory: true,
      name: SAMPLE_NAME,
      readable: true,
    });
    expect(verdict.disposition).toBe("undetermined");
    expect(verdict.reason).toContain(COMPLETION_MANIFEST);
  });

  it("never follows something that is not a plain directory", () => {
    const verdict = classifySynthesisEntry({
      ageMs: 30 * 24 * 60 * 60 * 1000,
      complete: true,
      directory: false,
      name: SAMPLE_NAME,
      readable: true,
    });
    expect(verdict.disposition).toBe("undetermined");
  });

  it("refuses an assembly whose contents cannot be listed", () => {
    const verdict = classifySynthesisEntry({
      ageMs: 30 * 24 * 60 * 60 * 1000,
      complete: false,
      directory: true,
      name: SAMPLE_NAME,
      readable: false,
    });
    expect(verdict.disposition).toBe("undetermined");
    expect(verdict.reason).toContain("could not be listed");
  });

  it("age alone never authorizes removal, which is the rule the sweep already holds", () => {
    const ancientIncomplete = classifySynthesisEntry({
      ageMs: 365 * 24 * 60 * 60 * 1000,
      complete: false,
      directory: true,
      name: SAMPLE_NAME,
      readable: true,
    });
    expect(ancientIncomplete.disposition).not.toBe("reclaimable");
  });
});

describe("reading facts from disk", () => {
  it("reports a symlink as not a directory without resolving it", () => {
    const root = makeRoot();
    const target = makeAssembly(root, "real-target", true, 0);
    fs.symlinkSync(target, path.join(root, `${SYNTHESIS_PREFIX}LINKED`));
    const facts = readSynthesisEntryFacts(
      root,
      `${SYNTHESIS_PREFIX}LINKED`,
      Date.now()
    );
    expect(facts.directory).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
  });

  it("reads completion and age from a real assembly", () => {
    const root = makeRoot();
    makeAssembly(root, `${SYNTHESIS_PREFIX}AAAAAA`, true, 3 * 60 * 60 * 1000);
    const facts = readSynthesisEntryFacts(
      root,
      `${SYNTHESIS_PREFIX}AAAAAA`,
      Date.now()
    );
    expect(facts.complete).toBe(true);
    expect(facts.ageMs).toBeGreaterThan(2 * 60 * 60 * 1000);
  });
});

describe("sweeping a root", () => {
  it("removes the stale completed assembly and leaves every other kind", () => {
    const root = makeRoot();
    const stale = makeAssembly(
      root,
      `${SYNTHESIS_PREFIX}STALE0`,
      true,
      48 * 60 * 60 * 1000
    );
    const fresh = makeAssembly(
      root,
      `${SYNTHESIS_PREFIX}FRESH0`,
      true,
      60 * 1000
    );
    const partial = makeAssembly(
      root,
      `${SYNTHESIS_PREFIX}PART00`,
      false,
      48 * 60 * 60 * 1000
    );

    const result = reclaimSynthesisScratch({ apply: true, root });

    expect(result.recognised).toBe(true);
    expect(result.reclaimed.map(one => one.name)).toEqual([
      `${SYNTHESIS_PREFIX}STALE0`,
    ]);
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(partial)).toBe(true);
    expect(result.live.map(one => one.name)).toEqual([
      `${SYNTHESIS_PREFIX}FRESH0`,
    ]);
    expect(result.undetermined.map(one => one.name)).toEqual([
      `${SYNTHESIS_PREFIX}PART00`,
    ]);
  });

  it("removes nothing when not applying, but still reports what it would remove", () => {
    const root = makeRoot();
    const stale = makeAssembly(
      root,
      `${SYNTHESIS_PREFIX}STALE0`,
      true,
      48 * 60 * 60 * 1000
    );
    const result = reclaimSynthesisScratch({ root });
    expect(result.reclaimed).toHaveLength(1);
    expect(fs.existsSync(stale)).toBe(true);
  });

  it("reports recognising nothing when the convention does not match, and removes nothing", () => {
    const root = makeRoot();
    const foreign = makeAssembly(
      root,
      "some-other-tool-XYZ",
      true,
      48 * 60 * 60 * 1000
    );
    const result = reclaimSynthesisScratch({ apply: true, root });
    expect(result.recognised).toBe(false);
    expect(result.reclaimed).toHaveLength(0);
    expect(fs.existsSync(foreign)).toBe(true);
  });

  it("does not follow a symlink that matches the convention", () => {
    const root = makeRoot();
    const outside = makeRoot();
    const treasure = path.join(outside, "treasure.txt");
    fs.writeFileSync(treasure, "keep me", "utf8");
    const link = path.join(root, `${SYNTHESIS_PREFIX}LINKED`);
    fs.symlinkSync(outside, link);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.lutimesSync(link, old, old);

    const result = reclaimSynthesisScratch({ apply: true, root });

    expect(result.reclaimed).toHaveLength(0);
    expect(fs.existsSync(treasure)).toBe(true);
  });

  it("refuses to unlink when the target is swapped after quarantine", () => {
    const root = makeRoot();
    const outside = makeRoot();
    const treasure = path.join(outside, "treasure.txt");
    fs.writeFileSync(treasure, "keep me", "utf8");
    makeAssembly(root, `${SYNTHESIS_PREFIX}SWAP00`, true, 48 * 60 * 60 * 1000);

    const result = reclaimSynthesisScratch({
      afterQuarantine: quarantine => {
        fs.rmSync(quarantine, { force: true, recursive: true });
        fs.symlinkSync(outside, quarantine);
      },
      apply: true,
      root,
    });

    expect(result.reclaimed).toHaveLength(0);
    expect(result.refused).toHaveLength(1);
    expect(result.refused[0]?.reason).toContain("identity changed");
    expect(fs.existsSync(treasure)).toBe(true);
  });

  it("honours a caller-supplied quiescence window", () => {
    const root = makeRoot();
    makeAssembly(root, `${SYNTHESIS_PREFIX}HOUR00`, true, 2 * 60 * 60 * 1000);
    expect(reclaimSynthesisScratch({ root }).reclaimed).toHaveLength(0);
    expect(
      reclaimSynthesisScratch({ quiescenceMs: 60 * 60 * 1000, root }).reclaimed
    ).toHaveLength(1);
  });

  it("defaults the quiescence window to a full day", () => {
    expect(DEFAULT_QUIESCENCE_MS).toBe(86_400_000);
  });

  it("reports an absent root as recognising nothing rather than throwing", () => {
    const result = reclaimSynthesisScratch({
      root: path.join(os.tmpdir(), "derived-reclaim-absent-root"),
    });
    expect(result.recognised).toBe(false);
  });
});
