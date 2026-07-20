/** Security regression contract for upstream attribution projection (#1826). */
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildUpstreamAttributionIssueBody,
  UPSTREAM_FAILURE_CLASSES,
  UPSTREAM_REDACTED_PLACEHOLDERS,
} from "../../../src/core/learnings.js";

const SURFACE = "plugins/src/base/skills/lisa-persist-learning/SKILL.md";
const OWNED_TEXT =
  "Route ONE candidate learning through the judgment gate and act on the verdict.";
const RESERVED_MARKER_TEXT =
  "<!-- [lisa-upstream-attribution] key=<root-cause-key> -->";
const VALID_FINGERPRINT = "sll4-0123456789ab";
const PUBLIC_SHA = "90549e6dae19aa5e53b86908d5050d303b724f55";

/**
 * Build one valid event with optional hostile overrides.
 * @param overrides - Fields to replace or append
 * @returns Candidate event
 */
function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    documentKind: "issue",
    failureClass: "stale-artifact-overwrite",
    lisaOwnedExcerpts: [{ file: SURFACE, text: OWNED_TEXT }],
    lisaSurface: SURFACE,
    redactedPlaceholders: ["<host-project>", "<env-value>"],
    upstreamCommitRefs: [PUBLIC_SHA],
    ...overrides,
  };
}

