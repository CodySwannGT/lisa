/**
 * The hosted measurement of what the filesystem budget probe cannot see
 * (CodySwannGT/lisa#4636).
 *
 * `fsLatencyBudgetMs` read a factor of exactly 1.00 on every sampled hosted
 * run while real removal there cost 39-129us per freed inode. Run 43251544381
 * measured why: the probe's one-byte files were freed before they were given
 * a block, so they sent the `discard`-mounted device nothing to discard. The
 * probe now writes 4 KiB `fsync`ed files, and the one-byte probe survives only
 * in the table `fs-latency-budget.ts` records from that run.
 *
 * Eight paired samples, each taking, in this order: the probe's per-entry
 * cost; the allocated variant (20 files of 4 KiB, `fsync`ed before the timed
 * removal), which is now the same measurement taken again; and the per-entry
 * cost of removing a freshly written, `fsync`ed 5,000-file corpus of 4 KiB
 * files. Each sample prints one `FS_PROBE_DIAGNOSTIC {json}` line to stderr
 * with the three figures, the variant's and the probe's ratio to the real
 * removal, and the device's discard counter deltas around each removal. The
 * mount the probe writes to and the root mount are printed once, with their
 * options and devices.
 *
 * ## This asserts almost nothing, deliberately
 *
 * The answer decides which branch of #4636 (a.2) is taken, so asserting one
 * would be a guess. What is asserted is that the measurement is valid: the
 * mounts were found and every figure is a real, positive time.
 *
 * ## Running it
 *
 * Off by default, and Linux only: the question is about the hosted runners'
 * ext4 mount and no other machine answers it. The packed-host journey workflow
 * runs it when dispatched with `probe_diagnostic`:
 *
 * ```sh
 * gh workflow run packed-host-journey.yml --ref <branch> -f ref=<branch> -f probe_diagnostic=true
 * ```
 *
 * By hand on a Linux box, `LISA_FS_PROBE_DIAGNOSTIC=1 bun run test
 * tests/integration/fs-probe-diagnostic.test.ts`. Setting
 * `LISA_FS_PROBE_DIAGNOSTIC_OUT` to a file also appends each line there.
 * @module tests/integration/fs-probe-diagnostic
 */
import { appendFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { fsLatencyBudgetMs } from "../helpers/fs-latency-budget.js";
import {
  mountOf,
  pairedSample,
  readDeviceCounters,
} from "../helpers/fs-probe-diagnostic.js";

/** Whether the diagnostic runs: only when asked, and only on Linux. */
const ENABLED =
  process.env["LISA_FS_PROBE_DIAGNOSTIC"] === "1" &&
  process.platform === "linux";

/** Paired samples, as #4636 (a.1) specifies. */
const SAMPLES = 8;

/**
 * Wait after each removal before the settled discard reading. ext4 commits
 * its journal every 5 s by default, and online discard is issued as a commit
 * completes, so a wait past one commit interval counts discards the unlinking
 * thread did not wait for.
 */
const SETTLE_MS = 6000;

/**
 * Quiet-box base for one paired sample, in milliseconds: four 6 s settles,
 * 5,000 `fsync`ed writes and three removals. A filesystem-dominated window,
 * so it scales on the filesystem proxy.
 */
const SAMPLE_BASE_MS = 240_000;

/**
 * Print one diagnostic record, and keep it when a file is named for it.
 * @param record - The record
 */
function emit(record: Record<string, unknown>): void {
  const line = `FS_PROBE_DIAGNOSTIC ${JSON.stringify(record)}`;
  const out = process.env["LISA_FS_PROBE_DIAGNOSTIC_OUT"];
  console.error(line);
  if (out) appendFileSync(out, `${line}\n`);
}

describe("fs probe diagnostic", () => {
  it.runIf(ENABLED)("records the mounts the probe writes to", () => {
    const probeMount = mountOf(tmpdir());
    const rootMount = mountOf("/");
    emit({
      kind: "mount",
      tmpdir: tmpdir(),
      probeMount: probeMount ?? null,
      rootMount: rootMount ?? null,
      deviceCountersReadable: readDeviceCounters(probeMount) !== undefined,
    });

    expect(probeMount).toBeDefined();
    expect(rootMount).toBeDefined();
  });

  it
    .runIf(ENABLED)
    .each(Array.from({ length: SAMPLES }, (_unused, index) => index + 1))(
    "paired sample %i of 8",
    async index => {
      const sample = await pairedSample({
        mount: mountOf(tmpdir()),
        settleMs: SETTLE_MS,
      });
      emit({ kind: "sample", sample: index, ...sample });

      expect(sample.probeUs).toBeGreaterThan(0);
      expect(sample.variantUs).toBeGreaterThan(0);
      expect(sample.realUs).toBeGreaterThan(0);
    },
    fsLatencyBudgetMs(SAMPLE_BASE_MS)
  );
});
