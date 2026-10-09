/**
 * @file errors.mjs
 * @description Coordinate refusals and independent native Git budget witnesses.
 * @module history-secrets-fixtures
 */
export { errorCases } from "./vendor-errors.mjs";

/**
 * Apply exactly the authored malformed-coordinate and manifest controls.
 * @param harness - Original private fixture operations
 * @param fixture - Actual graph and coordinate data
 * @returns Malformed fixture manifest bytes
 */
export const corruptImmutableManifest = (harness, fixture) => {
  const { mode, entries, identity, before, cwd, source, foreign } = fixture;
  const { git } = harness;
  const version = '"version": 1';
  const state = { manifest: "" };
  if (["missing-sibling", "coexist-incomplete"].includes(mode)) entries.pop();
  if (mode === "wrong-blob")
    entries[0].origin.blob = "f".repeat(identity.length);
  if (mode === "origin-not-selected") entries[0].origin.commit = before;
  if (mode === "wrong-span")
    entries[0].origin.value_span = entries[0].origin.value_span.map(
      value => value + 1
    );
  if (mode === "duplicate") entries.push(structuredClone(entries[0]));
  if (mode === "unknown") entries[0].authority = true;
  if (mode === "wrong-role") entries[0].origin.map_pointer = "/proof_sha256";
  if (mode === "unsafe-integer")
    entries[0].origin.value_span = [
      Number.MAX_SAFE_INTEGER + 1,
      Number.MAX_SAFE_INTEGER + 65,
    ];
  if (mode === "overlap") {
    const duplicate = structuredClone(entries[0]);
    duplicate.origin.value_span = duplicate.origin.value_span.map(
      value => value + 1
    );
    entries.push(duplicate);
  }
  if (mode === "blob-revision")
    entries[0].preimage.commit = git(cwd, "rev-parse", `${before}:${source}`);
  if (mode === "tag-revision") {
    git(cwd, "tag", "-a", "fixture", before, "-m", "typed tag");
    entries[0].preimage.commit = git(cwd, "rev-parse", "refs/tags/fixture");
  }
  if (mode === "off-chain") entries[0].preimage.commit = foreign;
  state.manifest = JSON.stringify({ version: 1, entries }, null, 2);
  if (mode === "escaped-coordinate")
    state.manifest = state.manifest.replace('"origin"', '"ori\\u0067in"');
  if (mode === "duplicate-key")
    state.manifest = state.manifest.replace(
      version,
      '"version": 1, "version": 1'
    );
  if (mode === "token-budget")
    state.manifest = JSON.stringify({
      version: 1,
      entries: Array.from({ length: 256 }, () => entries[0]),
    });
  if (mode === "depth-budget")
    state.manifest = state.manifest.replace(
      version,
      `"version": ${"[".repeat(33)}1${"]".repeat(33)}`
    );
  if (mode === "byte-budget") state.manifest += " ".repeat(1024 * 1024);
  if (mode === "sidecar-credential")
    state.manifest = state.manifest.replace(
      version,
      `${version}, "api_key": ${JSON.stringify(harness.secret().match(/"([^"]+)"/u)[1])}`
    );
  return state.manifest;
};

/**
 * Refuse ambiguous or oversized native preimage proof batches before Git runs.
 * @param tuples - Closed commit/path/optional SHA256 records
 * @returns Whether every tuple respects the original finite proof contract
 */
export const validPreimageTuples = tuples =>
  Array.isArray(tuples) &&
  tuples.length > 0 &&
  tuples.length <= 256 &&
  tuples.every(
    tuple =>
      Array.isArray(tuple) &&
      tuple.length === 3 &&
      typeof tuple[0] === "string" &&
      /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(tuple[0]) &&
      typeof tuple[1] === "string" &&
      tuple[1].length > 0 &&
      !/^(?:\/|[A-Za-z]:)/u.test(tuple[1]) &&
      !/[\\\u0000-\u001f\u007f]/u.test(tuple[1]) &&
      tuple[1]
        .split("/")
        .every(part => part && part !== "." && part !== "..") &&
      (tuple[2] === null ||
        (typeof tuple[2] === "string" && /^[a-f0-9]{64}$/u.test(tuple[2])))
  );

/**
 * Measure actual generated JSON syntax independently of the production parser.
 * @param value - Parsed exact committed fixture document
 * @param depth - Current genuine nesting depth
 * @returns Actual lexical token count and maximum value depth
 */
