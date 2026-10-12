/**
 * The validator reads `sessionManager` the way the runtime does: local over
 * committed, per key, deep for plain objects, arrays replaced.
 *
 * `config-resolution` documents `.lisa.config.local.json` as overriding the
 * committed file per key. The validator CLI once read only the committed file,
 * so a bad local override (a `capacity.maxWorkers` of 0, a credential pasted
 * into the local block) passed `validate` and only failed at runtime. Every
 * other block keeps its committed-file-only behaviour.
 * @module tests/unit/secrets/validate-config-local-merge
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import {
  mergeConfigLayers,
  readValidationConfig,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";

const SCRIPT = path.resolve(
  "plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs"
);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Make a project dir holding the given config files.
 * @param committed - `.lisa.config.json` contents, or undefined to omit it
 * @param local - `.lisa.config.local.json` contents, or undefined to omit it
 * @returns Project root
 */
function project(committed?: unknown, local?: unknown): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "lisa-vc-"));
  roots.push(root);
  if (committed !== undefined) {
    writeFileSync(
      path.join(root, ".lisa.config.json"),
      JSON.stringify(committed)
    );
  }
  if (local !== undefined) {
    writeFileSync(
      path.join(root, ".lisa.config.local.json"),
      JSON.stringify(local)
    );
  }
  return root;
}

const MANAGER = {
  name: "repo-a-manager",
  capacity: { maxWorkers: 6, gbPerWorker: 3 },
  repos: { root: "projects", entries: { api: { hints: ["NestJS"] } } },
  notify: { provider: "telegram", stateDir: "~/.claude/channels/telegram-a" },
};

describe("mergeConfigLayers", () => {
  it("merges plain objects deeply and replaces arrays and scalars", () => {
    expect(
      mergeConfigLayers(
        { a: { b: 1, c: [1, 2], d: { e: 1 } }, f: 1 },
        { a: { c: [3], d: { g: 2 } }, f: 2 }
      )
    ).toEqual({ a: { b: 1, c: [3], d: { e: 1, g: 2 } }, f: 2 });
  });

  it("drops prototype keys", () => {
    const merged = mergeConfigLayers(JSON.parse('{"__proto__":{"x":1},"y":1}'));
    expect(merged).toEqual({ y: 1 });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe("readValidationConfig", () => {
  it("returns null when neither file exists", () => {
    expect(readValidationConfig(project())).toBeNull();
  });

  it("merges sessionManager local over committed, per nested key", () => {
    const root = project(
      { sessionManager: MANAGER },
      { sessionManager: { capacity: { maxWorkers: 2 } } }
    );
    expect(readValidationConfig(root)?.sessionManager).toEqual({
      ...MANAGER,
      capacity: { maxWorkers: 2, gbPerWorker: 3 },
    });
  });

  it("reads a sessionManager block declared only in the local file", () => {
    const root = project({}, { sessionManager: MANAGER });
    expect(readValidationConfig(root)?.sessionManager).toEqual(MANAGER);
  });

  it("leaves every other block committed-file-only", () => {
    const root = project(
      { automations: { a: 1 } },
      { automations: { b: 2 }, secrets: { x: 1 } }
    );
    const cfg = readValidationConfig(root);
    expect(cfg?.automations).toEqual({ a: 1 });
    expect(cfg?.secrets).toBeUndefined();
    expect(cfg?.sessionManager).toBeUndefined();
  });
});

describe("validate-config CLI", () => {
  it("fails on a bad local sessionManager override", () => {
    const root = project(
      { sessionManager: MANAGER },
      { sessionManager: { capacity: { maxWorkers: 0 } } }
    );
    const result = boundedSpawnSync({
      label: "validate-config",
      command: process.execPath,
      args: [SCRIPT],
      cwd: root,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/maxWorkers/);
  });

  it("passes the same committed block with no override", () => {
    const result = boundedSpawnSync({
      label: "validate-config",
      command: process.execPath,
      args: [SCRIPT],
      cwd: project({ sessionManager: MANAGER }),
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
