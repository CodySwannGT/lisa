#!/usr/bin/env node
/** Empirical proof that built Codex and OpenCode installers preserve learner metadata. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { load as loadYaml } from "js-yaml";
import { parse as parseToml } from "smol-toml";
import { discoverAndInstallAgents as installOpencodeAgents } from "../dist/opencode/agent-installer.js";

const EXPECTED_DESCRIPTION =
  "Post-implementation learning agent. Capture-only — collects task learnings, builds seven-field entries, and persists them to the machine-managed ledger through the executable contract with provenance. Never promotes: it creates no skills, appends no rules, files no upstream issues; promotion is exclusively the gardener's ticket-gated job.";
const executeFile = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destination = await mkdtemp(
  path.join(tmpdir(), "lisa-learner-frontmatter-built-")
);

try {
  const codexOverlay = await executeFile(
    process.execPath,
    [path.join(root, "dist", "codex", "project-overlay.js"), destination],
    { cwd: root }
  );
  const opencodeResult = await installOpencodeAgents(root, destination, []);

  assert.match(
    codexOverlay.stderr,
    /Lisa Codex overlay: \d+ native skills from \d+ project plugins\./
  );
  assert.equal(
    opencodeResult.installed.some(agent => agent.id === "learner"),
    true
  );

  const codexAgent = parseToml(
    await readFile(
      path.join(destination, ".codex", "agents", "lisa", "learner.toml"),
      "utf8"
    )
  );
  assert.equal(codexAgent.name, "lisa-learner");
  assert.equal(codexAgent.description, EXPECTED_DESCRIPTION);

  const opencodeMarkdown = await readFile(
    path.join(destination, ".opencode", "agents", "lisa-learner.md"),
    "utf8"
  );
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(opencodeMarkdown);
  assert.notEqual(frontmatter, null);
  const opencodeAgent = loadYaml(frontmatter?.[1] ?? "");
  assert.equal(typeof opencodeAgent, "object");
  assert.notEqual(opencodeAgent, null);
  assert.equal(opencodeAgent.description, EXPECTED_DESCRIPTION);
  assert.equal(opencodeAgent.mode, "subagent");

  console.log(
    "[EVIDENCE: learner-frontmatter-built] codex=preserved opencode=preserved"
  );
} finally {
  await rm(destination, { recursive: true, force: true });
}
