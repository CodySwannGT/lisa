/* eslint-disable code-organization/enforce-statement-order -- This operator harness deliberately records each chronological child boundary. */
/** Immutable candidate packaging and an exact-artifact loopback npm boundary. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { expect } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";
import { files, write } from "./host.js";
import { run } from "./process.js";

const MANIFEST = "package.json";

/** Exact immutable packed candidate and isolated install environment. */
export interface Candidate {
  readonly root: string;
  readonly tarball: string;
  readonly sourceHead: string;
  readonly indexTree: string;
  readonly tarballSha256: string;
  readonly memberCount: number;
  readonly oracle: string;
  readonly entry: string;
  readonly version: string;
  readonly integrity: string;
  readonly env: NodeJS.ProcessEnv;
  readonly logs: string;
}

/**
 * Isolate child temp files and credentials while selecting the current Node.
 * @param root - Isolated fixture root
 * @param cache - Empty artifact-specific Bun cache
 * @returns Explicit child environment
 */
function childEnvironment(root: string, cache: string): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      // eslint-disable-next-line no-restricted-syntax -- Operator child environment, with live credentials removed.
      Object.entries(process.env).filter(
        ([name]) => !/^(AWS_|GIT_(DIR|WORK_TREE|INDEX_FILE)$)/.test(name)
      )
    ),
    // eslint-disable-next-line no-restricted-syntax -- The child must use the current reviewed Node executable.
    PATH: `${path.join(root, "fake-bin")}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env["PATH"] ?? ""}`,
    TMPDIR: path.join(root, "child-tmp"),
    TMP: path.join(root, "child-tmp"),
    TEMP: path.join(root, "child-tmp"),
    CI: "1",
    LISA_BOOTSTRAP: "1",
    LISA_RUNTIME_GH_SENTINEL: path.join(root, "github-was-invoked"),
    BUN_INSTALL_CACHE_DIR: cache,
    AWS_EC2_METADATA_DISABLED: "true",
  };
}

/**
 * Copy and stamp an isolated immutable index snapshot.
 * @param repo - Source checkout whose index is the candidate
 * @param root - Isolated fixture root
 * @returns Prepared immutable checkout paths, package provenance and child environment
 */
async function prepareCandidate(repo: string, root: string) {
  const checkout = path.join(root, "checkout");
  const logs = path.join(root, "evidence");
  const cache = path.join(root, "artifact-bun-cache");
  [
    checkout,
    logs,
    cache,
    path.join(root, "pack"),
    path.join(root, "oracle"),
    path.join(root, "child-tmp"),
    path.join(root, "fake-bin"),
  ].forEach(dir => fs.mkdirSync(dir));
  const git = resolveGit();
  const head = boundedSpawnSync({
    label: "candidate provenance",
    command: git,
    args: ["rev-parse", "HEAD"],
    cwd: repo,
  }).stdout.trim();
  const tree = boundedSpawnSync({
    label: "candidate index identity",
    command: git,
    args: ["write-tree"],
    cwd: repo,
  }).stdout.trim();
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  expect(tree).toMatch(/^[a-f0-9]{40}$/);
  write(
    path.join(root, "fake-bin"),
    "gh",
    '#!/bin/sh\ntouch "$LISA_RUNTIME_GH_SENTINEL"\nexit 99\n'
  );
  fs.chmodSync(path.join(root, "fake-bin", "gh"), 0o700);
  const env = childEnvironment(root, cache);
  await run(
    git,
    ["checkout-index", "--all", `--prefix=${checkout}/`],
    repo,
    env,
    logs,
    "immutable-index"
  );
  fs.symlinkSync(
    path.join(repo, "node_modules"),
    path.join(checkout, "node_modules"),
    "dir"
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(checkout, MANIFEST), "utf8")
  );
  const version: string = manifest.version;
  // These are the existing publication identity fields, applied only to this
  // isolated local candidate. This does not claim a public tag or publication.
  write(checkout, MANIFEST, {
    ...manifest,
    lisaReleaseCommit: head,
    gitHead: head,
    lisaReleaseTag: `v${version}`,
  });
  write(logs, "candidate-identity.json", {
    sourceHead: head,
    indexTree: tree,
    version,
    publicPublication: false,
  });
  return { checkout, root, env, logs, version, head, tree, cache };
}

/**
 * Build and validate the existing release identity contract.
 * @param input - Prepared immutable candidate paths and identity
 * @returns Validated local tarball path and its SHA512 integrity
 */
