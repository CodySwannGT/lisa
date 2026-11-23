/**
 * How the always-promotable setting (CodySwannGT/lisa#5188) reaches a session:
 * `release.liveUsers` and `release.switch.mechanism` are shown resolved, with
 * the built-in default marked when the project declares nothing and an invalid
 * value stated once as INVALID with the value actually in force.
 * @module tests/unit/hooks/inject-resolved-config-release
 */
import { describe, expect, it } from "vitest";

import {
  hookRunner,
  MAIN_CONFIG,
  project,
  writeJson,
} from "../../helpers/inject-resolved-config-harness.js";

const LIVE_KEY = "release.liveUsers";
const MECHANISM_KEY = "release.switch.mechanism";
const OWNER = "owner: all/copy-overwrite/scripts/lib/release-switch.mjs";

/** Bound once here: a shared helper may not read `process.env`. */
const { contextFor } = hookRunner(process.env);

/**
 * Every rendered line for a dotted key.
 * @param context - The injected resolved-config block
 * @param key - Dotted config key
 * @returns The lines that start with the key
 */
const linesFor = (context: string, key: string): string[] =>
  context.split("\n").filter(line => line.startsWith(`${key}:`));

describe("inject-resolved-config: release setting", () => {
  it("marks an undeclared live-users value as the built-in default", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github" });

    expect(linesFor(contextFor(root), LIVE_KEY)).toEqual([
      `${LIVE_KEY}: true   [Lisa built-in default — this project declares none; ${OWNER}]`,
    ]);
  });

  it("marks an unnamed switch mechanism as the built-in fallback", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github" });

    expect(linesFor(contextFor(root), MECHANISM_KEY)).toEqual([
      `${MECHANISM_KEY}: config-value   [Lisa built-in default — this project declares none; ${OWNER}]`,
    ]);
  });

  it("shows a pre-launch project's declared opt-out as declared", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      release: { liveUsers: false },
    });

    const context = contextFor(root);

    // A declared value renders in the block's ordinary subtree form, and the
    // built-in-default line must be gone: two lines would leave the reader to
    // guess which one is in force.
    expect(context).toContain("release: liveUsers=false");
    expect(linesFor(context, LIVE_KEY)).toEqual([]);
  });

  it("shows the named mechanism and its guide", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      release: {
        switch: { mechanism: "hosted-flags", guide: "docs/flags.md" },
      },
    });
    const context = contextFor(root);

    expect(context).toContain(
      "release.switch: mechanism=hosted-flags, guide=docs/flags.md"
    );
    expect(linesFor(context, MECHANISM_KEY)).toEqual([]);
  });

  it("states an invalid live-users value once, as INVALID, with the value in force", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      release: { liveUsers: "false" },
    });

    expect(linesFor(contextFor(root), LIVE_KEY)).toEqual([
      `${LIVE_KEY}: true   [INVALID — this project declares "false", which is not true or false; treated as true (the project has live users); ${OWNER}]`,
    ]);
  });

  it("never shows a release block that is not an object as if it were in force", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, { tracker: "github", release: false });
    const context = contextFor(root);

    expect(linesFor(context, LIVE_KEY)).toEqual([
      `${LIVE_KEY}: true   [INVALID — this project declares release as false, which is not an object; treated as true (the project has live users); ${OWNER}]`,
    ]);
    expect(context).not.toContain("release: false");
  });

  it("states an invalid switch mechanism as INVALID and does not print it as in force", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      release: {
        liveUsers: false,
        switch: { mechanism: 5, guide: "docs/f.md" },
      },
    });
    const context = contextFor(root);

    expect(linesFor(context, MECHANISM_KEY)).toEqual([
      `${MECHANISM_KEY}: config-value   [INVALID — this project declares 5, which is not a non-empty string; treated as config-value; ${OWNER}]`,
    ]);
    expect(context).not.toContain("mechanism=5");
    expect(context).toContain("release: liveUsers=false");
    expect(context).toContain("release.switch: guide=docs/f.md");
  });

  it("names a key that differs only by letter case instead of showing it as a setting", () => {
    const root = project();
    writeJson(root, MAIN_CONFIG, {
      tracker: "github",
      release: { liveusers: false, switch: { mechanism: "flags", guide: 7 } },
    });
    const context = contextFor(root);

    expect(linesFor(context, LIVE_KEY)).toEqual([
      `${LIVE_KEY}: true   [INVALID — this project declares release.liveusers, which Lisa does not read (the key is release.liveUsers); treated as true (the project has live users); ${OWNER}]`,
    ]);
    expect(context).not.toContain("liveusers=false");
    expect(context).not.toContain("guide=7");
    expect(context).toContain(
      `release.switch.guide: not set   [INVALID — this project declares 7, which is not a non-empty string; treated as not set; ${OWNER}]`
    );
    expect(context).toContain("release.switch: mechanism=flags");
  });
});
