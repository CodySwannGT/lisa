import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  processWikiSourceNote,
  sanitizeWikiSourceText,
  serializeWikiSafetyFindings,
} from "../../../plugins/src/wiki/scripts/wiki-safety.mjs";

describe("wiki safety sanitizer (#1169)", () => {
  const reportSourceId = "fixtures/report.md";
  const redactionFixture = "redaction-source.md";
  const redactionSourceId = "fixtures/wiki-safety/redaction-source.md";
  const fakeSsn = "123-45-6789";
  const fixtureRoot = path.resolve("tests/fixtures/wiki-safety");

  const readFixture = (name: string): string =>
    readFileSync(path.join(fixtureRoot, name), "utf8");

  it("redacts built-in blocked fixture values while preserving normal contacts", () => {
    const result = sanitizeWikiSourceText(readFixture(redactionFixture), {
      sourceId: redactionSourceId,
    });

    expect(result.reviewRequired).toBe(true);
    expect(result.text).toContain("Ada Lovelace");
    expect(result.text).toContain("ada@example.com");
    expect(result.text).toContain("[REDACTED:SSN]");
    expect(result.text).toContain("[REDACTED:CREDIT_CARD]");
    expect(result.text).toContain("[REDACTED:PRIVATE_KEY]");
    expect(result.text).toContain("password = [REDACTED:PASSWORD]");
    expect(result.text).toContain("api_key = [REDACTED:API_KEY]");
    expect(result.text).toContain("oauth_token: [REDACTED:OAUTH_TOKEN]");
    expect(result.text).toContain("routing number [REDACTED:ROUTING_NUMBER]");
    expect(result.text).toContain("account number [REDACTED:BANK_ACCOUNT]");
    expect(result.text).not.toContain(fakeSsn);
    expect(result.text).not.toContain("4111 1111 1111 1111");
    expect(result.text).not.toContain("fakePassword123");
    expect(result.text).not.toContain("sk_test_abcdefghijklmnopqrstuvwxyz");
    expect(result.text).not.toContain("ya29.fakeOAuthTokenValue1234567890");
    expect(result.text).not.toContain("123456789012");
    expect(result.findings.map(finding => finding.entityType)).toEqual([
      "api_key",
      "bank_account",
      "credit_card",
      "oauth_token",
      "password",
      "private_key",
      "routing_number",
      "ssn",
    ]);
  });

  it("serializes only safe finding metadata", () => {
    const raw = `token: public example\napi_key = sk_test_abcdefghijklmnopqrstuvwxyz\nSSN ${fakeSsn}`;
    const result = sanitizeWikiSourceText(raw, {
      sourceId: reportSourceId,
    });
    const serialized = serializeWikiSafetyFindings(result);
    const parsed = JSON.parse(serialized);

    expect(parsed.reviewRequired).toBe(true);
    expect(parsed.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: reportSourceId,
          entityType: "api_key",
          confidence: "medium",
          count: 1,
          ranges: [expect.objectContaining({ start: expect.any(Number) })],
        }),
        expect.objectContaining({
          sourceId: reportSourceId,
          entityType: "ssn",
          confidence: "high",
          count: 1,
        }),
      ])
    );
    expect(serialized).not.toContain("sk_test_abcdefghijklmnopqrstuvwxyz");
    expect(serialized).not.toContain(fakeSsn);
    expect(serialized).not.toContain("token: public example");
  });

  it("does not flag names, email addresses, or invalid card-shaped numbers", () => {
    const result = sanitizeWikiSourceText(readFixture("allowed-contacts.md"), {
      sourceId: "fixtures/wiki-safety/allowed-contacts.md",
    });

    expect(result.reviewRequired).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.text).toContain("Grace Hopper");
    expect(result.text).toContain("grace@example.com");
    expect(result.text).toContain("4111 1111 1111 1112");
  });

  it("keeps scanner-unavailable source notes blocked when policy requires a scanner", () => {
    const result = processWikiSourceNote(readFixture(redactionFixture), {
      sourceId: redactionSourceId,
      scannerAvailable: false,
      scannerRequired: true,
    });

    expect(result.scanner).toEqual({
      available: false,
      required: true,
      blocked: true,
    });
    expect(result.writeAllowed).toBe(false);
    expect(result.blockedReason).toBe(
      "sensitivity scanner is required but unavailable"
    );
    expect(result.text).toContain("[REDACTED:SSN]");
    expect(result.text).not.toContain(fakeSsn);
  });

  it("returns a sanitized preview without allowing writes in dry-run mode", () => {
    const result = processWikiSourceNote(readFixture(redactionFixture), {
      sourceId: redactionSourceId,
      dryRun: true,
      scannerAvailable: true,
      scannerRequired: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.scanner.blocked).toBe(false);
    expect(result.writeAllowed).toBe(false);
    expect(result.reviewRequired).toBe(true);
    expect(result.text).toContain("[REDACTED:CREDIT_CARD]");
    expect(result.text).not.toContain("4111 1111 1111 1111");
  });
});
