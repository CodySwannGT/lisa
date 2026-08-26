#!/usr/bin/env node
/** Empirical proof that the packed public learnings API preserves v2 semantics. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(root, ".packed-learnings-proof-"));

try {
  const archive = path.join(temporary, "lisa-packed.tgz");
  await executeFile(
    "bun",
    ["pm", "pack", "--ignore-scripts", "--filename", archive, "--quiet"],
    { cwd: root }
  );
  await executeFile("/usr/bin/tar", ["-xzf", archive, "-C", temporary]);
  const packedRoot = path.join(temporary, "package");
  const learnings = await import(
    pathToFileURL(path.join(packedRoot, "dist", "core", "learnings.js")).href
  );

  assert.equal(learnings.LEARNINGS_CONTRACT.version, 2);
  assert.equal(learnings.LEARNINGS_CONTRACT.fields.length, 8);
  assert.equal(learnings.LEARNINGS_CONTRACT.maxTokens, 12_800);

  const legacy = `# Project Learnings\n\n<!-- lisa-learnings-contract:v1 -->\n\n\`\`\`jsonl\n{"id":"learner-base","rule":"Keep packed compatibility executable.","why":"Consumers install the tarball, not the source tree.","provenance":["issue:#2015"],"first_learned":"2026-08-26","last_confirmed":"2026-08-26","confidence":"high"}\n\`\`\`\n`;
  const normalized = learnings.parseLearningsDocument(legacy);
  assert.equal(normalized.sourceVersion, 1);
  assert.equal(normalized.entries[0].fingerprint, "learner-base");

  const project = path.join(temporary, "consumer");
  await mkdir(project);
  const base = {
    ...normalized.entries[0],
    fingerprint: "learner-base-fingerprint",
  };
  await learnings.persistLearningEntry(project, base);
  const observed = { id: base.id, fingerprint: base.fingerprint };
  const stale = [];
  const candidates = Array.from({ length: 9 }, (_unused, index) => ({
    ...base,
    id: `learner-candidate-${index}`,
    fingerprint: `learner-candidate-fingerprint-${index}`,
    rule: `Packed writer candidate ${index}.`,
  }));
  await Promise.all(
    candidates.map(candidate =>
      learnings.persistConsolidatedLearning(project, candidate, {
        supersede: [observed],
        onStaleSupersede: targets => stale.push(targets),
      })
    )
  );

  const ledgerPath = path.join(project, ".lisa", "PROJECT_LEARNINGS.md");
  const afterRace = learnings.parseLearningsFile(
    await readFile(ledgerPath, "utf8")
  );
  assert.equal(afterRace.length, 9);
  assert.equal(stale.length, 8);
  const current = afterRace.find(entry => entry.id === base.id);
  assert.ok(current);

  const chained = {
    ...current,
    id: "learner-chained-candidate",
    fingerprint: "learner-chained-fingerprint",
    rule: "A current stamp may rewrite the stable identity.",
  };
  await learnings.persistConsolidatedLearning(project, chained, {
    supersede: [{ id: current.id, fingerprint: current.fingerprint }],
  });
  const beforeCollision = await readFile(ledgerPath, "utf8");
  await assert.rejects(
    learnings.persistLearningEntry(project, {
      ...chained,
      id: "learner-duplicate-content",
    }),
    /duplicate learning fingerprint/i
  );
  assert.equal(await readFile(ledgerPath, "utf8"), beforeCollision);

  const ancestor = normalized.entries[0];
  const ours = { ...ancestor, fingerprint: "learner-ours-fingerprint" };
  const theirs = { ...ancestor, fingerprint: "learner-theirs-fingerprint" };
  const merged = learnings.mergeLearningsDocuments(
    legacy,
    learnings.renderLearningsFile([ours]),
    learnings.renderLearningsFile([theirs])
  );
  assert.equal(merged.kind, "merged");
  const mergedEntries = learnings.parseLearningsFile(merged.content);
  assert.equal(mergedEntries.length, 2);
  assert.equal(new Set(mergedEntries.map(entry => entry.fingerprint)).size, 2);
  assert.equal(learnings.projectLearnings(mergedEntries).omittedCount, 0);

  console.log(
    "[EVIDENCE: packed-learnings-contract] v1=migratable race=9 stale=8 chain=stable collision=atomic merge=2 projection=bounded"
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