describe("buildUpstreamAttributionIssueBody hardening", () => {
  it.each([
    "affectedProject",
    "attributionEvidence",
    "harnessFault",
    "hostIssueUrl",
    "markerKey",
    "operatorImpact",
    "requestedChange",
    "upstreamRefs",
    "lisaRoot",
    "readLisaFile",
  ])("rejects legacy or caller-controlled field %s by name", field => {
    const canary = "HOST_SECRET_CANARY";
    expect(() =>
      buildUpstreamAttributionIssueBody(validEvent({ [field]: canary }))
    ).toThrow(new RegExp(field));
  });

  it("rejects proxies before descriptor traps and all allowed accessors", () => {
    const trap = vi.fn(() => {
      throw new Error("descriptor trap ran");
    });
    expect(() =>
      buildUpstreamAttributionIssueBody(
        new Proxy(validEvent(), { getOwnPropertyDescriptor: trap })
      )
    ).toThrow(/proxies/i);
    expect(trap).not.toHaveBeenCalled();

    for (const field of [
      "documentKind",
      "failureClass",
      "lisaOwnedExcerpts",
      "lisaSurface",
      "redactedPlaceholders",
      "upstreamCommitRefs",
    ]) {
      const input = validEvent();
      const getter = vi.fn(() => "unsafe");
      Object.defineProperty(input, field, { enumerable: true, get: getter });
      expect(() => buildUpstreamAttributionIssueBody(input)).toThrow(
        /accessors/i
      );
      expect(getter).not.toHaveBeenCalled();
    }
  });

  it("requires excerpt text to occur verbatim in its exact manifest file", () => {
    expect(() =>
      buildUpstreamAttributionIssueBody(
        validEvent({
          lisaOwnedExcerpts: [
            { file: SURFACE, text: "private host prose absent from Lisa" },
          ],
        })
      )
    ).toThrow(/lisaOwnedExcerpts/);
    expect(() =>
      buildUpstreamAttributionIssueBody(
        validEvent({
          lisaOwnedExcerpts: [{ file: ".git/config", text: "origin" }],
        })
      )
    ).toThrow(/lisaOwnedExcerpts/);
  });

  it("accepts only the closed failure and placeholder vocabularies", () => {
    expect(UPSTREAM_FAILURE_CLASSES).toContain("stale-artifact-overwrite");
    expect(UPSTREAM_REDACTED_PLACEHOLDERS).toContain("<host-project>");
    expect(() =>
      buildUpstreamAttributionIssueBody(
        validEvent({ failureClass: "customer-specific-outage" })
      )
    ).toThrow(/failureClass/);
    expect(() =>
      buildUpstreamAttributionIssueBody(
        validEvent({ redactedPlaceholders: ["<acme-production-database>"] })
      )
    ).toThrow(/redactedPlaceholders/);
  });

  it("requires exact public-origin full SHAs", () => {
    for (const reference of ["90549e6", "0".repeat(40)]) {
      expect(() =>
        buildUpstreamAttributionIssueBody(
          validEvent({ upstreamCommitRefs: [reference] })
        )
      ).toThrow(/upstreamCommitRefs/);
    }
  });

  it("projects an occurrence comment with exactly one strict marker", () => {
    const suppliedFingerprint = VALID_FINGERPRINT;
    const projectedFingerprint = `sll4-${createHash("sha256")
      .update(suppliedFingerprint)
      .digest("hex")
      .slice(0, 12)}`;
    const body = buildUpstreamAttributionIssueBody(
      validEvent({
        documentKind: "occurrence",
        occurrenceFingerprint: suppliedFingerprint,
      })
    );

    expect(
      body.match(/<!-- \[lisa-upstream-attribution-occurrence\] key=/gu) ?? []
    ).toHaveLength(1);
    expect(body).toContain(
      `<!-- [lisa-upstream-attribution-occurrence] key=${projectedFingerprint} -->`
    );
    expect(body).not.toContain(suppliedFingerprint);
    expect(body).not.toContain("<!-- [lisa-upstream-attribution] key=");
  });

  it("rejects array expandos, symbols, and accessors without reading them", () => {
    const variants: unknown[][] = [];
    const expando = [PUBLIC_SHA];
    Object.defineProperty(expando, "hostPayload", {
      enumerable: false,
      value: "HOST_SECRET_CANARY",
    });
    variants.push(expando);
    const symbol = [PUBLIC_SHA];
    Object.defineProperty(symbol, Symbol("host"), {
      value: "HOST_SECRET_CANARY",
    });
    variants.push(symbol);
    const accessor = [PUBLIC_SHA];
    const getter = vi.fn(() => "HOST_SECRET_CANARY");
    Object.defineProperty(accessor, "extra", { get: getter });
    variants.push(accessor);

    for (const upstreamCommitRefs of variants) {
      expect(() =>
        buildUpstreamAttributionIssueBody(validEvent({ upstreamCommitRefs }))
      ).toThrow(/upstreamCommitRefs/);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects fingerprint mismatches across both discriminator arms", () => {
    expect(() =>
      buildUpstreamAttributionIssueBody(
        validEvent({ occurrenceFingerprint: VALID_FINGERPRINT })
      )
    ).toThrow(/occurrenceFingerprint/);
    for (const occurrenceFingerprint of [
      "repeat-encounter-42",
      "sll4-0123456789a",
      "sll4-0123456789abc",
      "sll4-0123456789AZ",
    ]) {
      expect(() =>
        buildUpstreamAttributionIssueBody(
          validEvent({ documentKind: "occurrence", occurrenceFingerprint })
        )
      ).toThrow(/occurrenceFingerprint/);
    }
  });

  it.each(["acme-secret-customer", "src/acme-secret-customer.ts"])(
    "rejects unmanifested Lisa surface %s instead of emitting it",
    lisaSurface => {
      expect(() =>
        buildUpstreamAttributionIssueBody(validEvent({ lisaSurface }))
      ).toThrow(/lisaSurface/);
    }
  );

  it("accepts an exact manifest-backed dot-root Lisa surface", () => {
    const lisaSurface = ".github/workflows/ci.yml";
    expect(
      buildUpstreamAttributionIssueBody(validEvent({ lisaSurface }))
    ).toContain(lisaSurface);
  });

  it("rejects every host issue link and emits only the fixed omission", () => {
    expect(() =>
      buildUpstreamAttributionIssueBody(
        validEvent({
          hostIssueLink:
            "https://github.com/acme-secret-customer/private-prod/issues/42",
        })
      )
    ).toThrow(/hostIssueLink/);

    expect(buildUpstreamAttributionIssueBody(validEvent())).toContain(
      "Host-project issue: [OMITTED BY PUBLIC FILING POLICY]"
    );
  });

  it.each(["issue", "occurrence"] as const)(
    "rejects reserved marker text inside %s excerpts",
    documentKind => {
      expect(() =>
        buildUpstreamAttributionIssueBody(
          validEvent({
            documentKind,
            lisaOwnedExcerpts: [{ file: SURFACE, text: RESERVED_MARKER_TEXT }],
            ...(documentKind === "occurrence"
              ? { occurrenceFingerprint: VALID_FINGERPRINT }
              : {}),
          })
        )
      ).toThrow(/lisaOwnedExcerpts/);
    }
  );
});
