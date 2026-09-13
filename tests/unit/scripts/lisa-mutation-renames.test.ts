import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  compileMutatePatterns,
  selectChangedTargets,
} from "../../../typescript/copy-overwrite/scripts/lisa-mutation.mjs";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const GIT = resolveGit();
const BEFORE = "src/before.ts";
const AFTER = "src/after name.ts";
const SOURCE = Array.from(
  { length: 30 },
  (_, index) => `export const value${index} = ${index};\n`
).join("");
const PATTERNS = compileMutatePatterns(["src/**/*.ts"]);

describe("mutation selection preserves renames and deletions", () => {
  let root: string;
  let base: string;

  /** Run Git inside the isolated fixture without inheriting a parent index. */
  function git(...args: string[]) {
    return boundedExecFileSync({
      label: `mutation rename fixture: git ${args[0]}`,
      command: GIT,
      args,
      cwd: root,
      env: Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
      ),
    }).trim();
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-mutation-renames-"));
    git("init", "-q");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.com");
    git("config", "core.hooksPath", path.join(root, ".git/hooks"));
    git("config", "diff.renames", "false");
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, BEFORE), SOURCE);
    writeFileSync(path.join(root, "src/keeper.ts"), "export const keep = 1;\n");
    git("add", ".");
    git("commit", "-qm", "baseline");
    base = git("rev-parse", "HEAD");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reports a pure rename without selecting unchanged lines", () => {
    git("mv", BEFORE, AFTER);
    const scope = selectChangedTargets(root, base, PATTERNS);
    expect(scope.changed).toBe(1);
    expect(scope.selectedFiles).toBe(1);
    expect(scope.selected).toEqual([]);
    expect(scope.noCurrentLines).toEqual([AFTER]);
  });

  it("selects only the edited new-side line after a rename", () => {
    git("mv", BEFORE, AFTER);
    writeFileSync(
      path.join(root, AFTER),
      SOURCE.replace("value2 = 2", "value2 = 22")
    );
    const scope = selectChangedTargets(root, base, PATTERNS);
    expect(scope.changed).toBe(1);
    expect(scope.selected).toEqual([`${AFTER}:3-3`]);
    expect(scope.noCurrentLines).toEqual([]);
  });

  it("keeps a deleted mutate target in the no-current-lines result", () => {
    git("rm", BEFORE);
    const scope = selectChangedTargets(root, base, PATTERNS);
    expect(scope.changed).toBe(1);
    expect(scope.selectedFiles).toBe(1);
    expect(scope.selected).toEqual([]);
    expect(scope.noCurrentLines).toEqual([BEFORE]);
    expect(readFileSync(path.join(root, "src/keeper.ts"), "utf8")).toContain(
      "keep = 1"
    );
  });

  it("does not mix a reused old path into the renamed file's ranges", () => {
    git("mv", BEFORE, AFTER);
    writeFileSync(
      path.join(root, BEFORE),
      "export const replacement = true;\n"
    );
    git("add", BEFORE);
    expect(
      git(
        "diff",
        "--find-renames",
        "--break-rewrites",
        "--name-status",
        "-z",
        base
      )
    ).toContain(`100\0${BEFORE}\0${AFTER}\0`);
    const scope = selectChangedTargets(root, base, PATTERNS);
    expect(scope.selected).toEqual([`${BEFORE}:1-1`]);
    expect(scope.noCurrentLines).toEqual([AFTER]);
  });

  it("retains ordinary working-tree modification scoping", () => {
    writeFileSync(
      path.join(root, BEFORE),
      SOURCE.replace("value2 = 2", "value2 = 22")
    );
    const scope = selectChangedTargets(root, base, PATTERNS);
    expect(scope.selected).toEqual([`${BEFORE}:3-3`]);
    expect(scope.noCurrentLines).toEqual([]);
  });
});
