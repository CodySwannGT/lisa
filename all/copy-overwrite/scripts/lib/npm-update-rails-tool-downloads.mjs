// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Fixed official archives are authenticated before any member becomes executable. */
import {
  constants,
  openSync,
  closeSync,
  writeSync,
  fsyncSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { required } from "./npm-update-contract.mjs";

const VERSION = "154.0.8037.92";

/** The verified browser paths enter a finite compatibility environment, never arbitrary policy keys. */
export function railsBrowserEnvironment(chrome, driver, sandbox) {
  return {
    CHROME_BINARY: chrome,
    CHROME_BIN: chrome,
    CHROMEDRIVER: driver,
    CHROME_DEVEL_SANDBOX: sandbox,
  };
}

const DOWNLOADS = Object.freeze({
  docker: {
    url: "https://download.docker.com/linux/static/stable/x86_64/docker-29.8.2.tgz",
    sha256: "995d1ef289677f74fd58d8d2c35727b6a4ee389c69db8638a3e42d0487aa5b0f",
    binary: "6f7a95d27f98fc8c5f6b220898988bf8f61dd9b040936797917cbdc72c6cabe6",
  },
  compose: {
    url: "https://github.com/docker/compose/releases/download/v5.6.0/docker-compose-linux-x86_64",
    sha256: "40343e21ca777173e69cff5dbafeb37c6f81f3b0d57d9e597f036e95eb63e76a",
  },
  buildx: {
    url: "https://github.com/docker/buildx/releases/download/v0.38.0/buildx-v0.38.0.linux-amd64",
    sha256: "4fe4cc38adf48169132749b6ca22a990928db0118e3407584ee553723115d287",
  },
  chrome: {
    url: `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/linux64/chrome-linux64.zip`,
    sha256: "ff43322f335e436b2f4dcdfeeec5db032299e335a7e8c1c618b326e100ce8732",
    binary: "439f367a9a24dde467dca9c4e4c2feedd3266899c5a8e3eb17b68b05d4da9f5f",
    sandbox: "24beb85e4149c65db5bf40fa307721143d0883ab8952e60dde1158606f644dee",
  },
  chromedriver: {
    url: `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/linux64/chromedriver-linux64.zip`,
    sha256: "cc99c87cfd10e1da1b7d42ea9800a211df279f5a47c19a55b02c927cb9f606c2",
    binary: "83dad64578afcd2036c3c31d02fd9e01efdd957ac45dd1de7c97b061ace9d6dc",
  },
});

/** Exact pinned archive bytes are rechecked through a private no-follow descriptor before extraction. */
export function assertRailsArchive(name, file) {
  required(
    Object.hasOwn(DOWNLOADS, name) && realpathSync(file) === file,
    "fixed vendor archive identity differs"
  );
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    required(
      st.isFile() &&
        st.nlink === 1 &&
        st.uid === process.getuid() &&
        (st.mode & 0o077) === 0 &&
        st.size > 0 &&
        st.size <= 250000000,
      "fixed vendor archive is not private owned data"
    );
    required(
      createHash("sha256").update(readFileSync(fd)).digest("hex") ===
        DOWNLOADS[name].sha256,
      "fixed vendor archive integrity differs"
    );
    const current = lstatSync(file);
    required(
      current.dev === st.dev &&
        current.ino === st.ino &&
        !current.isSymbolicLink(),
      "fixed vendor archive ownership changed"
    );
  } finally {
    closeSync(fd);
  }
}

/** The exclusive descriptor receives bounded vendor bytes; an existing leaf is never overwritten. */
export async function downloadRailsTool(name, root, deadline) {
  required(
    Object.hasOwn(DOWNLOADS, name),
    "unsupported fixed runtime download"
  );
  const remaining = deadline - Date.now();
  required(
    Number.isSafeInteger(deadline) && remaining > 0 && remaining <= 1800000,
    "original runtime download deadline is absent or expired"
  );
  const file = join(root, `${name}.archive`);
  const fd = openSync(
    file,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600
  );
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(remaining, 60000)
  );
  const digest = createHash("sha256");
  let size = 0;
  try {
    const response = await fetch(DOWNLOADS[name].url, {
      signal: controller.signal,
    });
    required(
      response.ok && response.body && response.url.startsWith("https://"),
      "fixed vendor download failed"
    );
    for await (const part of response.body) {
      size += part.length;
      required(size <= 250000000, "fixed vendor download exceeds bound");
      digest.update(part);
      let offset = 0;
      while (offset < part.length) offset += writeSync(fd, part, offset);
    }
    fsyncSync(fd);
    required(
      size > 0 && digest.digest("hex") === DOWNLOADS[name].sha256,
      "fixed vendor download integrity differs"
    );
    const st = fstatSync(fd);
    const current = lstatSync(file);
    required(
      st.isFile() &&
        st.nlink === 1 &&
        st.uid === process.getuid() &&
        (st.mode & 0o077) === 0 &&
        current.dev === st.dev &&
        current.ino === st.ino &&
        !current.isSymbolicLink(),
      "fixed vendor download ownership changed"
    );
    return { file, ...DOWNLOADS[name] };
  } finally {
    clearTimeout(timer);
    closeSync(fd);
  }
}

/** Only an authenticated ZIP's fixed prefix is extracted into a newly owned empty directory. */
export async function extractRailsBrowser(name, archive, root, step) {
  required(
    name === "chrome" || name === "chromedriver",
    "unsupported fixed browser archive"
  );
  assertRailsArchive(name, archive);
  const prefix = `${name}-linux64/`;
  const listing = await step("/usr/bin/unzip", ["-Z1", archive]);
  const names = listing.stdout.toString().trimEnd().split("\n");
  required(
    names.length > 0 &&
      names.length <= 400 &&
      names.every(
        value =>
          value.startsWith(prefix) &&
          !/[\0\r\\]/.test(value) &&
          !value.split("/").some(part => part === ".." || part === ".") &&
          /^[a-zA-Z0-9_./-]+$/.test(value)
      ),
    "fixed browser archive member differs"
  );
  const target = join(root, name);
  mkdirSync(target, { mode: 0o700 });
  await step("/usr/bin/unzip", ["-q", archive, "-d", target]);
  return join(target, prefix, name);
}
