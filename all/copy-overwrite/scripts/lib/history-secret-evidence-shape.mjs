// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
/** Bounded lossless evidence syntax; no digest is authenticated by syntax alone. */
const credentialField =
  /^(?:api[_-]?key|access[_-]?token|password|passwd|secret)$/iu;
const credentialToken =
  /^(?:client[_-]?secret|auth[_-]?token|token|credentials?)$/iu;
export const safeSourcePath = value =>
  typeof value === "string" &&
  value.length > 0 &&
  !credentialField.test(value) &&
  !credentialToken.test(value) &&
  !/[\\\u0000-\u001f\u007f]/u.test(value) &&
  !/^(?:\/|[A-Za-z]:)/u.test(value) &&
  value.split("/").every(part => part && part !== "." && part !== "..");
const proofLabel = value =>
  safeSourcePath(value) ||
  (typeof value === "string" &&
    value.startsWith("/") &&
    safeSourcePath(value.slice(1)));
const sources = new Set([
  "source_sha256",
  "source_hashes",
  "source_hashes_after",
  "current_source_sha256",
  "prior66_source_sha256",
  "protected_sha256",
  "selected_artifact_hashes",
  "files",
]);
const proofs = new Set(["proof_sha256", "logs"]);
const isHash = value =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);

/** Native validation and duplicate-aware lexical spans share the exact same text. */
const lexical = text => {
  const value = JSON.parse(text);
  const tokens = [
    ...text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}[\],:]|[^{}[\],:\s]+/gu),
  ];
  if (tokens.length > 8192) throw new Error("Bounded JSON tokens");
  const state = { cursor: 0, spans: [] };
  visit(tokens, state, [], 0, text);
  if (state.cursor !== tokens.length) throw new Error("Trailing JSON tokens");
  return { value, spans: state.spans };
};

/** Duplicate decoded keys and escaped attribution spellings always fail closed. */
const visit = (tokens, state, path, depth, text) => {
  if (depth > 32) throw new Error("Bounded JSON depth");
  const token = tokens[state.cursor++];
  if (token[0] === "{") {
    const keys = new Set();
    while (tokens[state.cursor][0] !== "}") {
      const keyToken = tokens[state.cursor++][0];
      const key = JSON.parse(keyToken);
      if (keys.has(key) || keyToken !== JSON.stringify(key))
        throw new Error("Ambiguous JSON key");
      keys.add(key);
      state.cursor++;
      visit(tokens, state, [...path, key], depth + 1, text);
      if (tokens[state.cursor][0] === ",") state.cursor++;
    }
    state.cursor++;
  } else if (token[0] === "[") {
    let index = 0;
    while (tokens[state.cursor][0] !== "]") {
      visit(tokens, state, [...path, index++], depth + 1, text);
      if (tokens[state.cursor][0] === ",") state.cursor++;
    }
    state.cursor++;
  } else if (token[0][0] === '"') {
    const hash = JSON.parse(token[0]);
    if (!isHash(hash)) return;
    if (token[0] !== JSON.stringify(hash))
      throw new Error("Ambiguous digest spelling");
    state.spans.push({
      path,
      hash,
      start: Buffer.byteLength(text.slice(0, token.index + 1)),
      end: Buffer.byteLength(text.slice(0, token.index + token[0].length - 1)),
    });
  }
};

/** Source maps keep whole-map verification; proof entries attest only themselves. */
const maps = (text, offset) => {
  const parsed = lexical(text);
  if (
    !parsed.value ||
    typeof parsed.value !== "object" ||
    Array.isArray(parsed.value)
  )
    return [];
  const bare = Object.entries(parsed.value).every(
    ([file, hash]) => safeSourcePath(file) && isHash(hash)
  );
  const roles = bare
    ? [[null, parsed.value]]
    : Object.entries(parsed.value).filter(
        ([role]) => sources.has(role) || proofs.has(role)
      );
  const result = [];
  for (const [role, fields] of roles) {
    if (!fields || typeof fields !== "object" || Array.isArray(fields))
      return [];
    const kind = proofs.has(role)
      ? "proof"
      : role === "source_sha256"
        ? "strict"
        : "source";
    const entries = Object.entries(fields);
    const validPath = kind === "proof" ? proofLabel : safeSourcePath;
    if (
      !entries.length ||
      entries.length > 256 ||
      entries.some(([file, hash]) => !validPath(file) || !isHash(hash))
    )
      return [];
    const spans = parsed.spans
      .filter(span =>
        role === null
          ? span.path.length === 1
          : span.path.length === 2 && span.path[0] === role
      )
      .map(span => ({
        file: span.path.at(-1),
        hash: span.hash,
        start: span.start + offset,
        end: span.end + offset,
      }));
    if (spans.length !== entries.length) return [];
    result.push({ kind, value: parsed.value, spans });
  }
  return result;
};

/** Fenced JSON keeps original whole-file byte offsets for actual detector attribution. */
export const evidenceMaps = bytes => {
  if (bytes.length > 1024 * 1024) return [];
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) return [];
  try {
    return maps(text, 0);
  } catch {
    /* Ordinary Markdown can contain exact JSON fences. */
  }
  const result = [];
  for (const block of text.matchAll(
    /(?:^|\n)```json\n([\s\S]*?)\n```(?=\n|$)/gu
  )) {
    const offset = Buffer.byteLength(
      text.slice(0, block.index + block[0].indexOf(block[1]))
    );
    try {
      result.push(...maps(block[1], offset));
    } catch {
      return [];
    }
  }
  return result;
};

/** Only the fixed taxonomy in ordinary prose, outside Markdown code, is a candidate. */
export const narrativeSpan = (bytes, lineStart, lineEnd) => {
  const prior = bytes.subarray(0, lineStart).toString("utf8");
  const fences = prior.split(/[\r\n\u2028\u2029]/u).filter(part => {
    const trimmed = part.trimStart();
    return trimmed.startsWith("```") || trimmed.startsWith("~~~");
  });
  if (fences.length % 2) return null;
  const line = bytes.subarray(lineStart, lineEnd).toString("utf8");
  const prose = line.replace(/`[^`\r\n]{1,256}`/gu, "identifier");
  if (!/^(?:[-*] )?[A-Za-z][A-Za-z0-9 ,./():-]*\.$/u.test(prose)) return null;
  const taxonomy = "Disk/missing/corrupt";
  const phrase = `AccessDenied boundaries, ${taxonomy} falsifications`;
  const index = line.indexOf(phrase);
  if (index < 0 || line.indexOf(phrase, index + 1) >= 0) return null;
  if (
    !/[,.]/u.test(line[index + phrase.length] ?? "") ||
    line.slice(0, index).split("`").length % 2 === 0
  )
    return null;
  const start =
    lineStart +
    Buffer.byteLength(line.slice(0, index + phrase.indexOf(taxonomy)));
  return { hash: taxonomy, start, end: start + taxonomy.length };
};