const measuredJson = (value, depth = 0) => {
  if (value === null || typeof value !== "object") return { tokens: 1, depth };
  const children = Object.values(value).map(child =>
    measuredJson(child, depth + 1)
  );
  return {
    tokens:
      2 +
      Math.max(0, children.length - 1) +
      (Array.isArray(value) ? 0 : children.length * 2) +
      children.reduce((sum, child) => sum + child.tokens, 0),
    depth: Math.max(depth, ...children.map(child => child.depth)),
  };
};

/**
 * Retain actual native identities privately and publish only closed boundary metrics.
 * @param harness - Owned fixture report authority
 * @param name - Fixed case name
 * @param graph - Actual committed documents and complete coordinate entries
 * @param inventory - Independently recomputed regular Git objects
 * @param companion - Deliberately mismatching detector companion
 * @param fixture - Closed authored boundary tuple
 * @returns Measured native topology, never runtime read telemetry
 */
export const retainBudgetInventory = (
  harness,
  name,
  graph,
  inventory,
  companion,
  fixture
) => {
  const unique = [...new Map(inventory.map(row => [row.oid, row])).values()];
  const metrics = {
    detectorCompanion: companion,
    entries: graph.entries.length,
    mapEntries: graph.entries.length + graph.documents.length - 2,
    uniqueBlobs: unique.length,
    aggregateBytes: unique.reduce((total, row) => total + row.size, 0),
    documents: graph.documents.map(text => ({
      bytes: Buffer.byteLength(text),
      ...measuredJson(JSON.parse(text)),
    })),
  };
  harness.requireFact(
    metrics.entries <= 256 &&
      metrics.documents.every(
        row => row.bytes <= 1024 * 1024 && row.tokens <= 8192 && row.depth <= 32
      ),
    `${name}: competing document bounds exceeded.`
  );
  harness.requireFact(
    fixture[1] === "bytes"
      ? metrics.aggregateBytes <= 64 * 1024 * 1024 === (fixture[3] === 0)
      : metrics.uniqueBlobs === (fixture[3] === 0 ? 255 : 257),
    `${name}: actual native budget topology differs.`
  );
  if (harness.proof)
    harness.write(
      harness.proof,
      `${name}-inventory.json`,
      JSON.stringify({ ...metrics, origin: graph.origin, inventory }, null, 2)
    );
  return metrics;
};

/**
 * Build exact binary source objects for the closed authentic budget graph.
 * @param harness - Owned fixture operations
 * @param cwd - Original private Git repository
 * @param fixture - Exact finite authored budget tuple
 * @param hash - Existing fixture SHA256 operation
 * @returns Distinct native source paths and expected preimage digests
 */
export const createBudgetSources = (harness, cwd, fixture, hash) => {
  const [, kind, count] = fixture;
  return Array.from(
    { length: kind === "bytes" ? count : count + 1 },
    (_, index) => {
      const path = `config/access-${index}.rb`;
      const bytes = Buffer.alloc(
        kind === "bytes" ? 1024 * 1024 : 32,
        index + 1
      );
      bytes[0] = 0;
      const digest = hash(bytes);
      harness.values.push(digest);
      harness.write(cwd, path, bytes);
      return { path, digest };
    }
  );
};

/**
 * Preserve detector coverage with real independent legacy source-map documents.
 * @param harness - Owned native fixture operations
 * @param cwd - Original Git repository
 * @param sources - Actual distinct binary preimages
 * @param companion - Fixed mismatching detection arm
 * @returns Genuine original document coordinates and bytes
 */
export const createBudgetLegacy = (harness, cwd, sources, companion) => {
  return sources.slice(1).map((row, index) => {
    const file = `evidence/legacy-${index}.json`;
    const text = JSON.stringify(
      { source_sha256: { [row.path]: row.digest } },
      null,
      2
    );
    harness.write(cwd, file, text);
    if (companion) {
      const wrong = Buffer.alloc(32, index + 128);
      wrong[0] = 0;
      harness.write(cwd, row.path, wrong);
    }
    return {
      file,
      text,
      line: text.slice(0, text.indexOf(row.digest)).split("\n").length,
    };
  });
};

/**
 * Construct actual binary preimages and all independently addressable legacy documents.
 * @param harness - Existing owned fixture authority
 * @param fixture - Closed budget tuple
 * @param companion - Deliberately mismatching legacy detector companion
 * @param operations - Existing fixed fixture hash/commit functions
 * @returns Actual source/origin commits and complete native proof records
 */
