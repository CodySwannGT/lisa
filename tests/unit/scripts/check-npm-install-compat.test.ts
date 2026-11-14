/**
 * Unit tests for scripts/check-npm-install-compat.mjs (CodySwannGT/lisa#4871).
 *
 * The defect: `npm install @codyswann/lisa` crashed under npm 10.9.9 with
 * npm's internal `Cannot read properties of null (reading 'edgesOut')`. The
 * trigger was a Vitest 4 dependency whose optional peer chain resolved to
 * Vitest 5 inside npm 10's peer scratch tree. The check installs the packed
 * tarball under each npm version and must refuse on every signal that the
 * install did not happen as claimed: the wrong npm ran, a non-zero or missing
 * exit, the `edgesOut` crash text, or a missing or mismatched installed
 * manifest.
 *
 * The install step is injected so these tests never touch the network; the
 * real installs run in CI (packaged-apply-isolation.yml on pull requests,
 * publish-to-npm.yml before every publish).
 * @module tests/unit/scripts/check-npm-install-compat
 */
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_NPM_VERSIONS,
  evaluateInstall,
  formatReport,
  main,
  parseArgs,
  runChecks,
} from "../../../scripts/check-npm-install-compat.mjs";

/** One stubbed install outcome. */
interface InstallOutcome {
  readonly npmReported: string;
  readonly status: number | null;
  readonly output: string;
  readonly error?: string;
  readonly installedVersion: string | null;
}

const TARBALL = "/t/lisa.tgz";
const VERSION = "5.1.1";
const NPM10 = "10.9.9";
const NPM11 = "11.6.2";
const ON_NPM10 = { npmVersion: NPM10, packageVersion: VERSION };
const CRASH_LINE =
  "npm error Cannot read properties of null (reading 'edgesOut')";

/**
 * A healthy install under the given npm, with fields overridden.
 * @param npmVersion - npm version that ran
 * @param overrides - Fields to replace
 * @returns Outcome
 */
function outcome(
  npmVersion: string,
  overrides: Partial<InstallOutcome> = {}
): InstallOutcome {
  return {
    npmReported: npmVersion,
    status: 0,
    output: "added 1109 packages in 20s\n",
    installedVersion: VERSION,
    ...overrides,
  };
}

const CRASHED: Partial<InstallOutcome> = {
  status: 1,
  output: `${CRASH_LINE}\nnpm error A complete log of this run can be found in: /x.log\n`,
  installedVersion: null,
};

/**
 * Build an injected installer that answers per npm version.
 * @param byVersion - Overrides for each npm version
 * @returns Installer plus the calls it received
 */
function stubInstaller(byVersion: Record<string, Partial<InstallOutcome>>) {
  const calls: string[] = [];
  const install = (tarball: string, npmVersion: string): InstallOutcome => {
    calls.push(`${npmVersion}:${tarball}`);
    return outcome(npmVersion, byVersion[npmVersion]);
  };
  return { calls, install };
}

/** Effects for main that never touch disk or network. */
const quietDeps = (install: ReturnType<typeof stubInstaller>["install"]) => ({
  install,
  pack: () => "/packed/lisa.tgz",
  readVersion: () => VERSION,
  write: () => undefined,
});

