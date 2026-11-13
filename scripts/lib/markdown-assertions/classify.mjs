/**
 * Classify one Markdown assertion as STRUCTURAL, MACHINE-TOKEN or WORDING
 * (CodySwannGT/lisa#4867).
 *
 * An assertion is a (file, polarity, kind, value) check — a required or
 * forbidden substring or pattern in a Markdown document. The classes, tried
 * in this order, and every doubt resolves AWAY from WORDING:
 *
 *  - STRUCTURAL
 *      - frontmatter: the phrase is a `key:` line inside the document's YAML
 *        frontmatter;
 *      - reference: the phrase is (essentially only) a reference to a skill,
 *        command, agent or repository path — required when the target exists
 *        (the document's wiring), forbidden when it does not (a stale-
 *        reference guard).
 *  - MACHINE-TOKEN: the phrase, a heading it names, or a token-shaped part
 *    of it (`tokens.mjs`) occurs in the literal text of shipped code
 *    (`corpus.mjs`). The first such code file is recorded as the parser.
 *  - WORDING: everything else — prose an agent reads, which no script or
 *    hook consumes. Only this class is deleted.
 * @module scripts/lib/markdown-assertions/classify
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { patternLiteral, tokenCandidates } from "./tokens.mjs";

/** Shortest whole phrase looked up in code verbatim. */
const MIN_WHOLE_PHRASE = 12;

/** Most extra words a reference phrase may carry and still be a reference. */
const MAX_REFERENCE_EXTRA_WORDS = 3;

/** A skill, command or agent reference. */
const NAME_REFERENCE =
  /(?:^|[\s`"'(/$])[/$]?(lisa[-:][a-z0-9][a-z0-9:-]*[a-z0-9])/gu;

/** Repository path references: a directory path, or a bare file name. */
const PATH_REFERENCES = Object.freeze([
  /(?:^|[\s`"'(])((?:\.?[\w-]+\/)+[\w.-]*\w\/?)(?=$|[\s`"'),.:;])/gu,
  /(?:^|[\s`"'(])([\w-]+\.(?:md|mjs|ts|json|sh|yml|yaml))(?=$|[\s`"'),.:;])/gu,
]);

/**
 * @typedef {object} Check
 * @property {string} file - Repository-relative Markdown file.
 * @property {"required" | "forbidden"} polarity - Must it be present?
 * @property {"string" | "pattern"} kind - Substring or regular expression.
 * @property {string | { source: string, flags: string }} value - The phrase.
 */

/**
 * @typedef {object} Verdict
 * @property {"STRUCTURAL" | "MACHINE-TOKEN" | "WORDING"} class - The class.
 * @property {string} why - One-line reason.
 * @property {string} [parser] - For MACHINE-TOKEN, the code file that reads it.
 * @property {string} [token] - For MACHINE-TOKEN, the token found in code.
 */

/**
 * Every skill, command and agent name the repository defines, in the
 * spellings a document may use (`lisa-x`, `lisa:x`, `lisa:a:b`).
 * @param {string} root - Repository root.
 * @returns {Set<string>} Known names.
 */
export function knownNames(root) {
  const names = new Set();
  const pluginsSrc = path.join(root, "plugins", "src");
  const stacks = existsSync(pluginsSrc) ? readdirSync(pluginsSrc) : [];
  const roots = [
    ...stacks.map(stack => path.join(pluginsSrc, stack)),
    path.join(root, ".claude"),
    path.join(root, ".agents"),
  ];
  for (const base of roots) {
    for (const kind of ["skills", "commands", "agents"]) {
      const dir = path.join(base, kind);
      if (existsSync(dir)) collectNames(dir, "", names);
    }
  }
  return names;
}

/**
 * Add the names under one skills/commands/agents directory.
 * @param {string} dir - Directory.
 * @param {string} prefix - Colon-joined namespace so far.
 * @param {Set<string>} names - Collects names.
 */
function collectNames(dir, prefix, names) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const stem = entry.name.replace(/\.(?:md|agent\.md|toml)$/u, "");
    const name = prefix ? `${prefix}:${stem}` : stem;
    names.add(name);
    names.add(name.replaceAll(":", "-"));
    names.add(`lisa:${name}`);
    names.add(`lisa-${name.replaceAll(":", "-")}`);
    if (name.startsWith("lisa-")) names.add(`lisa:${name.slice(5)}`);
    if (entry.isDirectory())
      collectNames(path.join(dir, entry.name), name, names);
  }
}

/**
 * The text a check's value spells, for token search.
 * @param {Check} check - The check.
 * @returns {string} Literal text.
 */
export function literalText(check) {
  return typeof check.value === "string"
    ? check.value
    : patternLiteral(check.value.source);
}

