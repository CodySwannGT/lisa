/**
 * @file check-workflow-package-paths.test.ts
 * @description A workflow may only reference package paths that exist in the
 * RELEASED package (#2960).
 *
 * Consumers reference the reusable workflow at `@main` and version-pin
 * `@codyswann/lisa`, so every consumer runs today's workflow against an older
 * package. #2951 showed what that costs: a prover moved directories 72 minutes
 * after a release, the workflow followed it in the same commit — correct
 * against the source tree, wrong against every consumer already installed — and
 * the gate failed closed fleet-wide on clean trees.
 *
 * Two properties of that incident drive the cases below.
 *
 * **Lisa cannot catch it by running the step.** It is the one repository where
 * the host-relative candidate resolves, so its own run found the prover in its
 * checkout no matter what the package contained. So the fixtures assert the
 * ABSENCE of host-relative rescue: a step whose only surviving candidate is
 * host-relative must still fail.
 *
 * **Greening the path produced a prover that scanned 0 tracked files and
 * reported success** — strictly worse than the red it replaced. So this suite
 * carries a positive control proving the checker fails on the pre-#2951 state,
 * and pins the checker's own non-vacuity: examining nothing is exit 2, never a
 * pass.
 * @module tests/unit/scripts/check-workflow-package-paths
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

import {
  extractPackagePaths,
  releaseContains,
  splitIntoSteps,
} from "../../../scripts/check-workflow-package-paths.mjs";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

useIoLatencyBudget();

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const SCRIPT = path.join(
  REPO_ROOT,
  "scripts",
  "check-workflow-package-paths.mjs"
);

/** The prover that moved in #2951, at its two real locations. */
const NEW_LOCATION = "all/copy-overwrite/scripts/check-conflict-markers.mjs";
const OLD_LOCATION = "scripts/check-conflict-markers.mjs";

/** A released version that predates the move. */
const OLD_RELEASE = "3.40.0";

/** A released version that carries the new layout. */
const NEW_RELEASE = "3.62.0";

/** Where the compatibility floor is declared. */
const FLOOR_FILE = "workflow-package-floor.json";

/** A tarball entry every fixture release carries. */
const MANIFEST_ENTRY = "package/package.json";

/** The workflow file every fixture writes. */
const WORKFLOW_FILE = "quality.yml";

/** The new location as a workflow spells it. */
const NEW_REFERENCE = `node_modules/@codyswann/lisa/${NEW_LOCATION}`;

/** The old location as a workflow spells it. */
const OLD_REFERENCE = `node_modules/@codyswann/lisa/${OLD_LOCATION}`;

