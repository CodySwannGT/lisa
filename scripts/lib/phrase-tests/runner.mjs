/**
 * A minimal stand-in for the vitest runner API, used by the phrase recorder
 * (CodySwannGT/lisa#4609) to execute a phrase-only test file for real.
 *
 * It registers `describe` / `it` / `test` (with `.each`, `.skip`, `.skipIf`,
 * `.runIf`, `.only`, `.concurrent`, and placeholder entries that never run)
 * and the four lifecycle hooks,
 * then runs the tree in declaration order the way vitest does: `beforeAll`
 * once per suite, `beforeEach` outer to inner around every test, `afterEach`
 * inner to outer, `afterAll` last. Anything it does not model throws, so a
 * file using it is reported rather than half-recorded.
 * @module scripts/lib/phrase-tests/runner
 */
import { format } from "node:util";

/**
 * @typedef {object} Suite
 * @property {string} name - Suite title.
 * @property {Suite | undefined} parent - Enclosing suite.
 * @property {Record<"beforeAll" | "beforeEach" | "afterEach" | "afterAll", Function[]>} hooks - Lifecycle hooks.
 * @property {({ kind: "suite", suite: Suite } | { kind: "test", name: string, fn: Function | undefined, skip: boolean })[]} children - In declaration order.
 */

/**
 * A new empty suite.
 * @param {string} name - Suite title.
 * @param {Suite | undefined} parent - Enclosing suite.
 * @returns {Suite} The suite.
 */
function newSuite(name, parent) {
  return {
    name,
    parent,
    hooks: { beforeAll: [], beforeEach: [], afterEach: [], afterAll: [] },
    children: [],
  };
}

/**
 * Format an `.each` title the way vitest does for the common printf tokens.
 * @param {string} title - The title template.
 * @param {unknown[]} args - The row's arguments.
 * @param {number} index - The row index, for `%#`.
 * @returns {string} The title.
 */
function eachTitle(title, args, index) {
  const withIndex = title.replaceAll("%#", String(index));
  const tokens = withIndex.match(/%[sdifjoO]/gu)?.length ?? 0;
  if (tokens > 0) return format(withIndex, ...args.slice(0, tokens));
  const row = args[0];
  if (row !== null && typeof row === "object" && !Array.isArray(row)) {
    return withIndex.replaceAll(/\$(\w+)/gu, (_match, key) =>
      String(/** @type {Record<string, unknown>} */ (row)[key])
    );
  }
  return withIndex;
}

/**
 * The callback among a registration's trailing arguments
 * (`it(name, fn)`, `it(name, fn, timeout)`, `it(name, options, fn)`).
 * @param {unknown[]} rest - Arguments after the title.
 * @returns {Function | undefined} The callback.
 */
function callbackOf(rest) {
  return /** @type {Function | undefined} */ (
    rest.find(item => typeof item === "function")
  );
}

/**
 * Bind one `.each` row to its callback: an array row is spread into the
 * arguments, any other row is passed as the single argument, as vitest does.
 * @param {Function | undefined} fn - The row callback.
 * @param {unknown} row - One table row.
 * @returns {{ args: unknown[], bound: Function | undefined }} The row's arguments and bound callback.
 */
function bindRow(fn, row) {
  const args = Array.isArray(row) ? row : [row];
  return { args, bound: fn && (() => fn(...args)) };
}

/**
 * The function `<api>.each(table)` returns: registers one entry per row.
 * @param {unknown} table - The table (only arrays are supported).
 * @param {(name: string, fn: Function | undefined, skip: boolean) => void} register - Records one registration.
 * @param {boolean} skip - Whether the rows are skipped.
 * @returns {(title: unknown, ...rest: unknown[]) => void} The registrar.
 */
function eachRegistrar(table, register, skip) {
  return (title, ...rest) => {
    if (!Array.isArray(table)) {
      throw new Error("tagged-template .each is not supported");
    }
    const fn = callbackOf(rest);
    table.forEach((row, index) => {
      const { args, bound } = bindRow(fn, row);
      register(eachTitle(String(title), args, index), bound, skip);
    });
  };
}

/**
 * A `describe` / `it` style function with vitest's modifiers.
 * @typedef {((name: unknown, ...rest: unknown[]) => void) & { each: (table: unknown) => (title: unknown, ...rest: unknown[]) => void, skipIf: (condition: unknown) => Registrar, runIf: (condition: unknown) => Registrar, fails: () => never }} Registrar
 */

/**
 * Build a `describe` / `it` style function with vitest's modifiers.
 * @param {(name: string, fn: Function | undefined, skip: boolean) => void} register - Records one registration.
 * @param {boolean} skip - Whether registrations through this function are skipped.
 * @returns {Registrar} The API function.
 */
