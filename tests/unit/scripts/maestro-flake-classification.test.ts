/**
 * Tests for the Maestro flake classifier — the diagnostic that tells a preamble
 * loss apart from a product regression before anybody attributes a red run.
 *
 * Upstreamed from AcmeOrgD/frontend `scripts/classify-maestro-failures.mjs`,
 * which was paid for by two proof runs that each lost four flows to sign-in:
 * run 6's Android arm was written up as a possible product regression and came
 * back all green in run 7 with no code change.
 *
 * Four cases below guard hard-won details rather than obvious behavior, and
 * each one is a bug that already happened somewhere:
 *
 *   1. The self-closing `<testcase .../>` parse trap — a greedy attribute match
 *      swallows the `/>` and merges a PASSING case into the next failing one.
 *   2. Cycle-safe `runFlow` resolution — a subflow graph with a cycle would
 *      otherwise recurse forever.
 *   3. The tie-break always favoring the product column — misfiling a preamble
 *      loss costs an investigation, misfiling a product regression HIDES it.
 *   4. Elapsed-at-gate arithmetic — `extendedWaitUntil` always burns its full
 *      ceiling, so `duration − ceiling` is the time taken to REACH the gate.
 *
 * The known-intermittent registry is covered by
 * `maestro-intermittent-registry.test.ts`.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  ANDROID,
  assertionFor,
  type ClassifierModule,
  failingReport,
  gateLines,
  LANDING_SCREEN,
  NAV_HELPER,
  PREAMBLE,
  PRODUCT,
  reader,
  SIGN_IN,
  SIGN_IN_PATH,
  loadClassifier,
} from "./maestro-flake-helpers";

const CARD_DETAIL = ".maestro/flows/card-detail.yaml";
const RUN_SIGN_IN = "- runFlow: ../subflows/sign-in.yaml\n";

let mod: ClassifierModule;

beforeAll(async () => {
  mod = await loadClassifier();
});

describe("gate extraction", () => {
  it("pairs each selector with the ceiling of its own gate", () => {
    expect(mod.extractGates(SIGN_IN)).toEqual([
      { kind: "id", selector: LANDING_SCREEN, timeoutMs: 90000 },
      { kind: "id", selector: "confirm:back", timeoutMs: 30000 },
    ]);
  });

  it("reads scrollUntilVisible as a gate, since it also burns a ceiling", () => {
    expect(
      mod.extractGates(
        [
          "- scrollUntilVisible:",
          "    element:",
          "      id: 'signin:email-input'",
          "    direction: DOWN",
          "    timeout: 20000",
          "",
        ].join("\n")
      )
    ).toEqual([
      { kind: "id", selector: "signin:email-input", timeoutMs: 20000 },
    ]);
  });

  it("ignores selectors named only in a comment", () => {
    expect(mod.extractGates("# - extendedWaitUntil: id: 'ghost'\n")).toEqual(
      []
    );
  });
});

describe("JUnit parsing", () => {
  it("does not merge a self-closing passing case into the next failing one", () => {
    // The documented trap: a greedy `[^>]*` attribute match swallows the `/` of
    // `<testcase .../>` and then hunts for the next `</testcase>`, producing ONE
    // row that reports the passing flow's name with the failing flow's message.
    const rows = mod.parseReport(
      [
        "<testsuites><testsuite>",
        '<testcase file=".maestro/flows/ok.yaml" time="10.5" status="SUCCESS"/>',
        '<testcase file=".maestro/flows/bad.yaml" time="96.3" status="ERROR">',
        "<failure>Assertion is false: &quot;2 cards&quot; is visible",
        "  at foo</failure>",
        "</testcase>",
        "</testsuite></testsuites>",
      ].join("\n")
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.file).toBe(".maestro/flows/ok.yaml");
    expect(rows[0]?.message).toBeNull();
    expect(rows[1]?.durationSec).toBe(96.3);
    expect(rows[1]?.message).toBe('Assertion is false: "2 cards" is visible');
  });
});

describe("subflow resolution", () => {
  it("resolves runFlow targets in both the shorthand and file: forms", () => {
    expect(
      mod.extractRunFlowTargets(
        [
          "- runFlow: ../subflows/sign-in-populated.yaml",
          "- runFlow:",
          "    file: ../subflows/approve-scheme-open.yaml",
        ].join("\n"),
        "/m/flows/chat.yaml"
      )
    ).toEqual([
      "/m/subflows/sign-in-populated.yaml",
      "/m/subflows/approve-scheme-open.yaml",
    ]);
  });

  it("walks the runFlow graph transitively without looping on a cycle", () => {
    const files = {
      "/m/flows/a.yaml": "- runFlow: ../subflows/b.yaml",
      "/m/subflows/b.yaml": "- runFlow: ../subflows/c.yaml",
      "/m/subflows/c.yaml": "- runFlow: ../subflows/b.yaml",
    };
    expect(mod.resolveSubflows("/m/flows/a.yaml", reader(files))).toEqual([
      "/m/subflows/b.yaml",
      "/m/subflows/c.yaml",
    ]);
  });

  it("does not loop when a preamble probe meets a cycle", () => {
    const files = {
      "/m/subflows/b.yaml": "- runFlow: c.yaml",
      "/m/subflows/c.yaml": "- runFlow: b.yaml",
    };
    expect(mod.isPreambleSubflow("/m/subflows/b.yaml", reader(files))).toBe(
      false
    );
  });

  it("treats a subflow that signs in through another as a preamble", () => {
    const files = {
      "/m/subflows/jit.yaml": "- runFlow: sign-in.yaml\n",
      [SIGN_IN_PATH]: SIGN_IN,
    };
    expect(mod.isPreambleSubflow("/m/subflows/jit.yaml", reader(files))).toBe(
      true
    );
  });

  it("treats a mid-scenario navigation helper as NOT a preamble", () => {
    const files = { "/m/subflows/open-player.yaml": NAV_HELPER };
    expect(
      mod.isPreambleSubflow("/m/subflows/open-player.yaml", reader(files))
    ).toBe(false);
  });

  it("derives preamble identity from project markers, not a filename list", () => {
    const files = {
      "/m/subflows/onboard.yaml": [
        "- tapOn:",
        "    id: 'welcome:log-in'",
        ...gateLines("home:list", 5000),
        "",
      ].join("\n"),
    };
    expect(
      mod.isPreambleSubflow("/m/subflows/onboard.yaml", reader(files))
    ).toBe(false);
    expect(
      mod.isPreambleSubflow("/m/subflows/onboard.yaml", reader(files), [
        "welcome:log-in",
      ])
    ).toBe(true);
  });
});

describe("failure-message matching", () => {
  it("matches the assertion text Maestro renders for a timed-out gate", () => {
    expect(
      mod.messageNamesSelector(assertionFor(LANDING_SCREEN), {
        kind: "id",
        selector: LANDING_SCREEN,
      })
    ).toBe(true);
  });

  it("matches the not-found text Maestro renders for a regex lookup", () => {
    expect(
      mod.messageNamesSelector("Element not found: Text matching regex: Go", {
        kind: "text",
        selector: "Go",
      })
    ).toBe(true);
  });

  it("does not match a different selector", () => {
    expect(
      mod.messageNamesSelector(assertionFor("chat:list"), {
        kind: "id",
        selector: LANDING_SCREEN,
      })
    ).toBe(false);
  });
});

describe("classification", () => {
  it("files a preamble gate failure as a preamble loss, with elapsed-at-gate", () => {
    const files = {
      "/m/flows/card-detail.yaml": RUN_SIGN_IN,
      [SIGN_IN_PATH]: SIGN_IN,
    };
    const [result] = mod.classify(
      failingReport(CARD_DETAIL, 105.6, assertionFor(LANDING_SCREEN)),
      { maestroRoot: "/m", readFile: reader(files) }
    );
    expect(result?.kind).toBe(PREAMBLE);
    expect(result?.subflow).toBe("sign-in.yaml");
    expect(result?.gateCeilingSec).toBe(90);
    // The flow reached the gate 15.6s in, then the gate burned its full 90s.
    expect(result?.elapsedAtGateSec).toBe(15.6);
  });

  it("reports no elapsed-at-gate when the matched gate declares no ceiling", () => {
    const files = {
      "/m/flows/a.yaml": "- runFlow: ../subflows/s.yaml\n",
      "/m/subflows/s.yaml": [
        "- tapOn:",
        "    id: 'landing:sign-in'",
        ...gateLines("home:scroll"),
        "",
      ].join("\n"),
    };
    const [result] = mod.classify(
      failingReport(".maestro/flows/a.yaml", 40, assertionFor("home:scroll")),
      { maestroRoot: "/m", readFile: reader(files) }
    );
    expect(result?.kind).toBe(PREAMBLE);
    expect(result?.elapsedAtGateSec).toBeNull();
  });

  it("files a failure in a mid-scenario navigation helper as product", () => {
    const files = {
      "/m/flows/player-detail.yaml": `${RUN_SIGN_IN}- runFlow: ../subflows/open-player.yaml\n`,
      [SIGN_IN_PATH]: SIGN_IN,
      "/m/subflows/open-player.yaml": NAV_HELPER,
    };
    const [result] = mod.classify(
      failingReport(
        ".maestro/flows/player-detail.yaml",
        114.9,
        assertionFor("player:ready")
      ),
      { maestroRoot: "/m", readFile: reader(files) }
    );
    expect(result?.kind).toBe(PRODUCT);
    expect(result?.gate).toBeNull();
  });

  it("gives a contested selector to the product column, never to preamble noise", () => {
    const files = {
      // The flow asserts `landing:screen` itself — that is its own subject.
      "/m/flows/logout.yaml": [
        "- runFlow: ../subflows/sign-in.yaml",
        ...gateLines(LANDING_SCREEN, 5000),
        "",
      ].join("\n"),
      [SIGN_IN_PATH]: SIGN_IN,
    };
    const [result] = mod.classify(
      failingReport(
        ".maestro/flows/logout.yaml",
        60,
        assertionFor(LANDING_SCREEN)
      ),
      { maestroRoot: "/m", readFile: reader(files) }
    );
    expect(result?.kind).toBe(PRODUCT);
  });

  it("files a failure as product when the flow is no longer on disk", () => {
    const [result] = mod.classify(
      failingReport(
        ".maestro/flows/deleted.yaml",
        12,
        assertionFor(LANDING_SCREEN)
      ),
      { maestroRoot: "/m", readFile: reader({}) }
    );
    expect(result?.kind).toBe(PRODUCT);
  });

  it("resolves a flow that lives outside the conventional flows/ directory", () => {
    // Lisa's reusable workflow takes a configurable flows directory, so the
    // upstreamed classifier cannot assume `<root>/.maestro/flows/<name>`.
    const files = {
      "/proj/e2e/native/smoke.yaml": "- runFlow: ../shared/sign-in.yaml\n",
      "/proj/e2e/shared/sign-in.yaml": SIGN_IN,
    };
    const [result] = mod.classify(
      failingReport("e2e/native/smoke.yaml", 30, assertionFor(LANDING_SCREEN)),
      { maestroRoot: "/m", projectRoot: "/proj", readFile: reader(files) }
    );
    expect(result?.kind).toBe(PREAMBLE);
  });

  it("ships the reference project's sign-in markers as the documented default", () => {
    expect(mod.DEFAULT_SIGN_IN_MARKERS).toEqual([
      "landing:sign-in",
      "signin:email-input",
    ]);
  });

  it("carries no intermittent annotation when no registry is supplied", () => {
    const [result] = mod.classify(
      failingReport(CARD_DETAIL, 20, assertionFor("checkout:total")),
      { maestroRoot: "/m", readFile: reader({}), platform: ANDROID }
    );
    expect(result?.intermittent).toBeNull();
  });
});
