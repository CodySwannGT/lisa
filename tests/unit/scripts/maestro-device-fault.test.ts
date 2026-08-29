/**
 * Tests for the DEVICE column of the Maestro flake classifier — the third
 * verdict, beside `preamble` and `product`, that tells a reader the harness
 * fell over rather than the app breaking.
 *
 * ## Why the JUnit report cannot answer this
 *
 * Two device deaths are measured and written up in this repository's own
 * `maestro-native-e2e.yml` retry rationale:
 *
 *   * `maestro.android.DeviceServerDiedException` raised during `eraseText` —
 *     the uiautomator server died mid-command. Its `<failure>` element was
 *     BLANK.
 *   * a stuck IME-insets animation starving UiAutomator's `waitForIdle`, whose
 *     signature was 25 `animations-not-complete` events on the two affected
 *     flows against 0-1 across the other thirty-nine.
 *
 * The sibling arm has a third whose `<failure>` read, in its entirety,
 * `Unknown error`. A classifier keyed on the failure TEXT would have caught
 * none of them and would have looked correct the whole time, because it would
 * still have sorted every ordinary assertion failure into the right column.
 *
 * So the device verdict is derived from the RUN — Maestro's `--debug-output`
 * tree — and never from the report's failure text. The sweep in "the verdict
 * does not come from the failure text" is the negative proof of that: the same
 * evidence produces the same verdict under four different failure strings, and
 * the absence of that evidence produces NO device verdict under any of them.
 *
 * The blank-`<failure>` regression guarded here is worse than a miscolumned
 * failure: before this, `classify` dropped such a row entirely — the flow that
 * died of `DeviceServerDiedException` appeared in the summary neither as
 * product nor as preamble, and the failing-flow count read one lower than the
 * number of flows that failed.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  assertionFor,
  type ClassifierModule,
  type DebugArtifact,
  DEVICE,
  gateLines,
  PREAMBLE,
  PRODUCT,
  reader,
  SIGN_IN,
  SIGN_IN_PATH,
  loadClassifier,
} from "./maestro-flake-helpers";

/** Marker Maestro's Android driver raises when the uiautomator server dies. */
const SERVER_DIED = "maestro.android.DeviceServerDiedException";
/** Marker logcat repeats while a stuck animation starves `waitForIdle`. */
const ANIMATIONS = "animations-not-complete";

/** Stem of the flow every case classifies, as Maestro names its artifacts. */
const CARD_STEM = "card-detail";
/** Selector the flow asserts once it is past sign-in. */
const CARD_GATE = "card:detail";
/** Maestro's per-flow command log for that flow. */
const CARD_COMMANDS = `commands-(${CARD_STEM}).json`;

const CARD_DETAIL = `.maestro/flows/${CARD_STEM}.yaml`;
const CARD_DETAIL_PATH = `/m/flows/${CARD_STEM}.yaml`;
const RUN_SIGN_IN = "- runFlow: ../subflows/sign-in.yaml\n";

/** A flow that signs in, then asserts something of its own. */
const CARD_DETAIL_SRC = [
  "appId: ${MAESTRO_APP_ID}",
  "---",
  RUN_SIGN_IN.trim(),
  ...gateLines(CARD_GATE, 30000),
  "",
].join("\n");

let mod: ClassifierModule;

beforeAll(async () => {
  mod = await loadClassifier();
});

/** The in-memory flow tree every case below classifies against. */
const files = {
  [CARD_DETAIL_PATH]: CARD_DETAIL_SRC,
  [SIGN_IN_PATH]: SIGN_IN,
};

/**
 * A JUnit report whose single failing case carries exactly `message`.
 *
 * Written here rather than reusing `failingReport` because the whole point of
 * these cases is a failure element with NO text, which that helper cannot
 * express.
 * @param message - Body of the `<failure>` element, possibly empty
 * @param file - `file` attribute of the failing case
 * @returns JUnit XML
 */
