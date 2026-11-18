/**
 * The one door every canary request goes through.
 *
 * A canary is a real branch and a real pull request on the hosting platform,
 * so what this command may send there is not left to the code that sends it.
 * It is a short closed list, checked here, on every request:
 *
 * | request | allowed when |
 * | --- | --- |
 * | any read | always |
 * | create a blob, a tree or a commit | always; none of them is reachable from a branch until one is created |
 * | create a branch | its name is under the reserved prefix |
 * | open a pull request | its head branch is under the reserved prefix, and it is a draft |
 * | change a pull request | the change is exactly "close it" |
 * | delete a branch | its name is under the reserved prefix |
 *
 * Everything else is refused without being sent. In particular the door knows
 * no way to accept a canary into its base branch, to change any other pull
 * request field, to delete or move any branch outside the prefix, or to
 * change a setting: there is no rule those requests could match.
 *
 * Underneath is the recording door of `lisa controls protect`
 * (`./protect-requests.ts`), so every request, sent or refused, is in the
 * run's request log. Until a read has shown that the signed-in account may
 * write, the door is built with `mayWrite` false and passes on reads only.
 * @module controls/canary-door
 */
import { CANARY_BRANCH_PREFIX } from "./canary-names.js";
import type { RequestLog } from "./protect-requests.js";

/** What one request answered. */
export type Answered =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/** The methods a canary write may use. Accepting a pull request needs another. */
export type WriteMethod = "POST" | "PATCH" | "DELETE";

/** The requests a canary run can make. */
export interface CanaryDoor {
  /** `owner/name`. */
  readonly repository: string;
  /**
   * Read something of the repository.
   * @param path - The path under the repository, or `""` for the repository
   */
  readonly get: (path: string) => Answered;
  /**
   * Create, close or delete something a canary is made of.
   * @param method - The method
   * @param path - The path under the repository
   * @param body - The request body, when there is one
   */
  readonly send: (
    method: WriteMethod,
    path: string,
    body?: unknown
  ) => Answered;
}

/** One kind of write a canary run may send. */
interface WriteRule {
  readonly method: WriteMethod;
  readonly path: RegExp;
  /** What the body must be, when the path alone does not say enough. */
  readonly body?: (body: unknown) => boolean;
}

/** A canary branch as a path names it. */
const CANARY_REF_PATH =
  /^git\/refs\/heads\/lisa-attest\/[0-9a-z]+\/[0-9A-Za-z-]+$/u;

/**
 * Read a field out of a document, however deep.
 * @param value - The document
 * @param keys - The keys to follow, outermost first
 * @returns The field, or `undefined` when the way to it is not there
 */
export function fieldOf(value: unknown, ...keys: readonly string[]): unknown {
  return keys.reduce<unknown>(
    (inner, key) =>
      inner !== null && typeof inner === "object"
        ? (Reflect.get(inner, key) as unknown)
        : undefined,
    value
  );
}

/**
 * Read a text field out of a document.
 * @param value - The document
 * @param keys - The keys to follow, outermost first
 * @returns The text, or `""` when the field is not a text
 */
export function textOf(value: unknown, ...keys: readonly string[]): string {
  const field = fieldOf(value, ...keys);
  return typeof field === "string" ? field : "";
}

/** Every write a canary run may send. Nothing else is. */
const WRITE_RULES: readonly WriteRule[] = [
  { method: "POST", path: /^git\/(?:blobs|trees|commits)$/u },
  {
    method: "POST",
    path: /^git\/refs$/u,
    body: body =>
      textOf(body, "ref").startsWith(`refs/heads/${CANARY_BRANCH_PREFIX}`),
  },
  {
    method: "POST",
    path: /^pulls$/u,
    // A draft cannot be merged, by a person or by automation that merges
    // pull requests whose checks are green. So a canary is only ever opened
    // as one, and a request to open any other kind is not sent.
    body: body =>
      textOf(body, "head").startsWith(CANARY_BRANCH_PREFIX) &&
      fieldOf(body, "draft") === true,
  },
  {
    method: "PATCH",
    path: /^pulls\/\d+$/u,
    body: body =>
      body !== null &&
      typeof body === "object" &&
      Object.keys(body).join(",") === "state" &&
      fieldOf(body, "state") === "closed",
  },
  { method: "DELETE", path: CANARY_REF_PATH },
];

/**
 * Tell whether a write is one a canary run may send.
 * @param method - The method
 * @param path - The path under the repository
 * @param body - The request body
 * @returns Whether a rule allows it
 */
export function isCanaryWrite(
  method: string,
  path: string,
  body: unknown
): boolean {
  return WRITE_RULES.some(
    rule =>
      rule.method === method &&
      rule.path.test(path) &&
      (rule.body === undefined || rule.body(body))
  );
}

/**
 * Build the door for one repository.
 * @param log - The run's recording door
 * @param repository - `owner/name`
 * @param mayWrite - Whether a read has shown the account may write
 * @returns The door
 */
export function canaryDoor(
  log: RequestLog,
  repository: string,
  mayWrite: boolean
): CanaryDoor {
  const full = (path: string): string =>
    path === "" ? `repos/${repository}` : `repos/${repository}/${path}`;
  const answered = (
    result: ReturnType<RequestLog["read"]>,
    path: string
  ): Answered => {
    if (!result.ok) {
      const said = `${result.stdout}\n${result.stderr}`.trim();
      return {
        ok: false,
        reason: (said === "" ? `${path} gave no answer` : said).replaceAll(
          /\s+/gu,
          " "
        ),
      };
    }
    if (result.stdout.trim() === "") return { ok: true, value: null };
    try {
      return { ok: true, value: JSON.parse(result.stdout) as unknown };
    } catch {
      return { ok: false, reason: `${path} did not answer with JSON` };
    }
  };
  return {
    repository,
    get: path => answered(log.read(["api", full(path)]), path),
    send: (method, path, body) => {
      const args = [
        "api",
        "-X",
        method,
        full(path),
        ...(body === undefined ? [] : ["--input", "-"]),
      ];
      const options =
        body === undefined ? undefined : { input: JSON.stringify(body) };
      if (mayWrite && isCanaryWrite(method, path, body)) {
        return answered(log.write(args, options), path);
      }
      // Recorded as refused, and never passed on.
      log.read(args, options);
      return {
        ok: false,
        reason: mayWrite
          ? `Not sent: ${method} ${path} is not a request a canary run makes.`
          : `Not sent: ${method} ${path} needs write access, and no read has shown this account has it.`,
      };
    },
  };
}
