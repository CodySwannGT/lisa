/**
 * Which file says what a check's command runs, read from the command alone.
 *
 * `npm run lint` runs whatever `package.json` says `lint` is, so a proof's
 * change that edits that script changes the check. These cases hold the
 * reading of an argument list to the runners the design note names, to the
 * ways a command is commonly wrapped, and to what counts as a change of
 * each runner's file.
 */
import { describe, expect, it } from "vitest";

import {
  runnerManifestChange,
  startedProgram,
  taskRunnersOf,
  type ManifestSides,
} from "../../../src/controls/proof-task-runners.js";

const SCRIPTS = "package-scripts";
const MANIFEST = "package.json";

/** A file a command names with the runner's own file option. */
const NAMED_FILE = "build/checks";

/**
 * A `package.json` as text.
 * @param fields - What it holds
 * @returns The file's content
 */
function manifest(fields: Readonly<Record<string, unknown>>): string {
  return `${JSON.stringify(fields, null, 2)}\n`;
}

/**
 * Ask which runner's file a change edits.
 * @param argv - The check's command
 * @param files - Each touched path, with its content before and after
 * @param scope - The folder the command is started in
 * @returns The file and the runner, or `null`
 */
function changed(
  argv: readonly string[],
  files: Readonly<Record<string, ManifestSides>>,
  scope = "."
): ReturnType<typeof runnerManifestChange> {
  return runnerManifestChange({
    argv,
    scope,
    paths: Object.keys(files),
    read: file => files[file] ?? { before: null, after: null },
  });
}

describe("the task runner a command goes through", () => {
  it.each([
    ["npm run", ["npm", "run", "--silent", "lint"]],
    ["npm test", ["npm", "test"]],
    ["npm with a script's name alone", ["npm", "start"]],
    ["pnpm with a script's name", ["pnpm", "lint"]],
    ["pnpm run", ["pnpm", "run", "lint"]],
    ["yarn with a script's name", ["yarn", "lint"]],
    ["yarn run", ["yarn", "run", "lint"]],
    ["bun run", ["bun", "run", "lint"]],
    ["bun with a script's name", ["bun", "lint"]],
    ["node --run", ["node", "--run", "lint"]],
    ["node --run=", ["node", "--run=lint"]],
    ["a package manager given by its path", ["/usr/local/bin/npm", "test"]],
    ["a package manager's Windows shim", ["npm.cmd", "run", "lint"]],
    ["a package manager in capitals", ["NPM.CMD", "run", "lint"]],
    ["corepack in front", ["corepack", "pnpm", "run", "lint"]],
    ["env in front", ["env", "CI=1", "npm", "run", "lint"]],
    [
      "env with its own options in front",
      ["env", "-i", "-u", "HOME", "--", "yarn", "lint"],
    ],
    ["env given the command as one text", ["env", "-S", "npm run lint"]],
    ["a shell given a script", ["sh", "-c", "npm run lint"]],
    ["a shell given a script with other options", ["bash", "-ec", "yarn lint"]],
    [
      "a shell whose script runs two things",
      ["sh", "-c", "cd api && pnpm run lint"],
    ],
    [
      "env in front of a shell",
      ["env", "CI=1", "sh", "-c", "exec bun run lint"],
    ],
  ])("is a package manager's scripts for %s", (_name, argv) => {
    expect(taskRunnersOf(argv)).toEqual([SCRIPTS]);
  });

  it.each([
    ["make with a target", ["make", "lint"], "make"],
    ["gmake", ["gmake", "-C", "api", "lint"], "make"],
    ["make in a shell's script", ["sh", "-c", "make lint"], "make"],
    ["just with a recipe", ["just", "lint"], "just"],
    ["just in a shell's script", ["bash", "-c", "just lint"], "just"],
  ])("is %s", (_name, argv, kind) => {
    expect(taskRunnersOf(argv)).toEqual([kind]);
  });

  it("is every runner a shell's script mentions", () => {
    expect(taskRunnersOf(["sh", "-c", "make build && npm test"])).toEqual([
      SCRIPTS,
      "make",
    ]);
  });

  it.each([
    ["a tool started directly", ["ruff", "check", "."]],
    ["node running a file", ["node", "scripts/check.mjs"]],
    ["node given a program", ["node", "-e", "console.log('npm run lint')"]],
    ["a shell running a file", ["sh", "scripts/lint.sh"]],
    ["a tool whose name only starts like a runner's", ["npmx", "lint"]],
    ["a tool whose name only ends like a runner's", ["remake", "lint"]],
    ["an argument that names a runner", ["echo", "npm"]],
    ["an empty command", []],
    ["env with nothing after it", ["env", "CI=1"]],
    ["corepack with nothing after it", ["corepack", "--version"]],
  ])("is none for %s", (_name, argv) => {
    expect(taskRunnersOf(argv)).toEqual([]);
  });
});