function reportWithFailureText(message: string, file = CARD_DETAIL): string {
  return (
    `<testcase file="${file}" time="96.3" status="ERROR">` +
    `<failure>${message}</failure></testcase>`
  );
}

/**
 * Classify one report against the fixture tree.
 * @param xml - JUnit report
 * @param debugArtifacts - Debug-output artifacts observed for the run
 * @returns The classified failures
 */
function classified(xml: string, debugArtifacts: DebugArtifact[] = []) {
  return mod.classify(xml, {
    maestroRoot: "/m",
    projectRoot: "/",
    readFile: reader(files),
    debugArtifacts,
  });
}

/**
 * One debug artifact naming a flow, carrying `text` repeated `times` over.
 * @param name - Artifact basename, as Maestro writes it
 * @param text - Marker to repeat
 * @param times - Number of occurrences
 * @returns The artifact
 */
function artifact(name: string, text: string, times = 1): DebugArtifact {
  return {
    path: `/p/maestro-debug/.maestro/${name}`,
    text: Array.from({ length: times }, () => `... ${text} ...`).join("\n"),
  };
}

describe("JUnit rows with no failure text", () => {
  it("marks a blank <failure> element as a failure, not as a pass", () => {
    const rows = mod.parseReport(reportWithFailureText(""));
    expect(rows[0]?.failed).toBe(true);
    expect(rows[0]?.message).toBe("");
  });

  it("marks a self-closing <failure/> as a failure too", () => {
    const rows = mod.parseReport(
      `<testcase file="${CARD_DETAIL}" time="96.3" status="ERROR"><failure/></testcase>`
    );
    expect(rows[0]?.failed).toBe(true);
  });

  it("still reports a passing case as not failed", () => {
    const rows = mod.parseReport(
      `<testcase file="${CARD_DETAIL}" time="10" status="SUCCESS"/>`
    );
    expect(rows[0]?.failed).toBe(false);
    expect(rows[0]?.message).toBeNull();
  });

  it("classifies a blank-failure flow instead of dropping it silently", () => {
    // The regression this guards: `classify` skipped any row whose message was
    // falsy, so the measured `DeviceServerDiedException` loss — whose
    // `<failure>` was blank — vanished from the summary altogether.
    const failures = classified(reportWithFailureText(""));
    expect(failures).toHaveLength(1);
    expect(failures[0]?.flow).toBe(`${CARD_STEM}.yaml`);
  });
});

describe("device faults", () => {
  it("reports a device-server death as DEVICE, not as a product failure", () => {
    const failures = classified(reportWithFailureText(""), [
      artifact(CARD_COMMANDS, SERVER_DIED),
    ]);
    expect(failures[0]?.kind).toBe(DEVICE);
    expect(failures[0]?.device?.signal).toBe("fault-marker");
    expect(failures[0]?.device?.marker).toBe("DeviceServerDiedException");
  });

  it("leaves a genuine assertion failure in the product column", () => {
    const failures = classified(reportWithFailureText(assertionFor(CARD_GATE)));
    expect(failures[0]?.kind).toBe(PRODUCT);
    expect(failures[0]?.device).toBeNull();
  });

  it("outranks the preamble verdict — the harness fell over either way", () => {
    // Without the artifact this is a textbook preamble loss, so the case
    // proves the precedence rather than merely observing the device column.
    const xml = reportWithFailureText(assertionFor("landing:screen"));
    expect(classified(xml)[0]?.kind).toBe(PREAMBLE);
    expect(
      classified(xml, [artifact(CARD_COMMANDS, SERVER_DIED)])[0]?.kind
    ).toBe(DEVICE);
  });

  it("does not scan artifacts whose bytes are not text", () => {
    // A screenshot filename can name the flow and the marker both; reading one
    // as text is how a diagnostic starts inventing device faults.
    const failures = classified(reportWithFailureText(""), [
      {
        path: `/p/maestro-debug/.maestro/screenshot-${CARD_STEM}-${SERVER_DIED}.png`,
        text: SERVER_DIED,
      },
    ]);
    expect(failures[0]?.kind).toBe(PRODUCT);
  });
});

