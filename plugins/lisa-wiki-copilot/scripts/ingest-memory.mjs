#!/usr/bin/env node
/**
 * ingest-memory.mjs — PROJECT-SCOPED memory connector. Dependency-free.
 *
 * Ingests ONLY a project's own persisted memory into a sanitized source note.
 * NEVER ingests global/unrelated memory: global Codex memory (~/.codex/memories) and
 * the Codex Chronicle store are hard-refused. Claude per-project memory is inherently
 * project-scoped; Codex memory is accepted only via an explicit project-scoped path
 * (e.g. a per-project CODEX_HOME). Emits a proposed cursor; the kernel advances state.
 *
 * Usage:
 *   node ingest-memory.mjs --memory-dir <dir> [--config <p>] [--source-dir <dir>]
 *     [--state <file>] [--emit-meta <file>]
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  loadConfig,
  walkFiles,
  writeSanitizedSourceNote,
} from "./_wiki-lib.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i !== -1 ? argv[i + 1] : d;
};
const memoryDir = opt("--memory-dir");
const sourceDir = path.resolve(opt("--source-dir", "wiki/sources/memory"));
const emitMeta = opt("--emit-meta");

const fail = m => {
  console.error(`✗ ${m}`);
  process.exit(1);
};
if (!memoryDir)
  fail("--memory-dir is required (the PROJECT-SCOPED memory directory)");
const resolvedMem = path.resolve(memoryDir);

// Hard refusal of global / unrelated memory stores.
const globalCodex = path.resolve(os.homedir(), ".codex", "memories");
const chronicle = path.resolve(os.homedir(), ".codex", "memories_extensions");
if (
  resolvedMem === globalCodex ||
  resolvedMem.startsWith(globalCodex + path.sep) ||
  resolvedMem.startsWith(chronicle + path.sep)
) {
  fail(
    `refusing global Codex memory (${resolvedMem}). Memory ingestion is project-scoped only — never global/unrelated.`
  );
}
if (!fs.existsSync(resolvedMem)) fail(`memory dir not found: ${resolvedMem}`);

// Prove the directory is PROJECT-scoped (don't just trust the caller): accept only the
// Claude per-project memory dir for THIS repo, a per-project CODEX_HOME memories dir, or a
// config-declared allowlist. Otherwise refuse — it could be another project's memory.
const repo = path.resolve(opt("--repo", "."));
const { config } = loadConfig(opt("--config"));
const allowedRoots = (config?.memory?.allowedRoots ?? []).map(p =>
  path.resolve(p)
);
const claudeMem = path.resolve(
  os.homedir(),
  ".claude",
  "projects",
  repo.split(path.sep).join("-"),
  "memory"
);
const codexHome = process.env.CODEX_HOME
  ? path.resolve(process.env.CODEX_HOME)
  : null;
const projectCodexMem =
  codexHome && codexHome !== path.resolve(os.homedir(), ".codex")
    ? path.join(codexHome, "memories")
    : null;
const under = root =>
  Boolean(root) &&
  (resolvedMem === root || resolvedMem.startsWith(root + path.sep));
if (!(under(claudeMem) || under(projectCodexMem) || allowedRoots.some(under))) {
  fail(
    `--memory-dir is not provably project-scoped for repo ${repo}. Expected the Claude per-project dir (${claudeMem}), a per-project CODEX_HOME memories dir, or config.memory.allowedRoots. Refusing possibly-unrelated memory.`
  );
}

const mdFiles = walkFiles(resolvedMem, { ext: ".md" });
const date = new Date().toISOString().slice(0, 10);
const entries = mdFiles.map(f => {
  const body = fs.readFileSync(f, "utf8").trim();
  return `### ${path.basename(f)}\n\n${body}`;
});

const notePath = path.join(sourceDir, `${date}-memory.md`);
const note = `---
type: source
created: ${date}
updated: ${date}
related: []
sources: []
source_system: memory
sensitivity: internal
---

# project-scoped memory (${date})

- Source: \`${resolvedMem}\` (project-scoped; global/Chronicle memory is never ingested)
- Files: ${mdFiles.length}

${entries.join("\n\n") || "_(no memory files)_"}
`;

const safety = writeSanitizedSourceNote(notePath, note, {
  sourceId: path.relative(process.cwd(), notePath),
  sourceSystem: "memory",
});

const meta = {
  connector: "memory",
  profile: "project",
  ranAt: new Date().toISOString(),
  proposedCursor: { files: mdFiles.length, lastIngest: date },
  sourceNotes: [path.relative(process.cwd(), notePath)],
  safety: {
    reviewRequired: safety.reviewRequired,
    findings: safety.findings,
  },
};
if (emitMeta) {
  fs.mkdirSync(path.dirname(emitMeta), { recursive: true });
  fs.writeFileSync(emitMeta, `${JSON.stringify(meta, null, 2)}\n`);
}

console.log(
  `✓ memory connector: ${mdFiles.length} file(s) → ${path.relative(process.cwd(), notePath)}`
);
