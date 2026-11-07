/**
 * A loopback npm registry that accepts the two writes a release rollback makes
 * (CodySwannGT/lisa#4605).
 *
 * `startRegistry` in `tests/fixtures/shared-runtime-hosts/artifact.ts` serves
 * one packed candidate read-only and proxies everything else upstream. A
 * rollback test needs the opposite: no tarball, no upstream, and the two
 * writes — `npm deprecate` (a full-packument PUT) and `npm dist-tag add` (a
 * dist-tag PUT) — applied to state the test can read back. Kept as a sibling
 * rather than widening that helper, because a proxying registry that also
 * accepts writes is one misrouted request away from a test that talks to the
 * public registry.
 *
 * Writes require the bearer token the test configured, so a run with no token
 * is refused here exactly as the real registry would refuse it. Everything
 * unrecognised is a 404 and is recorded, so a test can assert nothing else was
 * asked.
 * @module tests/fixtures/release-rollback/writable-registry
 */
import { createServer, type IncomingMessage } from "node:http";

/** The package every route serves. */
const PACKAGE = "@codyswann/lisa";

/** A version entry in the in-memory packument. */
interface VersionEntry {
  readonly name: string;
  readonly version: string;
  readonly deprecated?: string;
}

/** The in-memory packument. */
export interface Packument {
  readonly name: string;
  readonly "dist-tags": Readonly<Record<string, string>>;
  readonly versions: Readonly<Record<string, VersionEntry>>;
}

/** One request the registry saw. */
interface Seen {
  readonly method: string;
  readonly path: string;
  readonly authorized: boolean;
}

/** A started registry. */
export interface WritableRegistry {
  readonly url: string;
  readonly origin: string;
  readonly packument: () => Packument;
  readonly requests: () => readonly Seen[];
  readonly close: () => Promise<void>;
}

/** What a route answers. */
interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

/** One route: matches a method and decoded path, and answers. */
interface Route {
  readonly method: string;
  readonly path: string;
  readonly needsAuth: boolean;
  readonly answer: (body: string) => Reply;
}

/**
 * Read a request body in full.
 * @param request - The incoming request
 * @returns The body text
 */
async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks = (await request.toArray()) as Buffer[];
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The packument a registry starts with.
 * @param versions - Published versions
 * @param latest - What `latest` points to
 * @returns A packument
 */
function initialPackument(
  versions: readonly string[],
  latest: string
): Packument {
  return {
    name: PACKAGE,
    "dist-tags": { latest },
    versions: Object.fromEntries(
      versions.map(version => [version, { name: PACKAGE, version }])
    ),
  };
}

/**
 * The routes npm uses for `whoami`, `deprecate` and `dist-tag add`.
 * @param state - Mutable holder for the current packument
 * @param state.current - The current packument
 * @param username - Who `whoami` reports
 * @returns The route table
 */
function routes(state: { current: Packument }, username: string): Route[] {
  const tags = `/-/package/${PACKAGE}/dist-tags`;
  return [
    {
      method: "GET",
      path: "/-/whoami",
      needsAuth: true,
      answer: () => ({ status: 200, body: { username } }),
    },
    {
      method: "GET",
      path: `/${PACKAGE}`,
      needsAuth: false,
      answer: () => ({ status: 200, body: state.current }),
    },
    {
      method: "GET",
      path: tags,
      needsAuth: false,
      answer: () => ({ status: 200, body: state.current["dist-tags"] }),
    },
    {
      method: "PUT",
      path: `${tags}/latest`,
      needsAuth: true,
      answer: body => {
        state.current = {
          ...state.current,
          "dist-tags": {
            ...state.current["dist-tags"],
            latest: JSON.parse(body) as string,
          },
        };
        return { status: 200, body: { ok: true } };
      },
    },
    {
      method: "PUT",
      path: `/${PACKAGE}`,
      needsAuth: true,
      answer: body => {
        state.current = JSON.parse(body) as Packument;
        return { status: 200, body: { ok: true } };
      },
    },
  ];
}

/**
 * Start a registry holding `versions`, with `latest` set.
 * @param input - Initial state
 * @param input.versions - Published versions
 * @param input.latest - What `latest` points to
 * @param input.token - The only bearer token writes accept
 * @param input.username - Who `whoami` reports
 * @returns The started registry
 */
export async function startWritableRegistry(input: {
  readonly versions: readonly string[];
  readonly latest: string;
  readonly token: string;
  readonly username: string;
}): Promise<WritableRegistry> {
  const state = { current: initialPackument(input.versions, input.latest) };
  const table = routes(state, input.username);
  const log: { current: readonly Seen[] } = { current: [] };
  const server = createServer((request, response) => {
    const method = request.method ?? "GET";
    const pathname = decodeURIComponent((request.url ?? "/").split("?")[0]!);
    const authorized =
      request.headers.authorization === `Bearer ${input.token}`;
    log.current = [
      ...log.current,
      { method, path: request.url ?? "/", authorized },
    ];
    void bodyOf(request).then(body => {
      const route = table.find(r => r.method === method && r.path === pathname);
      const reply: Reply =
        route === undefined
          ? { status: 404, body: { error: "not found" } }
          : route.needsAuth && !authorized
            ? { status: 401, body: { error: "unauthorized" } }
            : route.answer(body);
      response.writeHead(reply.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(reply.body ?? {}));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("registry must have a loopback port");
  const origin = `//127.0.0.1:${address.port}/`;
  return {
    url: `http:${origin}`.slice(0, -1),
    origin,
    packument: () => state.current,
    requests: () => log.current,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      ),
  };
}
