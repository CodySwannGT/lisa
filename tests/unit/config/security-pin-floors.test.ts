import fs from "node:fs";
import path from "node:path";
import { intersects, validRange } from "semver";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Every `force` pin Lisa writes into a host is a SECURITY FLOOR, and a floor
 * below its advisory's patched release is worse than no floor: it looks like
 * remediation, it survives review, and it readmits the exact releases the
 * advisory names. `tar` shipped as `>=7.5.19` while GHSA-r292-9mhp-454m is
 * `<= 7.5.20` patched at `7.5.21`, so the pin Lisa forced into every Expo host
 * admitted two vulnerable releases — and, because `overrides.tar` is `"$tar"`,
 * it did so for every override consumer too.
 *
 * The floors below were measured against the GitHub advisory API on
 * 2026-08-19, taking the highest `first_patched_version` across every
 * non-withdrawn advisory affecting the package:
 *
 * ```
 * gh api --paginate "/advisories?ecosystem=npm&affects=<pkg>&per_page=100" \
 *   --jq '.[] | select(.withdrawn_at == null) | .vulnerabilities[]
 *         | select(.package.name == "<pkg>")
 *         | "\(.vulnerable_version_range) | patched=\(.first_patched_version)"'
 * ```
 *
 * A floor here may only ever move UP. Raising one is a fix; lowering one to
 * make a pin pass is reintroducing the bug this file exists to catch.
 */
const ADVISORY_FLOORS: Readonly<Record<string, string>> = {
  "@isaacs/brace-expansion": "5.0.1",
  axios: "1.18.0",
  esbuild: "0.28.1",
  "fast-xml-parser": "5.10.1",
  "form-data": "4.0.6",
  handlebars: "4.7.9",
  lodash: "4.18.0",
  multer: "2.2.0",
  systeminformation: "5.31.7",
  tar: "7.5.21",
  undici: "6.28.0",
  vite: "8.0.16",
  "websocket-driver": "0.7.5",
  ws: "8.21.0",
};

/** package.json sections a `force` group may pin a dependency range in. */
const PINNED_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
  "resolutions",
] as const;

/** One forced pin, with enough context to name it in a failure. */
interface ForcedPin {
  readonly template: string;
  readonly section: string;
  readonly name: string;
  readonly range: string;
}

/**
 * Collect every literal range a template forces, across all pinned sections.
 * @param template - Repository-relative path to a package.lisa.json
 * @returns Forced pins whose value is a comparable semver range
 */
function collectForcedPins(template: string): readonly ForcedPin[] {
  const parsed = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, template), "utf8")
  ) as { readonly force?: Record<string, Record<string, unknown>> };

  return PINNED_SECTIONS.flatMap(section =>
    Object.entries(parsed.force?.[section] ?? {}).flatMap(([name, range]) =>
      typeof range === "string" && validRange(range) !== null
        ? [{ template, section, name, range }]
        : []
    )
  );
}

/**
 * Locate every package.lisa.json shipped in the repository.
 * @param dir - Absolute directory to walk
 * @returns Repository-relative paths, sorted
 */
function findTemplates(dir: string): readonly string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name === "dist"
          ? []
          : findTemplates(full);
      }
      return entry.name === "package.lisa.json"
        ? [path.relative(REPO_ROOT, full)]
        : [];
    })
    .sort((a, b) => a.localeCompare(b));
}

const TEMPLATES = findTemplates(REPO_ROOT);
const FORCED_PINS = TEMPLATES.flatMap(collectForcedPins).filter(
  pin => ADVISORY_FLOORS[pin.name] !== undefined
);

describe("shipped security pin floors", () => {
  it("finds the templates it is meant to police", () => {
    expect(TEMPLATES.length).toBeGreaterThan(0);
    expect(FORCED_PINS.length).toBeGreaterThan(0);
  });

  it.each(FORCED_PINS)(
    "$template forces $name in $section at $range, admitting nothing below its advisory floor",
    ({ name, range }) => {
      const floor = ADVISORY_FLOORS[name] as string;
      // `intersects` answers the only question that matters: does this range
      // admit ANY release below the patch? A floor that merely starts at the
      // right version still fails here if the range reaches under it.
      expect(intersects(range, `<${floor}`)).toBe(false);
    }
  );
});
