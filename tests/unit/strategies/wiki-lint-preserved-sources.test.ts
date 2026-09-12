/**
 * A preserved source note may not be blocked for describing a subject that moved.
 *
 * `wiki/sources/` is provenance, not navigation. The wiki contract's "Required
 * Provenance" section says a source note records "what was ingested, when, from
 * where, and with what scope", so a path it names is a claim about the subject
 * AT INGESTION TIME. Subjects move on: this repository's own
 * `sources/repository/2026-05-14-monorepo-baseline.md` cites
 * `docs/lisa-architecture.svg`, which existed on that date and was deleted
 * three months later by the commit that made the wiki the documentation home.
 *
 * The link is not broken. It is accurate about a repository that changed, and
 * neither remedy a reader has is legitimate — repointing it falsifies the
 * record, deleting it destroys the provenance the note exists to carry. A
 * finding whose only fixes damage the wiki must not be able to block, so these
 * are reported at INFO: printed in every run, present in `--json`, counted in
 * the summary, blocking in neither default nor `--strict` mode.
 *
 * The shipped CI workflow (`plugins/src/wiki/ci/lisa-wiki-validate.yml`) runs
 * `--strict`, under which WARN blocks too — so downgrading to WARN would have
 * changed the label and nothing else.
 *
 * CodySwannGT/lisa#3622.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const LINT_SCRIPT = path.resolve("plugins/src/wiki/scripts/lint-wiki.mjs");

/** Where a preserved note lives, and where authored pages live. */
const SOURCE_NOTE = "sources/repository/2026-05-14-snapshot.md";
const AUTHORED_PAGE = "concepts/a.md";

/** A `.md` target and an asset target, neither of which the fixture creates. */
const MISSING_PAGE = "docs/gone-since-ingestion.md";
const MISSING_ASSET = "docs/gone-since-ingestion.svg";

let fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures) {
    rmSync(fixture, { recursive: true, force: true });
  }
  fixtures = [];
});

/**
 * Builds a minimal, structurally valid wiki whose only defect is the caller's.
 *
 * Frontmatter is switched off and every required file and directory is
 * present, so any finding the linter reports came from the markdown the test
 * wrote and not from the scaffold.
 * @param body - Markdown for each of the two pages under test
 * @param body.authored - Markdown for the authored category page
 * @param body.source - Markdown for the preserved source note
 * @returns The fixture root and its wiki root
 */
function makeWiki(body: { authored: string; source: string }): {
  root: string;
  wikiRoot: string;
} {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-wiki-preserved-"));
  const wikiRoot = path.join(root, "wiki");
  fixtures.push(root);

  for (const dir of ["schema", "sources/repository", "state", "concepts"]) {
    mkdirSync(path.join(wikiRoot, dir), { recursive: true });
  }
  writeFileSync(
    path.join(wikiRoot, "index.md"),
    `# Index\n\n- [A concept](${AUTHORED_PAGE})\n`
  );
  writeFileSync(path.join(wikiRoot, "start-here.md"), "# Start here\n");
  writeFileSync(
    path.join(wikiRoot, "schema", "llm-wiki-contract.md"),
    "# Contract\n"
  );
  writeFileSync(
    path.join(wikiRoot, "log.md"),
    "| Date | Operation |\n| 2026-06-06 | fixture |\n"
  );
  writeFileSync(
    path.join(wikiRoot, "lisa-wiki.config.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        org: "Fixture",
        mode: "embedded",
        wikiRoot: "wiki",
        frontmatter: false,
        categories: ["concepts"],
        sourceRetention: "sanitized-note-only",
      },
      null,
      2
    )}\n`
  );
  writeFileSync(path.join(wikiRoot, AUTHORED_PAGE), body.authored);
  writeFileSync(path.join(wikiRoot, SOURCE_NOTE), body.source);
  return { root, wikiRoot };
}

/**
 * Runs the wiki linter over a fixture in the mode the shipped CI uses.
 * @param root - Fixture root directory
 * @param extra - Additional CLI flags
 * @returns The completed child-process result
 */
function lint(root: string, extra: readonly string[] = []) {
  return boundedSpawnSync({
    label: "lint-wiki.mjs",
    command: process.execPath,
    args: [
      LINT_SCRIPT,
      "--wiki",
      "wiki",
      "--config",
      "wiki/lisa-wiki.config.json",
      "--strict",
      ...extra,
    ],
    cwd: root,
  });
}

/** A source note that cites two paths the subject no longer has. */
const CITING_NOTE =
  "# Repository snapshot 2026-05-14\n\nIngested tree contained:\n\n" +
  `- [architecture diagram](${MISSING_ASSET})\n` +
  `- [design note](${MISSING_PAGE})\n\n` +
  `Source: ${MISSING_PAGE}\n`;

/** A source note that cites nothing, so it can never be the finding. */
const SILENT_NOTE = "# Repository snapshot 2026-05-14\n\nNothing citable.\n";

/** An authored page with no links at all. */
const SILENT_PAGE = "# Concept A\n\nAuthored prose with no links.\n";

describe("wiki lint: bare and backticked citations (#4151)", () => {
  it.each(["", "`"])(
    "resolves an existing citation delimited by %j",
    delimiter => {
      const fixture = makeWiki({
        authored: `${SILENT_PAGE}\nSource: ${delimiter}wiki/${SOURCE_NOTE}${delimiter}\n`,
        source: SILENT_NOTE,
      });

      const result = lint(fixture.root);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("0 fail, 0 warn, 0 info");
    }
  );

  it.each(["", "`"])(
    "still rejects a missing citation delimited by %j",
    delimiter => {
      const fixture = makeWiki({
        authored: `${SILENT_PAGE}\nSource: ${delimiter}${MISSING_PAGE}${delimiter}\n`,
        source: SILENT_NOTE,
      });

      const result = lint(fixture.root);

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        `citation path not found → ${MISSING_PAGE}`
      );
      expect(result.stdout).toContain("0 fail, 1 warn, 0 info");
    }
  );
});

