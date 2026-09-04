/**
 * No deploy template may leave an environment silently untriggered.
 *
 * CodySwannGT/lisa#3743. The rails template shipped `# - main` commented out
 * of its trigger list with no explanation. A commented-out branch is not
 * wrong on its own — shipping production deployment opt-in is a defensible
 * default for a starter — but a BARE one is indistinguishable from an
 * accident. These files are `create-only`: a host inherits one once, never
 * sees it refreshed, and has nothing to prompt the question.
 *
 * The failure this closes is the absence of a signal. #3467 fixed a deploy job
 * that was SKIPPED when its release failed; a skipped job still renders as a
 * neutral check somebody could go read. No trigger produces no check to skip —
 * nothing on the pull request, nothing in the Actions tab, and nothing to be
 * suspicious of.
 *
 * The rule asserted here is the general one, so it binds a template nobody has
 * written yet: a commented-out branch entry must be accompanied by prose. It
 * deliberately does NOT require any particular branch to be present — which
 * environments a stack serves is a per-stack decision, and encoding a list
 * here would make this test a second, staler copy of the templates.
 * @module tests/unit/config/deploy-template-triggers
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** A commented-out list entry, e.g. `# - main`. */
const COMMENTED_BRANCH = /^\s*#\s*-\s+\S+\s*$/u;

/** Any comment line that is not itself a commented-out list entry. */
const EXPLANATORY_COMMENT = /^\s*#(?!\s*-\s+\S+\s*$).*\S/u;

/**
 * Every stack's deploy workflow template.
 *
 * Discovered by scanning the stack directories rather than listed. A hardcoded
 * roster cannot see a template nobody added it to, which is exactly the shape
 * of defect this file guards — and the sweep that produced #3743 found a
 * deploy template (`nestjs`) that the ticket's own list had missed.
 * @returns Repo-relative paths to each deploy template found
 */
function discoverDeployTemplates(): string[] {
  return fs
    .readdirSync(REPO_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .map(entry =>
      path.join(entry.name, "create-only", ".github", "workflows", "deploy.yml")
    )
    .filter(relative => fs.existsSync(path.join(REPO_ROOT, relative)));
}

describe("deploy workflow templates", () => {
  const templates = discoverDeployTemplates();

  it("finds the deploy templates it is asserting about", () => {
    // Without this, deleting or relocating every template would make the
    // assertion below vacuously true rather than red.
    expect(templates.length).toBeGreaterThanOrEqual(4);
  });

  it.each(templates)(
    "%s documents any branch it comments out of its trigger list",
    relative => {
      const lines = fs
        .readFileSync(path.join(REPO_ROOT, relative), "utf-8")
        .split("\n");
      const commented = lines.filter(line => COMMENTED_BRANCH.test(line));
      if (commented.length === 0) return;

      // CONTIGUOUS adjacency, not a line window. The first version of this
      // scanned the 40 lines above the entry, and the rails file's own
      // "Seeded by Lisa on first setup" banner sat inside that window — so
      // the test passed against the exact defect it was written for. Prose
      // anywhere else in the file, however sincere, says nothing about why
      // THIS branch is absent.
      //
      // Walking up only through unbroken comment lines means the explanation
      // has to be attached to the entry. `- staging` on the line above breaks
      // the run, which is what made the bare `# - main` pass before.
      const firstCommented = lines.findIndex(line =>
        COMMENTED_BRANCH.test(line)
      );
      let cursor = firstCommented - 1;
      let explained = false;
      while (cursor >= 0 && lines[cursor]?.trim().startsWith("#")) {
        if (EXPLANATORY_COMMENT.test(lines[cursor] ?? "")) {
          explained = true;
          break;
        }
        cursor -= 1;
      }

      expect(
        explained,
        `${relative} comments out ${commented.length} branch entr` +
          `${commented.length === 1 ? "y" : "ies"} (${commented
            .map(line => line.trim())
            .join(
              ", "
            )}) with no explanation. A bare commented-out branch is ` +
          `indistinguishable from an accident, and create-only means the host ` +
          `never gets a corrected copy. Say why it is off and what to do to ` +
          `enable it, or uncomment it.`
      ).toBe(true);
    }
  );
});
