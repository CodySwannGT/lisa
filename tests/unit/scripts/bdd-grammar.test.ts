/**
 * Tests for the portfolio tracker-tag grammar and the Gherkin parser.
 *
 * The grammar is one portfolio-wide shape with a per-repo vocabulary, so the
 * cases that matter are: both schemes parse, `@gh-wiki-124` resolves the way
 * acmeorgc's existing reference already writes it, and nothing else in the
 * tag namespace is ever mistaken for a ticket.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

import { REPO_ROOT, RATIFIED, WEB } from "./bdd/support";

/** Parsed tracker reference. */
type Reference = Record<string, unknown>;

describe("tracker-tag grammar", () => {
  let parseTrackerTag: (tag: string) => Reference | null;
  let trackerUrl: (reference: Reference, trackers: unknown) => string | null;

  beforeAll(async () => {
    const module = await import(
      pathToFileURL(
        path.join(REPO_ROOT, "expo/copy-overwrite/scripts/bdd/contract.mjs")
      ).href
    );
    parseTrackerTag = module.parseTrackerTag;
    trackerUrl = module.trackerUrl;
  });

  it("parses key-style tracker tags", () => {
    expect(parseTrackerTag("TUN-123")).toMatchObject({
      scheme: "key",
      key: "TUN",
      number: 123,
    });
    expect(parseTrackerTag("SE-6833")).toMatchObject({
      scheme: "key",
      key: "SE",
      number: 6833,
    });
  });

  it("parses repo-issue tracker tags with and without a repo slug", () => {
    expect(parseTrackerTag("gh-2394")).toMatchObject({
      scheme: "gh",
      repo: null,
      number: 2394,
    });
    expect(parseTrackerTag("gh-wiki-124")).toMatchObject({
      scheme: "gh",
      repo: "wiki",
      number: 124,
    });
    expect(parseTrackerTag("gh-my-repo-7")).toMatchObject({
      scheme: "gh",
      repo: "my-repo",
      number: 7,
    });
  });

  it("never mistakes an id, platform, or provenance tag for a ticket", () => {
    for (const tag of [
      "BDD-AUTH-002",
      WEB,
      "ios",
      RATIFIED,
      "figma-1-2",
      "blocked",
      "reference-only",
    ]) {
      expect(parseTrackerTag(tag), tag).toBeNull();
    }
  });

  it("emits links from per-repo templates and never invents one", () => {
    const trackers = {
      keyUrlTemplate: "https://linear.app/t/issue/{id}",
      github: {
        org: "AcmeOrgD",
        defaultRepo: "frontend",
        repos: ["frontend", "wiki"],
      },
    };
    expect(trackerUrl(parseTrackerTag("TUN-123") as Reference, trackers)).toBe(
      "https://linear.app/t/issue/TUN-123"
    );
    expect(
      trackerUrl(parseTrackerTag("gh-wiki-124") as Reference, trackers)
    ).toBe("https://github.com/AcmeOrgD/wiki/issues/124");
    expect(trackerUrl(parseTrackerTag("gh-9") as Reference, trackers)).toBe(
      "https://github.com/AcmeOrgD/frontend/issues/9"
    );
    expect(trackerUrl(parseTrackerTag("TUN-1") as Reference, {})).toBeNull();
  });
});

describe("gherkin parser", () => {
  let parseFeatureSource: (
    source: string,
    file: string,
    platforms: Set<string>
  ) => Record<string, unknown>[];

  beforeAll(async () => {
    const module = await import(
      pathToFileURL(
        path.join(REPO_ROOT, "expo/copy-overwrite/scripts/bdd/parse.mjs")
      ).href
    );
    parseFeatureSource = module.parseFeatureSource;
  });

  it("captures the feature, line, categorized tags, and primary steps", () => {
    const source =
      "Feature: Sign in\n\n  @BDD-AUTH-001 @web @ios @ratified-consent-first @TUN-9\n" +
      "  Scenario: A member signs in\n" +
      "    Given a member\n    When they sign in\n    Then they land on home\n";
    const [scenario] = parseFeatureSource(
      source,
      "bdd/features/a.feature",
      new Set([WEB, "ios"])
    );
    expect(scenario).toMatchObject({
      id: "BDD-AUTH-001",
      feature: "Sign in",
      name: "A member signs in",
      platforms: [WEB, "ios"],
      provenance: ["ratified-consent-first"],
      required: true,
      line: 4,
    });
    expect(scenario.trackers).toHaveLength(1);
    expect(scenario.primarySteps).toEqual(["Given", "When", "Then"]);
  });

  it("treats a Scenario Outline as one behavior and honours lifecycle tags", () => {
    const source =
      "Feature: F\n\n  @BDD-A-001 @web @blocked @ratified-x\n" +
      "  Scenario Outline: Outlined\n    Given a\n    When b\n    Then c\n" +
      "    Examples:\n      | x |\n      | 1 |\n      | 2 |\n";
    const scenarios = parseFeatureSource(source, "f.feature", new Set([WEB]));
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]).toMatchObject({
      required: false,
      lifecycle: ["blocked"],
    });
  });

  it("ignores comments and scopes tags to the next scenario only", () => {
    const source =
      "# @BDD-GHOST-001 in a comment must not register\nFeature: F\n\n" +
      "  @BDD-A-001 @web @ratified-x\n  Scenario: One\n    Given a\n    When b\n    Then c\n\n" +
      "  @BDD-A-002 @web @ratified-x\n  Scenario: Two\n    Given a\n    When b\n    Then c\n";
    const scenarios = parseFeatureSource(source, "f.feature", new Set([WEB]));
    expect(scenarios.map(item => item.id)).toEqual(["BDD-A-001", "BDD-A-002"]);
    expect(scenarios[1].tags).toEqual(["BDD-A-002", WEB, "ratified-x"]);
  });

  it("only treats a tag as a platform when the project declared it", () => {
    const source =
      "Feature: F\n\n  @BDD-A-001 @web @tv @ratified-x\n  Scenario: One\n" +
      "    Given a\n    When b\n    Then c\n";
    const declared = parseFeatureSource(
      source,
      "f.feature",
      new Set([WEB, "tv"])
    );
    expect(declared[0].platforms).toEqual([WEB, "tv"]);
    const undeclared = parseFeatureSource(source, "f.feature", new Set([WEB]));
    expect(undeclared[0].platforms).toEqual([WEB]);
  });
});
