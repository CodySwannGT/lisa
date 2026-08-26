#!/usr/bin/env node
/** Empirical proof that the packed public learnings API preserves v2 semantics. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(path.join(root, ".packed-learnings-proof-"));
const packedConfigFile = ".lisa.config.json";
const packedLearningsFile = "docs/knowledge/PROJECT_LEARNINGS.md";

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
  assert.equal(learnings.MAX_STABLE_TOKEN_BYTES, 128);
  assert.equal(learnings.LEARNINGS_CONTRACT.maxTokens, 14_900);

  const configProject = path.join(temporary, "config-consumer");
  await mkdir(configProject);
  await writeFile(
    path.join(configProject, packedConfigFile),
    `${JSON.stringify({
      learnings: {
        file: packedLearningsFile,
        mergeDriver: false,
      },
    })}\n`,
    "utf8"
  );
  const packedConfig = await learnings.readProjectConfig(configProject);
  assert.deepEqual(packedConfig.learnings, {
    file: packedLearningsFile,
    mergeDriver: false,
  });
  assert.deepEqual(learnings.resolveLearningsSettings(packedConfig), {
    learningsFile: packedLearningsFile,
    mergeDriverEnabled: false,
  });
  await writeFile(
    path.join(configProject, packedConfigFile),
    '{"learnings":{"mergeDriver":"false"}}\n',
    "utf8"
  );
  await assert.rejects(
    learnings.readProjectConfig(configProject),
    /learnings\.mergeDriver.*expected boolean.*received "false"/iu
  );

  const typeConsumer = path.join(temporary, "type-consumer");
  await mkdir(path.join(typeConsumer, "node_modules", "@codyswann"), {
    recursive: true,
  });
  await symlink(
    packedRoot,
    path.join(typeConsumer, "node_modules", "@codyswann", "lisa"),
    "dir"
  );
  await writeFile(
    path.join(typeConsumer, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: "ES2022",
        },
        include: ["consumer.ts"],
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    path.join(typeConsumer, "consumer.ts"),
    `import { resolveLearningsSettings, type LearningsConfig, type ProjectConfig } from "@codyswann/lisa/learnings";

const absent: LearningsConfig = {};
const explicitTrue: LearningsConfig = { mergeDriver: true };
const explicitFalse: LearningsConfig = { mergeDriver: false };
const withFile: LearningsConfig = { file: "docs/LEARNINGS.md", mergeDriver: false };
const configs: ProjectConfig[] = [
  { learnings: absent },
  { learnings: explicitTrue },
  { learnings: explicitFalse },
  { learnings: withFile },
];
for (const config of configs) resolveLearningsSettings(config);
// @ts-expect-error mergeDriver is a boolean opt-out, never a string
const invalid: LearningsConfig = { mergeDriver: "false" };
void invalid;
`,
    "utf8"
  );
  await executeFile(
    process.execPath,
    [
      path.join(root, "node_modules", "typescript", "bin", "tsc"),
      "-p",
      typeConsumer,
    ],
    { cwd: typeConsumer }
  );

  const packedVictim = "packed-victim";
  const packedProvenance = "issue:#2015";
  const packedDate = "2026-08-26";
  const packedEntry = {
    id: packedVictim,
    fingerprint: "packed-victim-fingerprint",
    rule: "Keep packed entry validation inert.",
    why: "Consumers pass untrusted values through the public writer.",
    provenance: [packedProvenance],
    first_learned: packedDate,
    last_confirmed: packedDate,
    confidence: "high",
  };
  let entryGetterCalls = 0;
  const accessorEntry = { ...packedEntry };
  Object.defineProperty(accessorEntry, "why", {
    get: () => {
      entryGetterCalls += 1;
      return "hostile";
    },
  });
  assert.throws(
    () => learnings.validateLearningEntry(accessorEntry),
    /why.*accessor/i
  );
  assert.equal(entryGetterCalls, 0);
  const hostileProvenance = [packedProvenance];
  hostileProvenance.unexpected = true;
  assert.throws(
    () =>
      learnings.validateLearningEntry({
        ...packedEntry,
        provenance: hostileProvenance,
      }),
    /provenance array/i
  );

  let stampGetterCalls = 0;
  const accessorStamps = [];
  accessorStamps.length = 1;
  Object.defineProperty(accessorStamps, "0", {
    get: () => {
      stampGetterCalls += 1;
      return { id: packedVictim, fingerprint: packedVictim };
    },
  });
  assert.throws(
    () => learnings.validateLearningEntryStamps(accessorStamps),
    /supersede array/i
  );
  assert.equal(stampGetterCalls, 0);
  Object.defineProperties(Object.prototype, {
    id: { configurable: true, value: { value: packedVictim } },
    fingerprint: {
      configurable: true,
      value: { value: packedVictim },
    },
  });
  try {
    const pollutedEntry = { ...packedEntry };
    delete pollutedEntry.id;
    delete pollutedEntry.fingerprint;
    pollutedEntry.unrelatedId = "ignored";
    pollutedEntry.unrelatedFingerprint = "ignored";
    assert.throws(
      () => learnings.validateLearningEntry(pollutedEntry),
      /entry fields.*exactly/i
    );
    assert.throws(
      () =>
        learnings.validateLearningEntryStamps([
          { harmless: true, stillHarmless: true },
        ]),
      /exactly.*id.*fingerprint/i
    );
  } finally {
    delete Object.prototype.id;
    delete Object.prototype.fingerprint;
  }
  assert.throws(
    () =>
      learnings.validateLearningEntryStamps([
        { id: "A".repeat(129), fingerprint: packedVictim },
      ]),
    /id exceeds max stable token bytes 128/i
  );
  const inheritedProvenance = [];
  inheritedProvenance.length = 1;
  Object.defineProperty(Object.prototype, "0", {
    configurable: true,
    writable: true,
    value: { value: "issue:#forged" },
  });
  try {
    assert.throws(
      () =>
        learnings.validateLearningEntry({
          ...packedEntry,
          provenance: inheritedProvenance,
        }),
      /provenance array/i
    );
  } finally {
    delete Object.prototype["0"];
  }

  const legacy = `# Project Learnings\n\n<!-- lisa-learnings-contract:v1 -->\n\n\`\`\`jsonl\n{"id":"learner-base","rule":"Keep packed compatibility executable.","why":"Consumers install the tarball, not the source tree.","provenance":["issue:#2015"],"first_learned":"2026-08-26","last_confirmed":"2026-08-26","confidence":"high"}\n\`\`\`\n`;
  const normalized = learnings.parseLearningsDocument(legacy);
  assert.equal(normalized.sourceVersion, 1);
  assert.equal(normalized.entries[0].fingerprint, "learner-base");
  const oversizedLegacyId = "a".repeat(7007);
  const oversizedLegacy = `# Project Learnings\n\n<!-- lisa-learnings-contract:v1 -->\n\n\`\`\`jsonl\n${JSON.stringify({ ...JSON.parse(legacy.split("\n")[5]), id: oversizedLegacyId, rule: "r", why: "w".repeat(20), provenance: ["p"] })}\n\`\`\`\n`;
  assert.equal(Buffer.byteLength(oversizedLegacy, "utf8"), 7226);
  assert.throws(
    () => learnings.parseLearningsDocument(oversizedLegacy),
    /id exceeds max stable token bytes 128/i
  );

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

  const overflowProject = path.join(temporary, "overflow-consumer");
  await mkdir(overflowProject);
  const overflowEntry = index => ({
    id: `packed-overflow-${index}`,
    fingerprint: `packed-overflow-${index}`,
    rule: `Packed overflow entry ${index}.`,
    why: "Compact packed proof.",
    provenance: [`issue:#${index}`],
    first_learned: packedDate,
    last_confirmed: packedDate,
    confidence: "high",
  });
  for (
    let index = 0;
    index < learnings.LEARNINGS_CONTRACT.maxEntries;
    index += 1
  ) {
    await learnings.persistLearningEntry(overflowProject, overflowEntry(index));
  }
  const firstDrop = overflowEntry(20);
  await assert.rejects(
    learnings.persistLearningEntry(overflowProject, firstDrop),
    /was preserved/
  );
  const sameIdFork = { ...overflowEntry(21), id: firstDrop.id };
  await assert.rejects(
    learnings.persistLearningEntry(overflowProject, sameIdFork),
    /was preserved/
  );
  const overflow = await learnings.readLearningsOverflow(overflowProject);
  assert.deepEqual(
    overflow.entries.map(entry => [entry.id, entry.fingerprint]),
    [
      [firstDrop.id, firstDrop.fingerprint],
      [sameIdFork.fingerprint, sameIdFork.fingerprint],
    ]
  );
  const beforeOverflowCollision = await readFile(overflow.file, "utf8");
  await assert.rejects(
    learnings.persistLearningEntry(overflowProject, {
      ...overflowEntry(22),
      fingerprint: firstDrop.fingerprint,
    }),
    /duplicate learning fingerprint/i
  );
  assert.equal(await readFile(overflow.file, "utf8"), beforeOverflowCollision);

  console.log(
    "[EVIDENCE: packed-learnings-contract] config=validated merge-driver=opt-out types=closed v1=migratable legacy=bounded entries=hardened stamps=hardened race=9 stale=8 chain=stable collision=atomic overflow=fork merge=2 projection=bounded"
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
