// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Authenticated finite Rails profiles install only the fixed supported native prerequisites. */
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { required } from "./npm-update-contract.mjs";
import { canonicalJson } from "./automation-provenance-contract.mjs";
import {
  assertRuntimeBinding,
  railsRuntime,
} from "./npm-update-rails-runtime-contract.mjs";
import {
  downloadRailsTool,
  extractRailsBrowser,
  assertRailsArchive,
  railsBrowserEnvironment,
} from "./npm-update-rails-tool-downloads.mjs";
import {
  assertDockerQualified,
  runtimeTime,
  toolIdentity,
  qualifyRailsClient,
  qualifyRailsRuby,
  SUPPORTED_RAILS_CLIENT,
  SUPPORTED_RAILS_BROWSER,
} from "./npm-update-rails-tool-identity.mjs";
import { runProcess } from "./npm-update-process.mjs";

export { assertDockerQualified, runtimeTime, toolIdentity };
const CLIENT = SUPPORTED_RAILS_CLIENT;
const BROWSER = "154.0.8037.92";
const SUDO = "/usr/bin/sudo";
const SNAPSHOT = "--snapshot=20261008T000000Z";

/** Observe the actual supported OS; no caller-supplied platform can authorize installation. */
function hostedPlatform() {
  required(
    process.platform === "linux" && process.arch === "x64",
    "Rails tools require native Linux AMD64"
  );
  const os = readFileSync("/etc/os-release", "utf8");
  required(
    /^ID=ubuntu$/m.test(os) && /^VERSION_ID="24\.04"$/m.test(os),
    "Rails tools require supported Ubuntu 24.04"
  );
}

