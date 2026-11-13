/**
 * A push builds once (CodySwannGT/lisa#4595), end to end through the real gate
 * runner, the real `build-unless-marked.mjs` and the real
 * `check-plugins-sync.sh`, in a throwaway project shaped like Lisa: two test
 * gates that build before testing, a plugin drift gate, and a `build` that
 * counts how often it ran.
 *
 * Three properties are pinned, each against its control:
 * - with `pushGate.buildOnce` on, one push runs `build` exactly once and every
 *   later step logs that it skipped; with it off, every step builds as before;
 * - a working tree that differs from the marker's rebuilds;
 * - a stale committed plugin artifact still fails the drift gate with its
 *   declared failure shape, not with the pre-build refusal.
 * @module tests/integration/build-once-per-push
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { sweepAlreadyRanEnv } from "../helpers/cleanup-sweep-skip.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { cleanGitEnv, GIT_BIN } from "../support/git-executable.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RUNNER = path.join(
  REPO_ROOT,
  "all/copy-overwrite/scripts/lisa-run-gates.mjs"
);
const SKIP = "build skipped: marker matches";
const OUT_OF_SYNC =
  "✗ Generated plugin artifacts are out of sync with plugins/src.";
const PRE_BUILD_REFUSAL = "plugins/ has uncommitted changes before";
const TEST_GATE = "node scripts/build-unless-marked.mjs && echo tested";

/** Files the fixture borrows from this repository, at the same paths. */
const BORROWED = [
  "scripts/check-plugins-sync.sh",
  "scripts/build-unless-marked.mjs",
  "scripts/lib/invoked-as-script.mjs",
  "all/copy-overwrite/scripts/lib/build-marker.mjs",
];

/** A plugin build: one artifact under plugins/ and one materialized outside. */
const GENERATOR = `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const source = readFileSync("plugins/src/base.txt", "utf8");
mkdirSync("plugins/lisa", { recursive: true });
mkdirSync("out", { recursive: true });
writeFileSync("plugins/lisa/base.txt", source);
writeFileSync("out/gen.txt", source);
writeFileSync("plugins/materialized-artifacts.json", JSON.stringify(["out/gen.txt"]) + "\\n");
`;

const roots: string[] = [];

/**
 * Run git in the fixture.
 * @param cwd - Fixture root
 * @param args - Git arguments
 */
function git(cwd: string, ...args: string[]): void {
  execFileSync(GIT_BIN, args, { cwd, stdio: "ignore", env: cleanGitEnv() });
}

/**
 * Create the committed fixture project.
 * @param buildOnce - Value of `pushGate.buildOnce`, or undefined to omit it
 * @returns Fixture root
 */
function fixture(buildOnce: boolean | undefined): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-build-once-"));
  roots.push(root);
  for (const file of BORROWED) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    copyFileSync(path.join(REPO_ROOT, file), path.join(root, file));
  }
  writeFileSync(path.join(root, "gen.mjs"), GENERATOR);
  writeFileSync(
    path.join(root, "count.mjs"),
    'import { appendFileSync } from "node:fs";\nappendFileSync(".builds", "built\\n");\n'
  );
  writeFileSync(path.join(root, ".gitignore"), ".builds\n.lisa/\n");
  mkdirSync(path.join(root, "plugins/src"), { recursive: true });
  writeFileSync(path.join(root, "plugins/src/base.txt"), "v1\n");
  mkdirSync(path.join(root, ".claude-plugin"));
  writeFileSync(
    path.join(root, ".claude-plugin/marketplace.json"),
    JSON.stringify({ plugins: [{ name: "lisa", source: "./plugins/lisa" }] })
  );
  mkdirSync(path.join(root, ".lisa"));
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "build-once-fixture",
        private: true,
        type: "module",
        scripts: {
          build: "node count.mjs && bun run build:plugins",
          "build:plugins": "node gen.mjs",
          "check:plugins": "bash scripts/check-plugins-sync.sh",
          "test-a": TEST_GATE,
          "test-b": TEST_GATE,
        },
      },
      null,
      2
    )
  );
  writeFileSync(
    path.join(root, ".lisa.config.json"),
    JSON.stringify(
      {
        gates: {
          runner: "bun run",
          "x-test-a": { push: { level: "required", run: "test-a" } },
          "x-test-b": { push: { level: "required", run: "test-b" } },
          "x-plugin-artifact-sync": {
            push: {
              level: "required",
              run: "check:plugins",
              failure_shape: [OUT_OF_SYNC],
            },
          },
        },
        ...(buildOnce === undefined ? {} : { pushGate: { buildOnce } }),
      },
      null,
      2
    )
  );
  execFileSync(process.execPath, ["gen.mjs"], { cwd: root });
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "fixture");
  return root;
}