/** Outcome of one invocation of the script. */
interface Run {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Wrap a shell word in double quotes.
 * @param word - The candidate path
 * @returns The word, quoted for a `for` list
 */
function quoted(word: string): string {
  return `"${word}"`;
}

/**
 * Run the checker as a child process, bounded and never silently killed.
 * @remarks
 * `boundedSpawnSync` is what pairs a machine-scaled budget with the kill
 * diagnostic. Without the diagnostic a killed child returns EMPTY streams, so a
 * timeout presents as a content bug and never says "time".
 * @param args - Arguments after the script path
 * @returns Exit status and captured output
 */
function runScript(args: readonly string[]): Run {
  // No `baseMs`, so this takes the derived default. It carried 60,000ms, which
  // exactly EQUALLED the base this file's case budget scales from — a 1.00x
  // ratio, the same tie CodySwannGT/lisa#3202 was filed for, and it was never
  // derived from a measurement either. MEASURED instead, on this repository,
  // 18 cores, `ps aux | grep -c '[v]itest'` = 0 and a 1-minute load average of
  // 9.3: 12 runs of this child cost 63ms at worst and 27ms at the median,
  // divided by the 1.41x slowdown its worker measured — a 45ms quiet-equivalent
  // child. The 6,000ms default is 133x that.
  const result = boundedSpawnSync({
    label: "check-workflow-package-paths",
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

describe("workflow package paths must exist in the released package (#2960)", () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    repoDir = path.join(tempDir, "repo");
    await fs.ensureDir(path.join(repoDir, ".github", "workflows"));
    git(["init", "-q", repoDir]);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Write a workflow into the fixture repository and track it.
   * @param name - File name under `.github/workflows`
   * @param body - Workflow source
   */
  async function writeWorkflow(name: string, body: string): Promise<void> {
    await fs.writeFile(
      path.join(repoDir, ".github", "workflows", name),
      body,
      "utf8"
    );
    git(["-C", repoDir, "add", "-A"]);
  }

  /**
   * Write a release listing the script reads instead of the registry.
   * @param listing - Version to tarball entries, each `package/`-prefixed
   * @returns Absolute path to the listing file
   */
  async function writeListing(
    listing: Record<string, readonly string[]>
  ): Promise<string> {
    const file = path.join(tempDir, "listing.json");
    await fs.writeJson(file, listing);
    return file;
  }

  /**
   * Declare a floor and an existence-only contract for whatever is referenced.
   * @remarks
   * #2982 made the declaration mandatory: a resolved package path with no
   * contract entry fails, and an entry nothing references fails too. Deriving
   * the entries from the fixture's own workflow text keeps every case in this
   * suite about PATHS, which is the property it exists to pin, while still
   * satisfying the declaration's completeness rule.
   */
  async function writeDeclaration(): Promise<void> {
    const workflowDir = path.join(repoDir, ".github", "workflows");
    const referenced = (await fs.readdir(workflowDir)).flatMap(name =>
      extractPackagePaths(fs.readFileSync(path.join(workflowDir, name), "utf8"))
    );
    await fs.writeJson(path.join(repoDir, ".github", FLOOR_FILE), {
      floor: OLD_RELEASE,
      why: "A fixture floor, long enough to satisfy the declaration's own requirement that a later reader be given something to argue with.",
      contracts: Object.fromEntries(
        [...new Set(referenced)].map(candidate => [
          candidate,
          {
            kind: "reference",
            why: "Existence-only in this fixture: these cases pin the path half, and #2982's contract half has its own suite.",
          },
        ])
      ),
    });
  }

  /**
   * Run the checker against the fixture repository.
   * @param listingPath - Listing file to read release layouts from
   * @returns Exit status and captured output
   */
  async function check(listingPath: string): Promise<Run> {
    await writeDeclaration();
    return runScript(["--root", repoDir, "--json", "--listing", listingPath]);
  }

  /**
   * A step whose only candidates are the two given paths.
   * @param candidates - Path expressions the step tries in order
   * @returns Workflow source
   */
  function workflowWithStep(...candidates: readonly string[]): string {
    return [
      "jobs:",
      "  check:",
      "    steps:",
      "      - name: Conflict residue",
      "        run: |",
      `          for c in ${candidates.map(quoted).join(" ")}; do`,
      '            [ -f "$c" ] && node "$c" && break',
      "          done",
    ].join("\n");
  }

  /** A release carrying the new layout only. */
  const afterTheMove = {
    [NEW_RELEASE]: [`package/${NEW_LOCATION}`, MANIFEST_ENTRY],
  };

  /** A release carrying the old layout only — what the fleet had installed. */
  const beforeTheMove = {
    [OLD_RELEASE]: [`package/${OLD_LOCATION}`, MANIFEST_ENTRY],
  };

  describe("a workflow references a path absent from the released package", () => {
    it("fails, naming the release version and the missing path", async () => {
      // The #2951 state exactly: the workflow follows the move, the fleet has
      // not. This is the positive control — if it ever passes, the checker has
      // stopped reproducing the defect and proves nothing.
      await writeWorkflow(WORKFLOW_FILE, workflowWithStep(NEW_REFERENCE));

      const result = await check(await writeListing(beforeTheMove));

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(OLD_RELEASE);
      expect(result.stdout).toContain(NEW_LOCATION);
    });

    it("is not rescued by a host-relative candidate in the same step", async () => {
      // Lisa is the ONE repository where the host-relative candidate resolves,
      // which is precisely why its own run of the step answered yes throughout.
      // A fallback that only ever works here cannot satisfy a claim about the
      // released package.
      await writeWorkflow(
        WORKFLOW_FILE,
        workflowWithStep(NEW_REFERENCE, OLD_LOCATION)
      );

      const result = await check(await writeListing(beforeTheMove));

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(NEW_LOCATION);
    });
  });

  describe("a workflow references a path present in the released package", () => {
    it("passes", async () => {
      await writeWorkflow(WORKFLOW_FILE, workflowWithStep(NEW_REFERENCE));

      const result = await check(await writeListing(afterTheMove));

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).breakages).toEqual([]);
    });
  });

  describe("a transition supporting both layouts is not flagged", () => {
    it("passes against a release that has only the old location", async () => {
      await writeWorkflow(
        WORKFLOW_FILE,
        workflowWithStep(NEW_REFERENCE, OLD_REFERENCE)
      );

      const result = await check(
        await writeListing({ ...beforeTheMove, ...afterTheMove })
      );

      expect(result.status).toBe(0);
    });

    it("still fails when neither location is in a release", async () => {
      // The transition shape is the escape hatch, not a blanket exemption:
      // naming two paths that are both absent is still a broken merge.
      await writeWorkflow(
        WORKFLOW_FILE,
        workflowWithStep(NEW_REFERENCE, OLD_REFERENCE)
      );

      const result = await check(
        await writeListing({ [OLD_RELEASE]: [MANIFEST_ENTRY] })
      );

      expect(result.status).toBe(1);
    });

    it("does not let one step's path satisfy a different step", async () => {
      // Grouping is per step for a reason. If the two halves of a transition
      // could live in different steps, a workflow would satisfy this check
      // while the step that actually runs still resolves nothing.
      await writeWorkflow(
        WORKFLOW_FILE,
        [
          "jobs:",
          "  check:",
          "    steps:",
          "      - name: Runs the prover",
          `        run: node ${NEW_REFERENCE}`,
          "      - name: Mentions the old one",
          `        run: echo ${OLD_REFERENCE}`,
        ].join("\n")
      );

      const result = await check(await writeListing(beforeTheMove));

      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout).breakages).toHaveLength(1);
    });
  });

