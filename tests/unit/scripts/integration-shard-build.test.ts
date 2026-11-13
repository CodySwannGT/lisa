/**
 * Unit tests for scripts/integration-shard-build.mjs (CodySwannGT/lisa#4599):
 * one build for every integration-test shard leg, reused through the build
 * marker so no leg runs `bun run build` for the same tree.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main } from "../../../scripts/integration-shard-build.mjs";

const ARCHIVE = "out/build.tgz";
/** The effects `main` takes. */
type Deps = Parameters<typeof main>[1];
let dir: string;
let previous: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-shard-build-"));
  previous = process.cwd();
  process.chdir(dir);
  fs.writeFileSync("package.json", JSON.stringify({ scripts: { build: "x" } }));
});

afterEach(() => {
  process.chdir(previous);
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A recorded command. */
interface Call {
  readonly command: string;
  readonly args: readonly string[];
  readonly input?: string | undefined;
}

/**
 * Effects that record every call.
 * @param overrides - Replacements for individual effects
 * @returns The effects and what they saw
 */
function deps(overrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const lines: string[] = [];
  const builds: unknown[] = [];
  return {
    calls,
    lines,
    builds,
    effects: {
      exec: () => ({ code: 0 }),
      spawn: (command: string, args: readonly string[], input?: string) => {
        calls.push({ command, args, input });
        return {
          status: 0,
          stdout: command === "git" ? "plugins/x.json\0" : "",
        };
      },
      check: () => ({ match: true, reason: "marker matches tree abc" }),
      buildOnce: (options: unknown) => {
        builds.push(options);
        return { state: "passed", durationMs: 61_000 };
      },
      out: (line: string) => lines.push(line),
      env: {},
      ...overrides,
    } as unknown as Deps,
  };
}

describe("build", () => {
  it("builds once through the marker and packs dist, the changed tree and the marker", () => {
    const { effects, calls, lines, builds } = deps();

    expect(main(["build", ARCHIVE], effects)).toBe(0);

    expect(builds).toEqual([
      expect.objectContaining({
        config: { pushGate: { buildOnce: true } },
        runner: "bun run",
        scripts: { build: "x" },
      }),
    ]);
    expect(calls.at(-1)).toEqual({
      command: "tar",
      args: ["--null", "-T", "-", "-czf", ARCHIVE],
      input: "plugins/x.json\0dist\0.lisa/build-marker.json\0",
    });
    expect(lines.join("\n")).toContain("Built once in 61 s");
  });

  it("fails, packing nothing, when the build fails", () => {
    const { effects, calls } = deps({
      buildOnce: () => ({ state: "failed", durationMs: 1 }),
    });
    expect(main(["build", ARCHIVE], effects)).toBe(1);
    expect(calls).toEqual([]);
  });
});

describe("use", () => {
  it("unpacks the build and says the leg uses it", () => {
    const output = path.join(dir, "github-output");
    const { effects, calls, lines } = deps();

    expect(main(["use", ARCHIVE, "--github-output", output], effects)).toBe(0);

    expect(calls).toEqual([
      { command: "tar", args: ["-xzf", ARCHIVE], input: undefined },
    ]);
    expect(lines.join("\n")).toContain(
      "Using the shared build (marker matches tree abc); this shard does not run bun run build."
    );
    expect(fs.readFileSync(output, "utf8")).toBe(
      "marker=.lisa/build-marker.json\n"
    );
  });

  it("warns, and still hands over the marker, when the tree differs", () => {
    const { effects, lines } = deps({
      check: () => ({
        match: false,
        reason: "tree t differs from built tree u",
      }),
    });
    expect(main(["use", ARCHIVE], effects)).toBe(0);
    expect(lines.join("\n")).toContain(
      "::warning title=Shared integration build not used::tree t differs from built tree u, so lisa-test-run builds this shard itself."
    );
  });
});

it.each([[[]], [["build"]], [["pack", ARCHIVE]]])("refuses %j", argv => {
  expect(main(argv, deps().effects)).toBe(2);
});
