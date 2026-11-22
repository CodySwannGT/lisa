/**
 * Which filesystem failures the stale managed-banner doctor check calls an
 * absence.
 *
 * Only `ENOENT` and `ENOTDIR` may read as "this directory or file is not
 * there". Any other errno means the check could not look and must report
 * "could not determine": a project nested past the platform's path limit can
 * carry the very false banner this check exists to catch, and `ENAMETOOLONG`
 * used to pass it as a repository whose banners are all true
 * (CodySwannGT/lisa#4629).
 *
 * The real `readdir` and `open` are wrapped rather than the check's
 * `readDirectory` seam, because the seam replaces the very classification under
 * test. The project on disk really carries a workflow whose template the
 * installed package no longer ships, so a case that stopped going through the
 * replaced call would name that workflow instead of producing the expected
 * line.
 * @module tests/unit/cli/doctor-stale-managed-banner-errno
 */
import * as fse from "fs-extra";
import { open, readdir } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkStaleManagedBanner } from "../../../src/cli/doctor-stale-managed-banner.js";
import {
  ABSENT_CODES,
  type FsPromises,
  realFsPromises,
  refusingAt,
  UNDETERMINABLE_CODES,
} from "../../helpers/fs-errno.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<FsPromises>();
  return {
    ...actual,
    open: vi.fn(actual.open),
    readdir: vi.fn(actual.readdir),
  };
});

/** The header a `copy-overwrite` template carries, as shipped. */
const MANAGED_HEADER = [
  "# This file is managed by Lisa and IS replaced on each `lisa` run.",
  "# Do not edit directly — durable changes belong upstream in Lisa.",
  "",
  "name: workflow",
].join("\n");

/** The workflow directory Lisa writes into. */
const WORKFLOWS = ".github/workflows";

/** Repo-relative path of the workflow whose template was removed upstream. */
const RETIRED_WORKFLOW = `${WORKFLOWS}/build.yml`;

/** What the check says when every banner has a template. */
const ALL_TRUE =
  "Every file claiming Lisa manages it still has a template in the installed package";

/**
 * Every first argument a mocked filesystem call received.
 * @param calls - The mock's recorded calls
 * @returns The paths, in call order
 */
function pathsOf(calls: readonly (readonly unknown[])[]): readonly unknown[] {
  return calls.map(([target]) => target);
}

describe("doctor stale managed-banner check — filesystem failures", () => {
  let target: string;
  let lisaRoot: string;

  beforeEach(async () => {
    target = await createTempDir();
    lisaRoot = await createTempDir();
    await fse.writeJson(path.join(target, "package.json"), {
      name: "a-consumer",
    });
    await fse.outputFile(
      path.join(lisaRoot, `all/copy-overwrite/${WORKFLOWS}/quality.yml`),
      MANAGED_HEADER
    );
    await fse.outputFile(
      path.join(target, `${WORKFLOWS}/quality.yml`),
      MANAGED_HEADER
    );
    await fse.outputFile(path.join(target, RETIRED_WORKFLOW), MANAGED_HEADER);
  });

  afterEach(async () => {
    vi.mocked(readdir).mockReset();
    vi.mocked(open).mockReset();
    await cleanupTempDir(target);
    await cleanupTempDir(lisaRoot);
  });

  describe("listing a directory Lisa writes into", () => {
    /**
     * Refuse the project's workflow directory listing with one errno.
     * @param code - Errno code to reject with
     * @returns The refused path
     */
    async function refuseListing(code: string): Promise<string> {
      const actual = await realFsPromises();
      const refused = path.join(target, WORKFLOWS);
      vi.mocked(readdir).mockImplementation(
        refusingAt(actual.readdir, refused, code)
      );
      return refused;
    }

    it.each(UNDETERMINABLE_CODES)(
      "reports could-not-determine, naming %s, when the directory cannot be listed",
      async code => {
        const refused = await refuseListing(code);

        const check = await checkStaleManagedBanner(target, lisaRoot);

        expect(pathsOf(vi.mocked(readdir).mock.calls)).toContain(refused);
        expect(check.status).toBe("warn");
        expect(check.detail.startsWith("Could not determine")).toBe(true);
        expect(check.detail).toContain(code);
      }
    );

    it.each(ABSENT_CODES)(
      "reads %s as a directory with nothing in it",
      async code => {
        const refused = await refuseListing(code);

        const check = await checkStaleManagedBanner(target, lisaRoot);

        expect(pathsOf(vi.mocked(readdir).mock.calls)).toContain(refused);
        expect(check.status).toBe("ok");
        expect(check.detail).toBe(ALL_TRUE);
      }
    );
  });

  describe("reading a file's header", () => {
    /**
     * Refuse the retired workflow's header read with one errno.
     * @param code - Errno code to reject with
     * @returns The refused path
     */
    async function refuseHeader(code: string): Promise<string> {
      const actual = await realFsPromises();
      const refused = path.join(target, RETIRED_WORKFLOW);
      vi.mocked(open).mockImplementation(
        refusingAt(actual.open, refused, code)
      );
      return refused;
    }

    it.each(UNDETERMINABLE_CODES)(
      "reports could-not-determine, naming %s, when a header cannot be read",
      async code => {
        const refused = await refuseHeader(code);

        const check = await checkStaleManagedBanner(target, lisaRoot);

        expect(pathsOf(vi.mocked(open).mock.calls)).toContain(refused);
        expect(check.status).toBe("warn");
        expect(check.detail.startsWith("Could not determine")).toBe(true);
        expect(check.detail).toContain(code);
      }
    );

    it.each(ABSENT_CODES)(
      "reads %s as a file that vanished before it was read",
      async code => {
        const refused = await refuseHeader(code);

        const check = await checkStaleManagedBanner(target, lisaRoot);

        expect(pathsOf(vi.mocked(open).mock.calls)).toContain(refused);
        expect(check.status).toBe("ok");
        expect(check.detail).toBe(ALL_TRUE);
      }
    );
  });
});
