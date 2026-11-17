/**
 * The ticket flow for missing capabilities says what the code does.
 *
 * The flow is a reference document an agent follows. It quotes the marker, the
 * output of `lisa controls gaps` and the hold reason it passes to the ticket
 * writer, and each quote is only useful while it matches the code that decides
 * it. This suite holds the document to that code, on every agent surface the
 * document ships to (CodySwannGT/lisa#4992).
 * @module tests/unit/skills/missing-capability-tickets
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { classifyHumanGateReason } from "../../../plugins/src/base/scripts/human-gate-act.mjs";
import {
  CRITERION_ID_SOURCE,
  inScopeCriteria,
  loadCriterionCatalogue,
} from "../../../src/controls/catalogue.js";
import {
  GAPS_SCHEMA_VERSION,
  listControlGaps,
} from "../../../src/controls/commands/gaps.js";
import {
  CONTROL_GAP_TAG,
  controlGapKey,
  controlGapMarker,
} from "../../../src/controls/control-gap-marker.js";
import { SUPPORTED_TRACKERS } from "../../../src/controls/tracker-config.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

const REFERENCE = path.join(
  "lisa-enforce",
  "references",
  "missing-capability-tickets.md"
);

/** Skill roots per agent surface; the first is the source the rest are built from. */
const SURFACES = [
  "plugins/src/base/skills",
  "plugins/lisa/skills",
  "plugins/lisa-cursor/skills",
  "plugins/lisa-agy/skills",
  "plugins/lisa-copilot/skills",
  "plugins/lisa-devin/skills",
] as const;

/**
 * Read the reference document of one surface.
 * @param surface - A skill root, relative to the repository
 * @returns The document
 */
function reference(surface: string): string {
  return readFileSync(path.join(REPO_ROOT, surface, REFERENCE), "utf8");
}

const TEXT = reference(SURFACES[0]);

/** The document with every run of white space as one space, so a wrap is not a difference. */
const PROSE = TEXT.replaceAll(/\s+/gu, " ");

/**
 * The example the document walks through: a gap under a folder. Only a
 * requirement the catalogue says is answered per part can have a finding
 * there, so the example has to be one (CodySwannGT/lisa#5007).
 */
const EXAMPLE = { criterion: "SI8", scope: "api" } as const;

/**
 * The first fenced block of a language in the document.
 * @param language - The fence's language tag
 * @returns The block's content
 */
function fenced(language: string): string {
  const fence = "`".repeat(3);
  return (
    new RegExp(
      String.raw`${fence}${language}\n([\s\S]*?)\n\s*${fence}`,
      "u"
    ).exec(TEXT)?.[1] ?? ""
  );
}

