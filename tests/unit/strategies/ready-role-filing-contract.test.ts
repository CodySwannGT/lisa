/**
 * Contract coverage for work unit D — closing the non-ready filing paths.
 *
 * The originating failure: an agent closed a non-reproducing ticket, filed a
 * real defect it found beside it, and left the new ticket sitting. Filing
 * without the ready role is an incomplete handoff — no other agent will ever
 * pick it up.
 *
 * Per `wiki/decisions/2026-08-12-in-session-ticket-ready-role.md` this suite
 * pins four things that were previously free to drift:
 *
 * 1. **Omitted `build_ready` normalizes to NOT ready on every vendor.** This is
 *    a deliberate breaking change for GitHub and Linear, whose writers treated
 *    omission as ready (GitHub's validator even documented normalizing
 *    omitted → `true`). Ready becomes an explicit claim rather than an accident
 *    of which tracker a project happens to use.
 * 2. **Filing without ready and without a human-gate marker is incomplete.**
 *    Writers require `build_ready: true` or an explicit `human_gate` reason.
 * 3. **`lisa-exploratory-qa` is the *named* human-gate exception**, not drift —
 *    exploratory findings are candidate defects whose product significance a
 *    human should judge, so its `ready=false` is an explicit marker.
 * 4. **Two claim-time guards** adopted from acmeorgb's hand-rolled
 *    sprint-loop: an already-implemented ready item switches to
 *    verify-and-close instead of being built twice, and two failed attempts on
 *    the same item move it to blocked instead of burning cycles.
 *
 * Every assertion runs against both the skill/rule source (`plugins/src/...`)
 * and the generated artifact (`plugins/lisa/...`), so a source edit without
 * `bun run build:plugins` — or an artifact-only edit — fails the suite.
 * @module tests/unit/strategies/ready-role-filing-contract
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/** Source + generated plugin roots for the base plugin. */
const ROOTS = ["plugins/src/base", "plugins/lisa"] as const;

/** The three vendor writers that must converge on one normalization. */
const WRITERS = [
  "lisa-github-write-issue",
  "lisa-linear-write-issue",
  "lisa-jira-write-ticket",
] as const;

/** The three vendor build-intake arms that must cite the shared guard slug. */
const BUILD_INTAKES = [
  "lisa-github-build-intake",
  "lisa-jira-build-intake",
  "lisa-linear-build-intake",
] as const;

/** The heading anchoring the `build_ready` write-control section in each writer. */
const BUILD_READY_HEADING = "Build-ready control input";

/**
 * Read a file relative to a plugin root.
 * @param root plugin root directory
 * @param rel path relative to that root
 * @returns file contents
 */
const read = (root: string, rel: string): string =>
  readFileSync(path.resolve(root, rel), "utf8");

/**
 * Read a skill's SKILL.md from a plugin root.
 * @param root plugin root directory
 * @param name skill directory name
 * @returns SKILL.md contents
 */
const skill = (root: string, name: string): string =>
  read(root, `skills/${name}/SKILL.md`);

/** The explicit build-ready claim every in-session filing site must carry. */
const EXPLICIT_READY = "build_ready: true";

/** The rule slug every writer, validator, and filing site must cite. */
const RULE_SLUG = "ready-role-filing";

/** The write-control input that declares a deliberate human hold. */
const HUMAN_GATE = "human_gate";

describe("ready-role-filing rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/reference/ready-role-filing.md");
    const reference = read(root, "rules/reference/ready-role-filing.md");

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/ready-role-filing.md"
      );
    });

    it("states that omitted build_ready is NOT build-ready on every vendor", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/omitted/i);
        expect(doc).toMatch(/not build-ready|not ready/i);
      }
      // Named explicitly so no vendor arm can quietly keep its own default.
      for (const vendor of ["JIRA", "GitHub", "Linear"]) {
        expect(reference).toContain(vendor);
      }
    });

    it("makes ready an explicit claim rather than a vendor default", () => {
      expect(reference).toMatch(/explicit claim/i);
    });

    it("requires build_ready: true or a human-gate marker on every filing", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toMatch(/incomplete handoff/i);
        expect(doc).toContain(HUMAN_GATE);
      }
      expect(reference).toContain("[lisa-human-gate]");
    });

    it("names lisa-exploratory-qa as the human-gate exception", () => {
      expect(reference).toContain("lisa-exploratory-qa");
      expect(reference).toMatch(/exception/i);
    });

    it("records the breaking change for GitHub and Linear callers", () => {
      expect(reference).toMatch(/breaking/i);
    });
  });
});

