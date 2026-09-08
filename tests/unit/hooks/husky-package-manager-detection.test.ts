/**
 * The husky hooks must pick the package manager the PROJECT declares.
 *
 * The block these assertions execute used to carry the comment
 * `Priority: bun > yarn > npm (bun first since package.json engines prefer it)`
 * above a chain that read only lockfiles. Two defects, one visible and one not:
 *
 *   - the justification was decorative — nothing in the file read `engines`;
 *   - and it described LISA's `package.json`, in a file `copy-contents` stamps
 *     into other repositories whose `engines` say something else.
 *
 * Lockfile-only detection is not a harmless simplification. This product's own
 * `install-pkgs.sh` states the opposite rule and records why: an npm-only
 * project that picks up a stray `bun.lock` must still get npm, or the installer
 * and the commit hooks disagree about which manager runs the gates. `pnpm` was
 * absent from the chain entirely, so a pnpm project matched nothing and fell
 * through to the npm default while the hook printed that as a detection.
 *
 * These run the SHIPPED bytes rather than a copy: the block is sliced out of
 * each husky file between its markers and executed in a fixture directory, so
 * an assertion cannot pass against source the consumer does not receive.
 *
 * CodySwannGT/lisa#3535.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** The block markers the husky files wrap their detector in. */
const BLOCK_START = "# --- lisa:pm-detect ---";
const BLOCK_END = "# --- end lisa:pm-detect ---";

/**
 * Every husky file that carries the detector, shipped copy first.
 *
 * All three locations are asserted because they are separate files with no
 * generator between them: fixing the template alone would leave this
 * repository's own hooks running the algorithm the fix exists to remove.
 */
const HUSKY_FILES = [
  "typescript/copy-contents/.husky/pre-commit",
  "typescript/copy-contents/.husky/pre-push",
  "typescript/copy-contents/.husky/commit-msg",
  ".husky/pre-commit",
  ".husky/pre-push",
  ".husky/commit-msg",
  ".claude-pr/.husky/pre-commit",
  ".claude-pr/.husky/pre-push",
  ".claude-pr/.husky/commit-msg",
] as const;

let fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  fixtures = [];
});

/**
 * The detector, sliced out of a husky file and made runnable on its own.
 * @param relativePath - Repo-relative path to the husky hook
 * @returns Shell source that prints the manager it selected
 */
function detectorScript(relativePath: string): string {
  const text = fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf-8");
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start === -1 || end === -1) {
    // Not an assertion helper being lenient: a file with no markers cannot be
    // exercised at all, and returning something runnable would report a pass
    // for a file this suite never executed.
    throw new Error(`${relativePath} carries no ${BLOCK_START} block`);
  }
  return `${text.slice(start, end + BLOCK_END.length)}\nprintf '%s|%s|%s\\n' "$PACKAGE_MANAGER" "$RUNNER" "$EXECUTOR"\n`;
}

/** Managers the fixture PATH pretends are installed. */
const FAKE_BINARIES = ["bun", "pnpm", "yarn", "npm"] as const;

/**
 * A project directory containing exactly the signals a case declares.
 *
 * A `bin/` of stubs is placed on PATH, because the detector refuses to select a
 * manager that is not installed. Without it these assertions would measure
 * which managers this machine happens to have — the exact class of defect this
 * suite exists over, one level up.
 * @param files - File name to contents, written at the fixture root
 * @returns The fixture directory and the PATH to run under
 */
function makeProject(files: Record<string, string>): {
  root: string;
  binPath: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-pm-detect-"));
  const bin = path.join(root, "bin");
  const binPath = `${bin}:${process.env["PATH"] ?? ""}`;
  fixtures.push(root);
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, name), contents);
  }
  fs.mkdirSync(bin);
  for (const name of FAKE_BINARIES) {
    fs.writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
  }
  return { root, binPath };
}

/**
 * Read the detector's last line back into the three values it set.
 * @param stdout - Everything the detector printed
 * @returns The manager it selected, and the runner and executor it set
 */
function parseSelection(stdout: string): {
  manager: string;
  runner: string;
  executor: string;
} {
  const last = stdout.trim().split("\n").at(-1) ?? "";
  const [manager, runner, executor] = last.split("|");
  return {
    manager: manager ?? "",
    runner: runner ?? "",
    executor: executor ?? "",
  };
}

/**
 * Run one husky file's detector against one project.
 * @param relativePath - Repo-relative path to the husky hook
 * @param files - The project's files
 * @returns The manager it selected, and the runner and executor it set
 */
function detect(
  relativePath: string,
  files: Record<string, string>
): { manager: string; runner: string; executor: string } {
  const { root, binPath } = makeProject(files);
  const script = path.join(root, "detect.sh");
  const source = detectorScript(relativePath);
  fs.writeFileSync(script, source);
  return parseSelection(
    boundedSpawnSync({
      label: "pm-detect",
      command: "/bin/sh",
      args: [script],
      cwd: root,
      env: { ...process.env, PATH: binPath },
    }).stdout
  );
}

/** `engines` that forbid every manager but npm, as a real project spells it. */
const NPM_ONLY = JSON.stringify({
  engines: { bun: "please-use-npm", yarn: "please-use-npm" },
});

describe("husky package-manager detection reads what the project declares", () => {
  it.each(HUSKY_FILES)(
    "%s honours an engines opt-out over a stray lockfile",
    file => {
      // The recorded regression, stated in `install-pkgs.sh`: an npm-only project
      // that acquires a stray `bun.lock` must still get npm. Lockfile-only
      // detection answers bun here and npm in the installer — one repository,
      // two Lisa components, two different managers running the gates.
      expect(
        detect(file, { "package.json": NPM_ONLY, "bun.lock": "" }).manager
      ).toBe("npm");
    }
  );

  it.each(HUSKY_FILES)("%s selects pnpm for a pnpm project", file => {
    // Absent from the chain entirely before this. A pnpm project matched no
    // branch, took the npm default, and the hook printed "npm" as a detection.
    const selected = detect(file, {
      "package.json": "{}",
      "pnpm-lock.yaml": "",
    });

    expect(selected.manager).toBe("pnpm");
    expect(selected.runner).toBe("pnpm run");
    expect(selected.executor).toBe("pnpm exec");
  });

  it.each(HUSKY_FILES)("%s prefers an explicit packageManager field", file => {
    expect(
      detect(file, {
        "package.json": JSON.stringify({ packageManager: "yarn@4.1.0" }),
        "package-lock.json": "",
      }).manager
    ).toBe("yarn");
  });
});

describe("husky package-manager detection keeps its unchanged answers", () => {
  // The negative controls. Without them "reads engines now" is
  // indistinguishable from "answers something different than it used to".
  it.each(HUSKY_FILES)("%s still selects bun for a bun project", file => {
    const selected = detect(file, { "package.json": "{}", "bun.lock": "" });

    expect(selected.manager).toBe("bun");
    expect(selected.runner).toBe("bun run");
  });

  it.each(HUSKY_FILES)(
    "%s still defaults to npm with no signal at all",
    file => {
      const selected = detect(file, { "package.json": "{}" });

      expect(selected.manager).toBe("npm");
      expect(selected.executor).toBe("npx");
    }
  );
});
