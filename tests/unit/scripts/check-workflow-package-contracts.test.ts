/**
 * @file check-workflow-package-contracts.test.ts
 * @description A workflow's package path must not only EXIST in the released
 * package — the artifact there must still honour the contract the workflow
 * expects of it (#2982).
 *
 * #2960 shipped the path half and named this half explicitly unbuilt: "a file
 * can keep its path and change its contract ... only the PATH is legible from a
 * workflow, so a contract probe needs a declaration this gate does not have and
 * does not invent." Greening the path in #2951 produced a prover that scanned
 * zero tracked files and reported success — strictly worse than the red it
 * replaced, and invisible to any check that only asks whether the file is
 * there.
 *
 * So the load-bearing case below is an artifact that EXISTS at its declared
 * path and violates its contract. It is paired with a negative control — an
 * artifact that exists and honours the contract must still pass — because a
 * probe that fails everything proves nothing either, and the two cases are
 * indistinguishable from a single red.
 *
 * Every case drives released artifacts from disk via `--extracted`, so the
 * suite is offline and still executes real child processes out of a
 * release-shaped tree.
 * @module tests/unit/scripts/check-workflow-package-contracts
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "check-workflow-package-paths.mjs"
);

/** The synthetic release every fixture publishes. */
const RELEASE = "9.0.0";

/** A second synthetic release, for cases that need two. */
const OLDER_RELEASE = "8.0.0";

/** The package path the fixture workflow executes. */
const PROVER = "all/copy-overwrite/scripts/prover.mjs";

/** A second executed package path, for cases that need two. */
const RUNNER = "all/copy-overwrite/scripts/runner.mjs";

/** How the fixture workflow spells the prover. */
const PROVER_REFERENCE = `node_modules/@codyswann/lisa/${PROVER}`;

/** How the fixture workflow spells the runner. */
const RUNNER_REFERENCE = `node_modules/@codyswann/lisa/${RUNNER}`;

/** Why the fixture workflow runs the prover, as the declaration records it. */
const PROVER_WHY =
  "quality.yml runs it and treats exit 0 as proof the working tree carries no conflict residue.";

/** The probe declaration the prover carries in most cases. */
const PROVER_PROBE = {
  argv: ["--root", "."],
  expectExit: 0,
  why: "the step reads exit 0 as 'the tree is clean', which is only true if the prover actually walked the tree",
  signal: {
    pattern: "scanned (\\d+) tracked files",
    shape: "count",
    min: 1,
  },
};

/** Outcome of one invocation of the script. */
interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the checker as a child process, bounded and never silently killed.
 * @remarks
 * A killed child returns EMPTY streams, so without the kill diagnostic a
 * timeout presents as a content bug and never says "time".
 * @param args - Arguments after the script path
 * @returns Exit status and captured output
 */