export const budgetGraph = (harness, fixture, companion, operations) => {
  const { hash, commit } = operations;
  const [name, kind, count] = fixture;
  const { cwd } = harness.initialize(`${name}${companion ? "-detector" : ""}`);
  const sources = createBudgetSources(harness, cwd, fixture, hash);
  const before = commit(harness, cwd);
  const fields = Object.fromEntries(
    sources
      .slice(0, kind === "bytes" ? count : 1)
      .map(row => [row.path, row.digest])
  );
  const document = "evidence/budget.json";
  const content = JSON.stringify({ source_hashes: fields }, null, 2);
  const legacy =
    kind === "bytes"
      ? []
      : createBudgetLegacy(harness, cwd, sources, companion);
  const origin = (() => {
    harness.write(cwd, document, content);
    return commit(harness, cwd);
  })();
  const originBlob = harness.git(cwd, "rev-parse", `${origin}:${document}`);
  const entries = Object.values(fields).map(digest => {
    const start = Buffer.from(content).indexOf(Buffer.from(digest));
    return {
      origin: {
        commit: origin,
        blob: originBlob,
        path: document,
        format: "json-source-map",
        map_pointer: "/source_hashes",
        value_span: [start, start + 64],
      },
      preimage: { kind: "source", commit: before },
    };
  });
  const sidecar = ".lisa/history-secret-evidence.json";
  const manifest = JSON.stringify({ version: 1, entries });
  const head = (() => {
    harness.write(cwd, sidecar, manifest);
    return commit(harness, cwd);
  })();
  const tuples = sources.map(row => [
    kind === "bytes" || row === sources[0] ? before : origin,
    row.path,
    companion && row !== sources[0] ? null : row.digest,
  ]);
  tuples.push(
    [origin, document, hash(content)],
    [head, sidecar, hash(manifest)],
    ...legacy.map(row => [origin, row.file, hash(row.text)])
  );
  return {
    cwd,
    before,
    head,
    origin,
    content,
    manifest,
    documents: [content, manifest, ...legacy.map(row => row.text)],
    entries,
    tuples,
    targets:
      kind === "bytes"
        ? Object.values(fields).map(digest => ({
            file: document,
            line: content.slice(0, content.indexOf(digest)).split("\n").length,
          }))
        : legacy,
    sources,
  };
};

/**
 * Assert actual native budget rows against the independently authored fixed boundaries.
 * @param expect - Collected test expectation authority
 * @param observation - Actual redacted native fixture row
 * @param group - Independently authored collected selector
 */
export const requireCollectedBudgetObservation = (
  expect,
  observation,
  group
) => {
  const bytes = group.includes("bytes");
  const within = group.endsWith("within");
  const companion = observation.name.endsWith("-detector");
  const count = bytes ? (within ? 63 : 64) : within ? 126 : 127;
  expect(observation).toMatchObject({
    exit: companion || !within ? 42 : 0,
    selectedCommits: 2,
    preimagesVerified: companion ? 1 : bytes ? count : count + 1,
    budget: {
      detectorCompanion: companion,
      entries: bytes ? count : 1,
      mapEntries: bytes ? count : count + 1,
      uniqueBlobs: bytes ? count + 2 : within ? 255 : 257,
    },
  });
  expect(observation.budget.aggregateBytes <= 64 * 1024 * 1024).toBe(
    !bytes || within
  );
  if (companion) expect(observation.findingsCount).toBe(count);
  else if (within) expect(observation.findingsCount).toBe(0);
  else expect(observation.findingsCount).toBeGreaterThan(0);
  expect(
    observation.budget.documents.every(
      row => row.bytes <= 1024 * 1024 && row.tokens <= 8192 && row.depth <= 32
    )
  ).toBe(true);
};

/** Two real native scans overlap within the unchanged whole-journey deadline. */

/**
 * Preserve result order and await every active job before propagating a refusal.
 * @param jobs - Source-owned operations, each retaining its original child bound.
 * @returns Ordered actual observations after all active operations finish.
 */
export async function runTwoWorkers(jobs) {
  const selected = [...jobs];
  const results = [];
  const state = { next: 0, failed: false, firstFailure: undefined };
  const worker = async () => {
    while (!state.failed && state.next < selected.length) {
      const index = state.next++;
      try {
        results[index] = await selected[index]();
      } catch (error) {
        if (!state.failed) state.firstFailure = error;
        state.failed = true;
      }
    }
  };
  await Promise.all([worker(), worker()]);
  if (state.failed) throw state.firstFailure;
  return results;
}