describe("a change to a package manager's manifest", () => {
  const before = manifest({
    name: "fixture",
    scripts: { lint: "eslint ." },
    dependencies: { left: "1.0.0" },
  });
  const npm = ["npm", "run", "lint"];

  it("changes the check when the script the command runs is swapped", () => {
    const after = manifest({
      name: "fixture",
      scripts: { lint: 'node -e "process.exit(1)"' },
      dependencies: { left: "1.0.0" },
    });

    expect(changed(npm, { [MANIFEST]: { before, after } })).toEqual({
      file: MANIFEST,
      runner: SCRIPTS,
    });
  });

  it.each([
    [
      "another script is added, which can run before the one named",
      { lint: "eslint .", prelint: "exit 1" },
    ],
    ["the script is removed", {}],
    ["another script is changed", { lint: "eslint .", test: "exit 1" }],
  ])("changes the check when %s", (_name, scripts) => {
    const after = manifest({
      name: "fixture",
      scripts,
      dependencies: { left: "1.0.0" },
    });

    expect(changed(npm, { [MANIFEST]: { before, after } })?.file).toBe(
      MANIFEST
    );
  });

  it("changes the check when the scripts are taken out altogether", () => {
    const after = manifest({ name: "fixture" });

    expect(changed(npm, { [MANIFEST]: { before, after } })?.file).toBe(
      MANIFEST
    );
  });

  it.each([
    ["a manifest in another folder", "api/package.json"],
    ["a manifest deep in the tree", "packages/web/app/package.json"],
  ])("changes the check when the scripts of %s change", (_name, file) => {
    const after = manifest({ name: "fixture", scripts: { lint: "exit 1" } });

    expect(changed(npm, { [file]: { before, after } })?.file).toBe(file);
  });

  it.each([
    ["a manifest is added", { before: null, after: before }],
    ["a manifest is removed", { before, after: null }],
    ["a manifest stops being JSON", { before, after: "{ not json" }],
    ["a manifest becomes a list", { before, after: "[]\n" }],
  ])("changes the check when %s", (_name, sides) => {
    expect(changed(npm, { [MANIFEST]: sides })?.file).toBe(MANIFEST);
  });

  it.each([
    [
      "a dependency is added",
      manifest({
        name: "fixture",
        scripts: { lint: "eslint ." },
        dependencies: { left: "1.0.0", right: "2.0.0" },
      }),
    ],
    [
      "the keys are written in another order",
      manifest({
        dependencies: { left: "1.0.0" },
        scripts: { lint: "eslint ." },
        name: "fixture",
      }),
    ],
    [
      "the file is indented another way",
      JSON.stringify({
        name: "fixture",
        scripts: { lint: "eslint ." },
        dependencies: { left: "1.0.0" },
      }),
    ],
  ])("leaves the check alone when %s", (_name, after) => {
    expect(changed(npm, { [MANIFEST]: { before, after } })).toBeNull();
  });

  it("leaves the check alone when the command goes through no package manager", () => {
    const after = manifest({ scripts: { lint: "exit 1" } });

    expect(
      changed(["ruff", "check", "."], { [MANIFEST]: { before, after } })
    ).toBeNull();
  });

  it("leaves the check alone when the change touches no manifest", () => {
    expect(
      changed(npm, { "src/package.json.bak": { before: "a", after: "b" } })
    ).toBeNull();
  });
});