/** Fixed privileged package operations inherit only the original credential-free candidate keys. */
function toolEnvironment(root, env) {
  const allowed = new Set([
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TZ",
    "TMPDIR",
    "NPM_CONFIG_USERCONFIG",
    "NPM_CONFIG_GLOBALCONFIG",
    "NPM_CONFIG_CACHE",
    "NPM_CONFIG_REGISTRY",
    "NPM_CONFIG_AUDIT",
    "NPM_CONFIG_FUND",
    "NPM_CONFIG_UPDATE_NOTIFIER",
    "GIT_TERMINAL_PROMPT",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "GIT_AUTHOR_DATE",
    "GIT_COMMITTER_DATE",
  ]);
  required(
    Object.keys(env).every(name => allowed.has(name)) &&
      env.HOME === root &&
      typeof env.PATH === "string" &&
      realpathSync(root) === root,
    "Rails tool environment differs"
  );
  const fd = openSync(
    root,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
  try {
    const st = fstatSync(fd);
    required(
      st.isDirectory() &&
        st.uid === process.getuid() &&
        (st.mode & 0o077) === 0,
      "Rails tool root is not private owned storage"
    );
  } finally {
    closeSync(fd);
  }
  return { ...env, BUNDLER_VERSION: "2.4.10" };
}

async function plugins(root, step, deadline) {
  const directory = join(root, "docker-plugins");
  mkdirSync(directory, { mode: 0o700 });
  const value = {};
  for (const [name, version] of [
    ["compose", "5.6.0"],
    ["buildx", "0.38.0"],
  ]) {
    const archive = await downloadRailsTool(name, root, deadline);
    const path = join(directory, `docker-${name}`);
    writeFileSync(path, readFileSync(archive.file), {
      flag: "wx",
      mode: 0o700,
    });
    toolIdentity(path, archive.sha256);
    const result = await step(path, ["version"]);
    required(
      result.stdout.toString().includes(`v${version}`),
      "fixed Docker plugin version differs"
    );
    value[name] = { path, sha256: archive.sha256, version };
  }
  return value;
}

/** Pin the vendor SUID helper descriptor; sandbox and AppArmor policy remain enabled. */
async function browser(root, step, deadline) {
  const paths = {};
  let sandboxHash;
  for (const name of ["chrome", "chromedriver"]) {
    const archive = await downloadRailsTool(name, root, deadline);
    paths[name] = await extractRailsBrowser(name, archive.file, root, step);
    toolIdentity(paths[name], archive.binary);
    const version = await step(paths[name], ["--version"]);
    required(
      version.stdout.toString().includes(BROWSER),
      "fixed native browser version differs"
    );
    if (name === "chrome") sandboxHash = archive.sandbox;
  }
  const sandbox = join(root, "chrome/chrome-linux64/chrome_sandbox");
  toolIdentity(sandbox, sandboxHash);
  const fd = openSync(sandbox, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const reference = `/proc/${process.pid}/fd/${fd}`;
    await step(SUDO, ["-n", "/usr/bin/chown", "root:root", reference]);
    await step(SUDO, ["-n", "/usr/bin/chmod", "4755", reference]);
    const st = fstatSync(fd);
    required(
      st.uid === 0 && st.gid === 0 && (st.mode & 0o7777) === 0o4755,
      "fixed native sandbox ownership differs"
    );
    toolIdentity(sandbox, sandboxHash);
  } finally {
    closeSync(fd);
  }
  return railsBrowserEnvironment(paths.chrome, paths.chromedriver, sandbox);
}

/** Fixed Docker bytes and private plugin-only config bind the actual Linux daemon. */
async function prepareDocker(root, profile, step, deadline) {
  const directory = join(root, "runtime-tools");
  mkdirSync(directory, { mode: 0o700 });
  const archive = await downloadRailsTool("docker", directory, deadline);
  assertRailsArchive("docker", archive.file);
  await step("/usr/bin/tar", [
    "-xzf",
    archive.file,
    "--no-same-owner",
    "--no-same-permissions",
    "-C",
    directory,
    "docker/docker",
  ]);
  const path = join(directory, "docker/docker");
  chmodSync(path, 0o700);
  toolIdentity(path, archive.binary);
  const pluginMap = profile.dockerFixtures
    ? await plugins(root, step, deadline)
    : undefined;
  const config = join(root, "docker-config");
  mkdirSync(config, { mode: 0o700 });
  writeFileSync(
    join(config, "config.json"),
    `${JSON.stringify(pluginMap ? { cliPluginsExtraDirs: [join(root, "docker-plugins")] } : {})}\n`,
    { flag: "wx", mode: 0o600 }
  );
  const dockerEnv = {
    HOME: root,
    PATH: "/usr/bin:/bin",
    DOCKER_CONFIG: config,
  };
  const info = await runProcess(path, ["info", "--format", "{{json .ID}}"], {
    env: dockerEnv,
    timeout: runtimeTime(deadline),
    maximum: 4096,
  });
  const docker = {
    path,
    sha256: archive.binary,
    version: "29.8.2",
    engineId: JSON.parse(info.stdout.toString()),
    env: dockerEnv,
    ...(pluginMap ? { plugins: pluginMap } : {}),
  };
  await assertDockerQualified(docker, deadline);
  return docker;
}

/** One immutable signed Ubuntu snapshot retains the fixed roster when moving mirrors retire pins. */
export async function installRailsPackages(step, browser) {
  const libraries = browser ? SUPPORTED_RAILS_BROWSER : [];
  await step(SUDO, ["-n", "/usr/bin/apt-get", SNAPSHOT, "update"]);
  await step(SUDO, [
    "-n",
    "/usr/bin/apt-get",
    SNAPSHOT,
    "install",
    "--yes",
    "--no-install-recommends",
    `libmariadb-dev=${CLIENT}`,
    `libmariadb-dev-compat=${CLIENT}`,
    ...libraries,
  ]);
  return libraries;
}

/** Caller authentication precedes this fixed route; signed policy is rechecked before all side effects. */
export async function prepareRailsTools(context, root, env, profile) {
  assertRuntimeBinding(context.proposal, context.policy);
  required(
    canonicalJson(railsRuntime(context.policy)) === canonicalJson(profile),
    "original runtime profile differs"
  );
  hostedPlatform();
  const environment = toolEnvironment(root, env);
  const step = (command, args, maximum = 3145728) =>
    runProcess(command, args, {
      cwd: context.cwd,
      env: environment,
      timeout: runtimeTime(context.deadline, 1800000),
      maximum,
    });
  const ruby = await qualifyRailsRuby(environment, context.deadline);
  const libraries = await installRailsPackages(step, profile.browser);
  const client = await qualifyRailsClient(step);
  for (const library of libraries) {
    const [name, expected] = library.split("=");
    const version = await step("/usr/bin/dpkg-query", [
      "-W",
      "-f=${Version}\n",
      name,
    ]);
    required(
      version.stdout.toString() === `${expected}\n`,
      "native browser library version differs"
    );
  }
  if (libraries.length) {
    const verified = await step("/usr/bin/dpkg", [
      "--verify",
      ...libraries.map(value => value.split("=")[0]),
    ]);
    required(
      verified.stdout.length === 0,
      "native browser library bytes differ"
    );
  }
  const docker = await prepareDocker(root, profile, step, context.deadline);
  const chrome = profile.browser
    ? await browser(root, step, context.deadline)
    : {};
  return {
    docker,
    client,
    ruby,
    env: {
      ...environment,
      ...chrome,
      PATH: `${dirname(docker.path)}:${dirname(ruby.ruby.path)}:${dirname(ruby.bundle.path)}:${environment.PATH}`,
      DOCKER_CONFIG: docker.env.DOCKER_CONFIG,
      BUNDLE_BUILD__MYSQL2: "--with-mysql-config=/usr/bin/mariadb_config",
    },
  };
}
