// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Fixed native runtime identities are rechecked before each Docker observation. */
import {
  constants,
  existsSync,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { join, isAbsolute, dirname } from "node:path";
import { createHash } from "node:crypto";
import { required } from "./npm-update-contract.mjs";
import { runProcess } from "./npm-update-process.mjs";

/** Runtime calls consume the original absolute phase, including every identity readback. */
export function runtimeTime(deadline, maximum = 10000) {
  const remaining = deadline - Date.now();
  required(
    Number.isSafeInteger(deadline) && remaining > 0 && remaining <= 1800000,
    "original runtime deadline is absent or expired"
  );
  return Math.min(remaining, maximum);
}

/** Initial qualification reads only an already bounded no-follow executable descriptor. */
function toolSnapshot(file) {
  required(
    isAbsolute(file) && realpathSync(file) === file,
    "native tool identity is aliased or absent"
  );
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    required(
      st.isFile() &&
        st.nlink === 1 &&
        (st.mode & 0o111) !== 0 &&
        st.size <= 536870912,
      "native tool identity is not a bounded executable"
    );
    const hash = createHash("sha256").update(readFileSync(fd)).digest("hex");
    const current = lstatSync(file);
    required(
      current.dev === st.dev &&
        current.ino === st.ino &&
        !current.isSymbolicLink(),
      "native tool identity changed"
    );
    return { dev: st.dev, ino: st.ino, uid: st.uid, sha256: hash };
  } finally {
    closeSync(fd);
  }
}

/** An owned descriptor cannot authorize a symlink, shared inode, nonexecutable or substituted bytes. */
export function toolIdentity(file, expected) {
  required(
    /^[a-f0-9]{64}$/.test(expected),
    "native tool identity is aliased or absent"
  );
  const identity = toolSnapshot(file);
  required(identity.sha256 === expected, "native tool identity changed");
  return identity;
}

/** Private config is generated data only; no original auths, helper or credential store is inherited. */
function dockerEnvironment(docker) {
  const env = docker.env;
  required(
    env &&
      Object.keys(env).sort().join(",") === "DOCKER_CONFIG,HOME,PATH" &&
      isAbsolute(env.HOME) &&
      env.PATH.split(":").every(isAbsolute) &&
      env.DOCKER_CONFIG === join(env.HOME, "docker-config"),
    "Docker environment differs"
  );
  for (const dir of [env.HOME, env.DOCKER_CONFIG]) {
    const st = lstatSync(dir);
    required(
      realpathSync(dir) === dir &&
        st.isDirectory() &&
        st.uid === process.getuid() &&
        (st.mode & 0o077) === 0,
      "Docker configuration directory is not private owned storage"
    );
  }
  const file = join(env.DOCKER_CONFIG, "config.json");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    required(
      st.isFile() &&
        st.nlink === 1 &&
        st.uid === process.getuid() &&
        (st.mode & 0o077) === 0 &&
        st.size <= 4096,
      "Docker configuration is not private data"
    );
    const bytes = readFileSync(fd);
    const config = JSON.parse(bytes.toString());
    const dirs = docker.plugins ? [dirname(docker.plugins.compose.path)] : [];
    required(
      Object.keys(config).join(",") ===
        (dirs.length ? "cliPluginsExtraDirs" : "") &&
        JSON.stringify(config) ===
          JSON.stringify(dirs.length ? { cliPluginsExtraDirs: dirs } : {}) &&
        bytes.toString() === `${JSON.stringify(config)}\n`,
      "Docker configuration differs"
    );
    if (docker.plugins) {
      required(
        Object.keys(docker.plugins).sort().join(",") === "buildx,compose" &&
          dirname(docker.plugins.buildx.path) === dirs[0] &&
          dirs[0] === join(env.HOME, "docker-plugins"),
        "Docker plugin identity differs"
      );
      for (const plugin of Object.values(docker.plugins))
        toolIdentity(plugin.path, plugin.sha256);
    }
  } finally {
    closeSync(fd);
  }
  return env;
}

/** Native query errors never imply absence; daemon architecture is separate from the service platform. */
export async function assertDockerQualified(docker, deadline) {
  runtimeTime(deadline);
  const env = dockerEnvironment(docker);
  required(docker.version === "29.8.2", "unsupported native Docker identity");
  const identity = toolIdentity(docker.path, docker.sha256);
  const version = await runProcess(docker.path, ["--version"], {
    env,
    timeout: runtimeTime(deadline),
    maximum: 4096,
  });
  required(
    /^Docker version 29\.8\.2, build [a-z0-9]+\n$/.test(
      version.stdout.toString()
    ),
    "native Docker version identity differs"
  );
  const result = await runProcess(
    docker.path,
    ["info", "--format", '{"ID":{{json .ID}},"OSType":{{json .OSType}}}'],
    { env, timeout: runtimeTime(deadline), maximum: 4096 }
  );
  const value = JSON.parse(result.stdout.toString());
  required(
    Object.keys(value).sort().join(",") === "ID,OSType" &&
      value.OSType === "linux" &&
      typeof value.ID === "string" &&
      value.ID.length > 0 &&
      value.ID === docker.engineId,
    "native Docker daemon identity differs"
  );
  const after = toolIdentity(docker.path, docker.sha256);
  required(
    identity.dev === after.dev &&
      identity.ino === after.ino &&
      identity.uid === after.uid,
    "native Docker identity changed during observation"
  );
  return value;
}

