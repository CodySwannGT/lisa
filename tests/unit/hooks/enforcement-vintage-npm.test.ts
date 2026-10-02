/**
 * The project-pin and npm-latest rows of the session-vintage hook
 * (CodySwannGT/lisa#4325).
 *
 * The end-to-end cases drive the SHIPPED wrapper against a fabricated plugin
 * copy, the same construction `enforcement-vintage.test.ts` uses, so what is
 * asserted is the block an agent actually receives. The refresh path is driven
 * through the module with an injected spawn and fetch: no case here reaches npm.
 *
 * Two directions matter, as in the parent suite: a project behind npm must be
 * TOLD, and a current project must not be — a block that always says "behind"
 * would be a false alarm in every session on the fleet.
 * @module tests/unit/hooks/enforcement-vintage-npm.test
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  configDir,
  hookRunner,
  hostProject,
  pluginCopy,
  scratch,
} from "../../helpers/enforcement-vintage-harness.js";
import {
  cachedNpmLatest,
  needsRefresh,
  npmLatestCachePath,
  projectPin,
  refreshNpmLatest,
  renderNpmRows,
  resolveNpmState,
  startDetachedRefresh,
} from "../../../plugins/src/base/hooks/enforcement-vintage-npm.mjs";
import { isOlder } from "../../../plugins/src/base/hooks/enforcement-vintage.mjs";

/** Version the fabricated host installed. */
const PINNED = "4.40.0";
/** Version npm publishes in the fabricated cache. */
const PUBLISHED = "4.66.5";
/** A fixed clock, so freshness is deterministic. */
const NOW = Date.parse("2026-10-02T12:00:00.000Z");
/** Inside the 6-hour window. */
const FRESH_AT = "2026-10-02T10:00:00.000Z";
/** Outside it. */
const STALE_AT = "2026-10-01T10:00:00.000Z";
/** Row label for the project's installed Lisa. */
const PIN_ROW = "project pin:";
/** Row label for npm latest. */
const NPM_ROW = "npm latest:";
/** Guidance headline when the project is behind npm. */
const BEHIND = "PROJECT BEHIND";
/** The detached refresh's flag. */
const REFRESH_FLAG = "--refresh-npm-latest";

const { contextFor, runHook } = hookRunner(process.env);

/**
 * Give a project an installed Lisa.
 * @param root - Project root
 * @param version - Installed version
 * @returns The project root
 */
function install(root: string, version: string): string {
  const dir = path.join(root, "node_modules", "@codyswann", "lisa");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "@codyswann/lisa", version })
  );
  return root;
}

/**
 * Write the CLI-shaped update-check cache.
 * @param root - Project root
 * @param latest - Cached latest version
 * @param fetchedAt - Cache timestamp
 * @returns The project root
 */
function cache(root: string, latest: string, fetchedAt: string): string {
  const file = npmLatestCachePath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ latest, fetchedAt }));
  return root;
}

/**
 * The single row beginning with a label.
 * @param block - Injected context
 * @param label - Row label
 * @returns The row, or undefined
 */
function row(block: string, label: string): string | undefined {
  return block.split("\n").find(line => line.startsWith(label));
}

describe("enforcement-vintage npm rows: the shipped hook", () => {
  it("tells a session its project is behind npm, and what not to do", () => {
    const project = cache(
      install(hostProject(PINNED), PINNED),
      PUBLISHED,
      new Date().toISOString()
    );
    const block = contextFor({
      pluginRoot: pluginCopy(PUBLISHED),
      projectDir: project,
      configDir: configDir(""),
    });
    expect(row(block, PIN_ROW)).toContain(`lisa ${PINNED}`);
    expect(row(block, NPM_ROW)).toContain(`lisa ${PUBLISHED}`);
    expect(block).toContain(BEHIND);
    expect(block).toContain("Do NOT upgrade Lisa inside the current task");
    expect(block).toContain("lisa/update-*");
  });

  it("says nothing about being behind when the project matches npm", () => {
    const project = cache(
      install(hostProject(PUBLISHED), PUBLISHED),
      PUBLISHED,
      new Date().toISOString()
    );
    const block = contextFor({
      pluginRoot: pluginCopy(PUBLISHED),
      projectDir: project,
      configDir: configDir(""),
    });
    expect(row(block, PIN_ROW)).toContain(`lisa ${PUBLISHED}`);
    expect(block).not.toContain(BEHIND);
  });

  it("shows no project row inside the Lisa repository itself", () => {
    const project = install(scratch("lisa-repo"), PINNED);
    writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ name: "@codyswann/lisa", version: PUBLISHED })
    );
    cache(project, PUBLISHED, new Date().toISOString());
    const block = contextFor({
      pluginRoot: pluginCopy(PUBLISHED),
      projectDir: project,
      configDir: configDir(""),
    });
    expect(row(block, PIN_ROW)).toBeUndefined();
    expect(block).not.toContain(BEHIND);
  });

  it("still exits 0 with a block when there is no cache and no network", () => {
    const project = install(hostProject(PINNED), PINNED);
    const result = runHook({
      pluginRoot: pluginCopy(PUBLISHED),
      projectDir: project,
      configDir: configDir(""),
    });
    expect(result.status).toBe(0);
    const block = result.output.hookSpecificOutput?.additionalContext ?? "";
    expect(row(block, NPM_ROW)).toBe("npm latest: unknown");
    expect(block).not.toContain(BEHIND);
  });
});

