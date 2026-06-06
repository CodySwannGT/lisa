import fs from "node:fs";
import { readFileSync } from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createWikiIngestPublicationPolicy,
  processWikiSourceNote,
  sanitizeWikiSourceText,
  scanWikiGeneratedFiles,
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

  it("requires human review and disables auto-merge for redacted ingest summaries", () => {
    const raw = `api_key = sk_test_abcdefghijklmnopqrstuvwxyz\nSSN ${fakeSsn}`;
    const safetyResult = sanitizeWikiSourceText(raw, {
      sourceId: reportSourceId,
    });

    const policy = createWikiIngestPublicationPolicy({
      safetyResults: safetyResult,
    });

    expect(policy.reviewRequired).toBe(true);
    expect(policy.autoMergeAllowed).toBe(false);
    expect(policy.findingCount).toBe(2);
    expect(policy.entityTypes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: "api_key", count: 1 }),
        expect.objectContaining({ entityType: "ssn", count: 1 }),
      ])
    );
    expect(policy.prSummaryMarkdown).toContain("Auto-merge: disabled");
    expect(policy.prSummaryMarkdown).toContain(
      "Reason: redacted or sensitive findings"
    );
    expect(policy.prSummaryMarkdown).toContain("api_key: 1 finding");
    expect(policy.prSummaryMarkdown).toContain("ssn: 1 finding");
    expect(policy.prSummaryMarkdown).not.toContain(
      "sk_test_abcdefghijklmnopqrstuvwxyz"
    );
    expect(policy.prSummaryMarkdown).not.toContain(fakeSsn);
  });

  it("allows auto-merge for clean non-external ingest summaries", () => {
    const safetyResult = sanitizeWikiSourceText("Reader-safe source note", {
      sourceId: reportSourceId,
    });

    const policy = createWikiIngestPublicationPolicy({
      safetyResults: safetyResult,
    });

    expect(policy.reviewRequired).toBe(false);
    expect(policy.autoMergeAllowed).toBe(true);
    expect(policy.findingCount).toBe(0);
    expect(policy.prSummaryMarkdown).toContain("Auto-merge: allowed");
    expect(policy.prSummaryMarkdown).toContain("- none");
  });

  it("keeps external-write ingests review-only even without redactions", () => {
    const safetyResult = sanitizeWikiSourceText("Reader-safe source note", {
      sourceId: reportSourceId,
    });

    const policy = createWikiIngestPublicationPolicy({
      externalWrite: true,
      safetyResults: safetyResult,
    });

    expect(policy.reviewRequired).toBe(true);
    expect(policy.autoMergeAllowed).toBe(false);
    expect(policy.findingCount).toBe(0);
    expect(policy.prSummaryMarkdown).toContain("Auto-merge: disabled");
    expect(policy.prSummaryMarkdown).toContain("external-write source");
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

  it("blocks unredacted generated wiki secrets before commit", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wiki-safety-"));
    const wikiRoot = path.join(root, "wiki");
    const sourcePath = path.join(wikiRoot, "sources", "fixture.md");
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    writeFileSync(
      sourcePath,
      [
        "---",
        "type: source",
        "created: 2026-06-06",
        "updated: 2026-06-06",
        "---",
        "-----BEGIN PRIVATE KEY-----",
        "abc123",
        "-----END PRIVATE KEY-----",
      ].join("\n")
    );

    const result = scanWikiGeneratedFiles([sourcePath], {
      fsModule: fs,
      pathModule: path,
      wikiRoot,
    });

    expect(result.ok).toBe(false);
    expect(result.scanned).toEqual(["sources/fixture.md"]);
    expect(result.findings).toEqual([
      expect.objectContaining({
        sourceId: "sources/fixture.md",
        entityType: "private_key",
        count: 1,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("abc123");
  });

  it("scopes generated wiki verification to wiki output paths", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "wiki-safety-scope-"));
    const wikiRoot = path.join(root, "wiki");
    const sourcePath = path.join(wikiRoot, "sources", "clean.md");
    const unrelatedPath = path.join(root, "notes", "dirty.md");
    mkdirSync(path.dirname(sourcePath), { recursive: true });
    mkdirSync(path.dirname(unrelatedPath), { recursive: true });
    writeFileSync(sourcePath, "# Reader-safe source\n\nNo findings here.\n");
    writeFileSync(
      unrelatedPath,
      "api_key = sk_test_abcdefghijklmnopqrstuvwxyz\n"
    );

    const result = scanWikiGeneratedFiles([sourcePath, unrelatedPath], {
      fsModule: fs,
      pathModule: path,
      wikiRoot,
    });

    expect(result.ok).toBe(true);
    expect(result.scanned).toEqual(["sources/clean.md"]);
    expect(result.findings).toEqual([]);
  });
});