function registrar(register, skip) {
  /** @type {Registrar} */
  const api = Object.assign(
    /** @type {(name: unknown, ...rest: unknown[]) => void} */ (
      (name, ...rest) => register(String(name), callbackOf(rest), skip)
    ),
    {
      /** @param {unknown} table - The `.each` table. */
      each: table => eachRegistrar(table, register, skip),
      /** @param {unknown} condition - Skip when truthy. */
      skipIf: condition => (condition ? skipped() : api),
      /** @param {unknown} condition - Run only when truthy. */
      runIf: condition => (condition ? api : skipped()),
      fails: () => {
        throw new Error(".fails is not supported");
      },
    }
  );
  const skipped = () => registrar(register, true);
  Object.defineProperties(api, {
    skip: { get: skipped },
    todo: { get: () => () => undefined },
    only: { get: () => api },
    concurrent: { get: () => api },
    sequential: { get: () => api },
  });
  return api;
}

/**
 * Create a fresh runner: the registration API plus `run()`.
 * @param {{ onTest: (name: string | undefined) => void }} options - Told the
 *   full title of the test about to run (undefined outside any test), so the
 *   recorder can label what each assertion came from.
 * @returns {{ api: Record<string, Function>, run: () => Promise<string[]> }}
 *   `run` resolves to the errors thrown by tests and hooks.
 */
export function createRunner({ onTest }) {
  const root = newSuite("", undefined);
  let current = root;
  const describe = registrar((name, fn, skip) => {
    if (skip || fn === undefined) return;
    const suite = newSuite(name, current);
    current.children.push({ kind: "suite", suite });
    const previous = current;
    current = suite;
    try {
      fn();
    } finally {
      current = previous;
    }
  }, false);
  const it = registrar((name, fn, skip) => {
    current.children.push({ kind: "test", name, fn, skip });
  }, false);
  /** @type {(kind: keyof Suite["hooks"]) => (fn: Function) => void} */
  const hook = kind => fn => {
    current.hooks[kind].push(fn);
  };
  const api = {
    describe,
    suite: describe,
    it,
    test: it,
    beforeAll: hook("beforeAll"),
    beforeEach: hook("beforeEach"),
    afterEach: hook("afterEach"),
    afterAll: hook("afterAll"),
  };
  const run = async () => {
    /** @type {string[]} */
    const errors = [];
    await runSuite(root, [], errors, onTest);
    onTest(undefined);
    return errors;
  };
  return { api, run };
}

/**
 * Await a callback, collecting what it throws.
 * @param {Function} fn - The callback.
 * @param {string} label - What it is, for the error text.
 * @param {string[]} errors - Collects failures.
 * @returns {Promise<boolean>} True when it completed.
 */
async function attempt(fn, label, errors) {
  try {
    await fn({});
    return true;
  } catch (error) {
    errors.push(
      `${label}: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

/**
 * Every suite from the root down to `suite`.
 * @param {Suite} suite - The innermost suite.
 * @returns {Suite[]} Outer to inner.
 */
function lineage(suite) {
  return suite.parent ? [...lineage(suite.parent), suite] : [suite];
}

/**
 * Run one suite's hooks and children in declaration order.
 * @param {Suite} suite - The suite.
 * @param {string[]} titles - Enclosing titles.
 * @param {string[]} errors - Collects failures.
 * @param {(name: string | undefined) => void} onTest - Test-start callback.
 * @returns {Promise<void>} Resolves when the suite is done.
 */
async function runSuite(suite, titles, errors, onTest) {
  const path = suite.name ? [...titles, suite.name] : titles;
  const label = path.join(" > ") || "(file)";
  for (const fn of suite.hooks.beforeAll) {
    if (!(await attempt(fn, `${label} beforeAll`, errors))) return;
  }
  for (const child of suite.children) {
    if (child.kind === "suite") {
      await runSuite(child.suite, path, errors, onTest);
      continue;
    }
    if (child.skip || child.fn === undefined) continue;
    const name = [...path, child.name].join(" > ");
    onTest(name);
    const chain = lineage(suite);
    const before = chain.flatMap(item => item.hooks.beforeEach);
    const after = [...chain].reverse().flatMap(item => item.hooks.afterEach);
    let ok = true;
    for (const fn of before)
      ok = ok && (await attempt(fn, `${name} beforeEach`, errors));
    if (ok) await attempt(child.fn, name, errors);
    for (const fn of after) await attempt(fn, `${name} afterEach`, errors);
    onTest(undefined);
  }
  for (const fn of suite.hooks.afterAll) {
    await attempt(fn, `${label} afterAll`, errors);
  }
}