/**
 * The YAML frontmatter block of a document, or undefined.
 * @param {string | undefined} text - Document text.
 * @returns {string | undefined} The block between the `---` fences.
 */
function frontmatter(text) {
  const match = text
    ? /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)
    : null;
  return match?.[1];
}

/**
 * STRUCTURAL by frontmatter, or undefined.
 * @param {Check} check - The check.
 * @param {string | undefined} text - The document's text.
 * @returns {Verdict | undefined} The verdict.
 */
function frontmatterVerdict(check, text) {
  const block = frontmatter(text);
  if (block === undefined) return undefined;
  const literal = literalText(check).trim();
  if (literal === "---") {
    return { class: "STRUCTURAL", why: "frontmatter fence" };
  }
  const keyLine = /^[\w-]+:/u.test(literal);
  if (!keyLine) return undefined;
  const inBlock =
    typeof check.value === "string"
      ? block.includes(check.value)
      : new RegExp(check.value.source, check.value.flags.replace("g", "")).test(
          block
        );
  return inBlock || check.polarity === "forbidden"
    ? { class: "STRUCTURAL", why: `frontmatter key ${literal.split(":")[0]}` }
    : undefined;
}

/**
 * Words left in a phrase once one reference is taken out.
 * @param {string} literal - The phrase.
 * @param {string} reference - The reference it contains.
 * @returns {number} Remaining word count.
 */
function extraWords(literal, reference) {
  return literal
    .replace(reference, " ")
    .replaceAll(/[`"'()[\]{}*_.,:;/$\\-]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;
}

/**
 * STRUCTURAL by reference, or undefined.
 * @param {Check} check - The check.
 * @param {{ root: string, names: Set<string> }} context - Repository facts.
 * @returns {Verdict | undefined} The verdict.
 */
function referenceVerdict(check, { root, names }) {
  const literal = literalText(check);
  const references = [
    ...[...literal.matchAll(NAME_REFERENCE)].map(m => ({
      text: m[1] ?? "",
      exists: names.has(m[1] ?? ""),
      kind: "name",
    })),
    ...PATH_REFERENCES.flatMap(shape => [...literal.matchAll(shape)]).map(
      m => ({
        text: m[1] ?? "",
        exists: existsSync(path.join(root, m[1] ?? "")),
        kind: "path",
      })
    ),
  ];
  const reference = references.find(
    ref =>
      ref.text && extraWords(literal, ref.text) <= MAX_REFERENCE_EXTRA_WORDS
  );
  if (!reference) return undefined;
  if (check.polarity === "required" && reference.exists) {
    return {
      class: "STRUCTURAL",
      why: `references ${reference.kind} ${reference.text}`,
    };
  }
  if (check.polarity === "forbidden" && !reference.exists) {
    return {
      class: "STRUCTURAL",
      why: `guards a stale ${reference.kind} reference ${reference.text}`,
    };
  }
  return undefined;
}

/**
 * MACHINE-TOKEN by code occurrence, or undefined.
 * @param {Check} check - The check.
 * @param {import("./corpus.mjs").Corpus} corpus - The code corpus.
 * @returns {Verdict | undefined} The verdict.
 */
function machineTokenVerdict(check, corpus) {
  const literal = literalText(check);
  const heading = /^#{1,6}\s+(.+)$/mu.exec(literal)?.[1]?.trim();
  const wholes = [
    typeof check.value === "string" ? check.value.trim() : undefined,
    heading,
  ].filter(
    /** @returns {whole is string} */ whole =>
      typeof whole === "string" && whole.length >= MIN_WHOLE_PHRASE
  );
  for (const whole of wholes) {
    const parser = corpus.find(whole);
    if (parser)
      return {
        class: "MACHINE-TOKEN",
        why: "phrase is a literal in shipped code",
        parser,
        token: whole,
      };
  }
  for (const token of tokenCandidates(literal)) {
    const parser = corpus.find(token);
    if (parser)
      return {
        class: "MACHINE-TOKEN",
        why: "token is a literal in shipped code",
        parser,
        token,
      };
  }
  return undefined;
}

/**
 * Classify one check.
 * @param {Check} check - The check.
 * @param {{ root: string, names: Set<string>, corpus: import("./corpus.mjs").Corpus, readText: (file: string) => string | undefined }} context - Repository facts.
 * @returns {Verdict} The verdict.
 */
export function classifyCheck(check, context) {
  return (
    frontmatterVerdict(check, context.readText(check.file)) ??
    referenceVerdict(check, context) ??
    machineTokenVerdict(check, context.corpus) ?? {
      class: "WORDING",
      why: "prose no shipped code reads",
    }
  );
}
