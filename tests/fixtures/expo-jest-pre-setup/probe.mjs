/**
 * Run Lisa's managed Expo `jest.setup.pre.js` in this fresh child process and
 * report, as JSON on stdout, what its native-module proxy resolves.
 *
 * The child process is the sandbox: the setup gets a global object, `process`
 * and module loader of its own, and the parent bounds the child's wall time.
 * The setup is loaded from a directory the parent prepared, next to a real
 * `jest.config.react-native-mock.js` and `jest.setup.pre.local.js`, exactly
 * as Jest loads it in a host. Identity checks run here, where the objects
 * live, and are reported as booleans.
 *
 * Usage: node probe.mjs <setup-dir> <scenario>
 * @module tests/fixtures/expo-jest-pre-setup/probe
 */
import { createRequire } from "node:module";
import path from "node:path";

/** Names the parent asks the proxy to resolve, in every scenario. */
const QUERIES = Object.freeze([
  "SourceCode",
  "UIManager",
  "ProjectCamera",
  "constructor",
  "toString",
  "missing",
]);

/**
 * Build the project-owned mock registry a scenario describes.
 * @param {string} scenario - Scenario name chosen by the parent
 * @returns {object} The registry the setup will require
 */
function registryFor(scenario) {
  switch (scenario) {
    case "empty":
      return Object.freeze({});
    case "project":
      return Object.freeze({
        SourceCode: { getConstants: () => ({ scriptURL: "custom://bundle" }) },
        UIManager: { getConstants: () => ({ nativeView: "project-view" }) },
        ProjectCamera: { cameraId: "preserve-me" },
      });
    case "null-modules":
      return Object.freeze({ SourceCode: null, UIManager: null });
    case "undefined-modules":
      return Object.freeze({ SourceCode: undefined, UIManager: undefined });
    case "null-prototype":
      return Object.freeze(Object.create(null));
    default:
      throw new Error(`Unknown scenario: ${scenario}`);
  }
}

/**
 * Snapshot a registry's own property descriptors, values by identity.
 * @param {object} registry - Registry to snapshot
 * @returns {Array<[string, PropertyDescriptor]>} Descriptor entries
 */
function descriptorsOf(registry) {
  return Object.entries(Object.getOwnPropertyDescriptors(registry));
}

/**
 * Whether two descriptor snapshots are identical, values compared by identity.
 * @param {Array<[string, PropertyDescriptor]>} before - Earlier snapshot
 * @param {Array<[string, PropertyDescriptor]>} after - Later snapshot
 * @returns {boolean} True when nothing changed
 */
function sameDescriptors(before, after) {
  return (
    before.length === after.length &&
    before.every(([key, was], index) => {
      const [afterKey, now] = after[index];
      return (
        key === afterKey &&
        Object.is(was.value, now.value) &&
        was.writable === now.writable &&
        was.enumerable === now.enumerable &&
        was.configurable === now.configurable
      );
    })
  );
}

/**
 * Describe what the proxy returned for one name.
 * @param {object} registry - The project registry
 * @param {string} name - Requested module name
 * @param {unknown} resolved - What the proxy returned
 * @returns {object} JSON-safe observation
 */
function observe(registry, name, resolved) {
  const getConstants =
    resolved !== null && typeof resolved === "object"
      ? resolved.getConstants
      : undefined;
  return {
    isNull: resolved === null,
    isProjectModule:
      Object.hasOwn(registry, name) && Object.is(resolved, registry[name]),
    constants:
      typeof getConstants === "function"
        ? getConstants.call(resolved)
        : undefined,
  };
}

const [setupDir, scenario] = process.argv.slice(2);
const registry = registryFor(scenario);
const before = descriptorsOf(registry);
Object.assign(globalThis, {
  __lisaProbeRegistry: registry,
  jest: { fn: implementation => implementation ?? (() => undefined) },
});
createRequire(import.meta.url)(path.join(setupDir, "jest.setup.pre.js"));
const proxy = globalThis.__turboModuleProxy;
process.stdout.write(
  JSON.stringify({
    proxyType: typeof proxy,
    modules: Object.fromEntries(
      QUERIES.map(name => [
        name,
        observe(
          registry,
          name,
          typeof proxy === "function" ? proxy(name) : undefined
        ),
      ])
    ),
    registryUnchanged: sameDescriptors(before, descriptorsOf(registry)),
  })
);
