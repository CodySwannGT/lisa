import { describe, expect, it } from "vitest";

import { buildUpstreamAttributionIssueBody } from "../../../src/core/learnings.js";

const LISA_SURFACE = "plugins/src/base/skills/lisa-persist-learning/SKILL.md";

const validInput = {
  markerKey: `${LISA_SURFACE}#allowlist-projection`,
  failureClass: "allowlist-projection",
  lisaSurface: LISA_SURFACE,
  operatorImpact:
    "Operators get a public upstream ticket that cannot include private host values.",
  harnessFault:
    "The previous handoff procedure relied on prose discipline before filing.",
  requestedChange:
    "Delegate public upstream issue bodies to the executable allowlist builder.",
  affectedProject: "example-host",
  hostIssueUrl: "https://github.com/acme/example-host/issues/42",
  attributionEvidence: [
    "lisa-attribute-failure returned a conclusive lisa verdict.",
    "The implicated Lisa surface is the handoff-upstream filing step.",
  ],
  lisaOwnedExcerpts: [
    {
      surface: LISA_SURFACE,
      text: "Quote ONLY Lisa-owned surface text.",
    },
  ],
  upstreamRefs: ["https://github.com/CodySwannGT/lisa/pull/1763"],
};

describe("buildUpstreamAttributionIssueBody", () => {
  it("builds a public body exclusively from allowlisted fields", () => {
    const body = buildUpstreamAttributionIssueBody(validInput);

    expect(body).toContain(
      "<!-- [lisa-upstream-attribution] key=plugins/src/base/skills/lisa-persist-learning/SKILL.md#allowlist-projection -->"
    );
    expect(body).toContain("## Operator impact");
    expect(body).toContain("## Redacted evidence chain");
    expect(body).toContain(
      "Reproduction: REDACTED host values only; see linked host issue for private context."
    );
    expect(body).toContain("Quote ONLY Lisa-owned surface text.");
    expect(body).not.toContain("HOST_SECRET_CANARY");
  });

  it("rejects extraneous host content instead of silently dropping it", () => {
    expect(() =>
      buildUpstreamAttributionIssueBody({
        ...validInput,
        hostProjectRawContext:
          "HOST_SECRET_CANARY=do-not-ship arbitrary private host prose",
      })
    ).toThrow(/non-allowlisted field\(s\): hostProjectRawContext/);
  });

  it("rejects non-allowlisted excerpt fields", () => {
    expect(() =>
      buildUpstreamAttributionIssueBody({
        ...validInput,
        lisaOwnedExcerpts: [
          {
            surface: LISA_SURFACE,
            text: "Lisa-owned excerpt.",
            hostPayload: "private host payload",
          },
        ],
      })
    ).toThrow(/non-allowlisted field\(s\): hostPayload/);
  });

  it("keeps the deny-list backstop for values that reach allowlisted fields", () => {
    expect(() =>
      buildUpstreamAttributionIssueBody({
        ...validInput,
        operatorImpact: "Leaked token ghp_123456789012345678901234567890",
      })
    ).toThrow(/matched a blocked shape/);
  });
});
