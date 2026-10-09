// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
/** Bounded lossless evidence syntax; no digest is authenticated by syntax alone. */
const SOURCE_MAP_FORMAT = "json-source-map";
const PROOF_MAP_FORMAT = "json-proof-map";
const TAXONOMY = "Disk/missing/corrupt";
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
  const tokens = [];
  for (const token of text.matchAll(
    /"(?:\\[\s\S]|[^"\\])*"|[{}[\],:]|[^{}[\],:\s]+/gu
  )) {
    if (tokens.length >= 8192) throw new Error("Bounded JSON tokens");
    tokens.push(token);
  }
  const value = JSON.parse(text);
  const state = { cursor: 0, spans: [] };
  visit(tokens, state, [], 0, text);
  if (state.cursor !== tokens.length) throw new Error("Trailing JSON tokens");
  return { value, spans: state.spans, tokens };
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

const coordinateFormats = new Map([
  [
    SOURCE_MAP_FORMAT,
    new Set([
      "/selected_artifact_hashes",
      "/source_hashes",
      "/source_hashes_after",
    ]),
  ],
  ["json-root-map", new Set([""])],
  ["markdown-json-files", new Set(["/files"])],
  [PROOF_MAP_FORMAT, new Set(["/proof_sha256"])],
]);
const record = value =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const fieldsExactly = (value, fields) =>
  record(value) &&
  Object.keys(value).length === fields.length &&
  fields.every(field => Object.hasOwn(value, field));
const objectId = (value, width) =>
  typeof value === "string" &&
  [40, 64].includes(width) &&
  new RegExp(`^[a-f0-9]{${width}}$`, "u").test(value);
const documentText = bytes => {
  if (bytes.length > 1024 * 1024) return null;
  const text = bytes.toString("utf8");
  return Buffer.from(text).equals(bytes) ? text : null;
};
const coordinateOrigin = (origin, width) =>
  fieldsExactly(origin, [
    "commit",
    "blob",
    "path",
    "format",
    "map_pointer",
    "value_span",
  ]) &&
  objectId(origin.commit, width) &&
  objectId(origin.blob, width) &&
  safeSourcePath(origin.path) &&
  coordinateFormats.get(origin.format)?.has(origin.map_pointer) === true &&
  Array.isArray(origin.value_span) &&
  origin.value_span.length === 2 &&
  origin.value_span.every(
    value => Number.isSafeInteger(value) && value >= 0 && value <= 1024 * 1024
  ) &&
  origin.value_span[1] - origin.value_span[0] === 64;
const coordinatePreimage = (preimage, width) => {
  if (preimage?.kind === "source")
    return Object.hasOwn(preimage, "commit")
      ? fieldsExactly(preimage, ["kind", "commit"]) &&
          objectId(preimage.commit, width)
      : fieldsExactly(preimage, ["kind"]);
  return (
    fieldsExactly(preimage, ["kind", "commit", "path"]) &&
    preimage.kind === "archive" &&
    objectId(preimage.commit, width) &&
    preimage.path === "evidence/archive/neutral-artifact.json"
  );
};

/** Closed version1 coordinates carry no digest, opaque original key or caller role. */
export const coordinateManifest = (bytes, width) => {
  const text = documentText(bytes);
  if (text === null) return null;
  try {
    const parsed = lexical(text);
    if (
      parsed.tokens.some(
        token =>
          token[0].startsWith('"') &&
          token[0] !== JSON.stringify(JSON.parse(token[0]))
      )
    )
      return null;
    const value = parsed.value;
    if (
      !fieldsExactly(value, ["version", "entries"]) ||
      value.version !== 1 ||
      !Array.isArray(value.entries) ||
      value.entries.length > 256
    )
      return null;
    if (
      value.entries.some(
        entry =>
          !fieldsExactly(entry, ["origin", "preimage"]) ||
          !coordinateOrigin(entry.origin, width) ||
          !coordinatePreimage(entry.preimage, width)
      )
    )
      return null;
    return value.entries;
  } catch {
    return null;
  }
};

/** Scan maximal opening markers without backtracking across a long fence line. */
const openingFence = line => {
  const state = { start: 0, end: 0 };
  while (state.start < 3 && line[state.start] === " ") state.start++;
  state.end = state.start;
  const marker = line[state.start];
  if (marker !== "`" && marker !== "~") return null;
  while (line[state.end] === marker) state.end++;
  const info = line.slice(state.end);
  return state.end - state.start >= 3 && !/[\r\n]/u.test(info)
    ? [line.slice(state.start, state.end), info]
    : null;
};

