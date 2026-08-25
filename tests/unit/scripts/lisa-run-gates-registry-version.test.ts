/**
 * The evidence runner names the Lisa registry version in every shipped layout.
 *
 * The source template lives inside Lisa, while the managed copy runs from a
 * host project's `scripts/` directory. A location-relative manifest lookup can
 * serve one layout or the other, but not both.
 * @module tests/unit/scripts/lisa-run-gates-registry-version
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { copySync } from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { SCRIPT } from "./lisa-run-gates-fixtures.js";

const PROJECT = process.cwd();
const SCRIPTS = path.resolve("all/copy-overwrite/scripts");
const VERSION = (
  JSON.parse(readFileSync("package.json", "utf8")) as {
    version: string;
  }
).version;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** Run one layout and return the registry version it recorded. */
function recordedVersion(script: string, root: string): string | null {
  const evidence = path.join(root, "evidence.json");
  boundedSpawnSync({
    label: "lisa-run-gates registry version",
    command: process.execPath,
    args: [script, "--moment=commit", `--evidence=${evidence}`],
    cwd: root,
  });
  const envelope = JSON.parse(readFileSync(evidence, "utf8")) as {
    contract: { registry_version: string | null };
  };
  return envelope.contract.registry_version;
}

/** A throwaway caller project with a deliberately misleading host version. */
function callerRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-registry-version-"));
  roots.push(root);
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "caller-project", version: "999.0.0" })
  );
  return root;
}

describe("gate evidence registry version", () => {
  it("reads Lisa's manifest from the source-template layout", () => {
    const root = callerRoot();
    expect(recordedVersion(SCRIPT, root)).toBe(VERSION);
  });

  it("reads the installed Lisa manifest from an emitted consumer copy", () => {
    const root = callerRoot();
    const emittedScripts = path.join(root, "scripts");
    copySync(SCRIPTS, emittedScripts);
    const packageScope = path.join(root, "node_modules", "@codyswann");
    mkdirSync(packageScope, { recursive: true });
    symlinkSync(PROJECT, path.join(packageScope, "lisa"), "dir");

    expect(
      recordedVersion(path.join(emittedScripts, "lisa-run-gates.mjs"), root)
    ).toBe(VERSION);
  });
});
