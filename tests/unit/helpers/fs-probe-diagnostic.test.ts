/**
 * The pieces of the hosted fs-probe diagnostic that can be proven off the
 * runner it exists for (CodySwannGT/lisa#4636).
 *
 * The diagnostic itself only answers on a hosted Linux runner, so what is
 * checked here is everything that does not need one: that the kernel's mount
 * table is read by the longest matching mount point, that block-device
 * counters are named in the kernel's field order and missing fields are left
 * out rather than reported as zero, that a discard delta is computed only from
 * readings that exist, and that each sample kind really writes the allocated
 * files it claims to and reports a per-entry figure.
 * @module tests/unit/helpers/fs-probe-diagnostic
 */
import * as fs from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DEVICE_FIELDS,
  discardDelta,
  pairedSample,
  parseDeviceStat,
  parseMountInfo,
  timeRemovalUs,
} from "../../helpers/fs-probe-diagnostic.js";
import { fillProbeDirectory } from "../../helpers/fs-latency-budget.js";

/** A mountinfo table shaped like a hosted Ubuntu runner's. */
const MOUNTINFO = [
  "26 1 8:1 / / rw,relatime shared:1 - ext4 /dev/root rw,discard,errors=remount-ro,commit=30",
  "27 26 0:5 / /dev rw,nosuid,relatime shared:2 - devtmpfs udev rw,size=8145284k",
  "30 26 0:26 / /run rw,nosuid,nodev,noexec,relatime shared:5 - tmpfs tmpfs rw,size=1634284k",
  "35 30 0:29 / /run/user/1001 rw,nosuid,nodev,relatime shared:9 - tmpfs tmpfs rw,size=1634280k",
  "40 26 8:16 / /mnt rw,relatime shared:12 - ext4 /dev/sdb1 rw",
  "",
].join("\n");

/** A full 17-field `/sys/dev/block/<maj:min>/stat` line. */
const FULL_STAT =
  "  123  4  5000  60  700  8  9000  100  0  220  320  31  2  4096  7  15  9";

describe("parseMountInfo", () => {
  it("picks the longest mount point holding the target", () => {
    expect(parseMountInfo(MOUNTINFO, "/run/user/1001/x")).toEqual({
      device: "0:29",
      mountPoint: "/run/user/1001",
      fsType: "tmpfs",
      options: "rw,nosuid,nodev,relatime;rw,size=1634280k",
    });
  });

  it("falls back to the root mount, with its mount and super options", () => {
    expect(parseMountInfo(MOUNTINFO, "/home/runner/work/lisa")).toEqual({
      device: "8:1",
      mountPoint: "/",
      fsType: "ext4",
      options: "rw,relatime;rw,discard,errors=remount-ro,commit=30",
    });
  });

  it("matches a mount point exactly, and not a sibling sharing its prefix", () => {
    expect(parseMountInfo(MOUNTINFO, "/mnt")?.device).toBe("8:16");
    expect(parseMountInfo(MOUNTINFO, "/mntx/file")?.device).toBe("8:1");
  });

  it("finds nothing in a table without mounts", () => {
    expect(parseMountInfo("", "/tmp")).toBeUndefined();
  });
});

describe("parseDeviceStat", () => {
  it("names every counter in the kernel's field order", () => {
    const counters = parseDeviceStat(FULL_STAT);

    expect(Object.keys(counters)).toEqual([...DEVICE_FIELDS]);
    expect(counters["readIos"]).toBe(123);
    expect(counters["discardIos"]).toBe(31);
    expect(counters["discardSectors"]).toBe(4096);
    expect(counters["flushMs"]).toBe(9);
  });

  it("leaves out the fields an older kernel does not report", () => {
    // Kernels before 4.18 report eleven fields and no discard counters at
    // all; a missing counter must not read as zero discards.
    const counters = parseDeviceStat("1 2 3 4 5 6 7 8 9 10 11");

    expect(Object.keys(counters)).toHaveLength(11);
    expect(counters["discardIos"]).toBeUndefined();
  });
});

describe("discardDelta", () => {
  it("reports what the discard counters moved by", () => {
    const before = parseDeviceStat(FULL_STAT);
    const after = {
      ...before,
      discardIos: 41,
      discardSectors: 5096,
      readIos: 999,
    };

    expect(discardDelta(before, after)).toEqual({
      discardIos: 10,
      discardMerges: 0,
      discardSectors: 1000,
      discardMs: 0,
    });
  });

  it("reports nothing when a reading is missing", () => {
    expect(discardDelta(undefined, parseDeviceStat(FULL_STAT))).toBeNull();
    expect(discardDelta(parseDeviceStat(FULL_STAT), undefined)).toBeNull();
  });

  it("reports nothing when the device has no discard counters", () => {
    const old = parseDeviceStat("1 2 3 4 5 6 7 8 9 10 11");

    expect(discardDelta(old, old)).toBeNull();
  });
});

describe("the sample kinds", () => {
  it("times a removal per entry and leaves nothing behind", () => {
    const directory = fillProbeDirectory(5);

    const perEntryUs = timeRemovalUs(directory, 5);

    expect(perEntryUs).toBeGreaterThan(0);
    expect(fs.existsSync(directory)).toBe(false);
  });

  it("takes a paired sample of the probe, the variant and a real corpus", async () => {
    const sample = await pairedSample({
      mount: undefined,
      settleMs: 0,
      corpusEntries: 40,
    });

    expect(sample.probeUs).toBeGreaterThan(0);
    expect(sample.variantUs).toBeGreaterThan(0);
    expect(sample.realUs).toBeGreaterThan(0);
    expect(sample.variantToReal).toBeCloseTo(
      sample.variantUs / sample.realUs,
      2
    );
    expect(sample.probeToReal).toBeCloseTo(sample.probeUs / sample.realUs, 2);
    expect(sample.entries).toEqual({ probe: 100, variant: 100, real: 40 });
    expect(sample.discards.real).toEqual({ immediate: null, settled: null });
  });
});