describe("enforcement-vintage npm rows: module", () => {
  it("reads the project pin and ignores a malformed version", () => {
    const root = install(scratch("pin"), PINNED);
    expect(projectPin(root)?.version).toBe(PINNED);
    install(root, "not-a-version");
    expect(projectPin(root)).toBeNull();
    expect(projectPin(scratch("empty"))).toBeNull();
  });

  it("reads freshness from the cache timestamp", () => {
    const root = scratch("cache");
    expect(cachedNpmLatest(npmLatestCachePath(root), NOW)).toBeNull();
    cache(root, PUBLISHED, FRESH_AT);
    expect(cachedNpmLatest(npmLatestCachePath(root), NOW)).toEqual({
      version: PUBLISHED,
      fetchedAt: FRESH_AT,
      fresh: true,
    });
    cache(root, PUBLISHED, STALE_AT);
    expect(cachedNpmLatest(npmLatestCachePath(root), NOW)?.fresh).toBe(false);
    cache(root, "garbage", FRESH_AT);
    expect(cachedNpmLatest(npmLatestCachePath(root), NOW)).toBeNull();
  });

  it("refreshes only a missing or stale cache, and never when opted out", () => {
    const fresh = { version: PUBLISHED, fetchedAt: FRESH_AT, fresh: true };
    expect(needsRefresh(null, {})).toBe(true);
    expect(needsRefresh({ ...fresh, fresh: false }, {})).toBe(true);
    expect(needsRefresh(fresh, {})).toBe(false);
    expect(needsRefresh(null, { LISA_SKIP_UPDATE_CHECK: "1" })).toBe(false);
  });

  it("starts the refresh detached, so session start never waits on it", () => {
    const child = { on: vi.fn(), unref: vi.fn() };
    const spawnImpl = vi.fn(() => child);
    const started = startDetachedRefresh(
      "/x/enforcement-vintage-npm.mjs",
      "/x/cache.json",
      spawnImpl as never
    );
    expect(started).toBe(true);
    expect(spawnImpl).toHaveBeenCalledWith(
      process.execPath,
      ["/x/enforcement-vintage-npm.mjs", REFRESH_FLAG, "/x/cache.json"],
      { detached: true, stdio: "ignore" }
    );
    expect(child.unref).toHaveBeenCalled();
  });

  it("reports a spawn that throws as not started instead of throwing", () => {
    const spawnImpl = vi.fn(() => {
      throw new Error("EAGAIN");
    });
    expect(startDetachedRefresh("/a", "/b", spawnImpl as never)).toBe(false);
  });

  it("starts a refresh from the resolver only when the project has a pin", () => {
    const spawnImpl = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }));
    const none = resolveNpmState({
      projectDir: scratch("no-pin"),
      env: {},
      nowMs: NOW,
      isOlder,
      spawnImpl: spawnImpl as never,
    });
    expect(none.pin).toBeNull();
    expect(spawnImpl).not.toHaveBeenCalled();

    const behind = resolveNpmState({
      projectDir: cache(
        install(scratch("behind"), PINNED),
        PUBLISHED,
        STALE_AT
      ),
      env: {},
      nowMs: NOW,
      isOlder,
      spawnImpl: spawnImpl as never,
    });
    expect(behind).toMatchObject({ refreshing: true, projectBehind: true });
    expect(spawnImpl).toHaveBeenCalledTimes(1);
  });

  it("writes the cache in the CLI's shape on a good answer", async () => {
    const file = path.join(scratch("refresh"), "nested", "update-check.json");
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: PUBLISHED }),
    }));
    const written = await refreshNpmLatest(file, {
      fetchImpl: fetchImpl as never,
      now: () => new Date(NOW),
    });
    expect(written).toBe(PUBLISHED);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      latest: PUBLISHED,
      fetchedAt: new Date(NOW).toISOString(),
    });
  });

  it("writes nothing on an error status, a bad body, or a thrown fetch", async () => {
    const file = path.join(scratch("refresh-bad"), "update-check.json");
    const answers = [
      async () => ({ ok: false, json: async () => ({}) }),
      async () => ({ ok: true, json: async () => ({ version: "nope" }) }),
      async () => {
        throw new Error("offline");
      },
    ];
    for (const answer of answers) {
      expect(
        await refreshNpmLatest(file, { fetchImpl: vi.fn(answer) as never })
      ).toBeNull();
    }
    expect(() => readFileSync(file, "utf8")).toThrow();
  });

  it("labels a stale reading and a pending refresh in the row", () => {
    const { rows } = renderNpmRows({
      pin: { version: PINNED, source: "/p" },
      latest: { version: PUBLISHED, fetchedAt: STALE_AT, fresh: false },
      refreshing: true,
      projectBehind: true,
    });
    expect(rows[1]).toBe(
      `npm latest: lisa ${PUBLISHED} (checked ${STALE_AT}; stale, refreshing for the next session)`
    );
  });
});
