/**
 * A `gh` stub for running the built `lisa controls protect` without any
 * hosting platform (CodySwannGT/lisa#4993).
 *
 * The built command starts the real `gh` program, so an integration suite
 * cannot hand it a function. It puts this stub first on `PATH` instead. The
 * stub never reaches a network. It appends the arguments of every call to a
 * log, one line per call, answers a read from a canned file, and refuses
 * anything that is not a read — so a case can assert exactly what the command
 * asked for, and a write could not succeed even if one were sent.
 *
 * {@link protectGhEnv} also points the real `gh`, should it ever be reached,
 * at a host that cannot exist, at a proxy nothing listens on, and at an
 * empty configuration folder with no token.
 * @module tests/integration/support/protect-gh-stub
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { writeStub } from "./shell-guard-refusal-fixture.js";

const GH_BODY = `state="\${LISA_GH_STATE:?}"
printf '%s\\n' "$*" >> "$state/requests.log"
method=GET
target=""
previous=""
for arg in "$@"; do
  if [ "$previous" = "-X" ]; then method="$arg"; fi
  case "$arg" in repos/*) target="$arg" ;; esac
  previous="$arg"
done
if [ "$method" != "GET" ]; then
  echo "the stub refuses every request that is not a read" >&2
  exit 1
fi
file="$state/responses/$(printf '%s' "$target" | tr '/' '_').json"
if [ ! -f "$file" ]; then
  echo '{"message":"Not Found"}'
  echo "gh: Not Found (HTTP 404)" >&2
  exit 1
fi
cat "$file"
`;

/** A local address nothing listens on: the discard port of this machine. */
const NOWHERE = "http://127.0.0.1:9";

/** The stub's folders. */
export interface ProtectGhStub {
  /** The folder to put first on `PATH`. */
  readonly binDir: string;
  /** The folder holding the canned answers and the request log. */
  readonly stateDir: string;
}

/**
 * Install the stub and its canned answers.
 * @param root - An empty folder to build the stub in
 * @param responses - API path to the document the stub answers a read with
 * @returns The stub's folders
 */
export function writeProtectGh(
  root: string,
  responses: Readonly<Record<string, unknown>>
): ProtectGhStub {
  const binDir = path.join(root, "bin");
  const stateDir = path.join(root, "state");
  mkdirSync(path.join(stateDir, "responses"), { recursive: true });
  mkdirSync(path.join(stateDir, "gh-config"), { recursive: true });
  Object.entries(responses).forEach(([apiPath, document]) => {
    writeFileSync(
      path.join(stateDir, "responses", `${apiPath.replaceAll("/", "_")}.json`),
      JSON.stringify(document)
    );
  });
  writeStub(binDir, "gh", GH_BODY);
  return { binDir, stateDir };
}

/**
 * The environment that makes a child process find the stub before any real
 * `gh`, and leaves a real one with nowhere to go.
 * @param stub - The stub's folders
 * @param base - The environment to extend
 * @returns The environment for the child
 */
export function protectGhEnv(
  stub: ProtectGhStub,
  base: NodeJS.ProcessEnv
): NodeJS.ProcessEnv {
  return {
    ...base,
    PATH: `${stub.binDir}${path.delimiter}${base.PATH ?? ""}`,
    LISA_GH_STATE: stub.stateDir,
    GH_HOST: "github.invalid",
    GH_CONFIG_DIR: path.join(stub.stateDir, "gh-config"),
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
    // The command names the host in each call, which outranks GH_HOST. So a
    // real `gh` is also given a proxy nothing listens on: whatever host a
    // call names, no connection can be made.
    HTTPS_PROXY: NOWHERE,
    HTTP_PROXY: NOWHERE,
    ALL_PROXY: NOWHERE,
    https_proxy: NOWHERE,
    http_proxy: NOWHERE,
    all_proxy: NOWHERE,
    NO_PROXY: "",
    no_proxy: "",
  };
}

/**
 * Every call the stub received, in order.
 * @param stub - The stub's folders
 * @returns The argument list of each call, as one line
 */
export function recordedGhCalls(stub: ProtectGhStub): readonly string[] {
  try {
    return readFileSync(path.join(stub.stateDir, "requests.log"), "utf8")
      .split("\n")
      .filter(line => line.trim() !== "");
  } catch {
    return [];
  }
}
