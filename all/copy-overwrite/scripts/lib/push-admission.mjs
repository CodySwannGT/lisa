// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Route the push gate's heavy steps through headroom admission
 * (CodySwannGT/lisa#4596).
 *
 * When `.lisa.config.json` sets `pushGate.admission: true`, the gate runner
 * runs `code-style-slow` (`lint:slow`), `type-correctness` (`typecheck`) and the
 * build-once step through `lisa admit`, which starts them only when the machine
 * has headroom for them and refuses — never silently starts — once the wait
 * bound expires (5 minutes inside `git push`). Test suites are admitted by
 * `lisa-test-run` itself, so test gates are not wrapped here.
 *
 * With the switch off nothing here changes a command, and heavy steps start
 * immediately exactly as before.
 *
 * Windows is not wrapped: the admitted command is handed over as one
 * POSIX-quoted shell string, and the gate runner's Windows route runs commands
 * through `cmd.exe`. The gap is printed when the switch is on there.
 * @module lib/push-admission
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Gates, by id, that are heavy enough to admit, and the workers each declares. */
export const ADMITTED_GATES = Object.freeze({
  "code-style-slow": 2,
  "type-correctness": 1,
  "build-once": 2,
});

/** Value of `LISA_ADMISSION_CONTEXT` that tells admission it is inside a push. */
export const PUSH_CONTEXT = "push";

/**
 * Read and validate `pushGate.admission` from a parsed `.lisa.config.json`.
 *
 * Refused rather than defaulted on a wrong type, exactly as `lisa apply`
 * refuses it, so apply and push cannot disagree.
 * @param {Record<string, unknown>|null|undefined} config Parsed config.
 * @returns {boolean} Whether admission is on (default `false`).
 * @throws {Error} When `pushGate` or `pushGate.admission` has the wrong type.
 */
export function admissionEnabled(config) {
  const pushGate = config?.pushGate;
  if (pushGate === undefined) return false;
  if (
    pushGate === null ||
    typeof pushGate !== "object" ||
    Array.isArray(pushGate)
  ) {
    throw new Error(
      `pushGate is ${JSON.stringify(pushGate)}; expected an object such as ` +
        `{ "admission": true }.`
    );
  }
  const { admission } = pushGate;
  if (admission === undefined) return false;
  if (typeof admission !== "boolean") {
    throw new Error(
      `pushGate.admission is ${JSON.stringify(admission)}; expected true or false.`
    );
  }
  return admission;
}

/**
 * The installed Lisa CLI, as a shell prefix.
 *
 * Lisa itself runs its own build (`node dist/index.js`); a host runs the
 * package it installed (`node_modules/.bin/lisa`).
 * @param {string} cwd Project root.
 * @returns {string|null} The prefix, or null when no CLI is installed.
 */
export function lisaCliPrefix(cwd) {
  try {
    const manifest = JSON.parse(
      readFileSync(join(cwd, "package.json"), "utf8")
    );
    if (
      manifest?.name === "@codyswann/lisa" &&
      existsSync(join(cwd, "dist", "index.js"))
    ) {
      return "node dist/index.js";
    }
  } catch {
    // No readable manifest: fall through to the installed binary.
  }
  const bin = join(cwd, "node_modules", ".bin", "lisa");
  return existsSync(bin) ? "node_modules/.bin/lisa" : null;
}

/**
 * Quote one string for a POSIX shell.
 * @param {string} text Text to quote.
 * @returns {string} Single-quoted text.
 */
export function shellQuote(text) {
  const escaped = text.replaceAll("'", "'\\''");
  return `'${escaped}'`;
}

/**
 * The command a heavy gate runs under admission.
 * @param {string} prefix Lisa CLI prefix.
 * @param {number} workers Declared workers.
 * @param {string} command The gate's own command.
 * @returns {string} The admitted command.
 */
export function admittedCommand(prefix, workers, command) {
  return `${prefix} admit --workers ${workers} -- ${shellQuote(command)}`;
}

/**
 * Wrap a gate executor so heavy gates run through `lisa admit`.
 * @param {(command: string, gate?: {id?: string}) => object} exec Executor.
 * @param {object} options Options.
 * @param {boolean} options.enabled Whether `pushGate.admission` is on.
 * @param {string} [options.cwd] Project root.
 * @param {string} [options.platform] Platform, for the Windows gap.
 * @param {(line: string) => void} [options.out] Where notices go.
 * @param {(cwd: string) => string|null} [options.cli] CLI resolver.
 * @returns {(command: string, gate?: {id?: string}) => object} The executor to use.
 */
export function withAdmission(
  exec,
  {
    enabled,
    cwd = process.cwd(),
    platform = process.platform,
    out = line => console.log(line),
    cli = lisaCliPrefix,
  }
) {
  if (!enabled) return exec;
  if (platform === "win32") {
    out(
      "⚠️  pushGate.admission is on, but the gate runner does not admit heavy " +
        "steps on Windows; they start immediately."
    );
    return exec;
  }
  const prefix = cli(cwd);
  if (prefix === null) {
    out(
      "⚠️  pushGate.admission is on, but no Lisa CLI is installed here " +
        "(node_modules/.bin/lisa); heavy steps start without admission."
    );
    return exec;
  }
  return (command, gate) => {
    const workers = ADMITTED_GATES[gate?.id ?? ""];
    return workers === undefined || !command
      ? exec(command, gate)
      : exec(admittedCommand(prefix, workers, command), gate);
  };
}
