/**
 * Lisa carries no dependency-audit exclusions (CodySwannGT/lisa#4931).
 *
 * Lisa's root lists held 35 entries (33 shared, 2 local) and the managed
 * TypeScript list, applied to
 * every TypeScript-family host, held 33. Checked against the GitHub advisory
 * database and Lisa's lockfile on 2026-11-17, every entry but one excused an
 * advisory no copy in Lisa's tree still matched, or one GitHub had withdrawn
 * (braces GHSA-vfj7-8cjw-p6xm). The last live one, zod GHSA-mrhx-c7xc-m3w5, was
 * fixed by dropping eslint-plugin-react-compiler and forcing zod 4.6.7. Every
 * advisory the managed list named has a patched release in each affected
 * major, so a host fixes it by refreshing its lockfile rather than excluding
 * it. The shipped list and both local files must stay empty; any entry there is
 * a regression. The root audit.ignore.config.json is Lisa's own managed
 * decision file and is not checked here: it carries the separately evaluated
 * picomatch GHSA-fc5q-39xc-vjpf entry, which has no patched release.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

describe("Lisa's audit exclusion lists", () => {
  it.each([
    "audit.ignore.local.json",
    "typescript/copy-overwrite/audit.ignore.config.json",
    "typescript/create-only/audit.ignore.local.json",
  ])("%s excludes nothing", file => {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, file), "utf8")
    ) as { exclusions?: unknown };
    expect(parsed.exclusions).toEqual([]);
  });
});