describe("the verdict does not come from the failure text", () => {
  /** Four failure strings spanning both measured device deaths and a real one. */
  const texts = [
    "",
    "Unknown error",
    assertionFor(CARD_GATE),
    "java.lang.RuntimeException: something",
  ];

  it.each(texts)(
    "returns the same device verdict when <failure> reads %j",
    text => {
      const failures = classified(reportWithFailureText(text), [
        artifact(CARD_COMMANDS, SERVER_DIED),
      ]);
      expect(failures[0]?.kind).toBe(DEVICE);
      expect(failures[0]?.device?.signal).toBe("fault-marker");
    }
  );

  it.each(texts)(
    "returns NO device verdict on the same texts with no run evidence, %j",
    text => {
      const failures = classified(reportWithFailureText(text));
      expect(failures[0]?.kind).not.toBe(DEVICE);
      expect(failures[0]?.device).toBeNull();
    }
  );
});

describe("instability counted against the run's own baseline", () => {
  /** The measured signature: 25 events on the affected flow, 0-1 elsewhere. */
  const healthyFlows = Array.from(
    { length: 6 },
    (_unused, index) => `.maestro/flows/healthy-${index}.yaml`
  );

  /**
   * A report where `CARD_DETAIL` failed and six other flows passed.
   * @returns JUnit XML
   */
  function runReport(): string {
    return [
      reportWithFailureText(""),
      ...healthyFlows.map(
        file => `<testcase file="${file}" time="20" status="SUCCESS"/>`
      ),
    ].join("");
  }

  it("flags a flow whose event count towers over the healthy flows", () => {
    const failures = classified(runReport(), [
      artifact(CARD_COMMANDS, ANIMATIONS, 25),
      ...healthyFlows.map((_unused, index) =>
        artifact(`commands-(healthy-${index}).json`, ANIMATIONS, index % 2)
      ),
    ]);
    expect(failures[0]?.kind).toBe(DEVICE);
    expect(failures[0]?.device?.signal).toBe("instability");
    expect(failures[0]?.device?.count).toBe(25);
  });

  it("leaves a flow carrying the baseline's own event count alone", () => {
    const failures = classified(runReport(), [
      artifact(CARD_COMMANDS, ANIMATIONS, 1),
      ...healthyFlows.map((_unused, index) =>
        artifact(`commands-(healthy-${index}).json`, ANIMATIONS, 1)
      ),
    ]);
    expect(failures[0]?.kind).toBe(PRODUCT);
  });

  it("does not flag a whole-run elevation, where nothing stands out", () => {
    // Every flow at 25 is a degraded RUN, not a flow the device killed. A
    // ratio test would call every one of them a device fault and empty the
    // product column, which is the expensive direction to be wrong in.
    const failures = classified(runReport(), [
      artifact(CARD_COMMANDS, ANIMATIONS, 25),
      ...healthyFlows.map((_unused, index) =>
        artifact(`commands-(healthy-${index}).json`, ANIMATIONS, 25)
      ),
    ]);
    expect(failures[0]?.kind).toBe(PRODUCT);
  });
});

