/** Immutable candidate packaging and an exact-artifact loopback npm boundary. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { expect } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { borrowNodeModules } from "../../support/borrowed-node-modules.mjs";
import { resolveGit } from "../../support/git-executable.js";
import { files, write } from "./host.js";
import { run } from "./process.js";
import { freeCheckout } from "./teardown.js";
import { inheritedEnvironment } from "../../support/process-environment.js";

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
      Object.entries(inheritedEnvironment()).filter(
        ([name]) => !/^(AWS_|GIT_(DIR|WORK_TREE|INDEX_FILE)$)/.test(name)
      )
    ),
    PATH: `${path.join(root, "fake-bin")}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${inheritedEnvironment()["PATH"] ?? ""}`,
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
 * Copy an isolated immutable index snapshot beside a sentinel-only fake `gh`.
 * @param repo - Source checkout whose index is the candidate
 * @param root - Isolated fixture root
 * @returns Isolated checkout paths, index provenance and child environment
 */
async function isolateCheckout(repo: string, root: string) {
  const checkout = path.join(root, "checkout");
  const logs = path.join(root, "evidence");
  const cache = path.join(root, "artifact-bun-cache");
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
  const env = childEnvironment(root, cache);
  [
    checkout,
    logs,
    cache,
    path.join(root, "pack"),
    path.join(root, "oracle"),
    path.join(root, "child-tmp"),
    path.join(root, "fake-bin"),
  ].forEach(dir => fs.mkdirSync(dir));
  expect(head).toMatch(/^[a-f0-9]{40}$/);
  expect(tree).toMatch(/^[a-f0-9]{40}$/);
  write(
    path.join(root, "fake-bin"),
    "gh",
    '#!/bin/sh\ntouch "$LISA_RUNTIME_GH_SENTINEL"\nexit 99\n'
  );
  fs.chmodSync(path.join(root, "fake-bin", "gh"), 0o700);
  await run(
    git,
    ["checkout-index", "--all", `--prefix=${checkout}/`],
    repo,
    env,
    logs,
    "immutable-index"
  );
  borrowNodeModules(path.join(repo, "node_modules"), checkout);
  return { checkout, root, env, logs, head, tree, cache };
}

/**
 * Stamp the isolated candidate's manifest with its local release identity.
 * @param checkout - Isolated immutable checkout
 * @param logs - Evidence log directory
 * @param head - Source commit the candidate was copied from
 * @param tree - Index tree the candidate was copied from
 * @returns The candidate's declared package version
 */
function stampIdentity(
  checkout: string,
  logs: string,
  head: string,
  tree: string
): string {
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
  return version;
}

/**
 * Copy and stamp an isolated immutable index snapshot.
 * @param repo - Source checkout whose index is the candidate
 * @param root - Isolated fixture root
 * @returns Prepared immutable checkout paths, package provenance and child environment
 */
async function prepareCandidate(repo: string, root: string) {
  const isolated = await isolateCheckout(repo, root);
  const version = stampIdentity(
    isolated.checkout,
    isolated.logs,
    isolated.head,
    isolated.tree
  );
  return { ...isolated, version };
}

/**
 * Locate the single tarball the release identity check packed.
 * @param root - Isolated fixture root
 * @returns Path of the only packed tarball
 */
function packedTarball(root: string): string {
  const packed = fs
    .readdirSync(path.join(root, "pack"))
    .filter(name => name.endsWith(".tgz"));
  expect(packed).toHaveLength(1);
  return path.join(root, "pack", packed[0]!);
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
  const tarball = packedTarball(root);
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
 * Pack the Git index into the exact candidate. The packed tool is installed
 * afterwards by `installTool`, through the loopback registry this candidate
 * starts (CodySwannGT/lisa#4636), so the candidate names where it will be.
 * @param repo - Source checkout whose index is the candidate
 * @param root - Isolated fixture root
 * @returns Exact candidate identity and the packed CLI's install path
 */
export async function packCandidate(
  repo: string,
  root: string
): Promise<Candidate> {
  const { env, logs, version, tarball, integrity, head, tree } =
    await buildTarball(await prepareCandidate(repo, root));
  // Nothing reads the checkout once the tarball is built and validated: the
  // tool is proven against the extracted oracle, so its entries leave the
  // teardown here.
  await freeCheckout(path.join(root, "checkout"));
  return {
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
      root,
      "tool",
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
        // Preserve native metadata negotiation without forwarding credentials.
        ...(request.headers.accept === undefined
          ? {}
          : { headers: { Accept: request.headers.accept } }),
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
