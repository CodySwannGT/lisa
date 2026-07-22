import { describe, expect, it, vi } from "vitest";

import {
  buildUpstreamAttributionIssueBody,
  type UpstreamAttributionBodyInput,
} from "../../../src/core/learnings.js";

const LISA_SURFACE = "plugins/src/base/skills/lisa-persist-learning/SKILL.md";
const OWNED_TEXT =
  "Route ONE candidate learning through the judgment gate and act on the verdict.";
const PUBLIC_SHA = "90549e6dae19aa5e53b86908d5050d303b724f55";

const validInput = (): UpstreamAttributionBodyInput => ({
  documentKind: "issue",
  failureClass: "stale-artifact-overwrite",
  lisaOwnedExcerpts: [{ file: LISA_SURFACE, text: OWNED_TEXT }],
  lisaSurface: LISA_SURFACE,
  redactedPlaceholders: ["<host-project>", "<env-value>"],
  upstreamCommitRefs: [PUBLIC_SHA],
});

describe("buildUpstreamAttributionIssueBody", () => {
  it("retains a typed public event contract", () => {
    const typedBuilder: (input: UpstreamAttributionBodyInput) => string =
      buildUpstreamAttributionIssueBody;
    expect(typedBuilder).toBe(buildUpstreamAttributionIssueBody);
  });

  it("builds the three-audience issue body from closed fields", () => {
    const body = buildUpstreamAttributionIssueBody(validInput());

    expect(body).toContain(
      `<!-- [lisa-upstream-attribution] key=${LISA_SURFACE.toLowerCase()}#stale-artifact-overwrite -->`
    );
    expect(body).toContain("## What failed for the operator");
    expect(body).toContain("## What the harness did wrong");
    expect(body).toContain("## What to change");
    expect(body).toContain(OWNED_TEXT);
    expect(body).toContain("<host-project>");
  });

  it("rejects an unknown top-level field by name without reading its value", () => {
    const input = validInput() as unknown as Record<string, unknown>;
    const readCanary = vi.fn(() => "HOST_SECRET_CANARY");
    Object.defineProperty(input, "hostProjectRawContext", {
      enumerable: true,
      get: readCanary,
    });

    expect(() => buildUpstreamAttributionIssueBody(input)).toThrow(
      /hostProjectRawContext/
    );
    expect(readCanary).not.toHaveBeenCalled();
  });

  it("rejects non-allowlisted excerpt fields by name", () => {
    expect(() =>
      buildUpstreamAttributionIssueBody({
        ...validInput(),
        lisaOwnedExcerpts: [
          {
            file: LISA_SURFACE,
            text: OWNED_TEXT,
            hostPayload: "private host payload",
          },
        ],
      })
    ).toThrow(/hostPayload/);
  });

  it("rejects host issue links as non-public input", () => {
    expect(() =>
      buildUpstreamAttributionIssueBody({
        ...validInput(),
        hostIssueLink: "https://github.com/acme/example-host/issues/42",
      })
    ).toThrow(/hostIssueLink/i);
  });
});
