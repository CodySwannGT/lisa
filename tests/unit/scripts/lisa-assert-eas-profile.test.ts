/**
 * Tests the EAS build-profile guard.
 *
 * Two mistakes waste a full native build and then fail the suite in a way that
 * reads as a product bug: a development-client profile (which needs a Metro
 * server CI does not have) and a profile with no channel (which lets an
 * unrelated over-the-air update replace the build mid-suite).
 *
 * The two cases worth stating outright, because a naive guard fails both:
 * `eas.json` need not be strict JSON, and a profile's settings are inherited
 * through `extends`.
 * @module tests/unit/scripts/lisa-assert-eas-profile
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseEasJson,
  problemsWith,
  resolveProfile,
} from "../../../scripts/lisa-assert-eas-profile.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "scripts",
  "lisa-assert-eas-profile.mjs"
);

/** A profile shaped like the standard Lisa ships. */
const E2E = {
  extends: "dev-base",
  developmentClient: false,
  channel: "e2e",
};

describe("parseEasJson accepts what EAS accepts", () => {
  it("reads a file with a trailing comma, which JSON.parse rejects", () => {
    // Not hypothetical: acmeorgb/frontend-v2's eas.json has one on line
    // 16, so a strict parse would crash this guard on the very repository the
    // standard was extracted from.
    const text = '{"build":{"base":{"channel":"e2e",}}}';
    expect(() => JSON.parse(text)).toThrow();
    expect(parseEasJson(text)).toEqual({
      build: { base: { channel: "e2e" } },
    });
  });

  it("reads a file with comments", () => {
    const text = `{
      // the profile the suite builds
      "build": { "dev-e2e": { "channel": "e2e" } }
    }`;
    expect(parseEasJson(text).build["dev-e2e"].channel).toBe("e2e");
  });

  it("does not mistake a URL's slashes for a comment", () => {
    const text = '{"build":{"base":{"env":{"API":"https://example.com/x"}}}}';
    expect(parseEasJson(text).build.base.env.API).toBe("https://example.com/x");
  });
});

describe("resolveProfile flattens the extends chain", () => {
  const profiles = {
    base: { channel: "default", env: { A: "1" } },
    "dev-base": { extends: "base", developmentClient: true, env: { B: "2" } },
    "dev-e2e": E2E,
  };

  it("lets the named profile win over its ancestors", () => {
    const resolved = resolveProfile(profiles, "dev-e2e");
    expect(resolved.developmentClient).toBe(false);
    expect(resolved.channel).toBe("e2e");
  });

  it("inherits what the named profile does not set", () => {
    // The case a guard reading only the named profile gets wrong.
    const resolved = resolveProfile(profiles, "dev-base");
    expect(resolved.channel).toBe("default");
  });

  it("merges env across the chain", () => {
    expect(resolveProfile(profiles, "dev-e2e").env).toEqual({
      A: "1",
      B: "2",
    });
  });

  it("names the profiles that exist when one does not", () => {
    expect(() => resolveProfile(profiles, "nope")).toThrow(/dev-e2e/);
  });

  it("refuses a cycle rather than looping forever", () => {
    expect(() =>
      resolveProfile({ a: { extends: "b" }, b: { extends: "a" } }, "a")
    ).toThrow(/extends itself/);
  });
});

describe("problemsWith judges the resolved profile", () => {
  it("passes a profile that is not a dev client and has its own channel", () => {
    expect(
      problemsWith({ developmentClient: false, channel: "e2e" }, "dev-e2e")
    ).toEqual([]);
  });

  it("fails a development client, and says why it breaks the suite", () => {
    const [problem] = problemsWith(
      { developmentClient: true, channel: "e2e" },
      "dev"
    );
    expect(problem).toMatch(/Metro server/);
  });

  it("fails a profile with no channel", () => {
    expect(problemsWith({ developmentClient: false }, "dev-e2e")).toHaveLength(
      1
    );
  });

  it("fails the shared default channel", () => {
    const [problem] = problemsWith(
      { developmentClient: false, channel: "default" },
      "dev-e2e"
    );
    expect(problem).toMatch(/over-the-air/);
  });

  it("reports every problem at once, not just the first", () => {
    expect(problemsWith({ developmentClient: true }, "dev")).toHaveLength(2);
  });

  it("catches a dev client inherited from a parent", () => {
    // The whole reason resolution happens before judgement.
    const profiles = {
      "dev-base": { developmentClient: true, channel: "e2e" },
      "dev-e2e": { extends: "dev-base" },
    };
    expect(
      problemsWith(resolveProfile(profiles, "dev-e2e"), "dev-e2e")
    ).toHaveLength(1);
  });
});

describe("the CLI", () => {
  const run = (contents: string | null, profile: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), "lisa-eas-"));
    const file = path.join(dir, "eas.json");
    if (contents !== null) writeFileSync(file, contents, "utf8");
    const result = spawnSync(
      process.execPath,
      [SCRIPT, `--file=${file}`, `--profile=${profile}`],
      { encoding: "utf8" }
    );
    rmSync(dir, { recursive: true, force: true });
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  };

  it("passes a usable profile", () => {
    const { status } = run(
      '{"build":{"dev-e2e":{"developmentClient":false,"channel":"e2e"}}}',
      "dev-e2e"
    );
    expect(status).toBe(0);
  });

  it("fails a dev-client profile", () => {
    const { status, out } = run(
      '{"build":{"dev-e2e":{"developmentClient":true,"channel":"e2e"}}}',
      "dev-e2e"
    );
    expect(status).toBe(1);
    expect(out).toContain("::error");
  });

  it("passes a project with no eas.json rather than inventing a failure", () => {
    // Not every project builds with EAS, and blocking those would fail suites
    // that never had this class of problem.
    const { status } = run(null, "dev-e2e");
    expect(status).toBe(0);
  });

  it("requires a profile name", () => {
    const result = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(`${result.stderr}`).toContain("usage:");
  });
});
