/**
 * Contract tests for per-platform toolchain pins.
 *
 * A download URL names one platform's artifact and a checksum names one exact
 * file, so the single-URL shape could not express a tool that ships different
 * builds. The only guard available was `surfaces: ["remote"]`, which bought
 * safety by making the tool uninstallable on a laptop entirely — so `bws` and
 * `gh`, the two CLIs Lisa's own guardrails shell out to, were declared,
 * required, and unprovisionable on the machine most likely to lack them.
 *
 * Everything below is exercised through injected probes and explicit platform
 * keys, so no test depends on the machine it runs on. That matters more here
 * than usual: a platform-resolution bug that only appears on a platform CI does
 * not run is exactly the bug this shape exists to prevent.
 * @module tests/unit/secrets/toolchain-platforms
 */
import { describe, expect, it } from "vitest";

import {
  assertPinned,
  currentPlatform,
  planToolchain,
  resolvePlatform,
} from "../../../plugins/src/base/skills/lisa-setup-remote-env/scripts/toolchain.mjs";

/** The two platform keys every case below resolves against. */
const LINUX = "linux-x64";
const MAC = "darwin-arm64";

/** The two archive kinds, which gh really does split between platforms. */
const TAR = "release-tar";
const ZIP = "release-zip";

/** The macOS artifact, asserted by URL in several cases. */
const MAC_URL = "https://example.test/gh_macOS_arm64.zip";

/** A tool shipping a different archive kind per platform, as gh really does. */
const GH = {
  name: "gh",
  version: "2.83.0",
  platforms: {
    [LINUX]: {
      install: TAR,
      url: "https://example.test/gh_linux_amd64.tar.gz",
      sha256: "a".repeat(64),
      binary: "gh_2.83.0_linux_amd64/bin/gh",
    },
    [MAC]: {
      install: ZIP,
      url: MAC_URL,
      sha256: "b".repeat(64),
      binary: "gh_2.83.0_macOS_arm64/bin/gh",
    },
  },
};

/**
 * A probe reporting everything absent, so plans reflect the manifest only.
 * @returns A uniform "not installed" result.
 */
const ABSENT = () => ({ present: false, version: null });

/** A manifest entry, however many platforms it names. */
type Entry = Record<string, unknown>;

/** One decision the planner reached, with the entry it resolved. */
type Step = { action: string; reason: string; tool?: Entry };

/**
 * Resolve an entry and type the result.
 *
 * The planner is plain JavaScript with JSDoc, so it promises `object` and
 * nothing narrower. Casting once here keeps every assertion below readable.
 * @param platform Platform key to resolve for.
 * @returns The resolved entry.
 */
const ghOn = (platform: string): Entry =>
  resolvePlatform(GH, platform) as Entry;

/**
 * Plan a manifest and type the decisions.
 * @param tools Toolchain manifest.
 * @param probe Version probe.
 * @param surface Surface being provisioned.
 * @param platform Platform key to resolve against.
 * @returns The planned decisions.
 */
const planOn = (
  tools: Record<string, unknown>,
  probe: () => { present: boolean; version: string | null },
  surface: string,
  platform: string
): Step[] => planToolchain(tools, probe, surface, platform) as Step[];

