/**
 * Behaviour suite for the session-vintage hook (CodySwannGT/lisa#3714).
 *
 * Every case here drives a FABRICATED SESSION-EQUIVALENT: a real plugin
 * directory on disk, at a chosen version, holding a real copy of the shipped
 * script and renderer. That construction is the point. The defect is that a
 * session runs one resolved copy of Lisa for its whole life while the
 * repository moves on, and a suite that imported the renderer out of the
 * checkout would test the copy that is never the one in force.
 *
 * The two decisive cases are opposite in direction, because the defect was
 * measured in both: a stale copy must SAY it is stale, and a current copy must
 * not. A suite holding only the first is satisfied by a mechanism that shouts
 * unconditionally, which would be a false alarm on every session on the fleet.
 * @module tests/unit/hooks/enforcement-vintage.test
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  bothTreesProject,
  configDir,
  contextFromLoadedCopy,
  hookRunner,
  hostProject,
  pluginCopy,
  scratch,
} from "../../helpers/enforcement-vintage-harness.js";
import {
  isOlder,
  newestOf,
  readJsonVersion,
  releaseFields,
} from "../../../plugins/src/base/hooks/enforcement-vintage.mjs";

/** Bound once here: a shared helper may not read `process.env`. */
const { contextFor, runHook } = hookRunner(process.env);

describe("enforcement-vintage: a stale session says so", () => {
  it("reports the gap the fleet actually measured", () => {
    // The measured lane: eleven hours old, executing 4.32.2, with 4.35.1 sitting
    // in the same cache. Not a distribution failure — the newer copy had
    // arrived and could not be reached.
    const context = contextFor({
      pluginRoot: pluginCopy("4.32.2"),
      projectDir: scratch("empty"),
      configDir: configDir("4.35.1"),
    });

    expect(context).toContain("STALE");
    expect(context).toContain("lisa 4.32.2");
    expect(context).toContain("lisa 4.35.1");
  });

  it("names the two errors the gap produced, in both directions", () => {
    const context = contextFor({
      pluginRoot: pluginCopy("4.32.2"),
      projectDir: scratch("empty"),
      configDir: configDir("4.35.1"),
    });

    // Direction one: a defect read out of a stale copy and filed as live.
    expect(context).toContain("may already be fixed or superseded");
    // Direction two: a superseded contract read as current.
    expect(context).toMatch(/git show origin\/main:/u);
    // And the generalisation both collapse into.
    expect(context).toContain("Merge ancestry proves a fix EXISTS");
  });

  it("says the only thing that re-resolves the copy is a new session", () => {
    const context = contextFor({
      pluginRoot: pluginCopy("4.32.2"),
      projectDir: scratch("empty"),
      configDir: configDir("4.35.1"),
    });

    expect(context).toContain("Only starting a new session re-resolves");
  });
});

describe("enforcement-vintage: a current session does not", () => {
  it("reports clean when nothing newer is on the disk", () => {
    const context = contextFor({
      pluginRoot: pluginCopy("4.35.1"),
      projectDir: scratch("empty"),
      configDir: configDir("4.35.1"),
    });

    expect(context).toContain("CURRENT");
    expect(context).not.toContain("STALE");
  });

  it("does not call a copy stale for being AHEAD of the marketplace", () => {
    // The default state of a checkout minutes after a release is cut. Claiming
    // staleness here would make the signal permanently true and therefore
    // permanently ignored.
    const context = contextFor({
      pluginRoot: pluginCopy("4.36.0"),
      projectDir: scratch("empty"),
      configDir: configDir("4.35.1"),
    });

    expect(context).toContain("CURRENT");
    expect(context).not.toContain("STALE");
  });

  it("still names the running version, so a current session can cite it", () => {
    const context = contextFor({
      pluginRoot: pluginCopy("4.35.1"),
      projectDir: scratch("empty"),
      configDir: configDir("4.35.1"),
    });

    expect(context).toContain("lisa 4.35.1");
  });
});

describe("enforcement-vintage: an undateable copy is not a current one", () => {
  it("reports UNPROVEN rather than staying quiet", () => {
    // A copy with no manifest beside it cannot be shown current, and reading it
    // as current is exactly how a stale copy stays invisible.
    const context = contextFor({
      pluginRoot: pluginCopy(""),
      projectDir: scratch("empty"),
      configDir: configDir("4.35.1"),
    });

    expect(context).toContain("UNPROVEN");
    expect(context).toContain("vintage unknown");
    expect(context).not.toContain("CURRENT");
  });
});

