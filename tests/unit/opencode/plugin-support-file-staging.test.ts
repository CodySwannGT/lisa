/**
 * The installer's support-file list and the build's staging list must agree
 * (CodySwannGT/lisa#3078).
 *
 * `src/opencode/hooks-installer.ts` names the canonical scripts it copies into
 * a host's `.opencode/plugin/`; `scripts/copy-opencode-plugin-templates.mjs`
 * names the ones it stages into `dist/opencode/plugin-templates/`. They are two
 * hand-maintained lists of the same set, and `resolveSupportFile` resolves from
 * `plugins/src/base/hooks/` in a source checkout and from `dist/` in a packaged
 * install — so a file added to the installer alone works in this repository and
 * is MISSING from every `lisa apply` that runs off the published package.
 *
 * That failure mode is the one worth a test: the adapter loads, throws on the
 * missing script, and the guard reads as broken rather than as absent. Asserted
 * by reading both files, because neither list is exported.
 * @module tests/unit/opencode/plugin-support-file-staging
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const INSTALLER = path.join(
  process.cwd(),
  "src",
  "opencode",
  "hooks-installer.ts"
);
const COPY_SCRIPT = path.join(
  process.cwd(),
  "scripts",
  "copy-opencode-plugin-templates.mjs"
);
const HOOK_DIR = path.join(process.cwd(), "plugins", "src", "base", "hooks");

/**
 * Read the string literals out of one `const NAME = [ ... ]` array.
 * @param source - File contents.
 * @param name - The const's identifier.
 * @returns The literals, in declaration order.
 */
function arrayLiterals(source: string, name: string): string[] {
  const opened = source.indexOf(`${name} = [`);
  if (opened < 0) {
    // Thrown rather than asserted: an unreadable list is a broken probe, and a
    // probe that returns [] instead would let the comparison below pass by
    // finding nothing on both sides.
    throw new Error(`${name} not found — the probe cannot read this list`);
  }
  const body = source.slice(opened, source.indexOf("]", opened));
  return [...body.matchAll(/"([^"]+)"/g)].map(match => match[1] as string);
}

/**
 * Sort filenames deterministically across locales.
 * @param left - One filename.
 * @param right - The other.
 * @returns Standard comparator result.
 */
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

describe("OpenCode plugin support files", () => {
  it("stages into dist exactly what the installer copies into a host", async () => {
    const installer = arrayLiterals(
      await fs.readFile(INSTALLER, "utf8"),
      "PLUGIN_SUPPORT_FILES"
    );
    const staged = arrayLiterals(
      await fs.readFile(COPY_SCRIPT, "utf8"),
      "canonicalSupportFiles"
    );

    expect([...installer].sort(byName)).toEqual([...staged].sort(byName));
  });

  it("names only files that exist in the canonical hook directory", async () => {
    // The other half of the same guarantee. A list that agrees with itself and
    // names a file nobody ships fails at install time, not at review time.
    const installer = arrayLiterals(
      await fs.readFile(INSTALLER, "utf8"),
      "PLUGIN_SUPPORT_FILES"
    );

    expect(installer.length).toBeGreaterThan(0);
    for (const filename of installer) {
      expect(
        await fs.pathExists(path.join(HOOK_DIR, filename)),
        `${filename} is listed but absent from plugins/src/base/hooks/`
      ).toBe(true);
    }
  });

  it("includes the guard this issue added, so the pair is not vacuously equal", async () => {
    // Two empty lists are also equal. Naming the file pins that the case above
    // is measuring the set it was written for.
    const installer = arrayLiterals(
      await fs.readFile(INSTALLER, "utf8"),
      "PLUGIN_SUPPORT_FILES"
    );

    expect(installer).toContain("block-no-verify.sh");
  });
});
