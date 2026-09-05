/**
 * Reclaim for abandoned CDK synthesis assemblies left in the platform temp root.
 *
 * The scratch sweep in this directory reclaims what Lisa created, proved by an
 * owner token it wrote itself. Synthesis assemblies carry no such token: CDK
 * calls `mkdtemp` against the platform temp root with prefix `cdk.out`, so the
 * directory is real, unowned, and indistinguishable by name from one a live
 * synthesis is still writing.
 *
 * `isStaleForeignEntry` refuses to authorize a foreign entry on age alone, and
 * that refusal is correct — a long synthesis is indistinguishable from an
 * abandoned one by mtime. This module supplies the authority age cannot:
 * **evidence that the writer finished**. CDK writes `manifest.json` when an
 * assembly completes, so its presence is positive proof that the process which
 * created the directory got to the end of its work. A directory still being
 * written has no manifest, and one that just finished has a recent mtime.
 *
 * Both facts must hold before anything is removed, and every other case is
 * reported as undetermined rather than swept. The unsafe path here is the one
 * that looks like progress: deleting everything matching the prefix finishes
 * fast and frees the disk, right up until it takes a live synthesis with it.
 * @module configs/vitest/synthesis-scratch-reclaim
 */
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/** Prefix CDK uses for a `mkdtemp` cloud-assembly directory. */
export const SYNTHESIS_PREFIX = "cdk.out";

/** File CDK writes when an assembly completes. */
export const COMPLETION_MANIFEST = "manifest.json";

/** How long an assembly must be untouched before completion authorizes removal. */
export const DEFAULT_QUIESCENCE_MS = 24 * 60 * 60 * 1000;

/** Why one entry was placed in its bucket. */
export type ReclaimDisposition = "reclaimable" | "live" | "undetermined";

/** Facts read from one candidate, separated from the judgement about them. */
export interface SynthesisEntryFacts {
  /** Direct child basename. */
  readonly name: string;
  /** Whether the candidate is a real directory rather than a link or file. */
  readonly directory: boolean;
  /** Whether the candidate's children could be listed. */
  readonly readable: boolean;
  /** Whether the completion manifest is present. */
  readonly complete: boolean;
  /** Milliseconds since the candidate was last modified. */
  readonly ageMs: number;
}

/** One entry's bucket, with the reason stated for an operator. */
export interface SynthesisEntryVerdict {
  /** Direct child basename. */
  readonly name: string;
  /** Bucket this entry falls in. */
  readonly disposition: ReclaimDisposition;
  /** Operator-readable reason, always populated. */
  readonly reason: string;
}

/**
 * Judge one candidate from its facts alone.
 *
 * Ordered so the conservative arms win: anything that is not a plain directory,
 * or cannot be read, or was touched recently, is kept before completion is even
 * consulted. Completion is necessary but never sufficient.
 * @param facts - Facts read from the candidate
 * @param quiescenceMs - Required untouched interval
 * @returns The bucket and the reason for it
 */
export const classifySynthesisEntry = (
  facts: SynthesisEntryFacts,
  quiescenceMs: number = DEFAULT_QUIESCENCE_MS
): SynthesisEntryVerdict => {
  const { name } = facts;
  const minutes = String(Math.round(facts.ageMs / 60000));
  const hours = String(Math.round(facts.ageMs / 3600000));
  if (!facts.directory)
    return {
      disposition: "undetermined",
      name,
      reason: "not a plain directory; a link or file is never followed",
    };
  if (!facts.readable)
    return {
      disposition: "undetermined",
      name,
      reason:
        "contents could not be listed, so completion cannot be established",
    };
  if (facts.ageMs < quiescenceMs)
    return {
      disposition: "live",
      name,
      reason: `modified ${minutes} minute(s) ago, inside the quiescence window`,
    };
  if (!facts.complete)
    return {
      disposition: "undetermined",
      name,
      reason: `no ${COMPLETION_MANIFEST}, so the writer is not proven to have finished`,
    };
  return {
    disposition: "reclaimable",
    name,
    reason: `completed assembly, untouched for ${hours} hour(s)`,
  };
};

/**
 * Stat a candidate without following it, returning nothing when it is absent.
 * @param candidate - Absolute candidate path
 * @returns Candidate metadata, or undefined
 */
const lstatIfPresent = (candidate: string): fs.Stats | undefined => {
  try {
    return fs.lstatSync(candidate);
  } catch {
    return undefined;
  }
};

/**
 * List a directory's children, returning nothing when it cannot be read.
 * @param candidate - Absolute directory path
 * @returns Direct child names, or undefined
 */
const readdirIfPossible = (
  candidate: string
): readonly string[] | undefined => {
  try {
    return fs.readdirSync(candidate);
  } catch {
    return undefined;
  }
};

/**
 * Read the facts for one candidate without ever following a symlink.
 * @param root - Directory holding the candidate
 * @param name - Direct child basename
 * @param now - Clock reading for the age computation
 * @returns Facts describing the candidate
 */
export const readSynthesisEntryFacts = (
  root: string,
  name: string,
  now: number
): SynthesisEntryFacts => {
  const candidate = path.join(root, name);
  const stat = lstatIfPresent(candidate);
  if (stat === undefined || !stat.isDirectory())
    return {
      ageMs: 0,
      complete: false,
      directory: false,
      name,
      readable: false,
    };
  const children = readdirIfPossible(candidate);
  return {
    ageMs: Math.max(0, now - stat.mtimeMs),
    complete: children?.includes(COMPLETION_MANIFEST) ?? false,
    directory: true,
    name,
    readable: children !== undefined,
  };
};

