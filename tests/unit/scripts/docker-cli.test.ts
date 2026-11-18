import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveDockerCli } from "../../../scripts/lib/docker-cli.mjs";

/** One private root for every PATH directory this file makes. */
const ROOT = mkdtempSync(path.join(tmpdir(), "lisa-docker-cli-"));

/**
 * A directory holding a `docker` file with the given mode.
 * @param name - Directory name under the private root, unique per test
 * @param mode - File mode for its `docker`
 * @returns The directory's absolute path
 */
function holder(name: string, mode: number): string {
  const directory = path.join(ROOT, name);
  mkdirSync(directory);
  writeFileSync(path.join(directory, "docker"), "#!/bin/sh\n", { mode: 0o600 });
  chmodSync(path.join(directory, "docker"), mode);
  return directory;
}

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("resolveDockerCli", () => {
  it("returns the first executable docker on PATH, as an absolute path", () => {
    const skipped = holder("not-executable", 0o600);
    const first = holder("first", 0o700);
    const second = holder("second", 0o700);
    expect(
      resolveDockerCli([skipped, first, second].join(path.delimiter))
    ).toBe(path.join(first, "docker"));
  });

  it("ignores relative PATH entries, so the current directory cannot choose it", () => {
    const only = holder("only", 0o700);
    expect(resolveDockerCli(["relative-bin", only].join(path.delimiter))).toBe(
      path.join(only, "docker")
    );
  });

  it("refuses by name when no docker is on PATH", () => {
    expect(() => resolveDockerCli("")).toThrow(/Docker CLI not found on PATH/u);
  });
});