describe("evaluateInstall", () => {
  it("passes a zero exit that installed the tarball's version", () => {
    expect(evaluateInstall(ON_NPM10, outcome(NPM10))).toEqual({
      npmVersion: NPM10,
      ok: true,
      reason: "",
    });
  });

  it("refuses the edgesOut crash and quotes npm's error line", () => {
    const verdict = evaluateInstall(ON_NPM10, outcome(NPM10, CRASHED));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("exited 1");
    expect(verdict.reason).toContain(CRASH_LINE);
  });

  it("refuses edgesOut text even when npm exits zero", () => {
    const verdict = evaluateInstall(
      ON_NPM10,
      outcome(NPM10, { output: "npm warn something edgesOut\n" })
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("edgesOut");
  });

  it("refuses a zero exit that left no installed package", () => {
    const verdict = evaluateInstall(
      ON_NPM10,
      outcome(NPM10, { installedVersion: null })
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain(
      "node_modules/@codyswann/lisa/package.json"
    );
  });

  it("refuses an installed version that is not the tarball's", () => {
    const verdict = evaluateInstall(
      ON_NPM10,
      outcome(NPM10, { installedVersion: "5.0.0" })
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("5.0.0");
    expect(verdict.reason).toContain(VERSION);
  });

  it("refuses when npx ran a different npm than requested", () => {
    const verdict = evaluateInstall(ON_NPM10, outcome("11.6.2"));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("npx ran npm 11.6.2");
    expect(verdict.reason).toContain(`requested npm ${NPM10}`);
  });

  it("refuses a failed spawn and names the spawn error", () => {
    const verdict = evaluateInstall(
      ON_NPM10,
      outcome(NPM10, {
        status: null,
        output: "",
        error: "spawnSync npx ENOENT",
        installedVersion: null,
      })
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("exited null");
    expect(verdict.reason).toContain("spawnSync npx ENOENT");
  });
});

describe("parseArgs", () => {
  it("defaults to npm 10.9.9 and 11.6.2 with no tarball", () => {
    expect(DEFAULT_NPM_VERSIONS).toEqual([NPM10, NPM11]);
    expect(parseArgs([])).toEqual({
      tarball: undefined,
      npmVersions: [NPM10, NPM11],
    });
  });

  it("reads the tarball and an overriding version list", () => {
    expect(parseArgs(["--tarball", TARBALL, "--npm", "10.9.9,11.7.0"])).toEqual(
      { tarball: TARBALL, npmVersions: [NPM10, "11.7.0"] }
    );
  });

  it("rejects a flag with no value", () => {
    expect(() => parseArgs(["--tarball"])).toThrow(/--tarball/);
  });

  it("rejects a version list that names no version", () => {
    expect(() => parseArgs(["--npm", ","])).toThrow(
      "--npm needs at least one version"
    );
  });
});

describe("runChecks", () => {
  it("installs the tarball once per npm version", () => {
    const { calls, install } = stubInstaller({});
    const results = runChecks(
      { tarball: TARBALL, packageVersion: VERSION },
      [NPM10, NPM11],
      install
    );
    expect(calls).toEqual([`${NPM10}:${TARBALL}`, `${NPM11}:${TARBALL}`]);
    expect(results.map(result => result.ok)).toEqual([true, true]);
  });
});

describe("formatReport", () => {
  it("names each npm version and the failure reason", () => {
    const report = formatReport([
      evaluateInstall(ON_NPM10, outcome(NPM10, CRASHED)),
      evaluateInstall(
        { npmVersion: NPM11, packageVersion: VERSION },
        outcome(NPM11)
      ),
    ]);
    expect(report).toContain(`FAIL npm ${NPM10}`);
    expect(report).toContain(`PASS npm ${NPM11}`);
    expect(report).toContain("edgesOut");
  });
});

describe("main", () => {
  it("returns 1 and reports when any npm version fails", () => {
    const { install } = stubInstaller({ [NPM10]: CRASHED });
    const lines: string[] = [];
    const code = main(["--tarball", TARBALL], {
      ...quietDeps(install),
      write: (line: string) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(lines.join("")).toContain(`FAIL npm ${NPM10}`);
  });

  it("returns 0 when every npm version installs", () => {
    const { install } = stubInstaller({});
    expect(main(["--tarball", TARBALL], quietDeps(install))).toBe(0);
  });

  it("packs the repository when no tarball is given", () => {
    const { calls, install } = stubInstaller({});
    main(["--npm", NPM11], quietDeps(install));
    expect(calls).toEqual([`${NPM11}:/packed/lisa.tgz`]);
  });

  it("compares against the version read from the tarball", () => {
    const { install } = stubInstaller({});
    const code = main(["--tarball", TARBALL], {
      ...quietDeps(install),
      readVersion: () => "9.9.9",
    });
    expect(code).toBe(1);
  });

  it("hands the installer an absolute tarball path for a relative --tarball", () => {
    // The install runs in a temp directory, so a relative path would resolve
    // there instead of against the caller's cwd.
    const { calls, install } = stubInstaller({});
    const read: string[] = [];
    main(["--tarball", "./x.tgz", "--npm", NPM11], {
      ...quietDeps(install),
      readVersion: (tarball: string) => {
        read.push(tarball);
        return VERSION;
      },
    });
    const absolute = path.resolve("./x.tgz");
    expect(path.isAbsolute(absolute)).toBe(true);
    expect(calls).toEqual([`${NPM11}:${absolute}`]);
    expect(read).toEqual([absolute]);
  });
});
