/**
 * Tests for surface-scoped `secrets.require`.
 *
 * The shape is backward compatible on purpose: an array keeps meaning "every
 * surface", so no installed project's config changes meaning under it. The
 * object form opts into scoping, and the distinction that matters most is
 * `null` versus `[]` — the first leaves resolution un-narrowed, the second
 * would declare that the project needs no secrets and make `assertDeclared`
 * reject every name.
 * @module tests/unit/secrets/require-surface-scope
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readConfig } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/surfaces.mjs";
import { validateSecrets } from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/validate-config.mjs";

/**
 * Write a `.lisa.config.json` into a throwaway directory.
 * @param config - Config object to serialise into the file
 * @returns Absolute path to the directory containing it
 */
function repoWith(config: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "lisa-require-"));
  writeFileSync(join(dir, ".lisa.config.json"), JSON.stringify(config));
  return dir;
}

const original = process.env.LISA_SECRETS_SURFACE;

beforeEach(() => {
  process.env.LISA_SECRETS_SURFACE = "local";
});

afterEach(() => {
  if (original === undefined) delete process.env.LISA_SECRETS_SURFACE;
  else process.env.LISA_SECRETS_SURFACE = original;
});

describe("require resolution", () => {
  it("keeps an array meaning every surface", () => {
    const dir = repoWith({ secrets: { require: ["ATTIO_API_KEY"] } });
    expect(readConfig(dir).require).toEqual(["ATTIO_API_KEY"]);
  });

  it("unions `all` with the current surface", () => {
    const dir = repoWith({
      secrets: {
        require: {
          all: ["GH_TOKEN"],
          local: ["ATTIO_API_KEY"],
          "claude-web": ["CLAUDE_ROUTINE_TOKEN"],
        },
      },
    });
    expect(readConfig(dir).require).toEqual(["GH_TOKEN", "ATTIO_API_KEY"]);
  });

  it("excludes names scoped to a different surface", () => {
    const dir = repoWith({
      secrets: { require: { "claude-web": ["CLAUDE_ROUTINE_TOKEN"] } },
    });
    // A laptop session must not fail over a credential only a cloud surface
    // uses; a check that fails for the wrong reason stops being believed.
    expect(readConfig(dir).require).toBeNull();
  });

  it("resolves null, not an empty array, when nothing applies", () => {
    const dir = repoWith({ secrets: { require: { "github-actions": [] } } });
    expect(readConfig(dir).require).toBeNull();
  });

  it("de-duplicates a name listed in both `all` and the surface", () => {
    const dir = repoWith({
      secrets: { require: { all: ["GH_TOKEN"], local: ["GH_TOKEN"] } },
    });
    expect(readConfig(dir).require).toEqual(["GH_TOKEN"]);
  });
});

describe("routing floor on the resolved config", () => {
  it("derives the floor from top-level routing", () => {
    const dir = repoWith({ tracker: "github", source: "notion", secrets: {} });
    expect(readConfig(dir).requiredFloor).toEqual([
      "GH_TOKEN",
      "NOTION_API_TOKEN",
    ]);
  });

  it("derives the floor even with no secrets block at all", () => {
    const dir = repoWith({ tracker: "linear" });
    expect(readConfig(dir).requiredFloor).toEqual(["LINEAR_API_KEY"]);
  });

  it("leaves require un-narrowed while still deriving a floor", () => {
    // The floor must never switch narrowing on: a project that declares no
    // `require` resolves any granted secret today and must keep doing so.
    const dir = repoWith({ tracker: "github", secrets: {} });
    const cfg = readConfig(dir);
    expect(cfg.require).toBeNull();
    expect(cfg.requiredFloor).toEqual(["GH_TOKEN"]);
  });
});

describe("validateSecrets on require", () => {
  it("accepts the array shape", () => {
    expect(validateSecrets({ require: ["GH_TOKEN"] })).toEqual([]);
  });

  it("accepts the surface-scoped shape", () => {
    expect(
      validateSecrets({ require: { all: ["GH_TOKEN"], local: ["A_KEY"] } })
    ).toEqual([]);
  });

  it("rejects an unknown surface key rather than ignoring it", () => {
    const problems = validateSecrets({
      require: { github_actions: ["GH_TOKEN"] },
    });
    expect(problems.join(" ")).toContain('"github_actions" is not a known');
  });

  it("rejects a non-UPPER_SNAKE name inside a scoped list", () => {
    const problems = validateSecrets({ require: { local: ["gh-token"] } });
    expect(problems.join(" ")).toContain("UPPER_SNAKE_CASE");
    expect(problems.join(" ")).toContain("require.local");
  });

  it("still rejects a non-array rotating", () => {
    const problems = validateSecrets({ rotating: "TOKEN" });
    expect(problems.join(" ")).toContain("must be an array");
  });
});