describe("a change to what make or just reads", () => {
  const sides = { before: "lint:\n\ttrue\n", after: "lint:\n\tfalse\n" };

  it.each([
    ["Makefile", "Makefile"],
    ["makefile", "makefile"],
    ["GNUmakefile", "GNUmakefile"],
    ["a Makefile in a folder", "api/Makefile"],
    ["an included rules file", "build/rules.mk"],
  ])("changes a make check when it edits %s", (_name, file) => {
    expect(changed(["make", "lint"], { [file]: sides })).toEqual({
      file,
      runner: "make",
    });
  });

  it.each([
    ["the file named with -f", ["make", "-f", NAMED_FILE, "lint"]],
    ["the file named with --file", ["make", "--file", NAMED_FILE, "lint"]],
    ["the file named with --file=", ["make", `--file=${NAMED_FILE}`, "lint"]],
    [
      "the file named with --makefile=",
      ["make", `--makefile=${NAMED_FILE}`, "lint"],
    ],
  ])("changes a make check when it edits %s", (_name, argv) => {
    expect(changed(argv, { [NAMED_FILE]: sides })?.file).toBe(NAMED_FILE);
  });

  it("reads a file option from the folder the command is started in", () => {
    expect(
      changed(
        ["make", "-f", "checks.mk.txt", "lint"],
        {
          "api/checks.mk.txt": sides,
        },
        "api"
      )?.file
    ).toBe("api/checks.mk.txt");
  });

  it.each([
    ["justfile", "justfile"],
    ["Justfile", "Justfile"],
    [".justfile", ".justfile"],
    ["a justfile in a folder", "api/JUSTFILE"],
    ["an imported recipe file", "recipes/lint.just"],
  ])("changes a just check when it edits %s", (_name, file) => {
    expect(changed(["just", "lint"], { [file]: sides })).toEqual({
      file,
      runner: "just",
    });
  });

  it("changes a just check when it edits the file named with --justfile", () => {
    expect(
      changed(["just", "--justfile", "ci/recipes", "lint"], {
        "ci/recipes": sides,
      })?.file
    ).toBe("ci/recipes");
  });

  it.each([
    ["a make check and a justfile", ["make", "lint"], "justfile"],
    ["a just check and a Makefile", ["just", "lint"], "Makefile"],
    ["a make check and a source file", ["make", "lint"], "src/Makefile.py"],
    ["a tool started directly and a Makefile", ["ruff", "check"], "Makefile"],
  ])("leaves the check alone for %s", (_name, argv, file) => {
    expect(changed(argv, { [file]: sides })).toBeNull();
  });
});

describe("the program a command starts, given as a path into the repository", () => {
  it.each([
    ["a script in a folder", ["./scripts/lint.sh"], ".", "scripts/lint.sh"],
    ["a program without the dot", ["bin/check", "--all"], ".", "bin/check"],
    [
      "a program started in a part's folder",
      ["./bin/check"],
      "api",
      "api/bin/check",
    ],
    [
      "a program reached from a part's folder",
      ["../tools/check"],
      "api",
      "tools/check",
    ],
    ["a program behind env", ["env", "CI=1", "./check.sh"], ".", "check.sh"],
  ])("is %s", (_name, argv, scope, file) => {
    expect(startedProgram(argv, scope)).toBe(file);
  });

  it.each([
    ["a program looked up by name", ["ruff", "check"], "."],
    ["a program given from the root of the machine", ["/usr/bin/make"], "."],
    ["a path that leads out of the repository", ["../outside/check"], "."],
    ["an empty command", [], "."],
  ])("is none for %s", (_name, argv, scope) => {
    expect(startedProgram(argv, scope)).toBeNull();
  });
});