function runScript(args: readonly string[]): Run {
  // No `baseMs`, so this takes the derived default. It carried 120,000ms, which
  // was never derived from anything: the commit that introduced it recorded no
  // measurement, and 120,000 x the 8x ceiling is 960,000ms against a case
  // budget of 60,000 x the same slowdown — 0.50x, so the child could not die
  // first on any machine (CodySwannGT/lisa#3202). MEASURED instead, on this
  // repository, 18 cores, `ps aux | grep -c '[v]itest'` = 0 and a 1-minute load
  // average of 9.3: 15 runs of this child across the whole suite cost 74ms at
  // worst and 45ms at the median, divided by the 1.41x slowdown its worker
  // measured — a 53ms quiet-equivalent child. The 6,000ms default is 113x that.
  const result = boundedSpawnSync({
    label: "check-workflow-package-contracts",
    command: process.execPath,
    args: [SCRIPT, ...args],
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/**
 * Run a git command against a fixture, bounded the same way.
 * @param args - Arguments after `git`
 * @returns The child's stdout
 */
function git(args: readonly string[]): string {
  return (
    boundedSpawnSync({
      label: `git ${args[0]}`,
      command: "git",
      args,
      baseMs: 30_000,
      maxBuffer: 64 * 1024 * 1024,
    }).stdout ?? ""
  );
}

/**
 * An artifact that reports having examined a given number of things.
 * @param count - What the artifact claims to have scanned
 * @returns Source for a released `.mjs` artifact
 */
function proverReporting(count: number): string {
  return `console.log("scanned ${count} tracked files");\n`;
}

describe("a released artifact must still honour its declared contract (#2982)", () => {
  let tempDir: string;
  let repoDir: string;
  let releasesDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    repoDir = path.join(tempDir, "repo");
    releasesDir = path.join(tempDir, "releases");
    await fs.ensureDir(path.join(repoDir, ".github", "workflows"));
    git(["init", "-q", repoDir]);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Write a workflow whose steps execute the given package references.
   * @param references - Package references, one executed per step
   */
  async function writeWorkflow(
    ...references: readonly string[]
  ): Promise<void> {
    const body = [
      "jobs:",
      "  check:",
      "    steps:",
      ...references.flatMap((reference, index) => [
        `      - name: Step ${index}`,
        `        run: node ${reference} --root .`,
      ]),
    ].join("\n");
    await fs.writeFile(
      path.join(repoDir, ".github", "workflows", "quality.yml"),
      body,
      "utf8"
    );
    git(["-C", repoDir, "add", "-A"]);
  }

  /**
   * Write the floor declaration, floor and contracts together.
   * @param contracts - The contracts half of the declaration
   */
  async function writeDeclaration(
    contracts: Record<string, unknown>
  ): Promise<void> {
    await fs.writeJson(
      path.join(repoDir, ".github", "workflow-package-floor.json"),
      {
        floor: OLDER_RELEASE,
        why: "A fixture floor, long enough to satisfy the declaration's own requirement that a reader be given something to argue with.",
        contracts,
      }
    );
  }

  /**
   * Publish a synthetic release carrying the given artifacts.
   * @param version - The release version
   * @param artifacts - Package-relative path to artifact source
   */
  async function publish(
    version: string,
    artifacts: Record<string, string>
  ): Promise<void> {
    for (const [relative, source] of Object.entries(artifacts)) {
      const target = path.join(releasesDir, version, "package", relative);
      await fs.ensureDir(path.dirname(target));
      await fs.writeFile(target, source, "utf8");
    }
  }

  /**
   * Run the checker with released artifacts available to run.
   * @returns Exit status and captured output
   */
  function check(): Run {
    return runScript(["--root", repoDir, "--json", "--extracted", releasesDir]);
  }

  /**
   * Run the checker with LISTINGS only — the question #2960 could ask.
   * @param entries - Tarball entries for the synthetic release
   * @returns Exit status and captured output
   */
  async function checkPathsOnly(entries: readonly string[]): Promise<Run> {
    const listing = path.join(tempDir, "listing.json");
    await fs.writeJson(listing, { [RELEASE]: entries });
    return runScript(["--root", repoDir, "--json", "--listing", listing]);
  }

  describe("an artifact that exists and violates its contract", () => {
    it("fails, naming the release, the path and the signal that was absent", async () => {
      // The case #2960 structurally cannot see. The prover is exactly where the
      // workflow says it is, exits 0, and scanned nothing — which is the state
      // greening #2951's path produced and which was worse than the red.
      await writeWorkflow(PROVER_REFERENCE);
      await writeDeclaration({
        [PROVER]: {
          kind: "executed",
          why: PROVER_WHY,
          probes: [PROVER_PROBE],
        },
      });
      await publish(RELEASE, { [PROVER]: proverReporting(0) });

      const result = check();

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.contractProbesExecuted).toBe(1);
      expect(report.breakages.join("\n")).toContain(RELEASE);
      expect(report.breakages.join("\n")).toContain(PROVER);
      expect(report.breakages.join("\n")).toContain("counted 0");
    });

    it("is the exact case a path-existence check reports as clean", async () => {
      // The bite, stated as a contrast rather than asserted in prose: the same
      // release, the same workflow, the same artifact — green when the question
      // is "does the path exist", red when the question is "does the contract
      // hold". If this ever goes red on the listing half, the fixture has
      // stopped isolating the property under test.
      await writeWorkflow(PROVER_REFERENCE);
      await writeDeclaration({
        [PROVER]: {
          kind: "executed",
          why: PROVER_WHY,
          probes: [PROVER_PROBE],
        },
      });
      await publish(RELEASE, { [PROVER]: proverReporting(0) });

      expect((await checkPathsOnly([`package/${PROVER}`])).status).toBe(0);
      expect(check().status).toBe(1);
    });

    it("fails when the artifact runs and emits no signal at all", async () => {
      // Silence is not compliance. An artifact that prints nothing and exits 0
      // is indistinguishable from one that did its job, which is why the
      // declaration names a signal rather than trusting the exit code.
      await writeWorkflow(PROVER_REFERENCE);
      await writeDeclaration({
        [PROVER]: {
          kind: "executed",
          why: PROVER_WHY,
          probes: [PROVER_PROBE],
        },
      });
      await publish(RELEASE, { [PROVER]: "process.exit(0);\n" });

      const result = check();

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).breakages.join("\n")).toContain(
        "it ran, and proved nothing"
      );
    });

    it("fails when the artifact no longer accepts the flag the workflow passes", async () => {
      // The refuse shape: a released artifact that lost a flag prints a generic
      // usage line and enumerates nothing. `contains` pins the exact token the
      // workflow supplies, so the domain having shrunk past it is the failure.
      await writeWorkflow(PROVER_REFERENCE);
      await writeDeclaration({
        [PROVER]: {
          kind: "executed",
          why: "quality.yml passes --root, and a released copy that stopped accepting it would walk the wrong tree.",
          probes: [
            {
              argv: ["--no-such-flag"],
              expectExit: 1,
              why: "the step supplies --root, so the refusal must still name it among the flags the artifact accepts",
              signal: {
                pattern: "usage: prover\\.mjs (.+)$",
                shape: "list",
                min: 1,
                contains: ["--root"],
              },
            },
          ],
        },
      });
      await publish(RELEASE, {
        [PROVER]:
          'console.error("usage: prover.mjs --directory <dir>");\nprocess.exit(1);\n',
      });

      const result = check();

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).breakages.join("\n")).toContain(
        "--root"
      );
    });

    it("fails when the artifact exits differently from what the step branches on", async () => {
      await writeWorkflow(PROVER_REFERENCE);
      await writeDeclaration({
        [PROVER]: {
          kind: "executed",
          why: PROVER_WHY,
          probes: [PROVER_PROBE],
        },
      });
      await publish(RELEASE, {
        [PROVER]: `${proverReporting(5)}process.exit(3);\n`,
      });

      const result = check();

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).breakages.join("\n")).toContain(
        "exited 3 where the workflow depends on 0"
      );
    });
  });

  describe("negative control: an artifact that honours its contract", () => {
    it("passes, and says how many probes it executed", async () => {
      // Without this the suite cannot tell a probe that BITES from a probe that
      // fails everything, and a check that reddens on compliance is no more
      // useful than one that greens on violation.
      await writeWorkflow(PROVER_REFERENCE);
      await writeDeclaration({
        [PROVER]: {
          kind: "executed",
          why: PROVER_WHY,
          probes: [PROVER_PROBE],
        },
      });
      await publish(RELEASE, { [PROVER]: proverReporting(5) });

      const result = check();

      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.breakages).toEqual([]);
      expect(report.contractProbesExecuted).toBe(1);
      expect(report.contractProbesRun.join("\n")).toContain("counted 5");
    });

    it("passes a step whose executed candidate resolves only in the older layout", async () => {
      // The transition shape from #2951: the workflow names both locations, the
      // release carries only the older one, and the probe must follow the
      // artifact the step would actually run rather than declaring the step
      // unprobed.
      await writeWorkflow(`${RUNNER_REFERENCE}" "${PROVER_REFERENCE}`);
      await writeDeclaration({
        [RUNNER]: {
          kind: "executed",
          why: "The post-move location of the same artifact, named first because that is what a current release carries.",
          probes: [PROVER_PROBE],
        },
        [PROVER]: {
          kind: "executed",
          why: "The pre-move location, still named so a consumer on an older release resolves something.",
          probes: [PROVER_PROBE],
        },
      });
      await publish(RELEASE, { [PROVER]: proverReporting(4) });

      const result = check();

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).contractProbesExecuted).toBe(1);
    });
  });

  describe("an executed path with no declaration", () => {
    it("fails, naming the path and the workflow step that executes it", async () => {
      // A new package path must force a decision rather than inherit silence.
      await writeWorkflow(PROVER_REFERENCE);
      await writeDeclaration({});
      await publish(RELEASE, { [PROVER]: proverReporting(5) });

      const result = check();

      expect(result.status).toBe(1);
      const breakages = JSON.parse(result.stdout).breakages.join("\n");
      expect(breakages).toContain(PROVER);
      expect(breakages).toContain("Step 0");
      expect(breakages).toContain("declares no contract");
    });

    it("fails when a declaration names a path no workflow references", async () => {
      // A declaration nobody reaches is a probe that never runs — the same
      // silent-retirement shape, arriving from the other direction.
      await writeWorkflow(PROVER_REFERENCE);
      await writeDeclaration({
        [PROVER]: {
          kind: "executed",
          why: PROVER_WHY,
          probes: [PROVER_PROBE],
        },
        [RUNNER]: {
          kind: "executed",
          why: "Declared here but referenced by nothing, which is what this case exists to catch.",
          probes: [PROVER_PROBE],
        },
      });
      await publish(RELEASE, { [PROVER]: proverReporting(5) });

      const result = check();

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).breakages.join("\n")).toContain(
        "no workflow references it"
      );
    });
  });

  describe("the contract check refuses to pass on nothing", () => {
    it("exits 2 when artifacts were available and zero probes ran", async () => {
      // Declaring every executed path `reference` would otherwise buy a green
      // by asking nothing at all — the exact move that made greening #2951's
      // path worse than leaving it red.
      await writeWorkflow(PROVER_REFERENCE);
      await writeDeclaration({
        [PROVER]: {
          kind: "reference",
          why: "Deliberately mis-declared as not executed, to prove the checker notices that it then probed nothing.",
        },
      });
      await publish(RELEASE, { [PROVER]: proverReporting(5) });

      const result = check();

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("ZERO contract probes ran");
    });

    it("refuses a probe whose declared minimum is zero", async () => {
      await writeWorkflow(PROVER_REFERENCE);
      await writeDeclaration({
        [PROVER]: {
          kind: "executed",
          why: PROVER_WHY,
          probes: [
            {
              ...PROVER_PROBE,
              signal: { ...PROVER_PROBE.signal, min: 0 },
            },
          ],
        },
      });
      await publish(RELEASE, { [PROVER]: proverReporting(0) });

      const result = check();

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("signal.min must be a positive integer");
    });

    it("refuses an executed declaration carrying no probe", async () => {
      await writeWorkflow(PROVER_REFERENCE);
      await writeDeclaration({
        [PROVER]: {
          kind: "executed",
          why: "Declared executed and given nothing to prove, which is existence-only treatment wearing a contract's name.",
          probes: [],
        },
      });
      await publish(RELEASE, { [PROVER]: proverReporting(5) });

      const result = check();

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("needs at least one probe");
    });
  });

  describe("a contract the workflow tolerates losing", () => {
    it("defers the probe below its declared floor, and says so", async () => {
      // `since` records a degradation the workflow demonstrably survives. It is
      // visible in the report rather than silent, and it cannot buy a green on
      // its own: the run still has to execute a probe somewhere.
      await writeWorkflow(PROVER_REFERENCE, RUNNER_REFERENCE);
      await writeDeclaration({
        [PROVER]: {
          kind: "executed",
          why: PROVER_WHY,
          probes: [PROVER_PROBE],
        },
        [RUNNER]: {
          kind: "executed",
          why: "A capability the step wraps, warning and continuing when the released copy does not have it.",
          probes: [
            {
              ...PROVER_PROBE,
              since: "99.0.0",
              degradation:
                "The step wraps this call and warns, so an older release loses the capability without breaking the build.",
            },
          ],
        },
      });
      await publish(RELEASE, {
        [PROVER]: proverReporting(5),
        [RUNNER]: proverReporting(0),
      });

      const result = check();

      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.contractProbesExecuted).toBe(1);
      expect(report.contractProbesDeferred.join("\n")).toContain("99.0.0");
    });
  });

  describe("this repository's own declaration", () => {
    it("covers every package path its workflows resolve", () => {
      // A fixture-only suite would prove the mechanism and nothing about
      // whether the declaration here is complete. Offline: the listing is built
      // from this checkout's tracked files, which is the layout the NEXT
      // release carries.
      const tracked = git(["-C", REPO_ROOT, "ls-files"])
        .split("\n")
        .filter(Boolean)
        .map(entry => `package/${entry}`);
      const listing = path.join(tempDir, "self.json");
      fs.writeJsonSync(listing, { "next-release": tracked });

      const result = runScript([
        "--root",
        REPO_ROOT,
        "--json",
        "--listing",
        listing,
      ]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).breakages).toEqual([]);
    });

    it("declares a probe for every path its workflows execute", () => {
      const declared = fs.readJsonSync(
        path.join(REPO_ROOT, ".github", "workflow-package-floor.json")
      ) as { contracts: Record<string, { kind: string; probes?: unknown[] }> };
      const executed = Object.entries(declared.contracts).filter(
        ([, entry]) => entry.kind === "executed"
      );

      // Hardcoded rather than derived: a count computed from the same file it
      // checks would move with any edit and pin nothing.
      expect(executed.length).toBe(9);
      for (const [, entry] of executed) {
        expect(entry.probes?.length ?? 0).toBeGreaterThan(0);
      }
    });
  });
});
