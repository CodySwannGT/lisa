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
  pluginTreeProject,
  scratch,
} from "../../helpers/enforcement-vintage-harness.js";
import {
  isOlder,
  newestOf,
  readJsonVersion,
  releaseFields,
} from "../../../plugins/src/base/hooks/enforcement-vintage.mjs";

/** The version the fabricated stale session executes. */
const STALE_VERSION = "4.32.2";
/** The version sitting unreachable on the same fabricated disk. */
const NEWEST_VERSION = "4.35.1";
/** The vintage a `lisa apply` receipt records for the host guard tree. */
const TREE_VERSION = "4.23.26";
/** Row label for the tree the repository hook dispatcher would resolve. */
const GUARDS_ROW = "repository guards";
/** Row label for the copy the session itself executes. */
const SESSION_ROW = "session copy";
/** Row label for the newest Lisa demonstrably on the disk. */
const NEWEST_ROW = "newest on this disk";

/** Bound once here: a shared helper may not read `process.env`. */
const { contextFor, runHook } = hookRunner(process.env);

/**
 * One labelled row of the block.
 *
 * Assertions land on the ROW rather than on the whole block, because the block
 * repeats the same version numbers and the same remedies in several places. A
 * `toContain` against the whole text is satisfied by any of them — which is how
 * six mutants survived a first pass here, including one that gave the host tree
 * the wrong repair while a consequence line kept the expected phrase on screen.
 * @param context - The rendered block
 * @param label - Row prefix, e.g. "repository guards"
 * @returns That row, or "" when it is absent
 */
function row(context: string, label: string): string {
  return context.split("\n").find(line => line.startsWith(`${label}:`)) ?? "";
}

describe("enforcement-vintage: a stale session says so", () => {
  it("reports the gap the fleet actually measured", () => {
    // The measured lane: eleven hours old, executing 4.32.2, with 4.35.1 sitting
    // in the same cache. Not a distribution failure — the newer copy had
    // arrived and could not be reached.
    const context = contextFor({
      pluginRoot: pluginCopy(STALE_VERSION),
      projectDir: scratch("empty"),
      configDir: configDir(NEWEST_VERSION),
    });

    expect(context).toContain("STALE");
    expect(row(context, SESSION_ROW)).toContain(`lisa ${STALE_VERSION}`);
    expect(row(context, NEWEST_ROW)).toContain(`lisa ${NEWEST_VERSION}`);
  });

  it("names WHERE the unreachable newer copy is, not just its number", () => {
    // The number alone is not actionable. The path is what tells an operator
    // whether a restart would pick the newer copy up, or whether the newer Lisa
    // is somewhere a restart never looks.
    const marketplace = configDir(NEWEST_VERSION);
    const context = contextFor({
      pluginRoot: pluginCopy(STALE_VERSION),
      projectDir: scratch("empty"),
      configDir: marketplace,
    });

    expect(row(context, NEWEST_ROW)).toContain(
      path.join(marketplace, "plugins", "marketplaces", "lisa")
    );
  });

  it("names the directory the session copy was loaded from", () => {
    // Two cached copies can declare versions that a `git log` cannot tell
    // apart. The path is the only thing that identifies WHICH copy this is.
    const copy = pluginCopy(STALE_VERSION);
    const context = contextFor({
      pluginRoot: copy,
      projectDir: scratch("empty"),
      configDir: configDir(NEWEST_VERSION),
    });

    expect(row(context, SESSION_ROW)).toContain(path.basename(copy));
  });

  it("names the two errors the gap produced, in both directions", () => {
    const context = contextFor({
      pluginRoot: pluginCopy(STALE_VERSION),
      projectDir: scratch("empty"),
      configDir: configDir(NEWEST_VERSION),
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
      pluginRoot: pluginCopy(STALE_VERSION),
      projectDir: scratch("empty"),
      configDir: configDir(NEWEST_VERSION),
    });

    expect(context).toContain("Only starting a new session re-resolves");
  });
});

describe("enforcement-vintage: a current session does not", () => {
  it("reports clean when nothing newer is on the disk", () => {
    const context = contextFor({
      pluginRoot: pluginCopy(NEWEST_VERSION),
      projectDir: scratch("empty"),
      configDir: configDir(NEWEST_VERSION),
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
      configDir: configDir(NEWEST_VERSION),
    });

    expect(context).toContain("CURRENT");
    expect(context).not.toContain("STALE");
  });

  it("counts the running copy as evidence of what is on the disk", () => {
    // Nothing else is dateable here — no marketplace clone, no project. If the
    // running copy is not folded into the maximum there is no reference at all,
    // the row disappears, and a current session becomes indistinguishable from
    // one that could not be dated.
    const context = contextFor({
      pluginRoot: pluginCopy(NEWEST_VERSION),
      projectDir: scratch("empty"),
      configDir: configDir(""),
    });

    expect(row(context, NEWEST_ROW)).toContain(`lisa ${NEWEST_VERSION}`);
    expect(context).toContain("CURRENT");
  });

  it("still names the running version, so a current session can cite it", () => {
    const context = contextFor({
      pluginRoot: pluginCopy(NEWEST_VERSION),
      projectDir: scratch("empty"),
      configDir: configDir(NEWEST_VERSION),
    });

    expect(context).toContain(`lisa ${NEWEST_VERSION}`);
  });
});

