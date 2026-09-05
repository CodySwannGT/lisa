/**
 * Contract coverage for CodySwannGT/lisa#3854 — the attempt valve must not
 * retire a work item permanently, and must not be tripped by the machine.
 *
 * The defect: the valve counted every `[lisa-build-attempt]` marker on an item,
 * fresh at the top of every claim, with nothing ever removing one. Two markers
 * and the item was unbuildable by any loop for the life of the item — a human
 * fixed the real cause and requeued, the next cycle counted two and blocked it
 * again. The rule's own "Recovery is deliberate" paragraph described a recovery
 * that could not run.
 *
 * Two things compound it, and both are pinned here:
 *
 * 1. **Markers were written on ANY non-success terminal outcome.** A pre-push
 *    gate killed by machine contention is errored, gate-blocked and unmerged at
 *    once — three non-success outcomes from one event that proved nothing about
 *    the work. Lisa could already tell a kill from a failure
 *    (`gate-failure-diagnosis`'s signal-exit set, and the runbook contract's
 *    `recovery-required`); the counter never asked.
 * 2. **The count was unscoped.** Nothing can un-write a comment, so the fix
 *    cannot be a clearing path — it has to change what is COUNTED. Returning the
 *    item to the ready lane ends the period the old markers describe.
 *
 * Every assertion runs against both the skill/rule source (`plugins/src/...`)
 * and the generated artifact (`plugins/lisa/...`), so a source edit without
 * `bun run build:plugins` — or an artifact-only edit — fails the suite.
 * @module tests/unit/strategies/attempt-valve-recovery-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source + generated plugin roots for the base plugin. */
const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The three vendor build-intake arms that must return the same verdict. */
const BUILD_INTAKES = [
  "lisa-github-build-intake",
  "lisa-jira-build-intake",
  "lisa-linear-build-intake",
] as const;

/**
 * The lane-history read each vendor uses, keyed by arm.
 *
 * Each is an operation that already existed for rejection detection — an item
 * that reached review and came back. Reusing them is what makes the scoped
 * count available on every tracker today rather than a new per-vendor read.
 */
const LANE_HISTORY_READ: Readonly<Record<string, string>> = {
  "lisa-github-build-intake": "LabeledEvent",
  "lisa-jira-build-intake": "changelog",
  "lisa-linear-build-intake": "history",
};

/**
 * Read a file relative to a plugin root.
 * @param root - Plugin root directory
 * @param rel - Path relative to that root
 * @returns File contents
 */
function read(root: string, rel: string): string {
  return readFileSync(path.join(process.cwd(), root, rel), "utf8");
}

/**
 * Read a skill body from a plugin root.
 * @param root - Plugin root directory
 * @param name - Skill directory name
 * @returns SKILL.md contents
 */
function skill(root: string, name: string): string {
  return read(root, path.join("skills", name, "SKILL.md"));
}

/** Anchors the `two-failed-attempts` bullet inside a build-intake arm. */
const VALVE_ANCHOR = "`two-failed-attempts` valve.";

/**
 * Just the valve bullet from a build-intake arm, not the whole file.
 *
 * Asserting against the whole file does not discriminate: `changelog`,
 * `history` and `LabeledEvent` all appear elsewhere in these skills already,
 * for rejection detection. A whole-file `toContain` for those tokens passes
 * against the UNFIXED skill — it confirms the token exists somewhere rather
 * than proving the valve reads it, which is a check that shares a variable
 * with the thing it checks. Slicing to the bullet is what makes these
 * assertions bite.
 * @param content - Full SKILL.md contents
 * @returns The valve bullet's text
 */
function valveBullet(content: string): string {
  const start = content.indexOf(VALVE_ANCHOR);
  if (start === -1) {
    // Throw rather than return the whole file: silently widening the slice
    // back to the full document is exactly the non-discriminating assertion
    // this helper exists to prevent.
    throw new Error(`valve bullet not found (anchor: ${VALVE_ANCHOR})`);
  }
  const rest = content.slice(start);
  const end = rest.indexOf("\n2. ");
  return end === -1 ? rest : rest.slice(0, end);
}

/** The one surface carrying the claim-time-guards contract since #3992. */
const CLAIM_TIME_GUARDS = "rules/reference/claim-time-guards.md";

