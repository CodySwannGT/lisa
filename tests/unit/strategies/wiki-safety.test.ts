import { describe, expect, it } from "vitest";

import {
  sanitizeWikiSourceText,
  serializeWikiSafetyFindings,
} from "../../../plugins/src/wiki/scripts/wiki-safety.mjs";

describe("wiki safety sanitizer (#1169)", () => {
  const reportSourceId = "fixtures/report.md";

  it("redacts built-in blocked values while preserving normal contacts", () => {
    const raw = [
      "Contact Ada Lovelace at ada@example.com.",
      "Fake SSN: 123-45-6789.",
      "Card: 4111 1111 1111 1111.",
      "-----BEGIN PRIVATE KEY-----",
      "abc123",
      "-----END PRIVATE KEY-----",
      "password = fakePassword123",
      "api_key = sk_test_abcdefghijklmnopqrstuvwxyz",
      "oauth_token: ya29.fakeOAuthTokenValue1234567890",
      "routing number 021000021 and account number 123456789012",
    ].join("\n");

    const result = sanitizeWikiSourceText(raw, {
      sourceId: "fixtures/redaction.md",
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
    expect(result.text).not.toContain("123-45-6789");
    expect(result.text).not.toContain("4111 1111 1111 1111");
    expect(result.text).not.toContain("fakePassword123");
  });

  it("serializes only safe finding metadata", () => {
    const raw =
      "token: public example\napi_key = sk_test_abcdefghijklmnopqrstuvwxyz\nSSN 123-45-6789";
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
    expect(serialized).not.toContain("123-45-6789");
    expect(serialized).not.toContain("token: public example");
  });

  it("does not flag names, email addresses, or invalid card-shaped numbers", () => {
    const result = sanitizeWikiSourceText(
      "Grace Hopper <grace@example.com> invoice 4111 1111 1111 1112",
      { sourceId: "fixtures/allowed.md" }
    );

    expect(result.reviewRequired).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.text).toContain("Grace Hopper");
    expect(result.text).toContain("grace@example.com");
    expect(result.text).toContain("4111 1111 1111 1112");
  });
});
