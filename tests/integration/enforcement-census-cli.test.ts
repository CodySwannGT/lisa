/**
 * The census reports and never gates.
 *
 * The property under test here is the process exit status, which is why this
 * suite drives the real script as a child rather than calling the module. A
 * census that could redden a build because someone ELSE's checkout is stale
 * would be a worse control than the one it replaces, and the operator's
 * available move would be to route around it (CodySwannGT/lisa#3490).
 *
 * The two non-zero exits below are deliberately about the census's OWN inputs —
 * an unknown flag, and an explicitly named roster that is not there. Neither is
 * a finding about the fleet, and no fleet shape can produce either.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  ioLatencyBudgetMs,
  useIoLatencyBudget,
} from "../helpers/io-latency-budget.js";
import { SMOKE_BUILD_SCRIPT } from "../helpers/smoke-build.js";
import {
  ALL_GUARDS,
  buildFleet,
  type Fleet,
} from "../helpers/enforcement-census-fixtures.js";

useIoLatencyBudget();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CENSUS = path.join(REPO_ROOT, "scripts", "lisa-enforcement-census.mjs");

const REFERENCE = "4.24.2";
const ROSTER_FLAG = "--roster";
const REFERENCE_FLAG = "--reference";

let fleet: Fleet | null = null;

afterEach(() => {
  fleet?.cleanup();
  fleet = null;
});

/**
 * Drive the census as a child and return everything it produced.
 * @param args - Arguments after the script path
 * @returns Exit status and both streams
 */
function census(args: readonly string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const outcome = boundedSpawnSync({
    label: `lisa-enforcement-census ${args.join(" ")}`,
    command: "node",
    args: [CENSUS, ...args],
    baseMs: 30_000,
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: outcome.status,
    stdout: outcome.stdout ?? "",
    stderr: outcome.stderr ?? "",
  };
}

describe("the census never gates", () => {
  beforeAll(() => {
    boundedSpawnSync({
      label: "build dist for the census",
      command: "bun",
      args: ["run", SMOKE_BUILD_SCRIPT],
      // The child deadline must sit comfortably INSIDE the case budget below,
      // or the case dies of a vitest timeout that names nothing and the child
      // never reports by name. MARGIN_FRACTION puts the ceiling at half the
      // case base, so 30s is the highest admissible base here — the same value
      // `cli-smoke.test.ts` uses to bound this very build.
      baseMs: 30_000,
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }, ioLatencyBudgetMs(120_000));

  it("exits 0 on a fleet in which every checkout is stale", () => {
    fleet = buildFleet([
      { name: "a", hostGuards: ALL_GUARDS, receiptVersion: "3.23.0" },
      { name: "b", hostGuards: ALL_GUARDS, receiptVersion: "3.23.1" },
      { name: "c", hostGuards: ALL_GUARDS, receiptVersion: "3.46.3" },
    ]);
    const run = census([
      ROSTER_FLAG,
      fleet.rosterPath,
      REFERENCE_FLAG,
      REFERENCE,
    ]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("ENFORCING — 3 of 3");
    expect(run.stdout).toContain("behind: 3");
  });

  it("exits 0 on a fleet in which no checkout resolves any guard", () => {
    fleet = buildFleet([{ name: "a" }, { name: "b" }]);
    const run = census([ROSTER_FLAG, fleet.rosterPath]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      "NOT ENFORCING — 2 of 2 resolve no guard at all"
    );
  });

  it("exits 0 when a checkout on the roster cannot be read", () => {
    fleet = buildFleet(
      [{ name: "a", hostGuards: ALL_GUARDS }],
      ["/nonexistent/checkout"]
    );
    const run = census([ROSTER_FLAG, fleet.rosterPath]);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("COULD NOT LOOK — 1 of 2");
    expect(run.stdout).toContain("path does not exist");
  });
});

describe("the census output", () => {
  it("emits disjoint classes that sum to the roster size", () => {
    fleet = buildFleet(
      [
        { name: "stale", hostGuards: ALL_GUARDS, receiptVersion: "3.23.0" },
        { name: "unguarded" },
        { name: "covered", hostGuards: ALL_GUARDS, receiptVersion: REFERENCE },
      ],
      ["/nonexistent/checkout"]
    );
    const run = census([
      ROSTER_FLAG,
      fleet.rosterPath,
      REFERENCE_FLAG,
      REFERENCE,
      "--json",
    ]);
    const parsed = JSON.parse(run.stdout) as {
      summary: Record<string, number>;
    };

    expect(run.status).toBe(0);
    expect(
      parsed.summary.unreadable! +
        parsed.summary.unguarded! +
        parsed.summary.partial! +
        parsed.summary.full!
    ).toBe(parsed.summary.total);
    expect(parsed.summary.behind).toBe(1);
    expect(parsed.summary.unguarded).toBe(1);
    expect(parsed.summary.covered).toBe(1);
  });

  it("prints no real path under --redact", () => {
    fleet = buildFleet([{ name: "a", hostGuards: ALL_GUARDS }]);
    const run = census([ROSTER_FLAG, fleet.rosterPath, "--redact"]);

    expect(run.status).toBe(0);
    expect(run.stdout).not.toContain(fleet.root);
    expect(run.stdout).toMatch(/checkout-[0-9a-f]{8}/u);
  });
});

describe("the census's own inputs", () => {
  it("exits 2 on a usage error rather than pretending it measured", () => {
    const run = census(["--nonsense"]);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("Unknown option");
  });

  it.each([ROSTER_FLAG, "--scan", "--depth", REFERENCE_FLAG])(
    "exits 2 when %s is given no value, rather than silently measuring the default fleet",
    flag => {
      const run = census([flag]);

      expect(run.status).toBe(2);
      expect(run.stderr).toContain(`${flag} requires a value`);
      // The point of failing: it must not fall back to the machine's own
      // roster and report a fleet nobody asked it to measure.
      expect(run.stdout).toBe("");
    }
  );

  it("exits 1 when an explicitly named roster is not there", () => {
    const run = census([ROSTER_FLAG, "/nonexistent/roster.json"]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Could not read the roster");
  });
});
