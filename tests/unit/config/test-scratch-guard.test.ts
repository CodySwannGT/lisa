/**
 * Guards for the bounded test scratch space.
 *
 * The fix these protect is easy to remove by accident and its removal is
 * SILENT: nothing fails, the suite keeps passing, and the shared platform temp
 * directory simply starts filling again — reaching 24.8 MB and an 11-second
 * `stat` before anyone connected it to a day of unexplained test timeouts.
 *
 * So the contract is asserted at runtime rather than described in a comment.
 * Each guard below fails with a message naming the thing that broke, because
 * the failure it replaces was a 60-second timeout that named nothing.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  SCRATCH_NAMESPACE,
  parseRunRootName,
  sweepScratchNamespace,
} from "../../../src/configs/vitest/scratch.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

describe("the suite's temp directory is redirected", () => {
  it("resolves os.tmpdir() to a run root this process owns", () => {
    const tmp = os.tmpdir();

    expect(
      path.basename(path.dirname(tmp)),
      `os.tmpdir() is ${tmp}, which is not inside a ${SCRATCH_NAMESPACE} run root. ` +
        `The scratch setup file is not running: check that test.setupFiles still ` +
        `spreads scratchSetupFiles(), and that dist/ is built if the config is ` +
        `resolved from the package rather than from src.`
    ).toBe(SCRATCH_NAMESPACE);

    expect(
      parseRunRootName(path.basename(tmp)),
      `${tmp} is inside the namespace but is not a run root created by ` +
        `createRunRoot(), so the reclaim sweep will never remove it.`
    ).toEqual(expect.objectContaining({ pid: process.pid }));
  });

  it("places a fixture's own mkdtemp inside that root, which is the whole point", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "guard-fixture-"));
    try {
      expect(path.dirname(fixture)).toBe(os.tmpdir());
      expect(path.basename(path.dirname(path.dirname(fixture)))).toBe(
        SCRATCH_NAMESPACE
      );
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it("exports the redirection to child processes, so a spawned tool cannot escape it", () => {
    expect(process.env["TMPDIR"]).toBe(os.tmpdir());
    expect(process.env["TMP"]).toBe(os.tmpdir());
    expect(process.env["TEMP"]).toBe(os.tmpdir());
  });
});

describe("no test source hardcodes a platform temp path", () => {
  // Assembled from parts rather than written out, so this guard does not report
  // itself. A self-exempting allowlist would be the more usual answer and is the
  // worse one: an exemption list is a place future offenders get added, and this
  // file must have no such place.
  const sharedRoot = ["", "var", "folders", ""].join("/");

  /**
   * Lists every TypeScript file under a directory.
   * @param dir - Directory to walk
   * @returns Absolute paths of the `.ts` files found.
   */
  const collectSources = (dir: string): readonly string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "node_modules" ? [] : collectSources(full);
      }
      return entry.isFile() && entry.name.endsWith(".ts") ? [full] : [];
    });

  /**
   * Reads every test source once.
   * @returns Pairs of repo-relative path and file contents.
   */
  const readTestSources = (): readonly (readonly [string, string])[] =>
    collectSources(path.join(REPO_ROOT, "tests")).map(
      file =>
        [path.relative(REPO_ROOT, file), fs.readFileSync(file, "utf8")] as const
    );

  it("never names the macOS shared per-user temp root", () => {
    const offenders = readTestSources()
      .filter(([, source]) => source.includes(sharedRoot))
      .map(([file]) => file);

    expect(
      offenders,
      `A hardcoded ${sharedRoot} path escapes the scratch redirection entirely ` +
        "and writes straight into the shared directory this exists to protect."
    ).toEqual([]);
  });

  it("never creates a directory at a hardcoded absolute temp path", () => {
    // Matches only a creation call whose FIRST argument is an absolute temp
    // literal. Deliberately narrow: `/tmp/...` appearing in an expectation or a
    // message is fine, and a guard that flagged those would be turned off.
    const creators =
      "mkdtemp|mkdtempSync|mkdir|mkdirSync|ensureDir|ensureDirSync";
    const roots = ["/tmp", "/private/tmp", sharedRoot.slice(0, -1)]
      .map(root => root.replaceAll("/", String.raw`\/`))
      .join("|");
    const creation = new RegExp(`(?:${creators})\\(\\s*["'\`](?:${roots})`);

    const offenders = readTestSources()
      .filter(([, source]) => creation.test(source))
      .map(([file]) => file);

    expect(
      offenders,
      "A fixture created at an absolute temp path bypasses the run-scoped root, " +
        "so nothing reclaims it when the run is killed."
    ).toEqual([]);
  });
});

describe("residue from a killed run is reclaimed by the next run", () => {
  it("removes the root of a process that was SIGKILLed and keeps a live sibling's", async () => {
    const namespace = fs.mkdtempSync(path.join(os.tmpdir(), "kill-arm-"));

    // A child that creates its own run root exactly as the setup file does, then
    // reports readiness and waits. It is killed with SIGKILL, so nothing it
    // registered can run — which is precisely the case in-process cleanup
    // cannot cover and reclaim-on-start must.
    const script = `
      const fs = require("node:fs");
      const path = require("node:path");
      const root = path.join(${JSON.stringify(namespace)},
        "run-" + process.pid + "-" + Date.now() + "-" + "aaaaaa");
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, "fixture.txt"), "left behind");
      fs.writeFileSync(path.join(${JSON.stringify(namespace)}, "ready-" + process.pid), root);
      setInterval(() => {}, 1000);
    `;

    const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
    const childPid = child.pid;
    expect(childPid, "the child process failed to start").toBeDefined();

    const readyFile = path.join(namespace, `ready-${String(childPid)}`);
    const deadline = Date.now() + 20_000;
    while (!fs.existsSync(readyFile) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(
      fs.existsSync(readyFile),
      "the child never reported readiness, so this measured startup latency " +
        "rather than the reclaim behaviour under test"
    ).toBe(true);

    const abandoned = fs.readFileSync(readyFile, "utf8");
    fs.rmSync(readyFile);
    expect(fs.existsSync(abandoned)).toBe(true);

    const exited = new Promise<void>(resolve => {
      child.once("exit", () => {
        resolve();
      });
    });
    child.kill("SIGKILL");
    await exited;

    // A root owned by THIS process stands in for a sibling run still working.
    const liveSibling = path.join(
      namespace,
      `run-${String(process.pid)}-${String(Date.now())}-bbbbbb`
    );
    fs.mkdirSync(liveSibling);

    const result = sweepScratchNamespace({ dir: namespace });

    expect(
      fs.existsSync(abandoned),
      "the SIGKILLed run's root survived the next run's sweep, so a killed run " +
        "still leaks permanently"
    ).toBe(false);
    expect(result.removed).toEqual([path.basename(abandoned)]);
    expect(
      fs.existsSync(liveSibling),
      "the sweep removed a root belonging to a process that is still running"
    ).toBe(true);

    fs.rmSync(namespace, { recursive: true, force: true });
  });
});