describe("platform resolution", () => {
  it("selects the block for the named platform", () => {
    expect(ghOn(MAC).url).toBe(MAC_URL);
    expect(ghOn(MAC).sha256).toBe("b".repeat(64));
  });

  it("carries the install method from the block, not the entry", () => {
    // gh publishes a tarball for Linux and a zip for macOS. A single method
    // beside the platforms map would force one of them onto an archive kind its
    // vendor does not ship.
    expect(ghOn(LINUX).install).toBe(TAR);
    expect(ghOn(MAC).install).toBe(ZIP);
  });

  it("keeps the shared fields the block does not override", () => {
    expect(ghOn(LINUX).version).toBe("2.83.0");
    expect(ghOn(LINUX).name).toBe("gh");
  });

  it("drops the platforms map, so a resolved entry looks like a flat one", () => {
    // This is what lets assertPinned and both installers stay unaware that
    // per-platform pins exist at all.
    expect(ghOn(LINUX).platforms).toBeUndefined();
  });

  it("passes a flat entry through untouched", () => {
    // One artifact for every platform is true of npm-global and of nothing
    // else, and forcing it into a platforms map would be ceremony.
    const npm = {
      name: "playwright",
      version: "1.62.1",
      install: "npm-global",
      package: "@playwright/test",
    };
    expect(resolvePlatform(npm, MAC)).toBe(npm);
  });

  it("names the platform and what was declared when there is no block", () => {
    // The operator has to add the missing block, so the message has to say
    // which one and what is already there.
    expect(() => resolvePlatform(GH, "win32-x64")).toThrow(
      /no pin for win32-x64/
    );
    expect(() => resolvePlatform(GH, "win32-x64")).toThrow(
      /darwin-arm64, linux-x64/
    );
  });

  it("rejects a platforms field that is not a map", () => {
    expect(() =>
      resolvePlatform({ name: "x", platforms: ["linux-x64"] }, LINUX)
    ).toThrow(/keyed by <platform>-<arch>/);
  });

  it("reports platform and arch together", () => {
    // Either alone is insufficient: an Apple Silicon laptop and an Intel one
    // run different builds of the same release.
    expect(currentPlatform({ platform: "darwin", arch: "arm64" })).toBe(
      "darwin-arm64"
    );
  });
});

describe("planning across platforms", () => {
  it("plans an install from the block matching the platform", () => {
    const plan = planOn({ install: [GH] }, ABSENT, "remote", MAC);
    expect(plan[0]?.action).toBe("install");
    expect(plan[0]?.tool?.url).toBe(MAC_URL);
  });

  it("reports an unsupported platform instead of aborting the whole plan", () => {
    // An operator fixing a manifest wants the complete list. Throwing on the
    // first unresolvable tool hides every problem after it.
    const plan = planOn(
      {
        install: [
          GH,
          {
            name: "playwright",
            version: "1.62.1",
            install: "npm-global",
            package: "@playwright/test",
          },
        ],
      },
      ABSENT,
      "local",
      "win32-x64"
    );
    expect(plan.map(step => step.action)).toEqual(["invalid", "install"]);
    expect(plan[0]?.reason).toMatch(/no pin for win32-x64/);
  });

  it("attaches the resolved entry to the decision", () => {
    // The installer must not resolve a second time: two resolutions are two
    // chances to disagree, and the one that installs is the one nothing tested.
    const plan = planOn({ install: [GH] }, ABSENT, "remote", LINUX);
    expect(plan[0]?.tool?.install).toBe(TAR);
    expect(plan[0]?.tool?.platforms).toBeUndefined();
  });
});

describe("the pin is a floor locally and an equality remotely", () => {
  /**
   * A workstation already carrying a newer gh than the manifest pins.
   * @returns A probe result one minor ahead of the pin.
   */
  const NEWER = () => ({ present: true, version: "2.96.0" });

  it("leaves a newer tool alone on a laptop", () => {
    // ~/.local/bin is prepended to PATH, so installing 2.83.0 over a system
    // 2.96.0 downgrades gh for every other project on the machine.
    const plan = planOn({ install: [GH] }, NEWER, "local", LINUX);
    expect(plan[0]?.action).toBe("newer");
  });

  it("still installs an older tool on a laptop", () => {
    const older = () => ({ present: true, version: "2.10.0" });
    const plan = planOn({ install: [GH] }, older, "local", LINUX);
    expect(plan[0]?.action).toBe("install");
  });

  it("holds a container to the exact pin", () => {
    // A container exists to be reproducible, and nothing else on it competes
    // for the binary.
    const plan = planOn({ install: [GH] }, NEWER, "remote", LINUX);
    expect(plan[0]?.action).toBe("install");
  });
});

describe("the pinning gate", () => {
  it("refuses an entry that was never resolved", () => {
    // Reading url and sha256 straight off a platform-mapped entry gets fields
    // belonging to no platform in particular — which is the exact failure this
    // whole shape exists to prevent.
    expect(() => assertPinned(GH)).toThrow(/was not resolved/);
  });

  it("accepts the resolved form", () => {
    expect(() => assertPinned(resolvePlatform(GH, LINUX))).not.toThrow();
  });

  it("still demands a checksum beside a url", () => {
    const unchecksummed = {
      name: "x",
      install: "release-zip",
      url: "https://example.test/x.zip",
    };
    expect(() => assertPinned(unchecksummed)).toThrow(/url and sha256/);
  });
});