describe("enforcement-vintage: the repository guard tree", () => {
  it("dates a host tree from the apply receipt and names its repair", () => {
    const context = contextFor({
      pluginRoot: pluginCopy("4.35.1"),
      projectDir: hostProject("4.23.26"),
      configDir: configDir("4.35.1"),
    });

    expect(context).toContain("repository guards");
    expect(context).toContain("lisa 4.23.26");
    expect(context).toContain("BEHIND");
    expect(context).toContain("lisa apply");
  });

  it("reports the tree IN FORCE, not the newest tree present", () => {
    // Both trees exist and `scripts/lisa-hooks/` shadows the other outright, so
    // the shadowed copy never runs however new it is. Reporting the newest of
    // the two would describe a tree that enforces nothing — the exact reading
    // error this whole mechanism exists to stop.
    const context = contextFor({
      pluginRoot: pluginCopy("4.35.1"),
      projectDir: bothTreesProject("4.23.26", "4.35.1"),
      configDir: configDir("4.35.1"),
    });

    expect(context).toContain("scripts/lisa-hooks");
    expect(context).toContain("lisa 4.23.26");
    expect(context).not.toContain("plugins/lisa/hooks");
  });

  it("omits the row entirely when no guard tree resolves", () => {
    const context = contextFor({
      pluginRoot: pluginCopy("4.35.1"),
      projectDir: scratch("empty"),
      configDir: configDir("4.35.1"),
    });

    expect(context).not.toContain("repository guards");
  });
});

describe("enforcement-vintage: the envelope", () => {
  it("always renders a block, so silence can never mean current", () => {
    const run = runHook({
      pluginRoot: pluginCopy("4.35.1"),
      projectDir: scratch("empty"),
      configDir: configDir(""),
      input: { hook_event_name: "SessionStart" },
    });

    expect(run.status).toBe(0);
    expect(run.output.hookSpecificOutput?.additionalContext).toContain(
      "<lisa-enforcement-vintage>"
    );
  });

  it("echoes the event it was fired for, so SubagentStart is not mislabelled", () => {
    const run = runHook({
      pluginRoot: pluginCopy("4.35.1"),
      projectDir: scratch("empty"),
      configDir: configDir("4.35.1"),
      input: { hook_event_name: "SubagentStart" },
    });

    expect(run.output.hookSpecificOutput?.hookEventName).toBe("SubagentStart");
  });

  it("exits 0 on an unparseable payload rather than wedging session start", () => {
    const run = runHook({
      pluginRoot: pluginCopy("4.35.1"),
      projectDir: scratch("empty"),
      configDir: configDir("4.35.1"),
    });

    expect(run.status).toBe(0);
  });
});

describe("enforcement-vintage: the vintage is observed, not claimed", () => {
  it("dates the copy it was LOADED from, ignoring a contradicting variable", () => {
    // `CLAUDE_PLUGIN_ROOT` is a claim the harness makes; the directory the file
    // was loaded out of is not a claim at all. A vintage read from the variable
    // would be exactly as trustworthy as the environment that has been wrong
    // for eleven hours at a time.
    const context = contextFromLoadedCopy(process.env, {
      loadedCopy: pluginCopy("4.32.2"),
      claimedRoot: pluginCopy("4.35.1"),
      configDir: configDir("4.35.1"),
    });

    expect(context).toContain("lisa 4.32.2");
    expect(context).toContain("STALE");
  });
});

describe("enforcement-vintage: version arithmetic", () => {
  it("orders releases by field, not by string", () => {
    // "4.9.4" sorts after "4.35.1" lexically and before it numerically. A
    // string comparison here would report a genuinely stale copy as current.
    expect(isOlder("4.9.4", "4.35.1")).toBe(true);
    expect(isOlder("4.35.1", "4.9.4")).toBe(false);
  });

  it("ignores prerelease and build suffixes", () => {
    expect(isOlder("4.35.1-rc.1", "4.35.1")).toBe(false);
    expect(isOlder("4.35.1+build.9", "4.35.2")).toBe(true);
  });

  it("treats an unparseable field as zero, never as newer", () => {
    expect(releaseFields("4.x.1")).toEqual([4, 0, 1]);
    expect(isOlder("4.35.1", "nonsense")).toBe(false);
  });

  it("takes a maximum over local evidence rather than one reference", () => {
    // In the Lisa monorepo `node_modules/@codyswann/lisa` is a fixture pinned
    // majors behind the repository. Nominating it as "the installed release"
    // would report every current checkout as ahead and never report a stale one.
    expect(
      newestOf([
        { version: "2.1.0", source: "node_modules" },
        { version: "4.35.1", source: "marketplace" },
        { version: "", source: "absent" },
      ])
    ).toEqual({ version: "4.35.1", source: "marketplace" });
  });

  it("returns null when nothing on the disk is dateable", () => {
    expect(newestOf([{ version: "", source: "absent" }])).toBeNull();
  });
});

describe("enforcement-vintage: reading a manifest", () => {
  it("refuses a nested version key, which would report a dependency range", () => {
    // `node_modules/@codyswann/lisa/package.json` carries `"version"` keys
    // inside its dependency block. An unanchored first-match reads one of those
    // as Lisa's own version.
    const file = path.join(scratch("manifest"), "package.json");
    writeFileSync(
      file,
      '{\n  "dependencies": {\n    "some-package": {\n      "version": "9.9.9"\n    }\n  },\n  "version": "4.35.1"\n}\n',
      "utf8"
    );

    expect(readJsonVersion(file, "version")).toBe("4.35.1");
  });

  it("returns empty for a file that is not there", () => {
    expect(readJsonVersion("/nonexistent/plugin.json", "version")).toBe("");
  });
});
