/**
 * Behaviour of `lisa-linear-access/scripts/linear-graphql.sh`.
 *
 * The adapter used to exist only as a SKILL.md snippet, so agents pasted it
 * into one inline shell command that captured LINEAR_API_KEY with `$(...)` and
 * sent it to an external host with curl. Claude Code asks for approval on that
 * shape even when permissions are skipped, and a background worker has nobody
 * to answer it. The same code run from a file by path does not prompt, so the
 * adapter now ships as that file.
 *
 * Every case here runs the shipped script against a stub `curl` on PATH, so no
 * request leaves the machine. The script is copied into a disposable plugin
 * tree whose resolver is a stub too: the checked-in tree holds the real
 * `resolve-secret.mjs`, and running it from a unit test could reach a
 * developer's real secrets provider.
 *
 * The credential is a sentinel, and the cases assert where it must NOT appear:
 * stdout, stderr (including under `bash -x`), and the argv of any process the
 * script starts. A helper that printed its key into its own transcript is the
 * incident that made this a test rather than a comment.
 * @module tests/unit/scripts/linear-graphql-script
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const SCRIPT_SOURCE = path.join(
  repoRoot,
  "plugins/src/base/skills/lisa-linear-access/scripts/linear-graphql.sh"
);

/** The credential every case resolves. It must never be printed. */
const SENTINEL = "lin_api_SENTINEL_never_print_me_0123456789";

/** The stub curl's request-body log, one compact JSON request per line. */
const BODIES_LOG = "bodies.log";

/** Where the stub resolver sits inside the disposable plugin tree. */
const RESOLVER_REL =
  "plugin/skills/lisa-secrets-access/scripts/resolve-secret.mjs";

/**
 * A stand-in `curl`. It records its argv and request body, records the
 * Authorization header it was handed through `-H @file`, and answers the
 * identity probe from STUB_ORG / STUB_TEAMS and every other request from
 * STUB_RESPONSE.
 */
const STUB_CURL = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/argv.log"
header=""
prev=""
for arg in "$@"; do
  if [ "$prev" = "-H" ]; then
    case "$arg" in @*) header=$(cat "\${arg#@}") ;; esac
  fi
  prev="$arg"
done
printf '%s\\n' "$header" >> "$STUB_DIR/auth.log"
body=$(cat)
printf '%s\\n' "$body" >> "$STUB_DIR/bodies.log"
case "$body" in
  *'viewer{id name organization'*)
    teams=$(jq -cn --arg t "\${STUB_TEAMS:-}" '$t | split(",") | map(select(. != "") | {key: .})')
    jq -cn --arg org "\${STUB_ORG:-acme}" --argjson teams "$teams" \\
      '{data:{viewer:{id:"u1",name:"Agent",organization:{urlKey:$org,name:"Acme"}},teams:{nodes:$teams}}}'
    ;;
  *)
    resp="\${STUB_RESPONSE:-}"
    [ -n "$resp" ] || resp='{"data":{"ok":true}}'
    printf '%s' "$resp"
    ;;