describe("claim-time-guards rule contract", () => {
  describe.each(ROOTS)("%s", root => {
    const eager = read(root, "rules/reference/claim-time-guards.md");
    const reference = read(root, "rules/reference/claim-time-guards.md");

    it("stays reachable from the eager rule index", () => {
      expect(read(root, "rules/eager/00-rule-index.md")).toContain(
        "reference/claim-time-guards.md"
      );
    });

    it("defines the already-implemented guard routing to verify-and-close", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("already-implemented");
        expect(doc).toContain("verify-and-close");
      }
      // The two deterministic ancestry probes for the item's OWN key.
      expect(reference).toContain("git log --all --grep");
      expect(reference).toMatch(/open\/merged PRs|merged PR/i);
    });

    it("distinguishes the already-implemented guard from claim-archaeology and duplicates", () => {
      expect(reference).toContain("claim-archaeology");
      expect(reference).toContain("DUPLICATE_ALREADY_FIXED");
    });

    it("defines the two-failed-attempts valve with its blocked outcome", () => {
      for (const doc of [eager, reference]) {
        expect(doc).toContain("two-failed-attempts");
        expect(doc).toMatch(/blocked/i);
      }
      expect(reference).toContain("[lisa-build-attempt]");
      expect(reference).toMatch(/stop the loop|stops the loop/i);
    });

    it("is one shared vendor-neutral slug, not per-vendor prose", () => {
      expect(reference).toMatch(/vendor-neutral/i);
      for (const arm of BUILD_INTAKES) {
        expect(reference).toContain(arm);
      }
    });
  });

  describe.each(ROOTS)("%s build-intake arms cite the slug", root => {
    describe.each(BUILD_INTAKES)("%s", name => {
      const content = skill(root, name);

      it("cites claim-time-guards rather than restating it", () => {
        expect(content).toContain("claim-time-guards");
      });

      it("routes an already-implemented item to verify-and-close", () => {
        expect(content).toContain("verify-and-close");
      });

      it("stops the loop after two failed attempts", () => {
        expect(content).toContain("two-failed-attempts");
      });
    });
  });
});

describe("vendor writers normalize omitted build_ready to not-ready", () => {
  describe.each(ROOTS)("%s", root => {
    describe.each(WRITERS)("%s", name => {
      const content = skill(root, name);
      const section = content.slice(content.indexOf(BUILD_READY_HEADING));

      it("anchors the change to the ready-role-filing rule", () => {
        expect(section).toContain(RULE_SLUG);
      });

      it("documents omitted as NOT build-ready", () => {
        expect(section).toMatch(
          /\*\*Omitted\*\*[^\n]*(not build-ready|NOT build-ready)/
        );
      });

      it("no longer claims omitted preserves the old ready default", () => {
        // The exact prose the three writers carried before WU-D. Its survival
        // anywhere in the section means a vendor kept its implicit-ready path.
        expect(section).not.toMatch(/Omitted[^\n]*current behavior/i);
        expect(section).not.toMatch(/Preserves what every existing caller/i);
      });

      it("keeps explicit build_ready: true as the auto-pickup path", () => {
        expect(section).toContain(EXPLICIT_READY);
      });

      it("treats a filing with neither ready nor a human gate as incomplete", () => {
        expect(section).toMatch(/incomplete handoff/i);
        expect(section).toContain(HUMAN_GATE);
      });

      it("keeps build_ready subordinate to leaf-only-lifecycle", () => {
        expect(section).toMatch(/container is never/i);
        expect(content).toContain("leaf-only-lifecycle");
      });
    });
  });
});

describe("github validator no longer normalizes omitted build_ready to true", () => {
  describe.each(ROOTS)("%s", root => {
    const content = skill(root, "lisa-github-validate-issue");

    it("normalizes an omitted build_ready to false", () => {
      expect(content).toMatch(/normalize omitted `build_ready` to `false`/);
    });

    it("drops the old omitted-to-true normalization", () => {
      expect(content).not.toMatch(/normalize omitted `build_ready` to `true`/);
      expect(content).not.toMatch(/backward-compatible default-ready/i);
    });

    it("cites the ready-role-filing rule as the source of the normalization", () => {
      expect(content).toContain(RULE_SLUG);
    });
  });
});

describe("in-session filing call sites pass build_ready explicitly", () => {
  /**
   * Skills that file complete work found during other work. Each must pass an
   * explicit `build_ready: true` — never rely on a vendor default — so the
   * SE-6799 case (a real defect found beside a non-reproducing ticket) is
   * claimable by build-intake on the next cycle with no human flipping status.
   */
  const EXPLICIT_READY_CALLERS = [
    "lisa-track",
    "lisa-monitor",
    "lisa-verify-prd",
    "lisa-repair-intake",
    "lisa-qa-fail",
  ] as const;

  describe.each(ROOTS)("%s", root => {
    describe.each(EXPLICIT_READY_CALLERS)("%s", name => {
      it("passes build_ready: true explicitly", () => {
        expect(skill(root, name)).toContain(EXPLICIT_READY);
      });
    });
  });
});

describe("exploratory-qa is the named human-gate exception", () => {
  describe.each(ROOTS)("%s", root => {
    const content = skill(root, "lisa-exploratory-qa");

    it("keeps ready=false as its default", () => {
      expect(content).toContain("ready=true|false");
      expect(content).toMatch(/default/i);
    });

    it("declares itself the named human-gate exception, not an inconsistency", () => {
      expect(content).toMatch(/named human-gate exception/i);
      expect(content).toContain(RULE_SLUG);
    });

    it("supplies an explicit human_gate marker rather than a bare omission", () => {
      expect(content).toContain(HUMAN_GATE);
    });
  });
});

describe("repair-intake sweeps ungated non-ready filings", () => {
  describe.each(ROOTS)("%s", root => {
    const content = skill(root, "lisa-repair-intake");

    it("surfaces recently filed items carrying neither the ready role nor a human gate", () => {
      expect(content).toContain("[lisa-human-gate]");
      expect(content).toContain(RULE_SLUG);
      expect(content).toMatch(/incomplete handoff/i);
    });
  });
});
