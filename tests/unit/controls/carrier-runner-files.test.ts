/**
 * The gate runner as it is placed in a repository (CodySwannGT/lisa#4989).
 *
 * The carrier starts `scripts/lisa-run-gates.mjs` in a repository that has
 * nothing else from Lisa, so what is placed has to be everything the runner
 * loads and nothing it does not. The list is not written down here: other
 * work adds to what the runner imports, and a copy of the list would only
 * say what it was. What is held is the property: every file one of the
 * placed files refers to is itself placed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compareCodeUnits } from "../../../src/controls/canonical-json.js";
import { runnerFiles } from "../../../src/controls/carrier-runner-files.js";

const RUNNER = "scripts/lisa-run-gates.mjs";
const REFERENCE =
  /(?:\bfrom\s*|\bimport\s*|new URL\(\s*)["'](\.{0,2}\/?[\w./-]+\.(?:mjs|ps1|cs|json))["']/gu;

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * A scripts folder holding the given files.
 * @param files - Path from the folder to content
 * @returns The folder
 */
function scriptsFolder(files: Readonly<Record<string, string>>): string {
  const folder = mkdtempSync(path.join(tmpdir(), "lisa-carrier-scripts-"));
  cleanups.push(() => rmSync(folder, { force: true, recursive: true }));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    writeFileSync(path.join(folder, file), content);
  }
  return folder;
}

describe("the runner files placed from the Lisa package", () => {
  it("are the runner, the registry and what they load from lib/", async () => {
    const paths = (await runnerFiles()).map(file => file.path);

    expect(paths).toContain(RUNNER);
    expect(paths).toContain("scripts/lisa-gates.mjs");
    expect(paths.some(file => file.startsWith("scripts/lib/"))).toBe(true);
    expect(paths.every(file => file.startsWith("scripts/"))).toBe(true);
    expect(paths).toEqual([...paths].sort(compareCodeUnits));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("hold every file one of them refers to", async () => {
    const files = await runnerFiles();
    const placed = new Set(files.map(file => file.path));
    const missing = files.flatMap(file =>
      Array.from(file.content.toString("utf8").matchAll(REFERENCE))
        .map(match =>
          path.posix.normalize(
            path.posix.join(path.posix.dirname(file.path), match[1] ?? "")
          )
        )
        .filter(target => !placed.has(target))
        .map(target => `${file.path} -> ${target}`)
    );

    expect(missing).toEqual([]);
  });

  it("leave out what the runner does not load", async () => {
    const paths = (await runnerFiles()).map(file => file.path);

    expect(paths).not.toContain("scripts/lisa-work-item.mjs");
    expect(paths.length).toBeLessThan(40);
  });

  it("follow imports, re-exports and files read from beside a module", async () => {
    const folder = scriptsFolder({
      "lib/a.mjs": 'export { b } from "./b.mjs";\n',
      "lib/b.mjs":
        'export const b = new URL("./helper.ps1", import.meta.url);\n',
      "lib/helper.cs": "// helper\n",
      "lib/helper.ps1":
        "Add-Type -Path (Join-Path $PSScriptRoot 'helper.cs')\n",
      "lib/unused.mjs": "export const unused = 1;\n",
      "lisa-run-gates.mjs":
        'import {\n  a,\n} from "./lib/a.mjs";\nimport "./side.mjs";\n',
      "side.mjs": "// a comment naming import './lib/unused.mjs'\n",
    });

    const paths = (await runnerFiles(folder)).map(file => file.path);

    expect(paths).toEqual([
      "scripts/lib/a.mjs",
      "scripts/lib/b.mjs",
      "scripts/lib/helper.cs",
      "scripts/lib/helper.ps1",
      "scripts/lisa-run-gates.mjs",
      "scripts/side.mjs",
    ]);
  });

  it("refuse a runner that reaches outside its own folder", async () => {
    const folder = scriptsFolder({
      "lisa-run-gates.mjs": 'import "../elsewhere.mjs";\n',
    });

    await expect(runnerFiles(folder)).rejects.toThrow(
      /outside the scripts folder/u
    );
  });
});
