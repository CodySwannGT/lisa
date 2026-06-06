#!/usr/bin/env node
/**
 * Deterministic wiki source safety helpers.
 *
 * This module intentionally uses only Node built-ins and pure string scanning so
 * downstream wiki connectors can run the same redaction pass before persisting
 * reader-safe source notes.
 */

const PLACEHOLDERS = {
  ssn: "[REDACTED:SSN]",
  credit_card: "[REDACTED:CREDIT_CARD]",
  private_key: "[REDACTED:PRIVATE_KEY]",
  password: "[REDACTED:PASSWORD]",
  api_key: "[REDACTED:API_KEY]",
  oauth_token: "[REDACTED:OAUTH_TOKEN]",
  bank_account: "[REDACTED:BANK_ACCOUNT]",
  routing_number: "[REDACTED:ROUTING_NUMBER]",
};

const PATTERNS = [
  {
    entityType: "private_key",
    confidence: "high",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  },
  {
    entityType: "ssn",
    confidence: "high",
    re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  },
  {
    entityType: "password",
    confidence: "high",
    re: /\b(?:password|passwd|pwd)\s*[:=]\s*(['"]?)([^\s'",;]{8,})\1/gi,
    valueGroup: 2,
  },
  {
    entityType: "api_key",
    confidence: "medium",
    re: /\b(?:api[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret)\s*[:=]\s*(['"]?)([A-Za-z0-9._-]{20,})\1/gi,
    valueGroup: 2,
  },
  {
    entityType: "oauth_token",
    confidence: "high",
    re: /\b(?:oauth[_-]?token|refresh[_-]?token|access[_-]?token|bearer)\s*[:= ]\s*(['"]?)([A-Za-z0-9._-]{24,})\1/gi,
    valueGroup: 2,
  },
  {
    entityType: "routing_number",
    confidence: "medium",
    re: /\b(?:routing|routing_number|aba)\s*(?:number|no\.?)?\s*[:#=]?\s*(\d{9})\b/gi,
    valueGroup: 1,
  },
  {
    entityType: "bank_account",
    confidence: "medium",
    re: /\b(?:bank\s+)?(?:account|acct)\s*(?:number|no\.?)?\s*[:#=]?\s*(\d{6,17})\b/gi,
    valueGroup: 1,
  },
];

const TEXTISH_EXTS = new Set([
  ".md",
  ".mdx",
  ".json",
  ".jsonl",
  ".txt",
  ".yml",
  ".yaml",
  ".toml",
  ".csv",
  ".tsv",
]);

function luhnValid(candidate) {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = Number(digits[i]);
    if (doubleDigit) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function applyFinding(text, match, pattern) {
  const raw = match[0];
  const value = pattern.valueGroup ? match[pattern.valueGroup] : raw;
  const valueOffset = pattern.valueGroup ? raw.indexOf(value) : 0;
  const start = match.index + valueOffset;
  const end = start + value.length;
  return {
    sanitized:
      text.slice(0, start) + PLACEHOLDERS[pattern.entityType] + text.slice(end),
    finding: {
      entityType: pattern.entityType,
      confidence: pattern.confidence,
      range: { start, end },
    },
    delta: PLACEHOLDERS[pattern.entityType].length - value.length,
  };
}

function collectCreditCardFindings(text) {
  const findings = [];
  const re = /\b(?:\d[ -]?){13,19}\b/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const value = match[0].trim();
    if (!luhnValid(value)) continue;
    findings.push({
      entityType: "credit_card",
      confidence: "high",
      range: { start: match.index, end: match.index + match[0].length },
    });
  }
  return findings;
}

function summarizeFindings(sourceMetadata, findings) {
  const sourceId =
    sourceMetadata.sourceId ??
    sourceMetadata.id ??
    sourceMetadata.path ??
    sourceMetadata.url ??
    "unknown";
  const byType = new Map();
  for (const finding of findings) {
    const current = byType.get(finding.entityType) ?? {
      sourceId,
      entityType: finding.entityType,
      confidence: finding.confidence,
      count: 0,
      ranges: [],
    };
    current.count += 1;
    current.ranges.push(finding.range);
    byType.set(finding.entityType, current);
  }
  return [...byType.values()].sort((a, b) =>
    a.entityType.localeCompare(b.entityType)
  );
}

function collectFindings(rawText) {
  const text = String(rawText ?? "");
  const findings = [];

  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    let match;
    while ((match = pattern.re.exec(text)) !== null) {
      findings.push(applyFinding(text, match, pattern).finding);
    }
  }
  findings.push(...collectCreditCardFindings(text));
  findings.sort((a, b) => a.range.start - b.range.start);
  return findings;
}

export function scanWikiSourceText(rawText, sourceMetadata = {}) {
  const findings = collectFindings(rawText);

  return {
    sourceId:
      sourceMetadata.sourceId ??
      sourceMetadata.id ??
      sourceMetadata.path ??
      sourceMetadata.url ??
      "unknown",
    reviewRequired: findings.length > 0,
    findings: summarizeFindings(sourceMetadata, findings),
  };
}

export function sanitizeWikiSourceText(rawText, sourceMetadata = {}) {
  let sanitized = String(rawText ?? "");
  const rawFindings = collectFindings(rawText);
  for (const finding of [...rawFindings].sort(
    (a, b) => b.range.start - a.range.start
  )) {
    sanitized =
      sanitized.slice(0, finding.range.start) +
      PLACEHOLDERS[finding.entityType] +
      sanitized.slice(finding.range.end);
  }

  return {
    text: sanitized,
    reviewRequired: rawFindings.length > 0,
    findings: summarizeFindings(sourceMetadata, rawFindings),
  };
}

export function processWikiSourceNote(rawText, options = {}) {
  const {
    dryRun = false,
    scannerAvailable = true,
    scannerRequired = false,
    ...sourceMetadata
  } = options;
  const sanitized = sanitizeWikiSourceText(rawText, sourceMetadata);
  const scannerBlocked = scannerRequired && !scannerAvailable;

  return {
    ...sanitized,
    dryRun: Boolean(dryRun),
    writeAllowed: !dryRun && !scannerBlocked,
    scanner: {
      available: Boolean(scannerAvailable),
      required: Boolean(scannerRequired),
      blocked: scannerBlocked,
    },
    blockedReason: scannerBlocked
      ? "sensitivity scanner is required but unavailable"
      : undefined,
  };
}

export function serializeWikiSafetyFindings(result) {
  return JSON.stringify(
    {
      reviewRequired: Boolean(result?.reviewRequired),
      findings: Array.isArray(result?.findings) ? result.findings : [],
    },
    null,
    2
  );
}

export function isWikiSafetyScanTarget(filePath, options = {}) {
  const pathModule = options.pathModule;
  if (!pathModule) {
    throw new Error("isWikiSafetyScanTarget requires options.pathModule");
  }
  const wikiRoot = pathModule.resolve(options.wikiRoot ?? "wiki");
  const resolved = pathModule.resolve(filePath);
  const relative = pathModule.relative(wikiRoot, resolved);
  if (
    !relative ||
    relative.startsWith("..") ||
    pathModule.isAbsolute(relative)
  ) {
    return false;
  }
  const ext = pathModule.extname(resolved);
  return TEXTISH_EXTS.has(ext);
}

export function scanWikiGeneratedFiles(files, options = {}) {
  const fsModule = options.fsModule;
  const pathModule = options.pathModule;
  if (!fsModule || !pathModule) {
    throw new Error("scanWikiGeneratedFiles requires fsModule and pathModule");
  }

  const wikiRoot = pathModule.resolve(options.wikiRoot ?? "wiki");
  const candidates = [...new Set(files.map(file => pathModule.resolve(file)))]
    .filter(file => isWikiSafetyScanTarget(file, { wikiRoot, pathModule }))
    .sort();

  const scanned = [];
  const findings = [];
  const errors = [];

  for (const file of candidates) {
    let text;
    try {
      if (!fsModule.existsSync(file) || !fsModule.statSync(file).isFile()) {
        continue;
      }
      text = fsModule.readFileSync(file, "utf8");
    } catch (error) {
      errors.push({
        file: pathModule.relative(process.cwd(), file),
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const sourceId = pathModule.relative(wikiRoot, file);
    scanned.push(sourceId);
    const result = scanWikiSourceText(text, { sourceId });
    findings.push(...result.findings);
  }

  return {
    ok: findings.length === 0 && errors.length === 0,
    wikiRoot: pathModule.relative(process.cwd(), wikiRoot) || ".",
    scanned,
    findings,
    errors,
  };
}
