/**
 * When the splash-exit opt-out is reported missing, and when it is not.
 *
 * The finding exists because Lisa ships a config plugin it cannot register —
 * the Expo plugin list is host-owned. An unregistered plugin is inert, so a
 * file that looks like a fix would sit in every consumer while the defect
 * stayed live. This check is what makes shipping the file honest.
 *
 * The cases that matter most are the ones asserting SILENCE. A check that fired
 * on every Expo project, or on every project, would satisfy the warn case while
 * being useless — and noise is how a real finding comes to be ignored. Each
 * negative case here is a separate reason for silence, so an implementation
 * that drops one is caught by name rather than by a count.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectSplashExitOptOut } from "../../../src/health/expo-splash-inspection.js";

const PLUGIN = "withAndroidSplashNoClientExit";
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway project root.
 * @param files - Relative path to contents.
 * @returns The project root.
 */
function project(files: Record<string, string>): string {
  // realpath, because the health reader resolves symlinks before its
  // containment check and macOS `tmpdir()` is /var -> /private/var. Without
  // this the reader refuses every file as escaping the root, and the check
  // reports `pass` for the wrong reason — a green that proves nothing.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "lisa-splash-")));
  created.push(root);
  for (const [name, body] of Object.entries(files))
    writeFileSync(path.join(root, name), body);
  return root;
}

/**
 * A package.json declaring the given dependencies.
 * @param deps - Dependency map.
 * @returns Serialised manifest.
 */
function manifest(deps: Record<string, string>): string {
  return `${JSON.stringify({ name: "app", dependencies: deps }, null, 2)}\n`;
}

describe("splash-exit opt-out inspection", () => {
  it("warns when expo-splash-screen is installed and the plugin is unregistered", async () => {
    const root = project({
      "package.json": manifest({ "expo-splash-screen": "^57.0.2" }),
      "app.json": JSON.stringify({ expo: { plugins: ["expo-splash-screen"] } }),
    });
    const result = await inspectSplashExitOptOut(root);
    expect(result.status).toBe("warn");
    // The finding must say Lisa CANNOT register it — a reader who thinks Lisa
    // will do it on the next apply takes no action and stays exposed.
    expect(result.reason).toContain("CANNOT register it");
    expect(result.reason).toContain("inert");
  });

  it("passes once the app config registers the plugin", async () => {
    const root = project({
      "package.json": manifest({ "expo-splash-screen": "^57.0.2" }),
      "app.config.ts": `import ${PLUGIN} from "./plugins/${PLUGIN}";\nexport default { plugins: ["expo-splash-screen", ${PLUGIN}] };\n`,
    });
    const result = await inspectSplashExitOptOut(root);
    expect(result.status).toBe("pass");
  });

  it("stays silent when expo-splash-screen is not a dependency", async () => {
    // No listener is registered, so there is nothing to clear. A check that
    // warned here would fire on every Expo project that never had the problem.
    const root = project({
      "package.json": manifest({ expo: "^54.0.0" }),
      "app.json": JSON.stringify({ expo: { plugins: [] } }),
    });
    const result = await inspectSplashExitOptOut(root);
    expect(result.status).toBe("pass");
    expect(result.reason).toContain("not a dependency");
  });

  it("stays silent on a project with no manifest at all", async () => {
    const result = await inspectSplashExitOptOut(project({}));
    expect(result.status).toBe("pass");
  });

  it("stays silent on an unreadable manifest rather than throwing", async () => {
    // `readProjectJsonObject` throws on malformed JSON. A health check whose
    // contract is to stay quiet when it cannot see must not propagate that.
    const root = project({ "package.json": "{ not json" });
    await expect(inspectSplashExitOptOut(root)).resolves.toMatchObject({
      status: "pass",
    });
  });

  it("finds the registration in app.json as well as app.config.ts", async () => {
    // Expo resolves several app-config filenames. Reading only the first would
    // report a correctly-configured project as exposed.
    const root = project({
      "package.json": manifest({ "expo-splash-screen": "^57.0.2" }),
      "app.json": JSON.stringify({
        expo: { plugins: ["expo-splash-screen", `./plugins/${PLUGIN}`] },
      }),
    });
    const result = await inspectSplashExitOptOut(root);
    expect(result.status).toBe("pass");
  });

  it("counts a devDependency as exposure", async () => {
    // The listener registers from the autolinked module regardless of which
    // dependency field declares it.
    const root = project({
      "package.json": `${JSON.stringify({
        name: "app",
        devDependencies: { "expo-splash-screen": "^57.0.2" },
      })}\n`,
      "app.json": JSON.stringify({ expo: { plugins: [] } }),
    });
    const result = await inspectSplashExitOptOut(root);
    expect(result.status).toBe("warn");
  });
});
