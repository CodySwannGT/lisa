// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** One invocation reuses authenticated code bytes, never mutable provider authorization. */
import { required, OBJECT } from "./npm-update-contract.mjs";

/** Fresh owner selection and regular-file reads precede every cached use. */
function currentBinding(config, owner, read, members) {
  const selected = owner();
  return {
    root: selected.root,
    source: selected.source,
    version: selected.metadata.version,
    signerDigest: config.automationProvenance?.signerDigest,
    bytes: read(selected.root, members),
  };
}

/** A cached import URL cannot authorize changed files or a replacement owner. */
function assertBinding(expected, actual) {
  required(
    ["root", "source", "version", "signerDigest"].every(
      field => expected[field] === actual[field]
    ) &&
      expected.bytes.length === actual.bytes.length &&
      expected.bytes.every((bytes, index) => bytes.equals(actual.bytes[index])),
    "authenticated classifier identity or bytes changed"
  );
}

/** A sibling awaiting the same import may have invalidated its URL meanwhile. */
function assertUsable(poisoned, ...roots) {
  required(
    roots.every(root => !poisoned.has(root)),
    "authenticated classifier import lifetime is uncertain"
  );
}

/** Each factory owns its inaccessible cache; another caller cannot preseed this instance. */
export function classifierMemo(owner, read, members) {
  const entries = new WeakMap();
  const poisoned = new Set();
  const fixed = [...members];
  return async (config, authenticate) => {
    const current = currentBinding(config, owner, read, fixed);
    assertUsable(poisoned, current.root);
    // Without a source pin, the original qualifier must observe current HEAD each time.
    if (
      current.source &&
      (typeof current.signerDigest !== "string" ||
        !OBJECT.test(current.signerDigest))
    ) {
      const imported = await authenticate();
      const observed = currentBinding(config, owner, read, fixed);
      assertUsable(poisoned, current.root, imported.root, observed.root);
      return imported.verdict;
    }
    let entry = entries.get(config);
    if (entry) assertBinding(entry.binding, current);
    else {
      entry = {
        binding: {
          ...current,
          bytes: current.bytes.map(bytes => Buffer.from(bytes)),
        },
        promise: Promise.resolve().then(authenticate),
      };
      entries.set(config, entry);
      const pending = entry;
      pending.promise.catch(() => {
        if (entries.get(config) === pending) entries.delete(config);
      });
    }
    const imported = await entry.promise;
    let observed;
    try {
      // Authentication/import may yield; detect changes during that interval too.
      observed = currentBinding(config, owner, read, fixed);
      assertBinding(entry.binding, observed);
      required(
        imported.root === entry.binding.root,
        "classifier import owner changed"
      );
      assertUsable(poisoned, entry.binding.root, imported.root, observed.root);
    } catch (error) {
      // ESM caches this URL: restoring files or another config cannot requalify it.
      poisoned.add(entry.binding.root);
      poisoned.add(imported.root);
      if (observed) poisoned.add(observed.root);
      throw error;
    }
    return imported.verdict;
  };
}
