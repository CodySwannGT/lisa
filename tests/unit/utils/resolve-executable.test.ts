/**
 * @file resolve-executable.test.ts
 * @description Pins how Lisa resolves user-installed tools before spawning
 * them: absolute PATH directories only, first executable match wins, and a
 * miss leaves the bare name for the spawn to report as before.
 * @module utils
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { resolveExecutable } from "../../../src/utils/resolve-executable.js";

const roots: string[] = [];

/**
 * Creates a directory holding one file, optionally executable.
 * @param name - File name to create
 * @param mode - Permission bits for the file
 * @returns The directory that holds the file
 */
function dirWith(name: string, mode = 0o755): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-resolve-exe-"));
  const file = path.join(root, name);
  roots.push(root);
  writeFileSync(file, "#!/bin/sh\n");
  chmodSync(file, mode);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("resolveExecutable", () => {
  it("returns the first executable match from an absolute PATH directory", () => {
    const first = dirWith("tool");
    const second = dirWith("tool");
    const environment = { PATH: [first, second].join(path.delimiter) };
    expect(resolveExecutable("tool", { environment, platform: "linux" })).toBe(
      path.join(first, "tool")
    );
  });

  it("skips relative and empty PATH entries so a checked-in file cannot shadow the tool", () => {
    const real = dirWith("tool");
    const environment = { PATH: [".", "", "bin", real].join(path.delimiter) };
    expect(resolveExecutable("tool", { environment, platform: "linux" })).toBe(
      path.join(real, "tool")
    );
  });

  it("skips files without the execute bit", () => {
    const plain = dirWith("tool", 0o644);
    const real = dirWith("tool");
    const environment = { PATH: [plain, real].join(path.delimiter) };
    expect(resolveExecutable("tool", { environment, platform: "linux" })).toBe(
      path.join(real, "tool")
    );
  });

  it("skips a directory that shares the command's name", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-resolve-exe-"));
    const real = dirWith("tool");
    roots.push(root);
    mkdirSync(path.join(root, "tool"));
    const environment = { PATH: [root, real].join(path.delimiter) };
    expect(resolveExecutable("tool", { environment, platform: "linux" })).toBe(
      path.join(real, "tool")
    );
  });

  it("returns the bare name when no absolute directory holds the command", () => {
    const environment = { PATH: dirWith("other") };
    expect(resolveExecutable("tool", { environment, platform: "linux" })).toBe(
      "tool"
    );
  });

  it("returns the bare name when PATH is unset", () => {
    expect(
      resolveExecutable("tool", { environment: {}, platform: "linux" })
    ).toBe("tool");
  });

  it("leaves a command that already names a path untouched", () => {
    expect(
      resolveExecutable("./bin/tool", { environment: {}, platform: "linux" })
    ).toBe("./bin/tool");
  });

  it("applies PATHEXT and the case-insensitive Path key on Windows", () => {
    const root = dirWith("tool.EXE");
    const environment = { Path: root, PATHEXT: ".COM;.EXE" };
    expect(resolveExecutable("tool", { environment, platform: "win32" })).toBe(
      path.join(root, "tool.EXE")
    );
  });

  it("uses the default Windows extensions when PATHEXT is unset", () => {
    const root = dirWith("tool.CMD");
    const environment = { Path: root };
    expect(resolveExecutable("tool", { environment, platform: "win32" })).toBe(
      path.join(root, "tool.CMD")
    );
  });
});