/**
 * The environment every child sees: no inherited marker, no machine sweep.
 * @returns Environment
 */
function env(): NodeJS.ProcessEnv {
  const {
    LISA_BUILD_MARKER: _marker,
    GITHUB_ACTIONS: _ci,
    ...rest
  } = cleanGitEnv();
  return { ...rest, ...sweepAlreadyRanEnv() };
}

/**
 * Run the push gates in the fixture.
 * @param cwd - Fixture root
 * @returns Exit status and combined output
 */
function push(cwd: string): { status: number | null; output: string } {
  const child = boundedSpawnSync({
    label: "lisa-run-gates push (build-once fixture)",
    command: process.execPath,
    args: [
      RUNNER,
      "--moment=push",
      `--coverage=${path.join(cwd, ".lisa", "cov")}`,
    ],
    cwd,
    env: env(),
  });
  return { status: child.status, output: `${child.stdout}${child.stderr}` };
}

/**
 * How many times the fixture's `build` ran.
 * @param cwd - Fixture root
 * @returns Build count
 */
function builds(cwd: string): number {
  try {
    return readFileSync(path.join(cwd, ".builds"), "utf8").trim().split("\n")
      .length;
  } catch {
    return 0;
  }
}

/**
 * Count occurrences of a phrase.
 * @param text - Haystack
 * @param phrase - Needle
 * @returns Occurrences
 */
function occurrences(text: string, phrase: string): number {
  return text.split(phrase).length - 1;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("build once per push", () => {
  it("a clean push builds exactly once and every later step skips", () => {
    const root = fixture(true);
    const { status, output } = push(root);
    expect(output).toContain("🔨 build-once:");
    expect(status, output).toBe(0);
    expect(builds(root), output).toBe(1);
    // test-a, test-b and check:plugins each skip their build.
    expect(occurrences(output, SKIP)).toBe(3);
  });

  it("control: with the switch absent every step builds as it does today", () => {
    const root = fixture(undefined);
    const { status, output } = push(root);
    expect(status, output).toBe(0);
    expect(builds(root)).toBe(2);
    expect(output).not.toContain(SKIP);
    expect(output).not.toContain("build-once");
  });

  it("a working tree that differs from the marker's rebuilds", () => {
    const root = fixture(true);
    expect(push(root).status).toBe(0);
    writeFileSync(path.join(root, "touched.txt"), "changed after the marker\n");
    const child = boundedSpawnSync({
      label: "build-unless-marked (mismatched tree)",
      command: process.execPath,
      args: ["scripts/build-unless-marked.mjs"],
      cwd: root,
      env: {
        ...env(),
        LISA_BUILD_MARKER: path.join(root, ".lisa", "build-marker.json"),
      },
    });
    expect(child.status).toBe(0);
    expect(child.stdout).toMatch(/^building: tree /mu);
    expect(builds(root)).toBe(2);
  });

  it("a stale committed plugin artifact still fails with the declared shape", () => {
    const root = fixture(true);
    writeFileSync(path.join(root, "plugins/src/base.txt"), "v2\n");
    git(root, "commit", "-q", "-am", "edit source, forget to regenerate");
    const { status, output } = push(root);
    expect(status).not.toBe(0);
    expect(output).toContain(OUT_OF_SYNC);
    expect(output).not.toContain(PRE_BUILD_REFUSAL);
    expect(builds(root), output).toBe(1);
  });
});