describe("wiki lint: preserved sources cannot block (#3622)", () => {
  it("does not block on a preserved note citing paths the subject no longer has", () => {
    const fixture = makeWiki({ authored: SILENT_PAGE, source: CITING_NOTE });

    const result = lint(fixture.root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 fail, 0 warn, 3 info");
  });

  it("reports those three findings rather than falling silent", () => {
    // The failure mode a scoping change invites is fixing the red by no longer
    // looking. Each preserved finding must still be printed, at INFO, naming
    // the file and the path it could not resolve.
    const fixture = makeWiki({ authored: SILENT_PAGE, source: CITING_NOTE });

    const { stdout } = lint(fixture.root);

    expect(stdout).toContain(
      `ℹ [links] cited page not present → ${MISSING_PAGE}`
    );
    expect(stdout).toContain(
      `ℹ [links] cited path not present → ${MISSING_ASSET}`
    );
    expect(stdout).toContain(
      `ℹ [links] citation path not present → ${MISSING_PAGE}`
    );
    expect(stdout).toContain(SOURCE_NOTE);
  });

  it("still FAILS on the same unresolved link in authored content", () => {
    // The negative control. Without it, "preserved sources do not block" is
    // indistinguishable from "the link check no longer blocks on anything".
    const fixture = makeWiki({
      authored: `# Concept A\n\nSee [the missing page](b.md).\n`,
      source: SILENT_NOTE,
    });

    const result = lint(fixture.root);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("✗ [links] broken link → b.md");
    expect(result.stdout).toContain("1 fail, 0 warn, 0 info");
  });

  it("keeps preserved findings machine-visible in --json", () => {
    // A non-blocking finding that no consumer can read is a deleted finding.
    const fixture = makeWiki({ authored: SILENT_PAGE, source: CITING_NOTE });

    const parsed = JSON.parse(lint(fixture.root, ["--json"]).stdout) as {
      fails: number;
      warns: number;
      infos: number;
      items: { status: string; group: string; id: string }[];
    };

    expect({
      fails: parsed.fails,
      warns: parsed.warns,
      infos: parsed.infos,
    }).toEqual({ fails: 0, warns: 0, infos: 3 });
    expect(
      parsed.items.filter(item => item.status === "INFO").map(item => item.id)
    ).toEqual([
      "source-citation-asset",
      "source-citation",
      "source-citation-path",
    ]);
  });
});

describe("wiki lint: targets it was never entitled to resolve (#3622)", () => {
  // Pins the two behaviors a reader is most likely to assume are the defect.
  // Both were already correct before #3622 and are asserted so a future
  // scoping change cannot regress them into the blocking path.
  it("reports nothing for a dangling wikilink or an external URL", () => {
    // A `[[name]]` matching nothing yet is sanctioned — it marks a page worth
    // writing later — and an http(s) target is not this tool's to resolve.
    const fixture = makeWiki({
      authored:
        "# Concept A\n\nA dangling [[page-not-written-yet]], an autolink " +
        "<https://example.invalid/x>, and a [named](https://example.invalid/y.md).\n",
      source: SILENT_NOTE,
    });

    const result = lint(fixture.root);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 fail, 0 warn, 0 info");
  });
});
