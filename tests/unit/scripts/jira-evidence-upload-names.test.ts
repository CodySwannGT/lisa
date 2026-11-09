/**
 * The release-upload name contract for every copy of the Jira `post-evidence.sh`.
 *
 * Every pull request's evidence lands in one shared `pr-assets` release, and
 * `gh release upload --clobber` deletes a same-named asset before uploading.
 * An asset name without the pull request number therefore lets one pull
 * request destroy another's evidence (CodySwannGT/lisa#4639). This suite reads
 * every source and generated copy and fails if any `gh release upload` sends a
 * path whose name — followed through the variables it is built from — does not
 * carry `pr-${PR_NUMBER}-`. The executed proof lives in
 * `tests/integration/jira-evidence-pr-scoped-uploads.test.ts`.
 * @module tests/unit/scripts/jira-evidence-upload-names
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkoutFiles } from "../../helpers/tracked-files.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const SCOPED_PREFIX = "pr-${PR_NUMBER}-";
const SOURCES = [
  "plugins/src/base/skills/lisa-jira-evidence/scripts/post-evidence.sh",
  "plugins/src/expo/skills/jira-evidence/scripts/post-evidence.sh",
  "plugins/src/rails/skills/jira-evidence/scripts/post-evidence.sh",
];
const COPIES = checkoutFiles(repoRoot)
  .filter(file => path.basename(file) === "post-evidence.sh")
  .filter(file => file.includes("jira-evidence"))
  .sort((left, right) => left.localeCompare(right));

/**
 * Expand the shell variables a token refers to, using the script's own
 * assignments, so a scoped name built through a variable is recognised.
 * @param text - Whole script text.
 * @param token - Text to expand.
 * @param depth - Remaining expansion levels.
 * @returns The token with every resolvable variable replaced by its definition.
 */
function expand(text: string, token: string, depth = 3): string {
  if (depth === 0) return token;
  return token.replace(/\$\{?([A-Z_]+)\}?/g, (whole, name: string) => {
    if (name === "PR_NUMBER") return whole;
    const assignment = new RegExp(`^\\s*${name}=(.+)$`, "m").exec(text);
    return assignment ? expand(text, assignment[1] ?? "", depth - 1) : whole;
  });
}

/**
 * Every `gh release upload` in a script, with its expanded uploaded path.
 * @param text - Whole script text.
 * @returns One entry per upload line.
 */
function uploads(text: string): readonly { line: string; asset: string }[] {
  return text
    .split("\n")
    .filter(line => /^\s*gh release upload\b/.test(line))
    .map(line => {
      const asset = line.trim().split(/\s+/)[4] ?? "";
      return { line, asset: expand(text, asset) };
    });
}

describe("every post-evidence.sh uploads pull-request-scoped asset names", () => {
  it("finds every source and generated copy", () => {
    expect(COPIES.length).toBeGreaterThanOrEqual(21);
    for (const source of SOURCES) expect(COPIES).toContain(source);
  });

  it.each(COPIES)("%s scopes every release upload by PR number", copy => {
    const found = uploads(readFileSync(path.join(repoRoot, copy), "utf8"));

    expect(found.length, copy).toBeGreaterThan(0);
    for (const { line, asset } of found) {
      expect(asset, line).toContain(SCOPED_PREFIX);
    }
  });

  // Pins the acceptance-criteria clause "it fails for any --clobber upload of a
  // name that does not include the pull request number". --clobber deletes the
  // same-named asset first, so on an unscoped name it destroys another pull
  // request's evidence; on a scoped name it can only replace this PR's own.
  it.each(COPIES)("%s clobbers only pull-request-scoped names", copy => {
    const found = uploads(readFileSync(path.join(repoRoot, copy), "utf8"));
    const clobbering = found.filter(({ line }) => line.includes("--clobber"));

    for (const { line, asset } of clobbering) {
      expect(asset, line).toContain(SCOPED_PREFIX);
    }
  });

  // `gh release create <tag> <files…>` uploads its file arguments under their
  // bare names — a second upload path that would dodge the checks above.
  it.each(COPIES)("%s never uploads files through gh release create", copy => {
    const creates = readFileSync(path.join(repoRoot, copy), "utf8")
      .split("\n")
      .filter(line => /^\s*gh release create\b/.test(line));

    for (const line of creates) {
      const positional = line.trim().split(/\s+/).slice(4);
      const firstFlag = positional.findIndex(token => token.startsWith("-"));
      const files =
        firstFlag === -1 ? positional : positional.slice(0, firstFlag);
      expect(files, line).toEqual([]);
    }
  });

  it.each(COPIES)("%s validates PR_NUMBER before its first upload", copy => {
    const text = readFileSync(path.join(repoRoot, copy), "utf8");
    const guard = text.indexOf('"$PR_NUMBER" =~ ^[1-9][0-9]*$');
    // Anchored to a command line, so a comment or echoed text that mentions
    // the command cannot stand in for the first real upload.
    const firstUpload = text.search(/^\s*gh release upload\b/m);

    expect(guard, copy).toBeGreaterThan(-1);
    expect(firstUpload, copy).toBeGreaterThan(-1);
    expect(guard, copy).toBeLessThan(firstUpload);
  });
});

describe("the three source scripts stay identical", () => {
  it("keeps base, expo and rails byte-identical", () => {
    const [first, ...rest] = SOURCES.map(source =>
      readFileSync(path.join(repoRoot, source), "utf8")
    );
    for (const text of rest) expect(text).toBe(first);
  });
});
