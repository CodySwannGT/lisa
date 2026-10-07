#!/usr/bin/env node
/** Reproduce the updater's fixed source graph from actual bounded bytes; this grants no runtime authority. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { __debug } from "prettier";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  managedTemplateMembers,
  validateHelperManifest,
  auditControllerClosure,
  helperManifest,
} from "../all/copy-overwrite/scripts/lib/npm-update-helper-graph.mjs";
import {
  HELPER_CONTROLS,
  HELPER_PACKAGE_MEMBERS,
} from "../all/copy-overwrite/scripts/lib/npm-update-helper-inventory.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = "all/copy-overwrite/scripts/npm-updater-helper-graph.json";

/** Source coordinates bind exceptional nonliteral import handling to exactly the existing canonical expression. */
function sourceSpan(text, node) {
  assert(
    Number.isSafeInteger(node.start) && Number.isSafeInteger(node.end),
    "genuine AST source coordinates required"
  );
  return text.slice(node.start, node.end).replace(/\s/g, "");
}

function addEdges(node, member, text, target, result) {
  if (
    [
      "ImportDeclaration",
      "ExportNamedDeclaration",
      "ExportAllDeclaration",
    ].includes(node.type) &&
    node.source
  )
    result.staticImports.push(target(node.source.value));
  const dynamic =
    node.type === "ImportExpression"
      ? node.source
      : node.type === "CallExpression" && node.callee?.type === "Import"
        ? node.arguments?.[0]
        : undefined;
  if (dynamic) {
    if (["StringLiteral", "Literal"].includes(dynamic.type))
      result.dynamicImports.push(target(dynamic.value));
    else {
      assert(
        member === "lib/npm-update-helper.mjs" &&
          sourceSpan(text, node) ===
            "import(pathToFileURL(join(owner.root,MEMBERS[0])).href)",
        "unqualified nonliteral helper import"
      );
      result.dynamicImports.push(
        "package/plugins/lisa/scripts/intake-blocker-reprobe.mjs"
      );
    }
  }
  const child = node.arguments?.[0],
    base = node.arguments?.[1];
  if (
    node.type === "NewExpression" &&
    node.callee?.name === "URL" &&
    ["StringLiteral", "Literal"].includes(child?.type) &&
    typeof child.value === "string" &&
    base &&
    sourceSpan(text, base) === "import.meta.url"
  )
    result.children.push(target(child.value));
}

/** The genuine parser supplies all imports and canonical URL children without evaluating member code. */
export async function auditedHelperEdges(member, bytes) {
  const text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  const result = { staticImports: [], dynamicImports: [], children: [] };
  const target = specifier =>
    isBuiltin(specifier)
      ? specifier.startsWith("node:")
        ? specifier
        : `node:${specifier}`
      : posix.normalize(posix.join(posix.dirname(member), specifier));
  const visited = new WeakSet();
  const visit = value => {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    addEdges(value, member, text, target, result);
    for (const [key, child] of Object.entries(value))
      if (!["comments", "tokens", "loc", "extra"].includes(key)) {
        if (Array.isArray(child)) child.forEach(visit);
        else visit(child);
      }
  };
  if (member.endsWith(".mjs"))
    visit((await __debug.parse(text, { parser: "babel" })).ast);
  if (member === "lisa-rails-prepush.mjs") {
    assert(
      text.includes('const name = "lisa-work-item.mjs";') &&
        text.includes("[join(scripts, name), ...args]"),
      "canonical Rails child declaration changed"
    );
    result.children.push("lisa-work-item.mjs");
  }
  for (const field of Object.keys(result))
    result[field] = [...new Set(result[field])].sort((a, b) =>
      a.localeCompare(b)
    );
  return result;
}

/** Read only fixed current source files. Missing packaged members, aliases and oversized files refuse. */
function sourceBytes(root, file) {
  const path = join(root, file),
    stat = lstatSync(path);
  assert(
    path === realpathSync(path) &&
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.size <= 1_048_576,
    "helper source is missing, aliased or unbounded"
  );
  const bytes = readFileSync(path);
  assert(bytes.length <= 1_048_576, "helper source grew beyond bound");
  return bytes;
}

/** Independent controls omit self-inclusive hashes; runtime callers still authenticate them from the pinned owner. */
export async function generatedHelperGraph(root = ROOT) {
  const inventory = new Map([
    ...managedTemplateMembers(),
    ...HELPER_PACKAGE_MEMBERS.map(member => [
      member,
      member.slice("package/".length),
    ]),
  ]);
  const manifest = { version: 1, controls: {}, members: {} },
    authenticated = new Map();
  for (const [member, file] of [...inventory].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const bytes = sourceBytes(root, file),
      edges = await auditedHelperEdges(member, bytes);
    authenticated.set(member, bytes);
    if (HELPER_CONTROLS.includes(member)) manifest.controls[member] = edges;
    else
      manifest.members[member] = {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        ...edges,
      };
  }
  validateHelperManifest(manifest);
  auditControllerClosure(manifest, authenticated);
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  helperManifest(bytes);
  return bytes;
}

async function main() {
  assert(
    process.argv.length <= 3 &&
      (process.argv[2] === undefined || process.argv[2] === "--check"),
    "usage: generate-npm-updater-helper-graph.mjs [--check]"
  );
  const bytes = await generatedHelperGraph();
  if (process.argv[2] === "--check")
    assert(
      readFileSync(join(ROOT, OUTPUT)).equals(bytes),
      "updater helper graph is stale; regenerate it"
    );
  else writeFileSync(join(ROOT, OUTPUT), bytes);
}

if (invokedAsScript(import.meta.url))
  main().catch(error => {
    process.stderr.write(
      `updater helper graph generation failed: ${error.message}\n`
    );
    process.exitCode = 1;
  });
