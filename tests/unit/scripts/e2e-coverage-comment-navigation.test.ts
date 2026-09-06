/**
 * A comment may DECLARE coverage; it may not SIMULATE a navigation (#3444).
 *
 * `extractMaestroPaths` matched `openLink:` against the whole file with no
 * notion of YAML structure, and `extractPlaywrightPaths` did the same with
 * `.goto(`. So a comment mentioning either was read as a visit, and prose
 * credited routes no test ever opened.
 *
 * Measured in a consumer by the `unmatchedVisits()` reporting added in #3442 /
 * #3443. The flow's comment said *"the coverage gate only sees `openLink:`, so
 * they are declared here"* — a sentence doing everything right, explaining why
 * the flow uses `e2e-route:` annotations — and the extractor read it as a
 * navigation, eating ``` `openLink:`, ``` into the path `` /`, ``. That instance
 * credited nothing because it matched no route. It is the same mechanism one
 * character away from a false credit.
 *
 * ## The asymmetry these cases exist to pin
 *
 * `e2e-route:` and `e2e-route-exempt:` are read from comments ON PURPOSE — they
 * are an author declaring what a flow reaches by tapping, which no extractor
 * can see. So comment-stripping applies to the navigation patterns only. A fix
 * that stripped comments before every pattern would delete the annotation
 * channel and score those flows zero, which is why the annotation cases below
 * are not decoration.
 *
 * ## Direction of the remaining imprecision
 *
 * The JS stripper does not model `//` inside `${...}` in a template literal, or
 * inside a regex literal. Both survive as string content, so the failure mode
 * is UNDER-stripping — a comment that survives credits only what the old code
 * already credited. Over-stripping would silently delete real navigations, and
 * the string-tracking cases below pin that it cannot happen.
 *
 * These tests assert the extracted PATHS, not that the gate passes. A test
 * asserting only a passing verdict would have passed throughout the defect.
 * @module tests/unit/scripts/e2e-coverage-comment-navigation
 */
import { describe, expect, it } from "vitest";

import {
  extractMaestroPaths,
  extractPlaywrightPaths,
  stripJsComments,
  stripYamlComments,
} from "../../../expo/copy-overwrite/scripts/check-e2e-coverage.mjs";

/** The route the consumer's comment mentioned as an example. */
const WATCHLIST = "/watchlist";

/** The first two lines every Maestro flow fixture opens with. */
const FLOW_HEADER = ["appId: com.example.app", "---"];

/** A route declared by annotation because tapping cannot be extracted. */
const USERS = "/users";

describe("a Maestro comment is not a navigation", () => {
  it("credits nothing for a flow whose only openLink is in prose", () => {
    // The real comment from the consumer, verbatim in shape.
    const flow = [
      ...FLOW_HEADER,
      "# Routes this flow reaches by NAVIGATION rather than by deep link — the",
      "# coverage gate only sees `openLink:`, so they are declared here:",
      "# A comment that merely MENTIONS openLink: /watchlist as an example.",
      "- tapOn: Watchlist",
    ].join("\n");

    expect(extractMaestroPaths(flow)).toEqual([]);
  });

  it("still credits a real openLink command", () => {
    // Without this, "strip everything" would satisfy the case above.
    const flow = [...FLOW_HEADER, "- openLink: /watchlist"].join("\n");

    expect(extractMaestroPaths(flow)).toEqual([WATCHLIST]);
  });

  it("still reads an e2e-route annotation out of a comment", () => {
    // The annotation channel is deliberately in a comment. A fix that stripped
    // comments before every pattern would score this flow zero.
    const flow = [
      ...FLOW_HEADER,
      "# e2e-route: /users — hamburger menu, Manage, Manage Users.",
      "- tapOn: Manage",
    ].join("\n");

    expect(extractMaestroPaths(flow)).toEqual([USERS]);
  });

  it("keeps a fragment inside a quoted scalar", () => {
    // YAML opens a comment at `#` only after whitespace or line start, so a
    // fragment in a deep link is not a comment. Stripping it would truncate a
    // real navigation.
    expect(stripYamlComments('- openLink: "myapp://host/watchlist#tab"')).toBe(
      '- openLink: "myapp://host/watchlist#tab"'
    );
  });
});

describe("a Playwright comment is not a navigation", () => {
  it("credits nothing for a spec whose only goto is in a line comment", () => {
    const spec = [
      "test('renders', async ({ page }) => {",
      '  // Historically this used page.goto("/watchlist"); it now taps through.',
      "  await page.getByRole('link', { name: 'Watchlist' }).click();",
      "});",
    ].join("\n");

    expect(extractPlaywrightPaths(spec)).toEqual([]);
  });

  it("credits nothing for a goto inside a block comment", () => {
    const spec = [
      "/*",
      ' * await page.goto("/watchlist");',
      " */",
      "test('renders', async () => {});",
    ].join("\n");

    expect(extractPlaywrightPaths(spec)).toEqual([]);
  });

  it("still credits a real goto", () => {
    const spec = 'await page.goto("/watchlist");';

    expect(extractPlaywrightPaths(spec)).toEqual([WATCHLIST]);
  });

  it("still reads an e2e-route annotation out of a comment", () => {
    const spec = [
      "// e2e-route: /users",
      "await page.getByRole('link', { name: 'Users' }).click();",
    ].join("\n");

    expect(extractPlaywrightPaths(spec)).toEqual([USERS]);
  });

  it("does not eat an absolute URL as a comment", () => {
    // The failure this stripper had to avoid: deleting from `//` would eat the
    // rest of the line and LOSE a real navigation.
    const spec = 'await page.goto("https://host.example/watchlist");';

    expect(extractPlaywrightPaths(spec)).toEqual([WATCHLIST]);
  });

  it("leaves a comment delimiter inside a string alone", () => {
    expect(stripJsComments('const u = "a // b";')).toBe('const u = "a // b";');
    expect(stripJsComments("const u = 'a /* b */ c';")).toBe(
      "const u = 'a /* b */ c';"
    );
  });

  it("keeps an escaped quote from ending the string early", () => {
    // A mishandled escape would drop out of string state mid-literal and start
    // treating code as a comment, which is the over-stripping direction.
    expect(stripJsComments('const u = "a \\" // b";')).toBe(
      'const u = "a \\" // b";'
    );
  });
});