esac
`;

interface Tree {
  readonly root: string;
  readonly script: string;
  readonly project: string;
  readonly stubDir: string;
  readonly bin: string;
}

const trees: string[] = [];

afterEach(() => {
  for (const root of trees.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Build a disposable plugin tree, project directory and stub bin.
 * @param options Tree shape.
 * @param options.resolverAnswer What the stub resolver prints, or null for no resolver.
 * @param options.config `.lisa.config.json` contents for the project, or null.
 * @returns Paths into the tree.
 */
const buildTree = (
  options: {
    readonly resolverAnswer?: string | null;
    readonly config?: Record<string, unknown> | null;
  } = {}
): Tree => {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-linear-graphql-"));
  trees.push(root);
  const scriptDir = path.join(root, "plugin/skills/lisa-linear-access/scripts");
  mkdirSync(scriptDir, { recursive: true });
  const script = path.join(scriptDir, "linear-graphql.sh");
  copyFileSync(SCRIPT_SOURCE, script);

  if (options.resolverAnswer !== undefined && options.resolverAnswer !== null) {
    const resolver = path.join(root, RESOLVER_REL);
    mkdirSync(path.dirname(resolver), { recursive: true });
    writeFileSync(
      resolver,
      `process.stdout.write(${JSON.stringify(options.resolverAnswer)});\n`
    );
  }

  const project = path.join(root, "project");
  mkdirSync(path.join(project, "nested"), { recursive: true });
  const config =
    options.config === undefined
      ? { linear: { workspace: "acme", teamKey: "ENG" } }
      : options.config;
  if (config !== null) {
    writeFileSync(
      path.join(project, ".lisa.config.json"),
      JSON.stringify(config)
    );
  }

  const stubDir = path.join(root, "stub");
  const bin = path.join(root, "bin");
  mkdirSync(stubDir, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, "curl"), STUB_CURL, { mode: 0o755 });
  return { root, script, project, stubDir, bin };
};

/** Directories holding the real tools the script needs (jq, node). */
const toolPath = (): string => {
  const dirs = [path.dirname(process.execPath), "/usr/bin", "/bin"];
  for (const candidate of ["/opt/homebrew/bin", "/usr/local/bin"]) {
    if (existsSync(path.join(candidate, "jq"))) dirs.push(candidate);
  }
  return dirs.join(":");
};

interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly argv: string;
  readonly bodies: readonly string[];
  readonly auth: readonly string[];
}

const readLines = (file: string): readonly string[] =>
  existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter(Boolean)
    : [];

/* eslint-disable sonarjs/no-os-command-from-path -- The PATH is built here on
   purpose: a stub curl fronts a minimal PATH so no request leaves the machine
   and no developer-shell credential leaks into the child. */

/**
 * Run the script inside a tree.
 * @param tree The tree to run in.
 * @param args Arguments after the script path.
 * @param options Run shape.
 * @param options.env Extra environment.
 * @param options.input Stdin.
 * @param options.cwd Directory relative to the project.
 * @param options.bashFlags Flags for bash itself, before the script path.
 * @returns Exit status, streams and what the stub curl saw.
 */
const run = (
  tree: Tree,
  args: readonly string[],
  options: {
    readonly env?: Readonly<Record<string, string>>;
    readonly input?: string;
    readonly cwd?: string;
    readonly bashFlags?: readonly string[];
  } = {}
): Run => {
  const result = spawnSync(
    "bash",
    [...(options.bashFlags ?? []), tree.script, ...args],
    {
      cwd: path.join(tree.project, options.cwd ?? "."),
      encoding: "utf8",
      input: options.input ?? "",
      timeout: 30_000,
      env: {
        PATH: `${tree.bin}:${toolPath()}`,
        HOME: tree.root,
        STUB_DIR: tree.stubDir,
        ...options.env,
      },
    }
  );
  const argvFile = path.join(tree.stubDir, "argv.log");
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    argv: existsSync(argvFile) ? readFileSync(argvFile, "utf8") : "",
    bodies: readLines(path.join(tree.stubDir, BODIES_LOG)),
    auth: readLines(path.join(tree.stubDir, "auth.log")),
  };
};

/* eslint-enable sonarjs/no-os-command-from-path -- End test-only PATH shim scope. */

/** Assert the sentinel reached nothing a transcript or `ps` would show. */
const expectKeyNeverPrinted = (result: Run): void => {
  expect(result.stdout).not.toContain(SENTINEL);
  expect(result.stderr).not.toContain(SENTINEL);
  expect(result.argv).not.toContain(SENTINEL);
};

const writeQuery = (tree: Tree, text: string): string => {
  const file = path.join(tree.root, "query.graphql");
  writeFileSync(file, text);
  return file;
};

const QUERY = "query($id:String!){ issue(id:$id){ identifier title } }";

/** Flags and fixture names the cases share. */
const QUERY_FLAG = "--query-file";
const VARIABLES_FLAG = "--variables";
const OTHER_ORG = "someone-else";

describe("linear-graphql.sh sends a request without exposing the key", () => {
  it("posts the query file and variables, after an identity probe", () => {
    const tree = buildTree();
    const query = writeQuery(tree, QUERY);

    const result = run(
      tree,
      [QUERY_FLAG, query, VARIABLES_FLAG, '{"id":"ENG-1"}'],
      { env: { LINEAR_API_KEY: SENTINEL, STUB_TEAMS: "ENG" } }
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toStrictEqual({ data: { ok: true } });
    expect(result.bodies).toHaveLength(2);
    expect(JSON.parse(result.bodies[1]!)).toStrictEqual({
      query: QUERY,
      variables: { id: "ENG-1" },
    });
    // The key was delivered, as a header read from a file descriptor.
    expect(result.auth.at(-1)).toBe(`Authorization: ${SENTINEL}`);
    expectKeyNeverPrinted(result);
  });

  it("reads the query from stdin", () => {
    const tree = buildTree();

    const result = run(tree, [QUERY_FLAG, "-"], {
      env: { LINEAR_API_KEY: SENTINEL, STUB_TEAMS: "ENG" },
      input: "query{ viewer{ id } }",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.bodies[1]!).query).toBe("query{ viewer{ id } }");
    expectKeyNeverPrinted(result);
  });

  it("accepts the positional form with a variables file", () => {
    const tree = buildTree();
    const query = writeQuery(tree, QUERY);
    const variables = path.join(tree.root, "vars.json");
    writeFileSync(variables, '{"id":"ENG-2"}');

    const result = run(tree, [query, `@${variables}`], {
      env: { LINEAR_API_KEY: SENTINEL, STUB_TEAMS: "ENG" },
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.bodies[1]!).variables).toStrictEqual({
      id: "ENG-2",
    });
  });

  it("keeps the key out of an xtrace of the whole run", () => {
    // `bash -x script.sh` is the obvious way to debug this file, and it would
    // print every expanded word to stderr, the key included, without a guard.
    const tree = buildTree();
    const query = writeQuery(tree, QUERY);

    const result = run(tree, [QUERY_FLAG, query], {
      env: { LINEAR_API_KEY: SENTINEL, STUB_TEAMS: "ENG" },
      bashFlags: ["-x"],
    });

    expect(result.status).toBe(0);
    expectKeyNeverPrinted(result);
  });

  it("prints the body and exits 1 when Linear returns GraphQL errors", () => {
    const tree = buildTree();
    const query = writeQuery(tree, QUERY);

    const result = run(tree, [QUERY_FLAG, query], {
      env: {
        LINEAR_API_KEY: SENTINEL,
        STUB_TEAMS: "ENG",
        STUB_RESPONSE: '{"errors":[{"message":"Entity not found"}]}',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Entity not found");
    expectKeyNeverPrinted(result);
  });
});

describe("linear-graphql.sh keeps identity-match mandatory", () => {
  it("refuses a key for a different organization and sends only the probe", () => {
    const tree = buildTree();
    const query = writeQuery(tree, QUERY);

    const result = run(tree, [QUERY_FLAG, query], {
      env: { LINEAR_API_KEY: SENTINEL, STUB_ORG: OTHER_ORG },
    });

    expect(result.status).toBe(4);
    expect(result.stderr).toContain("identity-match refused");
    expect(result.stderr).toContain(OTHER_ORG);
    expect(result.bodies).toHaveLength(1);
    expectKeyNeverPrinted(result);
  });

  it("refuses a key that cannot see the configured team", () => {
    const tree = buildTree();
    const query = writeQuery(tree, QUERY);

    const result = run(tree, [QUERY_FLAG, query], {
      env: { LINEAR_API_KEY: SENTINEL, STUB_TEAMS: "OPS" },
    });

    expect(result.status).toBe(4);
    expect(result.stderr).toContain("cannot see the configured team 'ENG'");
    expect(result.bodies).toHaveLength(1);
  });

  it("refuses to send anything when no workspace is configured", () => {
    const tree = buildTree({ config: null });
    const query = writeQuery(tree, QUERY);

    const result = run(tree, [QUERY_FLAG, query], {
      env: { LINEAR_API_KEY: SENTINEL },
    });

    expect(result.status).toBe(4);
    expect(result.stderr).toContain("No Linear workspace is configured");
    expect(result.bodies).toHaveLength(0);
  });

  it("finds the project config from a subdirectory, local override first", () => {
    const tree = buildTree();
    writeFileSync(
      path.join(tree.project, ".lisa.config.local.json"),
      JSON.stringify({ linear: { workspace: "acme-local" } })
    );
    const query = writeQuery(tree, QUERY);

    const result = run(tree, [QUERY_FLAG, query], {
      env: {
        LINEAR_API_KEY: SENTINEL,
        STUB_ORG: "acme-local",
        STUB_TEAMS: "ENG",
      },
      cwd: "nested",
    });

    expect(result.status).toBe(0);
  });

  it("reports identity with --whoami without running any other request", () => {
    const tree = buildTree();

    const result = run(tree, ["--whoami"], {
      env: { LINEAR_API_KEY: SENTINEL, STUB_TEAMS: "ENG" },
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      organization: { urlKey: "acme" },
      teamVisible: true,
    });
    expect(result.bodies).toHaveLength(1);
    expectKeyNeverPrinted(result);
  });
});

describe("linear-graphql.sh resolves the key through lisa-secrets-access", () => {
  it("uses the resolver shipped beside it when no plugin root is exported", () => {
    // Claude Code does not export CLAUDE_PLUGIN_ROOT to Bash, and a multi-repo
    // root often has no node_modules. The plugin copy this script ships in
    // holds the resolver, so that is the rung that has to answer.
    const tree = buildTree({ resolverAnswer: SENTINEL });
    const query = writeQuery(tree, QUERY);

    const result = run(tree, [QUERY_FLAG, query], {
      env: { STUB_TEAMS: "ENG" },
    });

    expect(result.status).toBe(0);
    expect(result.auth.at(-1)).toBe(`Authorization: ${SENTINEL}`);
    expectKeyNeverPrinted(result);
  });

  it("honours the per-workspace variable", () => {
    const tree = buildTree();
    const query = writeQuery(tree, QUERY);

    const result = run(tree, [QUERY_FLAG, query], {
      env: { LINEAR_API_KEY_acme: SENTINEL, STUB_TEAMS: "ENG" },
    });

    expect(result.status).toBe(0);
    expect(result.auth.at(-1)).toBe(`Authorization: ${SENTINEL}`);
    expectKeyNeverPrinted(result);
  });

  it("exits 3 naming every path it tried, and sends nothing, with no key", () => {
    const tree = buildTree();
    const query = writeQuery(tree, QUERY);

    const result = run(tree, [QUERY_FLAG, query]);

    expect(result.status).toBe(3);
    expect(result.stderr).toContain(
      "could not resolve LINEAR_API_KEY through lisa-secrets-access"
    );
    expect(result.stderr).toContain(
      "node_modules/@codyswann/lisa/plugins/lisa/skills/lisa-secrets-access/scripts/resolve-secret.mjs"
    );
    expect(result.bodies).toHaveLength(0);
  });
});

describe("linear-graphql.sh refuses malformed input before sending", () => {
  it.each([
    [[QUERY_FLAG, "/nonexistent/query.graphql"], "no such file"],
    [[VARIABLES_FLAG, "{}"], "no query"],
    [[QUERY_FLAG, "-", "--variables-file", "-"], "only one of"],
    [["--bogus"], "unknown option"],
  ])("exits 2 for %j", (args, message) => {
    const tree = buildTree();

    const result = run(tree, args, { env: { LINEAR_API_KEY: SENTINEL } });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
    expect(result.bodies).toHaveLength(0);
  });

  it("exits 2 when the variables are not one JSON object", () => {
    const tree = buildTree();
    const query = writeQuery(tree, QUERY);

    const result = run(tree, [QUERY_FLAG, query, VARIABLES_FLAG, "[1]"], {
      env: { LINEAR_API_KEY: SENTINEL },
    });

    expect(result.status).toBe(2);
    expect(result.bodies).toHaveLength(0);
  });
});

describe("linear-graphql.sh as a sourced library", () => {
  it("defines the adapter functions and sends nothing when sourced", () => {
    const tree = buildTree();
    const result = spawnSync(
      "bash",
      [
        "-c",
        `source "$1" && declare -F read_linear_key linear_graphql linear_identity_check linear_require_identity`,
        "bash",
        tree.script,
      ],
      {
        cwd: tree.project,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          PATH: `${tree.bin}:${toolPath()}`,
          HOME: tree.root,
          STUB_DIR: tree.stubDir,
          LINEAR_API_KEY: SENTINEL,
        },
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toStrictEqual([
      "read_linear_key",
      "linear_graphql",
      "linear_identity_check",
      "linear_require_identity",
    ]);
    expect(existsSync(path.join(tree.stubDir, BODIES_LOG))).toBe(false);
  });

  it("passes caller variables through linear_graphql unchanged", () => {
    // The SKILL.md copy defaulted with `\${2:-{}}`, which appends a stray `}` to
    // any variables a caller passes, so every variables-bearing call sent
    // invalid JSON. The default here must not touch a supplied value.
    const tree = buildTree();
    const result = spawnSync(
      "bash",
      [
        "-c",
        `source "$1" && linear_graphql 'query{x}' '{"id":"ENG-3"}'`,
        "bash",
        tree.script,
      ],
      {
        cwd: tree.project,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          PATH: `${tree.bin}:${toolPath()}`,
          HOME: tree.root,
          STUB_DIR: tree.stubDir,
          STUB_TEAMS: "ENG",
          LINEAR_API_KEY: SENTINEL,
        },
      }
    );

    expect(result.status).toBe(0);
    const bodies = readLines(path.join(tree.stubDir, BODIES_LOG));
    // The identity probe goes first, then the caller's request.
    expect(bodies).toHaveLength(2);
    expect(JSON.parse(bodies[1]!).variables).toStrictEqual({ id: "ENG-3" });
    expect(result.stdout).not.toContain(SENTINEL);
    expect(result.stderr).not.toContain(SENTINEL);
  });

  it("refuses a sourced linear_graphql for a different organization", () => {
    const tree = buildTree();
    const result = sourced(tree, "linear_graphql 'query{x}'", {
      STUB_ORG: OTHER_ORG,
    });

    expect(result.status).toBe(4);
    expect(readLines(path.join(tree.stubDir, BODIES_LOG))).toHaveLength(1);
    expect(result.stderr).not.toContain(SENTINEL);
  });

  it("defaults linear_graphql variables to an empty object", () => {
    const tree = buildTree();
    const result = sourced(tree, "linear_graphql 'query{x}'", {
      STUB_TEAMS: "ENG",
    });

    expect(result.status).toBe(0);
    const bodies = readLines(path.join(tree.stubDir, BODIES_LOG));
    expect(JSON.parse(bodies[1]!).variables).toStrictEqual({});
  });

  it("probes identity once when linear_require_identity runs first", () => {
    const tree = buildTree();
    const result = sourced(
      tree,
      "linear_require_identity && linear_graphql 'query{a}' >/dev/null && linear_graphql 'query{b}'",
      { STUB_TEAMS: "ENG" }
    );

    expect(result.status).toBe(0);
    expect(readLines(path.join(tree.stubDir, BODIES_LOG))).toHaveLength(3);
    expect(result.stdout).not.toContain(SENTINEL);
  });
});

/**
 * Source the script in a fresh bash and run a snippet after it.
 * @param tree The tree to run in.
 * @param snippet Shell to run once the adapter is sourced.
 * @param env Extra environment.
 * @returns The bash result.
 */
const sourced = (
  tree: Tree,
  snippet: string,
  env: Readonly<Record<string, string>> = {}
) =>
  spawnSync("bash", ["-c", `. "$1" && ${snippet}`, "bash", tree.script], {
    cwd: tree.project,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: `${tree.bin}:${toolPath()}`,
      HOME: tree.root,
      STUB_DIR: tree.stubDir,
      LINEAR_API_KEY: SENTINEL,
      ...env,
    },
  });
