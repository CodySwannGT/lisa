/**
 * Tests for the routing-implied credential floor.
 *
 * The floor exists so a project cannot be missing a credential its own routing
 * makes mandatory just because nobody typed it into `secrets.require`. These
 * assert the mapping and, more importantly, the two silences: an unknown vendor
 * and an absent one both contribute nothing rather than throwing.
 * @module tests/unit/secrets/routing-floor
 */

import { describe, expect, it } from "vitest";

import {
  routingFloor,
  routingFloorReasons,
} from "../../../plugins/src/base/skills/lisa-secrets-access/scripts/routing-floor.mjs";

describe("routingFloor", () => {
  it("derives the tracker credential", () => {
    expect(routingFloor({ tracker: "github" })).toEqual(["GH_TOKEN"]);
    expect(routingFloor({ tracker: "linear" })).toEqual(["LINEAR_API_KEY"]);
    expect(routingFloor({ tracker: "jira" })).toEqual(["ATLASSIAN_API_TOKEN"]);
  });

  it("derives the source credential", () => {
    expect(routingFloor({ source: "notion" })).toEqual(["NOTION_API_TOKEN"]);
    expect(routingFloor({ source: "confluence" })).toEqual([
      "ATLASSIAN_API_TOKEN",
    ]);
  });

  it("unions tracker and source, sorted", () => {
    expect(routingFloor({ tracker: "github", source: "notion" })).toEqual([
      "GH_TOKEN",
      "NOTION_API_TOKEN",
    ]);
  });

  it("de-duplicates when JIRA and Confluence share one token", () => {
    expect(routingFloor({ tracker: "jira", source: "confluence" })).toEqual([
      "ATLASSIAN_API_TOKEN",
    ]);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(routingFloor({ tracker: "  GitHub " })).toEqual(["GH_TOKEN"]);
  });

  it("returns nothing for absent routing", () => {
    expect(routingFloor()).toEqual([]);
    expect(routingFloor({})).toEqual([]);
  });

  it("returns nothing for an unknown vendor rather than throwing", () => {
    // A tracker Lisa does not recognise is a routing error that config
    // dispatch reports with a better message. Failing here would make a
    // credential preflight the place a typo in `tracker` first surfaces.
    expect(routingFloor({ tracker: "bugzilla" })).toEqual([]);
  });

  it("ignores non-string routing values", () => {
    expect(routingFloor({ tracker: 7 as never })).toEqual([]);
    expect(routingFloor({ tracker: null as never })).toEqual([]);
  });
});

describe("routingFloorReasons", () => {
  it("names the routing key that implied each credential", () => {
    expect(routingFloorReasons({ tracker: "github" })).toEqual({
      GH_TOKEN: ['tracker is "github"'],
    });
  });

  it("records both reasons when one token serves tracker and source", () => {
    expect(
      routingFloorReasons({ tracker: "jira", source: "confluence" })
    ).toEqual({
      ATLASSIAN_API_TOKEN: ['tracker is "jira"', 'source is "confluence"'],
    });
  });

  it("is empty when nothing is routed", () => {
    expect(routingFloorReasons({})).toEqual({});
  });
});
