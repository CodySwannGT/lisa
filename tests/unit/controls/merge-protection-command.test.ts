/**
 * `lisa controls merge-protection`: the audit's one read of the hosting
 * platform, printed as one JSON document.
 *
 * The command is run by an agent in the middle of an audit, so a platform
 * that would not answer is a result, not a failure: the document is printed
 * and the exit code is 0 whether the platform was read, refused the read, or
 * was never asked. Only a run that could produce no document exits 1
 * (CodySwannGT/lisa#4981).
 */
import { realpathSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runMergeProtection } from "../../../src/controls/commands/merge-protection.js";
import {
  MERGE_PROTECTION_NOTE,
  MERGE_PROTECTION_SCHEMA_VERSION,
  type MergeProtectionRead,
} from "../../../src/controls/merge-protection-read.js";
import {
  notAttemptedProbe,
  reachableProbe,
  unreachableProbe,
  type SampleProbe,
} from "../../helpers/audit-probes.js";

const HERE = realpathSync(process.cwd());
const RULESET = "main checks";
const GITHUB = {
  name: "github",
  repository: "example-owner/example-repo",
  detected_from: "remote",
  reachable: true,
  note: null,
} as const;
const NOWHERE = {
  name: "unknown",
  repository: null,
  detected_from: "none",
  reachable: false,
  note: "Nothing says where this repository is hosted.",
} as const;

/** What one run of the command printed and returned. */
interface Run {
  readonly code: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
  readonly roots: readonly string[];
}

/**
 * A document as the read would return it.
 * @param probe - The probe it carries, or `null`
 * @param change - Fields that differ
 * @returns The document
 */
function documentWith(
  probe: SampleProbe | null,
  change: Partial<MergeProtectionRead> = {}
): MergeProtectionRead {
  return {
    schema_version: MERGE_PROTECTION_SCHEMA_VERSION,
    platform: probe === null ? NOWHERE : GITHUB,
    branch: null,
    probe: probe as MergeProtectionRead["probe"],
    merge_protection: null,
    requests: [],
    ...change,
  };
}

/**
 * Run the command in-process with a stand-in for the read.
 * @param read - What the read returns, or throws
 * @param target - The path argument
 * @returns Exit code, printed lines, and the roots the read was given
 */
async function run(
  read: () => MergeProtectionRead,
  target?: string
): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const roots: string[] = [];
  const code = await runMergeProtection(target, {
    cwd: HERE,
    stdout: text => {
      stdout.push(text);
    },
    stderr: line => {
      stderr.push(line);
    },
    read: root => {
      roots.push(root);
      return Promise.resolve().then(read);
    },
  });
  return { code, stdout, stderr, roots };
}

describe("lisa controls merge-protection", () => {
  it("prints the document and says what the platform requires", async () => {
    const read = documentWith(reachableProbe(), {
      branch: "main",
      merge_protection: {
        rulesets: [RULESET],
        required_checks: [
          { context: "CI / test", ruleset: RULESET },
          { context: "CI / lint", ruleset: RULESET },
        ],
        note: MERGE_PROTECTION_NOTE,
      },
    });

    const printed = await run(() => read);

    expect(printed.code).toBe(0);
    expect(printed.stdout.map(text => JSON.parse(text) as unknown)).toEqual([
      read,
    ]);
    expect(printed.stderr).toEqual([
      "merge-protection: READ. GitHub requires 2 checks before a change is merged into main.",
    ]);
  });

  it("says so when the platform requires no check", async () => {
    const read = documentWith(reachableProbe(), {
      branch: "main",
      merge_protection: {
        rulesets: [],
        required_checks: [],
        note: MERGE_PROTECTION_NOTE,
      },
    });

    expect((await run(() => read)).stderr).toEqual([
      "merge-protection: READ. GitHub requires no check before a change is merged into main.",
    ]);
  });

  it("exits 0 and says what access is missing when the platform would not answer", async () => {
    const probe = unreachableProbe({
      observed_error: "gh: Not Found\n(HTTP 404)",
    });
    const printed = await run(() => documentWith(probe));

    expect(printed.code).toBe(0);
    expect(printed.stdout).toHaveLength(1);
    expect(printed.stderr).toEqual([
      `merge-protection: NOT REACHED. Lisa could not reach ${String(probe.system)}: gh: Not Found (HTTP 404). To check this requirement an agent needs ${String(probe.access_needed)}.`,
    ]);
  });

  it("exits 0 and says why when no read was tried", async () => {
    const probe = notAttemptedProbe();
    const printed = await run(() => documentWith(probe));

    expect(printed.code).toBe(0);
    expect(printed.stderr).toEqual([
      `merge-protection: NOT TRIED. Lisa did not try to reach ${String(probe.system)}: ${String(probe.reason)} To check this requirement an agent needs ${String(probe.access_needed)}.`,
    ]);
  });

  it("exits 0 with no probe when nothing says where the repository is hosted", async () => {
    const printed = await run(() => documentWith(null));

    expect(printed.code).toBe(0);
    expect(JSON.parse(String(printed.stdout[0]))).toMatchObject({
      probe: null,
    });
    expect(printed.stderr).toEqual([
      "merge-protection: NO PLATFORM. Nothing says where this repository is hosted. There is no outside system to read.",
    ]);
  });

  it("reads the repository it is run in, or the one it is given", async () => {
    const here = await run(() => documentWith(null));
    const named = await run(() => documentWith(null), "src");

    expect(here.roots).toEqual([HERE]);
    expect(named.roots).toEqual([path.join(HERE, "src")]);
  });

  it("exits 1 and prints no document when the path is not a folder", async () => {
    const printed = await run(() => documentWith(null), "no-such-folder");

    expect(printed.code).toBe(1);
    expect(printed.stdout).toEqual([]);
    expect(printed.roots).toEqual([]);
    expect(printed.stderr).toEqual([
      "no-such-folder is not a folder. Give the path of the repository to read.",
      "merge-protection: FAIL. Nothing was read, and nothing was sent to the hosting platform or written",
    ]);
  });

  it("exits 1 and prints no document when the read cannot be made", async () => {
    const printed = await run(() => {
      throw new Error("The gate registry is missing\nfrom this copy of Lisa.");
    });

    expect(printed.code).toBe(1);
    expect(printed.stdout).toEqual([]);
    expect(printed.stderr).toEqual([
      "The gate registry is missing from this copy of Lisa.",
      "merge-protection: FAIL. Nothing was read, and nothing was sent to the hosting platform or written",
    ]);
  });
});
