// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Public immutable archives are checked before the trusted daemon loads them. @module npm-updater */
import { openSync, closeSync, writeSync, fsyncSync, constants } from "node:fs";
import { join } from "node:path";
import { required, keys } from "./npm-update-contract.mjs";
import { inspectRuntimeArchive } from "./npm-update-runtime-archive.mjs";
import { dockerClient } from "./npm-update-worker-lifecycle.mjs";
import { namespaceRecords } from "./npm-update-orchestrator.mjs";

/** Only exact official public assets grant archive transport authority. */
export function validateArchiveTransport(archive, platform) {
  keys(archive, ["url", "sha256", "bytes", "uncompressedBytes", "config"]);
  required(
    typeof archive.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(archive.sha256) &&
      typeof archive.config === "string" &&
      /^sha256:[a-f0-9]{64}$/.test(archive.config),
    "runtime archive/config identity is unresolved"
  );
  required(
    Number.isSafeInteger(archive.bytes) &&
      archive.bytes > 0 &&
      archive.bytes < 1_000_000_000 &&
      Number.isSafeInteger(archive.uncompressedBytes) &&
      archive.uncompressedBytes > 0 &&
      archive.uncompressedBytes < 1_500_000_000,
    "runtime archive exceeds supported asset bounds"
  );
  required(
    ["linux/arm64", "linux/amd64"].includes(platform),
    "unsupported archive platform"
  );
  const url = new URL(archive.url);
  const path = new RegExp(
    `^/CodySwannGT/lisa/releases/download/v[0-9]+\\.[0-9]+\\.[0-9]+/npm-updater-gate-${platform.replace("/", "-")}-${archive.sha256}\\.tar\\.gz$`
  );
  required(
    url.protocol === "https:" &&
      url.hostname === "github.com" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      path.test(url.pathname),
    "runtime archive is not an immutable official public asset"
  );
  return archive;
}

/** Redirects stay within GitHub's public asset services, with no authorization headers. */
async function publicResponse(initialUrl, signal) {
  let url = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const parsed = new URL(url);
    required(
      parsed.protocol === "https:" &&
        ["github.com", "release-assets.githubusercontent.com"].includes(
          parsed.hostname
        ) &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port,
      "runtime asset redirect is foreign"
    );
    const response = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { Accept: "application/octet-stream" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get("location");
      await response.body?.cancel();
      required(next, "runtime asset redirect is missing");
      url = new URL(next, url).href;
    } else {
      if (!response.ok || response.status !== 200 || !response.body) {
        await response.body?.cancel();
        required(false, "anonymous runtime asset download failed");
      }
      return response;
    }
  }
  throw Error("runtime asset redirect limit exceeded");
}

/** Only pinned bytes enter fresh private storage, with a bounded total deadline. */
async function writeDownload(file, response, expectedBytes, signal) {
  const reader = response.body.getReader();
  let fd;
  let length = 0;
  let expired = false;
  const deadline = () => {
    expired = true;
    reader.cancel().catch(() => {});
  };
  const timer = setTimeout(deadline, 180_000);
  signal.addEventListener("abort", deadline, { once: true });
  try {
    required(!signal.aborted, "runtime asset deadline exceeded");
    fd = openSync(
      file,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600
    );
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      required(
        length <= expectedBytes,
        "runtime asset expanded beyond its byte bound"
      );
      let offset = 0;
      while (offset < value.length) {
        const count = writeSync(fd, value, offset);
        required(count > 0, "runtime asset write failed");
        offset += count;
      }
    }
    required(!expired && !signal.aborted, "runtime asset deadline exceeded");
    required(length === expectedBytes, "runtime asset download was incomplete");
    fsyncSync(fd);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", deadline);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    if (fd !== undefined) closeSync(fd);
  }
}

/** No daemon load can consume an archive before whole-byte and graph verification. */
export async function downloadRuntimeArchive(root, entry) {
  const archive = validateArchiveTransport(entry.archive, entry.platform);
  required(
    namespaceRecords(root).length === 0,
    "runtime download requires completed worker recovery"
  );
  const file = join(root, `runtime-${archive.sha256}.tar.gz`);
  const signal = AbortSignal.timeout(180_000);
  const response = await publicResponse(archive.url, signal);
  try {
    const declared = response.headers.get("content-length");
    required(
      declared === null || declared === String(archive.bytes),
      "runtime asset declared byte length differs"
    );
    await writeDownload(file, response, archive.bytes, signal);
  } finally {
    await response.body.cancel().catch(() => {});
  }
  await inspectRuntimeArchive(file, {
    ...archive,
    image: entry.image,
    platform: entry.platform,
  });
  return file;
}

/** Loading tagless data must preserve all foreign image names and bind the actual index. */
export async function loadRuntimeImage(boundary, entry, file) {
  validateArchiveTransport(entry.archive, entry.platform);
  required(
    namespaceRecords(boundary.root).length === 0,
    "runtime load requires completed worker recovery"
  );
  await inspectRuntimeArchive(file, {
    ...entry.archive,
    image: entry.image,
    platform: entry.platform,
  });
  const docker = dockerClient(boundary);
  const census = async () =>
    (
      await docker([
        "image",
        "ls",
        "--no-trunc",
        "--format",
        "{{.ID}} {{.Repository}}:{{.Tag}}",
      ])
    ).stdout
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .sort();
  const before = await census();
  await docker(["image", "load", "--input", file], { timeout: 180_000 });
  const values = JSON.parse(
    (await docker(["image", "inspect", entry.image])).stdout.toString()
  );
  required(
    Array.isArray(values) &&
      values.length === 1 &&
      values[0].Id === entry.image &&
      values[0].Descriptor?.digest === entry.image &&
      `${values[0].Os}/${values[0].Architecture}` === entry.platform,
    "loaded runtime index/platform differs"
  );
  const after = await census();
  required(
    before.every(value => after.includes(value)) &&
      after.every(
        value =>
          before.includes(value) || value === `${entry.image} <none>:<none>`
      ),
    "runtime load changed foreign image/tag census"
  );
  return {
    image: entry.image,
    config: entry.archive.config,
    platform: entry.platform,
  };
}