/** Strip only trailing CR/LF bytes, with a single bounded backwards pass. */
const withoutLineEnding = line => {
  const state = { end: line.length };
  while (state.end > 0 && /[\r\n]/u.test(line[state.end - 1])) state.end--;
  return line.slice(0, state.end);
};

/** Track actual Markdown fences, including nested-looking text inside another fence. */
const markdownFences = text => {
  const result = [];
  let active = null;
  let offset = 0;
  for (const line of text.split(/(?<=\n)/u)) {
    const clean = withoutLineEnding(line);
    if (active) {
      const close = clean.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u);
      if (
        close &&
        close[1][0] === active.marker[0] &&
        close[1].length >= active.marker.length
      ) {
        result.push({
          ...active,
          bodyEnd: offset,
          end: offset + line.length,
          closed: true,
        });
        active = null;
      }
    } else {
      const open = openingFence(clean);
      if (open && !(open[0][0] === "`" && open[1].includes("`")))
        active = {
          start: offset,
          marker: open[0],
          info: open[1].trim(),
          bodyStart: offset + line.length,
        };
    }
    offset += line.length;
  }
  if (active)
    result.push({
      ...active,
      bodyEnd: text.length,
      end: text.length,
      closed: false,
    });
  return result;
};
const markdownTokensWithinBudget = text => {
  let count = 0;
  for (const _token of text.matchAll(
    /"(?:\\[\s\S]|[^"\\])*"|[`~]+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu
  ))
    if (++count > 8192) return false;
  return true;
};
const completeMap = (value, isPath) =>
  record(value) &&
  Object.keys(value).length > 0 &&
  Object.keys(value).length <= 256 &&
  Object.entries(value).every(
    ([key, literal]) => isPath(key) && isHash(literal)
  );
const opaqueKey = key => typeof key === "string" && key.length > 0;
const coordinateMap = (parsed, role, format, offset = 0) => {
  const value = role === null ? parsed.value : parsed.value[role];
  if (
    !completeMap(
      value,
      format === PROOF_MAP_FORMAT ? opaqueKey : safeSourcePath
    )
  )
    return null;
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
  if (spans.length !== Object.keys(value).length) return null;
  return {
    kind: format === PROOF_MAP_FORMAT ? "proof" : "source",
    format,
    pointer: role === null ? "" : `/${role}`,
    value: parsed.value,
    spans,
  };
};
const coordinateJsonMaps = parsed => {
  if (!record(parsed.value)) return [];
  if (completeMap(parsed.value, safeSourcePath))
    return [coordinateMap(parsed, null, "json-root-map")];
  const roles = [
    "selected_artifact_hashes",
    "source_hashes",
    "source_hashes_after",
    "proof_sha256",
  ].filter(role => Object.hasOwn(parsed.value, role));
  const result = roles.map(role =>
    coordinateMap(
      parsed,
      role,
      role === "proof_sha256" ? PROOF_MAP_FORMAT : SOURCE_MAP_FORMAT
    )
  );
  return result.some(map => map === null) ? [] : result;
};

/** Complete documents derive exact fixed map roles independently of manifest assertions. */
export const coordinateMaps = bytes => {
  const text = documentText(bytes);
  if (text === null) return [];
  try {
    return coordinateJsonMaps(lexical(text));
  } catch {
    /* A complete Markdown document may supply one independently parsed JSON fence. */
  }
  if (!markdownTokensWithinBudget(text)) return [];
  const blocks = markdownFences(text).filter(block => block.info === "json");
  if (blocks.length !== 1 || !blocks[0].closed) return [];
  try {
    const block = blocks[0];
    const parsed = lexical(text.slice(block.bodyStart, block.bodyEnd));
    if (
      !record(parsed.value) ||
      !completeMap(parsed.value.files, safeSourcePath) ||
      !completeMap(parsed.value.logs, opaqueKey)
    )
      return [];
    const map = coordinateMap(
      parsed,
      "files",
      "markdown-json-files",
      Buffer.byteLength(text.slice(0, block.bodyStart))
    );
    return map ? [map] : [];
  } catch {
    return [];
  }
};