describe("the missing-capability ticket flow", () => {
  it.each(SURFACES.slice(1))("ships unchanged to %s", surface => {
    expect(reference(surface)).toBe(TEXT);
  });

  it("starts from the command, and names the fallback for a machine without lisa on the PATH", () => {
    expect(fenced("bash")).toBe("lisa controls gaps");
    expect(PROSE).toContain("bunx @codyswann/lisa controls gaps");
  });

  it("shows the command's output with exactly the fields the command prints", () => {
    const shown = JSON.parse(fenced("json")) as {
      readonly schema_version: number;
      readonly tracker: Record<string, unknown>;
      readonly gaps: readonly Record<string, unknown>[];
    };
    const [real] = listControlGaps(
      {
        schema_version: 1,
        scopes: [".", EXAMPLE.scope],
        findings: [
          {
            ...EXAMPLE,
            state: "missing",
            what: "Nothing does this.",
            why: "It matters.",
            next: "Add it.",
            mechanisms: [],
          },
        ],
        questions: [],
        answers: [],
        probes: [],
      },
      [
        {
          id: EXAMPLE.criterion,
          title: "A title",
          in_scope: true,
          question: "Is it done?",
          answered: "part",
        },
      ]
    );

    expect(shown.schema_version).toBe(GAPS_SCHEMA_VERSION);
    expect(Object.keys(shown)).toEqual([
      "schema_version",
      "report",
      "tracker",
      "gaps",
    ]);
    expect(Object.keys(shown.tracker)).toEqual([
      "configured",
      "name",
      "problem",
      "question",
    ]);
    expect(Object.keys(shown.gaps[0] ?? {})).toEqual(Object.keys(real ?? {}));
    expect(shown.gaps[0]).toMatchObject({
      ...EXAMPLE,
      part: real?.part,
      key: real?.key,
      marker: real?.marker,
      outcome: null,
    });
  });

  it("walks through a gap the report check would accept under a folder", () => {
    const criterion = inScopeCriteria(loadCriterionCatalogue()).find(
      entry => entry.id === EXAMPLE.criterion
    );

    expect(EXAMPLE.scope).not.toBe(".");
    expect(criterion?.answered).toBe("part");
  });

  it("quotes the marker and the key the code produces for its example", () => {
    const marker = controlGapMarker(EXAMPLE.criterion, EXAMPLE.scope);

    expect(TEXT.split(marker).length - 1).toBeGreaterThanOrEqual(2);
    expect(PROSE).toContain(
      `"key": "${controlGapKey(EXAMPLE.criterion, EXAMPLE.scope)}"`
    );
  });

  it("matches a ticket on the tag and the key, never on the title", () => {
    expect(PROSE).toContain(
      `only when its description contains both \`${CONTROL_GAP_TAG}\` and \`key=<key>\``
    );
    expect(PROSE).toContain("never on the title");
    expect(PROSE).toMatch(/open and\s+closed/u);
  });

  it("mentions a requirement's id only where the marker or the output carries it", () => {
    const withId = TEXT.split("\n").filter(line =>
      new RegExp(String.raw`\b(?:${CRITERION_ID_SOURCE})\b`, "u").test(line)
    );

    expect(withId.length).toBeGreaterThan(0);
    withId.forEach(line => {
      expect(line).toMatch(/criterion=SI8 |"criterion": "SI8"/u);
    });
  });

  it("names every tracker the command can report", () => {
    SUPPORTED_TRACKERS.forEach(name => {
      expect(PROSE).toContain(`\`${name}\``);
    });
  });
});

describe("how a ticket is filed", () => {
  it("goes through the vendor-neutral writer and nothing else", () => {
    expect(PROSE).toContain("Every ticket goes through `lisa-tracker-write`");
    expect(PROSE).toContain(
      "No direct tracker command, no vendor-specific writer"
    );
    expect(TEXT).not.toMatch(/gh issue create|lisa-github-write-issue/u);
    expect(TEXT).not.toMatch(/lisa-jira-write-ticket|lisa-linear-write-issue/u);
  });

  it("holds the ticket by default, with a reason the writer accepts as the operator's hold", () => {
    const reason = /human_gate: "([^"]+)"/u.exec(TEXT)?.[1] ?? "";

    expect(TEXT).toMatch(/build_ready: false\n\s*human_gate: "/u);
    expect(classifyHumanGateReason(reason)).toMatchObject({
      valid: true,
      act: "operator-hold",
    });
    expect(classifyHumanGateReason(reason, { mode: "strict" })).toMatchObject({
      valid: true,
      act: "operator-hold",
    });
  });

  it("files ready to build only when the operator asked", () => {
    expect(PROSE).toContain(
      "`true` only when the operator asked for it by passing `build_ready=true`"
    );
    expect(TEXT).toMatch(/```text\n\s*build_ready: true\n\s*```/u);
    expect(PROSE).toContain("Pass no `human_gate`");
    expect(PROSE).toContain(
      "It never files a ticket ready to build unless the operator passed `build_ready=true`"
    );
  });

  it("leaves a ticket an earlier run filed exactly as it is", () => {
    expect(PROSE).toContain(
      "An existing ticket is never changed by this flow."
    );
  });

  it("files nothing and reports blocked when there is no tracker", () => {
    expect(PROSE).toContain(
      "Do not search. Do not call `lisa-tracker-write`. Run no tracker command. **Zero tickets.**"
    );
    expect(PROSE).toContain("outcome `blocked`, the reason `tracker.problem`");
    expect(PROSE).toContain("the question `tracker.question`");
  });

  it("never files on a search that did not happen", () => {
    expect(PROSE).toContain(
      "A ticket is never filed on the strength of a search that did not happen."
    );
  });

  it("tells the operator which way of closing the ticket stops it coming back", () => {
    expect(TEXT).toContain(
      "To stop this from being raised again, close it as **Not planned**. Close it as **Completed** if it was fixed — a later recurrence may be re-filed as a regression."
    );
  });

  it("keeps the marker out of an HTML comment, which not every tracker keeps", () => {
    expect(PROSE).toContain("Do not put it inside an HTML comment");
    expect(TEXT).not.toContain("<!--");
  });
});