describe("artifact attribution", () => {
  it("names a flow by its file stem", () => {
    expect(mod.flowArtifactKeys(CARD_DETAIL, CARD_DETAIL_SRC)).toContain(
      CARD_STEM
    );
  });

  it("also names it by the `name:` its header declares", () => {
    expect(
      mod.flowArtifactKeys(
        CARD_DETAIL,
        ["appId: com.example", "name: Card Detail", "---", "- launchApp"].join(
          "\n"
        )
      )
    ).toEqual([CARD_STEM, "Card Detail"]);
  });

  it("ignores a `name:` that appears after the header separator", () => {
    expect(
      mod.flowArtifactKeys(
        CARD_DETAIL,
        ["appId: com.example", "---", "- runFlow:", "    name: Nested"].join(
          "\n"
        )
      )
    ).toEqual([CARD_STEM]);
  });

  it("gives an artifact to the longest flow key that names it", () => {
    // `card-detail-2`'s artifacts contain `card-detail` as a substring. A
    // first-match rule would read the sibling's device death as this flow's.
    const sibling = `.maestro/flows/${CARD_STEM}-2.yaml`;
    const keys = [
      { flow: CARD_DETAIL, keys: [CARD_STEM] },
      { flow: sibling, keys: [`${CARD_STEM}-2`] },
    ];
    expect(
      mod.attributeArtifact(`/p/commands-(${CARD_STEM}-2).json`, keys)
    ).toBe(sibling);
    expect(mod.attributeArtifact(`/p/${CARD_COMMANDS}`, keys)).toBe(
      CARD_DETAIL
    );
  });

  it("reads a per-flow DIRECTORY as naming the flow too", () => {
    // Maestro has shipped both layouts — the flow's name in the filename and a
    // directory per flow — and a reader that knows only one is a feature that
    // silently does nothing on the other.
    expect(
      mod.attributeArtifact(`/p/maestro-debug/${CARD_STEM}/maestro.log`, [
        { flow: CARD_DETAIL, keys: [CARD_STEM] },
      ])
    ).toBe(CARD_DETAIL);
  });

  it("does not let a grandparent directory decide every artifact", () => {
    expect(
      mod.attributeArtifact(`/p/${CARD_STEM}/logs/logcat.txt`, [
        { flow: CARD_DETAIL, keys: [CARD_STEM] },
      ])
    ).toBeNull();
  });

  it("attributes an artifact naming no flow to nothing", () => {
    expect(
      mod.attributeArtifact("/p/maestro-debug/.maestro/logs/logcat.txt", [
        { flow: CARD_DETAIL, keys: [CARD_STEM] },
      ])
    ).toBeNull();
  });
});

describe("evidence that names no flow", () => {
  it("is reported at run level and reclassifies nothing", () => {
    // Logcat is written once per run, not once per flow. Spreading its device
    // faults across every failing flow would launder a real regression, so an
    // unattributable fault is a note beside the table and never a verdict.
    const result = mod.classifyRun(
      reportWithFailureText(assertionFor(CARD_GATE)),
      {
        maestroRoot: "/m",
        projectRoot: "/",
        readFile: reader(files),
        debugArtifacts: [
          {
            path: "/p/maestro-debug/.maestro/logs/logcat.txt",
            text: `boom ${SERVER_DIED} boom`,
          },
        ],
      }
    );
    expect(result.failures[0]?.kind).toBe(PRODUCT);
    expect(result.deviceRunEvidence).toEqual([
      {
        marker: "DeviceServerDiedException",
        count: 1,
        artifact: "logcat.txt",
      },
    ]);
  });
});

describe("rendering", () => {
  it("gives the device column its own header count and table", () => {
    const markdown = mod.renderMarkdown({
      report: "maestro-android-report.xml",
      defects: [],
      deviceRunEvidence: [],
      failures: classified(reportWithFailureText(""), [
        artifact(CARD_COMMANDS, SERVER_DIED),
      ]),
    });
    expect(markdown).toContain("**1 device**");
    expect(markdown).toContain(`\`${CARD_STEM}.yaml\``);
    expect(markdown).toContain("DeviceServerDiedException");
  });

  it("says so plainly when a failure carried no text at all", () => {
    const markdown = mod.renderMarkdown({
      report: "maestro-android-report.xml",
      defects: [],
      deviceRunEvidence: [],
      failures: classified(reportWithFailureText("")),
    });
    expect(markdown).toContain("(no failure text)");
  });
});