  describe("the check is not vacuous", () => {
    it("reports a non-zero count of package paths examined", async () => {
      await writeWorkflow(WORKFLOW_FILE, workflowWithStep(NEW_REFERENCE));

      const report = JSON.parse(
        (await check(await writeListing(afterTheMove))).stdout
      );

      expect(report.packagePathsExamined).toBeGreaterThan(0);
      expect(report.workflowsExamined).toBeGreaterThan(0);
      expect(report.stepsExamined).toBeGreaterThan(0);
    });

    it("refuses to pass when no workflow references the package at all", async () => {
      // Examining nothing and reporting success is the exact shape that made
      // greening the #2951 path worse than leaving it red.
      await writeWorkflow(
        WORKFLOW_FILE,
        ["jobs:", "  check:", "    steps:", "      - run: echo hello"].join(
          "\n"
        )
      );

      const result = await check(await writeListing(afterTheMove));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("examined nothing is not a pass");
    });

    it("refuses to pass when the release layouts cannot be read", async () => {
      await writeWorkflow(WORKFLOW_FILE, workflowWithStep(NEW_REFERENCE));

      const result = await check(path.join(tempDir, "absent.json"));

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("never ran");
    });
  });

  describe("the compatibility floor is declared, not guessed", () => {
    it("refuses to run when no floor is declared", async () => {
      // A count of recent releases answers nothing: measured 2026-08-23 this
      // package published ~15 releases a day, so "the last 3" spans about five
      // hours. Without a declared floor the check would be guessing how far
      // back to look, and a guessed floor is how a gate ends up measuring
      // nothing.
      await writeWorkflow(WORKFLOW_FILE, workflowWithStep(NEW_REFERENCE));

      const result = runScript(["--root", repoDir, "--json"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("workflow-package-floor.json");
    });

    it("refuses a declaration with no floor in it", async () => {
      await writeWorkflow(WORKFLOW_FILE, workflowWithStep(NEW_REFERENCE));
      await fs.writeJson(path.join(repoDir, ".github", FLOOR_FILE), {
        why: "no floor here",
      });

      const result = runScript(["--root", repoDir, "--json"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('no string "floor"');
    });

    it("this repository declares a floor that names a real release", () => {
      const declared = fs.readJsonSync(
        path.join(REPO_ROOT, ".github", FLOOR_FILE)
      ) as { floor?: unknown; why?: unknown };

      expect(typeof declared.floor).toBe("string");
      expect(String(declared.floor)).toMatch(/^\d+\.\d+\.\d+$/);
      // A bare version number is a value nobody chose. The reason it is THAT
      // version is the part a later reader needs in order to argue with it.
      expect(String(declared.why ?? "").length).toBeGreaterThan(80);
    });
  });

  describe("it reads this repository's real workflows", () => {
    it("examines a non-zero number of package paths in the real tree", () => {
      // A fixture-only suite would prove the mechanism and nothing about
      // whether the walk reaches anything here. The listing is built from this
      // checkout's own tracked files — the layout the NEXT release will carry —
      // so the case is offline and still runs against real workflow text.
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
      const report = JSON.parse(result.stdout);

      expect(report.packagePathsExamined).toBeGreaterThan(0);
      expect(report.stepsExamined).toBeGreaterThan(0);
      expect(report.unattributed).toEqual([]);
    });
  });

  describe("extraction", () => {
    it("skips prose that is not a path", () => {
      // `node_modules/@codyswann/lisa/...` appears in a comment explaining the
      // hazard. Treating that as a claim would make the gate's first act a
      // false alarm.
      expect(
        extractPackagePaths("see node_modules/@codyswann/lisa/... for why")
      ).toEqual([]);
    });

    it("keeps a directory reference, which is a claim too", () => {
      expect(
        extractPackagePaths("ls node_modules/@codyswann/lisa/scripts/")
      ).toEqual(["scripts/"]);
    });

    it("groups a for-loop's candidates into one step", () => {
      const steps = splitIntoSteps(
        [
          "jobs:",
          "  check:",
          "    steps:",
          "      - name: One",
          `        run: for c in ${quoted(NEW_REFERENCE)} ${quoted(OLD_REFERENCE)}; do :; done`,
          "      - name: Two",
          "        run: echo unrelated",
        ].join("\n")
      );
      const withPaths = steps.filter(
        step => extractPackagePaths(step.text).length > 0
      );

      expect(withPaths).toHaveLength(1);
      expect(extractPackagePaths(withPaths[0].text)).toEqual([
        NEW_LOCATION,
        OLD_LOCATION,
      ]);
    });
  });

  describe("release membership", () => {
    it("matches a file entry exactly", () => {
      expect(releaseContains([`package/${NEW_LOCATION}`], NEW_LOCATION)).toBe(
        true
      );
    });

    it("does not match a prefix of a longer file name", () => {
      expect(
        releaseContains([`package/${NEW_LOCATION}.bak`], NEW_LOCATION)
      ).toBe(false);
    });

    it("matches a directory when the release has something under it", () => {
      expect(releaseContains(["package/scripts/a.mjs"], "scripts/")).toBe(true);
    });

    it("does not match an empty directory entry", () => {
      expect(releaseContains(["package/scripts/"], "scripts/")).toBe(false);
    });
  });
});
