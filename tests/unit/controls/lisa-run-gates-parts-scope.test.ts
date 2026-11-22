/**
 * Where a part's command is allowed to start.
 *
 * The declaration is a committed file that names commands, and a part's
 * `scope` decides the folder its command starts in. The folder is resolved on
 * disk, links included, and the command starts only when what it resolves to
 * is a folder inside the repository. Anything else is reported against the
 * part, blocks like any other unproved gate, and starts nothing.
 * @module tests/unit/controls/lisa-run-gates-parts-scope
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { STATE } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  API,
  API_ARGV,
  type ArgvExecutor,
  LINT,
  partGates,
  partLine,
  partRow,
  type PartsRepository,
  partsRepository,
  type PartsRun,
  runParts,
  WEB,
  WEB_ARGV,
} from "./support/lisa-run-gates-parts-fixtures.js";
import { createSymlink } from "../../support/borrowed-node-modules.mjs";

/** A folder name the fixture repository never holds. */
const GONE = "gone";

/** A name inside the repository that is a link, not a folder. */
const LINKED = "linked";

describe("the folder a part's command starts in", () => {
  let repository: PartsRepository;
  let outside: string;
  let execArgv: ReturnType<typeof vi.fn<ArgvExecutor>>;

  /**
   * Run one gate whose first part covers `scope` and whose second covers web.
   * @param scope - The first part's folder
   * @returns The run
   */
  const runWith = (scope: string): PartsRun =>
    runParts({
      execArgv,
      gates: partGates([
        { scope, command: API_ARGV },
        { scope: WEB, command: WEB_ARGV },
      ]),
      root: repository.root,
    });

  beforeEach(() => {
    repository = partsRepository();
    outside = mkdtempSync(path.join(tmpdir(), "lisa-parts-outside-"));
    execArgv = vi.fn<ArgvExecutor>(() => ({ code: 0, output: "" }));
  });

  afterEach(() => {
    repository.cleanup();
    rmSync(outside, { force: true, recursive: true });
  });

  it("reports a folder that does not exist against the part, and starts nothing there", () => {
    const run = runWith(GONE);
    const row = partRow(run, GONE);

    expect(row.state).toBe(STATE.UNPROVABLE);
    expect(row.code).toBeNull();
    expect(partLine(run, `${LINT} in ${GONE}`)).toContain(
      `the folder "${GONE}" does not exist`
    );
    expect(run.transcript).toContain(`gate NOT PROVED: ${LINT} in ${GONE}`);
    expect(run.result.blocked).toBe(true);
    expect(run.result.passed.map(entry => entry.scope)).toEqual([WEB]);
    // The other part still ran, in its own folder.
    expect(execArgv.mock.calls.map(([, context]) => context.cwd)).toEqual([
      path.join(repository.root, WEB),
    ]);
  });

  it("refuses a scope that is a file", () => {
    writeFileSync(path.join(repository.root, "README"), "not a folder\n");

    const run = runWith("README");

    expect(partRow(run, "README").state).toBe(STATE.UNPROVABLE);
    expect(partLine(run, `${LINT} in README`)).toContain("is not a folder");
    expect(execArgv).toHaveBeenCalledTimes(1);
  });

  it("refuses a scope that is a link leading outside the repository", () => {
    createSymlink(outside, path.join(repository.root, LINKED), "dir");

    const run = runWith(LINKED);

    expect(partRow(run, LINKED).state).toBe(STATE.UNPROVABLE);
    expect(partLine(run, `${LINT} in ${LINKED}`)).toContain(
      "outside this repository"
    );
    expect(run.result.blocked).toBe(true);
    expect(execArgv.mock.calls.map(([, context]) => context.cwd)).toEqual([
      path.join(repository.root, WEB),
    ]);
  });

  it("refuses a folder reached through a link that leaves the repository", () => {
    mkdirSync(path.join(outside, "nested"));
    createSymlink(outside, path.join(repository.root, LINKED), "dir");

    const run = runWith(`${LINKED}/nested`);

    expect(partRow(run, `${LINKED}/nested`).state).toBe(STATE.UNPROVABLE);
    expect(execArgv).toHaveBeenCalledTimes(1);
  });

  it("starts in the real folder when a link stays inside the repository", () => {
    createSymlink(
      path.join(repository.root, API),
      path.join(repository.root, LINKED),
      "dir"
    );

    const run = runWith(LINKED);

    expect(partRow(run, LINKED).state).toBe(STATE.PASSED);
    expect(execArgv.mock.calls[0]?.[1].cwd).toBe(
      path.join(repository.root, API)
    );
  });

  it("counts a part it never started among the ones this run did not prove", () => {
    const run = runWith(GONE);

    expect(run.result.failed.map(entry => entry.scope)).toEqual([GONE]);
    expect(run.result.unprovable.map(entry => entry.scope)).toEqual([GONE]);
    expect(run.result.killed).toEqual([]);
  });
});
