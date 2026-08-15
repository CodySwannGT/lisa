/**
 * Tests for the ways the two readiness preflights could report a non-answer.
 *
 * Each case here is the same failure in a different place: something that could
 * not be determined presenting as something that was.
 *
 * - A routing value that names an inherited property (`constructor`) resolved
 *   to `Object`'s member, which is not iterable — so a typo in `tracker` threw
 *   out of `readConfig` instead of contributing nothing.
 * - A required credential with no derivable cause rendered as
 *   `NAME — required because ` and told the operator nothing.
 * - A `.lisa.config.json` that exists and does not parse derived an empty tool
 *   floor and reported `ok` — clean precisely when nothing was read.
 * - An unbounded substrate probe held session start open for as long as a hung
 *   network call lived.
 * @module tests/unit/secrets/preflight-hardening
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  requiredNames,
  report,
  runProbe,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/preflight-secrets.mjs";
import {
  routingFloor,
  routingFloorReasons,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/routing-floor.mjs";
import { readConfigRoot } from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/preflight-tools.mjs";

const CONFIG = ".lisa.config.json";
const GH_TOKEN = "GH_TOKEN";
/** Names that index an inherited member on any plain object. */
const INHERITED = ["constructor", "__proto__", "toString", "valueOf"];

const dirs: string[] = [];

/**
 * A throwaway directory, optionally holding a config file.
 * @param contents - What to write as `.lisa.config.json`; omit to write none
 * @returns The directory path
 */
const projectDir = (contents?: string): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "lisa-preflight-"));
  dirs.push(dir);
  if (contents !== undefined) writeFileSync(path.join(dir, CONFIG), contents);
  return dir;
};

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("routingFloor reads only what a vendor declared", () => {
  it("contributes nothing for a name that is an inherited property", () => {
    // The documented behavior is that an unrecognised vendor adds no
    // credential. Indexing the map directly answered these with a function or
    // with Object.prototype, and spreading either throws `not iterable` —
    // aborting config load over a typo, in the wrong vocabulary.
    for (const tracker of INHERITED) {
      expect(routingFloor({ tracker })).toEqual([]);
      expect(routingFloor({ source: tracker })).toEqual([]);
      expect(routingFloorReasons({ tracker })).toEqual({});
      expect(routingFloorReasons({ source: tracker })).toEqual({});
    }
  });

  it("still derives the credential a recognised vendor implies", () => {
    // The guard must not have been bought by dropping the real lookups.
    expect(routingFloor({ tracker: "github", source: "notion" })).toEqual([
      GH_TOKEN,
      "NOTION_API_TOKEN",
    ]);
    expect(routingFloorReasons({ tracker: "linear" })).toEqual({
      LINEAR_API_KEY: ['tracker is "linear"'],
    });
  });
});

describe("every required credential names a cause", () => {
  it("falls back to the floor when no routing reason explains the name", () => {
    const [entry] = requiredNames({ requiredFloor: [GH_TOKEN], require: [] });
    expect(entry.reasons).not.toEqual([]);
    expect(entry.name).toBe(GH_TOKEN);
  });

  it("does not read inherited routing reasons for credential names", () => {
    for (const name of INHERITED) {
      const [entry] = requiredNames({ requiredFloor: [name], require: [] });
      expect(entry).toEqual({
        name,
        reasons: ["it is in this project's resolved secrets floor"],
      });
    }
  });

  it("never renders a report that stops at 'required because'", () => {
    const text = report(
      {
        verdict: "missing",
        required: [],
        missing: requiredNames({ requiredFloor: [GH_TOKEN], require: [] }),
        reason: null,
      },
      { surface: "local", provider: "bws" }
    );
    expect(text).toContain(GH_TOKEN);
    expect(text).not.toMatch(/required because\s*$/mu);
  });

  it("still prefers the routing cause when there is one", () => {
    const [entry] = requiredNames({
      requiredFloor: [GH_TOKEN],
      require: [GH_TOKEN],
      routing: { tracker: "github" },
    });
    expect(entry.reasons).toEqual([
      'tracker is "github"',
      "declared in secrets.require",
    ]);
  });
});

describe("readConfigRoot separates absent from unreadable", () => {
  it("returns an empty config when there is no file to read", () => {
    const dir = projectDir();
    expect(existsSync(path.join(dir, CONFIG))).toBe(false);
    expect(readConfigRoot(dir)).toEqual({});
  });

  it("throws when the file exists and does not parse", () => {
    // Returning {} here derives an empty tool floor and reports `ok` — the
    // check reporting clean exactly when it could not read the declaration it
    // exists to enforce.
    const dir = projectDir("{ not json");
    expect(() => readConfigRoot(dir)).toThrow(/not readable/u);
  });

  it("reads a well-formed config unchanged", () => {
    const dir = projectDir(JSON.stringify({ tracker: "github" }));
    expect(readConfigRoot(dir)).toEqual({ tracker: "github" });
  });
});

describe("the substrate probe is bounded", () => {
  it("gives up on a command that never returns", { timeout: 20_000 }, () => {
    const started = Date.now();
    expect(runProbe({ command: "sleep", args: ["30"] })).toBe(false);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it("still answers true for a command that exits zero", () => {
    expect(runProbe({ command: "true", args: [] })).toBe(true);
  });
});