export const SUPPORTED_RAILS_CLIENT = "1:10.11.14-0ubuntu0.24.04.1";
/** Fixed Ubuntu archive versions supply browser libraries without ambient runner assumptions. */
export const SUPPORTED_RAILS_BROWSER = Object.freeze([
  "fonts-liberation=1:2.1.5-3",
  "libasound2t64=1.2.11-1ubuntu0.3",
  "libatk-bridge2.0-0t64=2.52.0-1build1",
  "libatk1.0-0t64=2.52.0-1build1",
  "libcairo2=1.18.0-3build1",
  "libcups2t64=2.4.7-1.2ubuntu7.14",
  "libdbus-1-3=1.14.10-4ubuntu4.1",
  "libdrm2=2.4.125-1ubuntu0.1~24.04.2",
  "libgbm1=25.2.8-0ubuntu0.24.04.4",
  "libglib2.0-0t64=2.80.0-6ubuntu3.9",
  "libnss3=2:3.98-1ubuntu0.2",
  "libpango-1.0-0=1.52.1+ds-1build1",
  "libx11-xcb1=2:1.8.7-1build1",
  "libxcomposite1=1:0.4.5-1build3",
  "libxdamage1=1:1.1.6-1build1",
  "libxext6=2:1.3.4-1build2",
  "libxfixes3=1:6.0.0-2build1",
  "libxkbcommon0=1.6.0-1build1",
  "libxrandr2=2:1.5.2-2build1",
]);

/** Original trusted PATH selects regular Ruby tools; their bytes are pinned around native version calls. */
export async function qualifyRailsRuby(env, deadline) {
  const output = {};
  required(
    typeof env.PATH === "string" && env.PATH.split(":").every(isAbsolute),
    "Ruby tool environment path differs"
  );
  for (const [name, version] of [
    ["ruby", "3.4.11"],
    ["bundle", "2.4.10"],
  ]) {
    const path = env.PATH.split(":")
      .map(dir => join(dir, name))
      .find(existsSync);
    required(typeof path === "string", "supported native Ruby tool is absent");
    const before = toolSnapshot(path);
    const sha256 = before.sha256;
    const result = await runProcess(path, ["--version"], {
      env,
      timeout: runtimeTime(deadline),
      maximum: 4096,
    });
    const text = result.stdout.toString();
    required(
      name === "ruby"
        ? text.startsWith("ruby 3.4.11 ")
        : text === "Bundler version 2.4.10\n",
      "supported native Ruby/Bundler identity differs"
    );
    const after = toolIdentity(path, sha256);
    required(
      before.dev === after.dev &&
        before.ino === after.ino &&
        before.uid === after.uid,
      "native Ruby tool changed during qualification"
    );
    output[name] = { path, sha256, version };
  }
  return output;
}

/** Signed Ubuntu packages qualify both native client and bounded header identities. */
export async function qualifyRailsClient(step) {
  const versions = await step("/usr/bin/dpkg-query", [
    "-W",
    "-f=${Package} ${Version}\n",
    "libmariadb-dev",
    "libmariadb-dev-compat",
  ]);
  required(
    versions.stdout.toString() ===
      `libmariadb-dev ${SUPPORTED_RAILS_CLIENT}\nlibmariadb-dev-compat ${SUPPORTED_RAILS_CLIENT}\n`,
    "supported native client package version differs"
  );
  const verified = await step("/usr/bin/dpkg", [
    "--verify",
    "libmariadb-dev",
    "libmariadb-dev-compat",
  ]);
  required(verified.stdout.length === 0, "native client package bytes differ");
  const path = "/usr/bin/mariadb_config";
  const sha256 = toolSnapshot(path).sha256;
  const version = await step(path, ["--version"]);
  required(
    version.stdout.toString() === "10.11.14\n",
    "supported native client identity differs"
  );
  const header = "/usr/include/mariadb/mysql.h";
  const fd = openSync(header, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    required(
      st.isFile() &&
        st.nlink === 1 &&
        st.uid === 0 &&
        st.size <= 1048576 &&
        realpathSync(header) === header,
      "native client header identity differs"
    );
    const headerSha256 = createHash("sha256")
      .update(readFileSync(fd))
      .digest("hex");
    return {
      path,
      sha256,
      version: SUPPORTED_RAILS_CLIENT,
      header,
      headerSha256,
    };
  } finally {
    closeSync(fd);
  }
}