async function buildTarball(
  input: Awaited<ReturnType<typeof prepareCandidate>>
) {
  const { checkout, root, env, logs, version, head } = input;
  await run(
    "bun",
    ["run", "build:dist:in-place"],
    checkout,
    env,
    logs,
    "build-candidate",
    60_000
  );
  await run(
    process.execPath,
    [
      "scripts/check-release-package-identity.mjs",
      "pack",
      "--version",
      version,
      "--release-commit",
      head,
      "--tag",
      `v${version}`,
      "--pack-destination",
      path.join(root, "pack"),
    ],
    checkout,
    env,
    logs,
    "validate-pack",
    60_000
  );
  const packed = fs
    .readdirSync(path.join(root, "pack"))
    .filter(name => name.endsWith(".tgz"));
  expect(packed).toHaveLength(1);
  const tarball = path.join(root, "pack", packed[0]!);
  await run(
    "tar",
    ["-xzf", tarball, "-C", path.join(root, "oracle")],
    root,
    env,
    logs,
    "extract-oracle"
  );
  const bytes = fs.readFileSync(tarball);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  return { ...input, tarball, integrity };
}

/**
 * Pack the Git index and install the genuine isolated candidate tool.
 * @param repo - Source checkout whose index is the candidate
 * @param root - Isolated fixture root
 * @returns Exact candidate identity and installed packed CLI paths
 */
export async function packCandidate(
  repo: string,
  root: string
): Promise<Candidate> {
  const { env, logs, version, cache, tarball, integrity, head, tree } =
    await buildTarball(await prepareCandidate(repo, root));
  const tool = path.join(root, "tool");
  write(tool, MANIFEST, {
    name: "packed-runtime-tool",
    version: "1.0.0",
    private: true,
    dependencies: { "@codyswann/lisa": `file:${tarball}` },
  });
  await run(
    "bun",
    ["install", "--ignore-scripts", "--cache-dir", cache],
    tool,
    env,
    logs,
    "install-tool",
    180_000
  );
  const candidate = {
    root,
    tarball,
    sourceHead: head,
    indexTree: tree,
    tarballSha256: createHash("sha256")
      .update(fs.readFileSync(tarball))
      .digest("hex"),
    memberCount: files(path.join(root, "oracle", "package")).length,
    oracle: path.join(root, "oracle", "package"),
    entry: path.join(
      tool,
      "node_modules",
      "@codyswann",
      "lisa",
      "dist",
      "index.js"
    ),
    version,
    integrity,
    env,
    logs,
  };
  assertInstalledBytes(
    candidate,
    path.join(tool, "node_modules", "@codyswann", "lisa")
  );
  return candidate;
}

/**
 * Compare every regular tar-member byte, rather than trusting version strings.
 * @param candidate - Exact packed candidate and child environment
 * @param installed - Installed package root to compare
 */
export function assertInstalledBytes(
  candidate: Candidate,
  installed: string
): void {
  const members = files(candidate.oracle);
  expect(members.length).toBeGreaterThan(100);
  members.forEach(member =>
    expect(
      Buffer.compare(
        fs.readFileSync(path.join(installed, member)),
        fs.readFileSync(path.join(candidate.oracle, member))
      ),
      member
    ).toBe(0)
  );
}

/**
 * Serve only Lisa from the candidate; every other request reaches genuine npm.
 * @param candidate - Exact packed candidate and child environment
 * @returns Bound loopback registry URL and asynchronous shutdown function
 */
export async function startRegistry(
  candidate: Candidate
): Promise<{ readonly url: string; readonly close: () => Promise<void> }> {
  const bytes = fs.readFileSync(candidate.tarball);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(candidate.oracle, MANIFEST), "utf8")
  );
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent((request.url ?? "/").split("?")[0]!);
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("registry must have a loopback port");
    const dist = {
      tarball: `http://127.0.0.1:${address.port}/packed-lisa.tgz`,
      integrity: candidate.integrity,
      // eslint-disable-next-line sonarjs/hashing -- npm legacy shasum metadata; SHA512 integrity and full bytes are separately asserted.
      shasum: createHash("sha1").update(bytes).digest("hex"),
    };
    if (pathname === "/packed-lisa.tgz") {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end(bytes);
    } else if (
      ["/@codyswann/lisa", `/@codyswann/lisa/${candidate.version}`].includes(
        pathname
      )
    ) {
      const exact = { ...manifest, dist };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify(
          pathname.endsWith(`/${candidate.version}`)
            ? exact
            : {
                name: "@codyswann/lisa",
                "dist-tags": { latest: candidate.version },
                versions: { [candidate.version]: exact },
              }
        )
      );
    } else {
      void fetch(`https://registry.npmjs.org${request.url}`, {
        signal: AbortSignal.timeout(120_000),
      })
        .then(async upstream => {
          response.writeHead(upstream.status, {
            "Content-Type":
              upstream.headers.get("content-type") ?? "application/json",
          });
          response.end(Buffer.from(await upstream.arrayBuffer()));
        })
        .catch(error => {
          response.writeHead(502);
          response.end(String(error));
        });
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("missing loopback registry address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

/* eslint-enable code-organization/enforce-statement-order -- End the chronological fixture harness. */