const paragraphBreak = line =>
  /^\s*$/u.test(line) ||
  /^ {0,3}(?:>|#{1,6}[ \t]|`{3,}|~{3,}|(?:[-*+] |\d+[.)] ))/u.test(line) ||
  /^(?: {4}|\t)/u.test(line);
const paragraphAt = (text, position) => {
  const lines = [];
  let start = 0;
  for (const textLine of text.split(/(?<=\n)/u)) {
    lines.push({ text: textLine, start, end: start + textLine.length });
    start += textLine.length;
  }
  const index = lines.findIndex(
    line => position >= line.start && position < line.end
  );
  if (index < 0) return null;
  let first = index;
  let last = index;
  while (first > 0 && !paragraphBreak(lines[first].text)) {
    if (/^\s*$/u.test(lines[first - 1].text)) break;
    if (paragraphBreak(lines[first - 1].text)) {
      if (/^ {0,3}>/u.test(lines[first - 1].text)) return null;
      if (/^ {0,3}[-*+] /u.test(lines[first - 1].text)) first--;
      break;
    }
    first--;
  }
  while (last + 1 < lines.length && !paragraphBreak(lines[last + 1].text))
    last++;
  return {
    start: lines[first].start,
    text: text.slice(lines[first].start, lines[last].end),
  };
};
const inlineCode = text => {
  const ranges = [];
  const runs = [...text.matchAll(/`+/gu)];
  let index = 0;
  while (index < runs.length) {
    const close = runs.findIndex(
      (run, candidate) =>
        candidate > index && run[0].length === runs[index][0].length
    );
    if (close < 0) return null;
    ranges.push([runs[index].index, runs[close].index + runs[close][0].length]);
    index = close + 1;
  }
  return ranges;
};
const quotedRanges = text => {
  const ranges = [];
  let quote = null;
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char !== "'" && char !== '"') continue;
    if (quote === char) {
      ranges.push([start, index + 1]);
      quote = null;
    } else if (quote === null) {
      if (char === "'" && /[\p{L}\p{N}]/u.test(text[index - 1] ?? "")) continue;
      quote = char;
      start = index;
    }
  }
  return quote === null ? ranges : null;
};

/** One exact taxonomy occurrence may live inside a complete larger Markdown paragraph. */
export const paragraphNarrativeSpan = (bytes, lineStart, lineEnd) => {
  const text = documentText(bytes);
  if (text === null || !markdownTokensWithinBudget(text)) return null;
  const position = bytes.subarray(0, lineStart).toString("utf8").length;
  if (
    markdownFences(text).some(
      block => position >= block.start && position < block.end
    )
  )
    return null;
  const paragraph = paragraphAt(text, position);
  if (!paragraph) return null;
  const phrase = `AccessDenied boundaries, ${TAXONOMY} falsifications`;
  const index = paragraph.text.indexOf(phrase);
  if (
    index < 0 ||
    paragraph.text.indexOf(phrase, index + 1) >= 0 ||
    !/[,.]/u.test(paragraph.text[index + phrase.length] ?? "")
  )
    return null;
  const ranges = inlineCode(paragraph.text);
  if (
    ranges === null ||
    ranges.some(([start, end]) => index < end && index + phrase.length > start)
  )
    return null;
  let prose = paragraph.text;
  for (const [start, end] of [...ranges].reverse())
    prose = `${prose.slice(0, start)}identifier${prose.slice(end)}`;
  const quotes = quotedRanges(prose);
  const proseIndex = prose.indexOf(phrase);
  if (
    quotes === null ||
    quotes.some(
      ([start, end]) => proseIndex < end && proseIndex + phrase.length > start
    )
  )
    return null;
  if (
    !/^(?: {0,3}[-*+] )?\p{L}[\p{L}\p{N}\s,./():;!?"'-]*[.!?]\s*$/u.test(prose)
  )
    return null;
  if (
    [...prose.matchAll(/(?:^|\s)([a-z_-]+)\s*:/giu)].some(
      match => credentialField.test(match[1]) || credentialToken.test(match[1])
    )
  )
    return null;
  const start = Buffer.byteLength(
    text.slice(0, paragraph.start + index + phrase.indexOf(TAXONOMY))
  );
  const end = start + TAXONOMY.length;
  return start >= lineStart && end <= lineEnd
    ? { hash: TAXONOMY, start, end }
    : null;
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
  const taxonomy = TAXONOMY;
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
