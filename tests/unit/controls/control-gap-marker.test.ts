/**
 * The marker a missing-capability ticket carries.
 *
 * A second enforce run must find the ticket the first one filed, so the marker
 * has to be the same text every time for the same requirement and part, and
 * the piece that identifies it has to come back unchanged from a tracker that
 * reformats descriptions (CodySwannGT/lisa#4992).
 */
import { describe, expect, it } from "vitest";

import {
  CONTROL_GAP_KEY_LENGTH,
  CONTROL_GAP_TAG,
  controlGapKey,
  controlGapMarker,
  encodeMarkerScope,
} from "../../../src/controls/control-gap-marker.js";

/** The one form a marker may take: four fields, single spaces, one line. */
const MARKER_FORM =
  /^\[lisa-control-gap\] criterion=[A-Za-z0-9.]+ scope=[A-Za-z0-9._/%-]+ key=[0-9a-f]{12}$/u;

/** Folder names a formatter could mangle or a parser could trip on. */
const AWKWARD_SCOPES = [
  "packages/web app",
  "docs/*drafts*",
  "src/`gen`",
  "a|b",
  "x --> y",
  "<!-- hidden",
  "team@work/#1",
  "line\nbreak",
  "tab\there",
  "50%/done",
  "[link](target)",
  "café/日本",
];

describe("the control-gap key", () => {
  it.each([
    { criterion: "AC8.2", scope: ".", key: "ce419bc78bb7" },
    { criterion: "AC8.2", scope: "api", key: "9a486b704cd0" },
    { criterion: "AC5.1", scope: ".", key: "b77fc98053cf" },
  ])(
    "is the documented shasum of $criterion in $scope",
    ({ criterion, scope, key }) => {
      // Each expected key was produced outside this code, with the command
      // the flow's reference document gives:
      //   printf 'criterion=%s\nscope=%s' <id> <scope> | shasum -a 256 | cut -c1-12
      expect(controlGapKey(criterion, scope)).toBe(key);
    }
  );

  it("is the same every time it is computed", () => {
    expect(controlGapKey("AC8.2", "api")).toBe(controlGapKey("AC8.2", "api"));
  });

  it("differs when the requirement or the part differs", () => {
    const keys = [
      controlGapKey("AC8.2", "."),
      controlGapKey("AC8.2", "api"),
      controlGapKey("AC8.5", "."),
      controlGapKey("AC8.5", "api"),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not let a requirement and a part run together", () => {
    expect(controlGapKey("AC1.1", "2/api")).not.toBe(
      controlGapKey("AC1.12", "/api")
    );
  });

  it("tells folders apart by letter case", () => {
    expect(controlGapKey("AC8.2", "API")).not.toBe(
      controlGapKey("AC8.2", "api")
    );
  });

  it("is the same for one folder name written in either Unicode form", () => {
    const composed = "café";
    const decomposed = "café";

    expect(controlGapKey("AC8.2", decomposed)).toBe(
      controlGapKey("AC8.2", composed)
    );
  });

  it(`is ${CONTROL_GAP_KEY_LENGTH} lower-case hex characters`, () => {
    expect(controlGapKey("AC8.2", "packages/web app")).toMatch(
      /^[0-9a-f]{12}$/u
    );
  });
});

describe("the control-gap marker", () => {
  it("reads as tag, requirement, part and key", () => {
    expect(controlGapMarker("AC8.2", ".")).toBe(
      "[lisa-control-gap] criterion=AC8.2 scope=. key=ce419bc78bb7"
    );
    expect(controlGapMarker("AC8.2", "api")).toBe(
      "[lisa-control-gap] criterion=AC8.2 scope=api key=9a486b704cd0"
    );
  });

  it("carries the tag every search starts from", () => {
    expect(controlGapMarker("AC8.2", ".")).toContain(`[${CONTROL_GAP_TAG}]`);
  });

  it("leaves ordinary folder names readable", () => {
    expect(encodeMarkerScope("packages/my_app-v2.1")).toBe(
      "packages/my_app-v2.1"
    );
  });

  it.each(AWKWARD_SCOPES)(
    "stays one plain line of four fields for the folder %j",
    scope => {
      expect(controlGapMarker("AC8.2", scope)).toMatch(MARKER_FORM);
    }
  );

  it.each(AWKWARD_SCOPES)(
    "keeps the folder %j recoverable from the marker",
    scope => {
      expect(decodeURIComponent(encodeMarkerScope(scope))).toBe(
        scope.normalize("NFC")
      );
    }
  );

  it("gives two folders that differ only in an awkward character two markers", () => {
    expect(controlGapMarker("AC8.2", "web app")).not.toBe(
      controlGapMarker("AC8.2", "web_app")
    );
  });
});