describe("enforcement-vintage: an undateable copy is not a current one", () => {
  it("reports UNPROVEN rather than staying quiet", () => {
    // A copy with no manifest beside it cannot be shown current, and reading it
    // as current is exactly how a stale copy stays invisible.
    const context = contextFor({
      pluginRoot: pluginCopy(""),
      projectDir: scratch("empty"),
      configDir: configDir(NEWEST_VERSION),
    });

    expect(context).toContain("UNPROVEN");
    expect(context).toContain("vintage unknown");
    expect(context).not.toContain("CURRENT");
  });
});

describe("enforcement-vintage: the repository guard tree", () => {
  it("dates a host tree from the apply receipt and names its repair", () => {
    const context = contextFor({
      pluginRoot: pluginCopy(NEWEST_VERSION),
      projectDir: hostProject(TREE_VERSION),
      configDir: configDir(NEWEST_VERSION),
    });

    const guards = row(context, GUARDS_ROW);

    expect(guards).toContain(`lisa ${TREE_VERSION}`);
    expect(guards).toContain("BEHIND");
    // On the ROW, not in the block: the stale-session consequences also mention
    // `lisa apply`, so a whole-block assertion passes even when the row carries
    // the wrong tree's remedy.
    expect(guards).toContain("npx @codyswann/lisa apply");
  });

  it("gives the monorepo's own tree the remedy that applies to it", () => {
    // `lisa apply` does not touch `plugins/lisa/hooks/` — that tree IS the
    // checkout's source. Printing the host remedy there hands half the fleet an
    // instruction that changes nothing.
    const guards = row(
      contextFor({
        pluginRoot: pluginCopy(NEWEST_VERSION),
        projectDir: pluginTreeProject(TREE_VERSION),
        configDir: configDir(NEWEST_VERSION),
      }),
      GUARDS_ROW
    );

    expect(guards).toContain("plugins/lisa/hooks");
    expect(guards).not.toContain("npx @codyswann/lisa apply");
    expect(guards).toContain("own source");
  });

  it("measures tree staleness against the disk, not against the session copy", () => {
    // The session copy is older than the tree here. Comparing the tree to the
    // session copy would report a nine-minor-old tree as fine, which is the
    // reading the ticket was filed over.
    const guards = row(
      contextFor({
        pluginRoot: pluginCopy("4.20.0"),
        projectDir: hostProject(TREE_VERSION),
        configDir: configDir(NEWEST_VERSION),
      }),
      GUARDS_ROW
    );

    expect(guards).toContain(`lisa ${TREE_VERSION}`);
    expect(guards).toContain("BEHIND");
  });

  it("reports the tree IN FORCE, not the newest tree present", () => {
    // Both trees exist and `scripts/lisa-hooks/` shadows the other outright, so
    // the shadowed copy never runs however new it is. Reporting the newest of
    // the two would describe a tree that enforces nothing — the exact reading
    // error this whole mechanism exists to stop.
    const context = contextFor({
      pluginRoot: pluginCopy(NEWEST_VERSION),
      projectDir: bothTreesProject("4.23.26", "4.35.1"),
      configDir: configDir(NEWEST_VERSION),
    });

    expect(context).toContain("scripts/lisa-hooks");
    expect(context).toContain(`lisa ${TREE_VERSION}`);
    expect(context).not.toContain("plugins/lisa/hooks");
  });

  it("omits the row entirely when no guard tree resolves", () => {
    const context = contextFor({
      pluginRoot: pluginCopy(NEWEST_VERSION),
      projectDir: scratch("empty"),
      configDir: configDir(NEWEST_VERSION),
    });

    expect(context).not.toContain(GUARDS_ROW);
  });
});

describe("enforcement-vintage: the envelope", () => {
  it("always renders a block, so silence can never mean current", () => {
    const run = runHook({
      pluginRoot: pluginCopy(NEWEST_VERSION),
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
      pluginRoot: pluginCopy(NEWEST_VERSION),
      projectDir: scratch("empty"),
      configDir: configDir(NEWEST_VERSION),
      input: { hook_event_name: "SubagentStart" },
    });

    expect(run.output.hookSpecificOutput?.hookEventName).toBe("SubagentStart");
  });

  it("exits 0 on an unparseable payload rather than wedging session start", () => {
    const run = runHook({
      pluginRoot: pluginCopy(NEWEST_VERSION),
      projectDir: scratch("empty"),
      configDir: configDir(NEWEST_VERSION),
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
      loadedCopy: pluginCopy(STALE_VERSION),
      claimedRoot: pluginCopy(NEWEST_VERSION),
      configDir: configDir(NEWEST_VERSION),
    });

    expect(context).toContain(`lisa ${STALE_VERSION}`);
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