describe("the attempt valve distinguishes the machine from the work", () => {
  describe.each(ROOTS)("%s", root => {
    // #3992 demoted claim-time-guards: the head is folded into the body, so
    // both names read the one surviving surface.
    const reference = read(root, CLAIM_TIME_GUARDS);
    const eager = reference;

    it("carries a measures= field on the marker", () => {
      // Without this field there is nowhere for the distinction to live, and
      // the counter is back to treating a contention kill as evidence about
      // the item.
      for (const doc of [eager, reference]) {
        expect(doc).toContain("measures=");
      }
      expect(reference).toMatch(/measures=<?work/);
      expect(reference).toMatch(/machine/);
    });

    it("counts only markers that measure the work", () => {
      expect(reference).toMatch(/only .*`?measures=work`?|`measures=work`/);
      expect(reference).toMatch(/terminated|signal|SIGTERM|killed/i);
    });

    it("names the two shipped discriminators rather than inventing one", () => {
      // Both already exist and are already correct. The defect was that
      // nothing carried their answer to the counter.
      expect(reference).toContain("gate-failure-diagnosis");
      expect(reference).toContain("recovery-required");
    });

    it("defaults an unlabelled marker to work, keeping the valve shut", () => {
      // Fail-open here would reopen the infinite re-claim loop the valve
      // exists to prevent — a strictly worse defect than the one being fixed.
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/(no `measures=`|unlabelled marker)[^.]*`?work`?/i);
      }
    });
  });
});

describe("the attempt valve scopes its count so recovery works", () => {
  describe.each(ROOTS)("%s", root => {
    // #3992 demoted claim-time-guards: the head is folded into the body, so
    // both names read the one surviving surface.
    const reference = read(root, CLAIM_TIME_GUARDS);
    const eager = reference;

    it("counts only markers recorded after the item re-entered the ready lane", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(
          /after the item most recently entered the ready lane/i
        );
      }
    });

    it("keeps the markers as history rather than deleting them", () => {
      // The substrate is comments, which are append-only. A fix that promised
      // to remove a marker would be undeliverable; the window moves instead.
      expect(reference).toMatch(
        /nothing deletes them|stay on the item as permanent history/i
      );
    });

    it("falls back to the unscoped count when lane history cannot be read", () => {
      // Degrading to "count nothing" would reopen the re-claim loop; degrading
      // to "block" would restore the defect. Counting every work marker keeps
      // the valve honest either way.
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/unreadable lane history|cannot be read/i);
      }
      expect(reference).toMatch(/regardless of age/i);
    });

    it("records that the documented recovery used to be inert", () => {
      // The prose was the reason nobody checked the control. Deleting this
      // note would re-arm exactly that trap for the next auditor.
      expect(reference).toContain("3854");
      expect(reference).toMatch(/described but inert|could not run/i);
    });

    it("still stops an item that keeps failing", () => {
      // Without this the fix is a regression: the valve's whole purpose is to
      // stop a scheduled loop re-claiming the same failing item forever.
      for (const doc of [eager, reference]) {
        expect(doc).toContain("two-failed-attempts");
        expect(doc).toMatch(/two or more/i);
      }
      expect(reference).toMatch(/stop the loop|stops the loop/i);
    });
  });
});

describe("every vendor arm applies both filters and reads its own lane history", () => {
  describe.each(ROOTS)("%s", root => {
    describe.each(BUILD_INTAKES)("%s", name => {
      const bullet = valveBullet(skill(root, name));

      it("applies the measures= filter", () => {
        expect(bullet).toContain("measures=work");
      });

      it("scopes the count to the current ready-lane period", () => {
        expect(bullet).toMatch(
          /most recently (gained|transitioned into|entered)/i
        );
      });

      it("reads lane history from the substrate that already exposes it", () => {
        expect(bullet).toContain(LANE_HISTORY_READ[name]);
      });

      it("writes measures= on every new marker", () => {
        // A cycle that records an unlabelled marker silently reintroduces the
        // defect for the NEXT cycle, which is the hardest version to notice.
        expect(bullet).toMatch(/measures=<?work\|machine>?/);
      });

      it("names the degradation when lane history is unavailable", () => {
        expect(bullet).toMatch(/regardless of age/i);
      });
    });
  });
});