/** Inputs for one reclaim pass. */
export interface ReclaimSynthesisScratchOptions {
  /** Temp root to inspect. */
  readonly root: string;
  /** Clock reading used for every age computation. */
  readonly now?: number;
  /** Required untouched interval before completion authorizes removal. */
  readonly quiescenceMs?: number;
  /** Whether to remove. False reports without touching anything. */
  readonly apply?: boolean;
  /** Adversarial hook invoked after quarantine and before unlink, for tests. */
  readonly afterQuarantine?: (quarantine: string) => void;
}

/** What one reclaim pass found and did. */
export interface ReclaimSynthesisScratchResult {
  /** Whether any candidate matched the expected naming convention. */
  readonly recognised: boolean;
  /** Entries removed, or that would be removed when not applying. */
  readonly reclaimed: readonly SynthesisEntryVerdict[];
  /** Entries kept because they are inside the quiescence window. */
  readonly live: readonly SynthesisEntryVerdict[];
  /** Entries kept because their status could not be established. */
  readonly undetermined: readonly SynthesisEntryVerdict[];
  /** Entries whose removal was attempted and refused by the fence. */
  readonly refused: readonly SynthesisEntryVerdict[];
}

/**
 * Revalidate a quarantined candidate against its pre-rename identity.
 *
 * This is the arm that survives a writer racing the decision: a directory
 * swapped for a symlink between the judgement and the unlink fails here rather
 * than being followed out of the root.
 * @param quarantine - Quarantined path
 * @param before - Pinned pre-rename metadata
 * @throws When device, inode or kind changed across the rename
 */
const assertIdentityUnchanged = (
  quarantine: string,
  before: fs.Stats
): void => {
  const after = fs.lstatSync(quarantine);
  if (
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    !after.isDirectory()
  )
    throw new Error("Synthesis assembly identity changed during quarantine");
};

/**
 * Quarantine one candidate and unlink it, revalidating identity across the rename.
 * @param root - Directory holding the candidate
 * @param name - Direct child basename
 * @param afterQuarantine - Adversarial hook for tests
 * @returns True when the entry was removed
 */
const quarantineAndRemove = (
  root: string,
  name: string,
  afterQuarantine?: (quarantine: string) => void
): boolean => {
  const candidate = path.join(root, name);
  const before = fs.lstatSync(candidate);
  const suffix = randomBytes(6).toString("hex");
  const quarantine = path.join(
    root,
    `.${SYNTHESIS_PREFIX}-reclaim-${String(process.pid)}-${suffix}`
  );
  if (!before.isDirectory()) return false;
  fs.renameSync(candidate, quarantine);
  afterQuarantine?.(quarantine);
  assertIdentityUnchanged(quarantine, before);
  fs.rmSync(quarantine, { force: true, recursive: true });
  return true;
};

/** One removal attempt's outcome, kept alongside the verdict that caused it. */
interface RemovalOutcome {
  /** Whether the entry was actually removed. */
  readonly removed: boolean;
  /** The verdict, with its reason replaced when the fence refused. */
  readonly verdict: SynthesisEntryVerdict;
}

/**
 * Attempt one fenced removal, converting a refusal into a reported outcome.
 * @param options - Root and hooks for this pass
 * @param verdict - The reclaimable verdict to act on
 * @returns Whether it was removed, and the verdict to report
 */
const attemptRemoval = (
  options: ReclaimSynthesisScratchOptions,
  verdict: SynthesisEntryVerdict
): RemovalOutcome => {
  if (options.apply !== true) return { removed: true, verdict };
  try {
    const removed = quarantineAndRemove(
      options.root,
      verdict.name,
      options.afterQuarantine
    );
    return removed
      ? { removed, verdict }
      : {
          removed,
          verdict: { ...verdict, reason: "no longer a plain directory" },
        };
  } catch (error) {
    return {
      removed: false,
      verdict: { ...verdict, reason: (error as Error).message },
    };
  }
};

/**
 * Reclaim completed, quiescent synthesis assemblies from one temp root.
 *
 * Removes nothing when no candidate matches the convention: a naming change in
 * the producing tool must read as "recognised nothing" rather than as a clean
 * sweep, because the two are opposite facts and only one of them is good news.
 * @param options - Root, clock, thresholds and hooks
 * @returns What was found in each bucket, and what was removed
 */
export function reclaimSynthesisScratch(
  options: ReclaimSynthesisScratchOptions
): ReclaimSynthesisScratchResult {
  const now = options.now ?? Date.now();
  const quiescenceMs = options.quiescenceMs ?? DEFAULT_QUIESCENCE_MS;
  const names = (readdirIfPossible(options.root) ?? []).filter(entry =>
    entry.startsWith(SYNTHESIS_PREFIX)
  );
  const empty: ReclaimSynthesisScratchResult = {
    live: [],
    reclaimed: [],
    recognised: false,
    refused: [],
    undetermined: [],
  };
  if (names.length === 0) return empty;
  const verdicts = names.map(name =>
    classifySynthesisEntry(
      readSynthesisEntryFacts(options.root, name, now),
      quiescenceMs
    )
  );
  const outcomes = verdicts
    .filter(one => one.disposition === "reclaimable")
    .map(verdict => attemptRemoval(options, verdict));
  return {
    live: verdicts.filter(one => one.disposition === "live"),
    reclaimed: outcomes.filter(one => one.removed).map(one => one.verdict),
    recognised: true,
    refused: outcomes.filter(one => !one.removed).map(one => one.verdict),
    undetermined: verdicts.filter(one => one.disposition === "undetermined"),
  };
}
