// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Selected native daemon observations never expose container environment or credentials. */
import { required } from "./npm-update-contract.mjs";
import { runProcess } from "./npm-update-process-core.mjs";
import { createHash } from "node:crypto";
import { publicFailure } from "./npm-update-invariants.mjs";
import {
  assertDockerQualified,
  runtimeTime,
} from "./npm-update-rails-tool-identity.mjs";

const FIELDS =
  "{{json .Id}}\t{{json .Name}}\t{{json .Config.Labels}}\t{{json .Image}}\t{{json .State.Running}}\t{{json .Mounts}}\t{{json .NetworkSettings.Ports}}";
const fields = bytes =>
  bytes
    .toString()
    .trim()
    .split("\t")
    .map(value => JSON.parse(value));

const COMMAND_PHASES = Object.freeze({
  pull: "Docker pull",
  image: "Docker image",
  ps: "Docker census",
  create: "Docker create",
  start: "Docker start",
  stop: "Docker stop",
  container: "Docker container",
  exec: "MySQL query",
});
const PHASES = new Set([
  "command",
  "Rails prepare",
  ...Object.values(COMMAND_PHASES),
]);

/** Data descriptors avoid invoking an unknown error's getters while retaining bounded native buffers. */
export function mysqlErrorData(error, name) {
  return error !== null &&
    (typeof error === "object" || typeof error === "function")
    ? Object.getOwnPropertyDescriptor(error, name)?.value
    : undefined;
}

function captureFingerprint(value) {
  return Buffer.isBuffer(value) && value.length <= 3145728
    ? Object.freeze({
        bytes: value.length,
        sha256: createHash("sha256").update(value).digest("hex"),
      })
    : null;
}

/** Only typed status and hashes leave a native failure; its original capture stays in memory. */
export function mysqlObservation(error, phase) {
  required(PHASES.has(phase), "MySQL native diagnostic phase differs");
  const code = mysqlErrorData(error, "code");
  const native = publicFailure(error);
  return Object.freeze({
    phase,
    status: Number.isInteger(code) && code >= 0 && code <= 255 ? code : null,
    signal: /\bsignal=(SIG[A-Z]+)\b/.exec(native)?.[1] ?? null,
    native,
    stdout: captureFingerprint(mysqlErrorData(error, "stdout")),
    stderr: captureFingerprint(mysqlErrorData(error, "stderr")),
  });
}

/** Native failure status is useful; SQL, credentials, capture and argv are never diagnostics. */
export function mysqlFailure(error, stage, phase = stage) {
  required(
    stage === "command" || stage === "Rails prepare",
    "MySQL native diagnostic stage differs"
  );
  const observation = mysqlObservation(error, phase);
  return Object.assign(
    new Error(`npm updater: MySQL native ${stage} failed`, { cause: error }),
    {
      code: observation.status,
      observation,
    }
  );
}

function ownedContainer(values, state) {
  const [id, name, labels, imageId, running] = values;
  required(
    values.length === 7 &&
      /^[a-f0-9]{64}$/.test(id) &&
      name === `/${state.name}` &&
      Object.keys(labels).join(",") === "lisa.npm.mysql" &&
      labels["lisa.npm.mysql"] === state.nonce &&
      imageId === state.imageId &&
      (state.containerId === null || id === state.containerId) &&
      typeof running === "boolean",
    "MySQL container ownership differs"
  );
  return { id, running };
}

function ownedMounts(mounts, storage) {
  const expected = storage.files.map(file => ({
    Type: "bind",
    Source: file.file,
    Destination: `/run/lisa-${file.name}`,
    RW: false,
  }));
  required(
    Array.isArray(mounts) &&
      mounts.length === 4 &&
      expected.every(want =>
        mounts.some(actual =>
          Object.entries(want).every(([key, value]) => actual[key] === value)
        )
      ) &&
      mounts.some(
        mount =>
          mount.Type === "tmpfs" && mount.Destination === "/var/lib/mysql"
      ),
    "MySQL container mount ownership differs"
  );
}

function ownedPort(ports, state) {
  const bindings = ports?.["3306/tcp"];
  required(
    ports &&
      Object.keys(ports).every(
        key => key === "3306/tcp" || ports[key] === null
      ) &&
      Array.isArray(bindings) &&
      bindings.length === 1 &&
      bindings[0].HostIp === "127.0.0.1" &&
      /^[1-9]\d{0,4}$/.test(bindings[0].HostPort) &&
      Number(bindings[0].HostPort) <= 65535 &&
      (state.port === null || state.port === bindings[0].HostPort),
    "MySQL private loopback port differs"
  );
  state.port = bindings[0].HostPort;
}

async function inspectContainer(call, target, state, storage, deadline) {
  const result = await call(
    ["container", "inspect", target, "--format", FIELDS],
    undefined,
    [0, 1],
    deadline
  );
  if (result.code === 1) {
    required(
      (result.stdout.length === 0 || result.stdout.equals(Buffer.from("\n"))) &&
        result.stderr.toString().trim() ===
          `Error response from daemon: No such container: ${target}`,
      "MySQL container absence is unproved"
    );
    return null;
  }
  const values = fields(result.stdout);
  const observed = ownedContainer(values, state);
  ownedMounts(values[5], storage);
  if (observed.running) ownedPort(values[6], state);
  return observed;
}

/** Every command rechecks immutable client, private storage and the same daemon/phase. */
export function createMysqlDaemon(docker, storage, state, deadline) {
  const call = async (args, input, allowed = [0], limit = deadline) => {
    storage.validate();
    await assertDockerQualified(docker, limit);
    try {
      return await runProcess(docker.path, args, {
        env: docker.env,
        input,
        allowed,
        timeout: runtimeTime(limit, args[0] === "pull" ? 1800000 : 10000),
        maximum: 262144,
      });
    } catch (error) {
      throw mysqlFailure(error, "command", COMMAND_PHASES[args[0]]);
    }
  };
  return {
    call,
    inspect: (target, limit = deadline) =>
      inspectContainer(call, target, state, storage, limit),
    async census(limit = deadline) {
      const result = await call(
        ["ps", "-aq", "--no-trunc"],
        undefined,
        [0],
        limit
      );
      const ids = result.stdout.toString().trim().split(/\s+/).filter(Boolean);
      required(
        ids.length <= 10000 && ids.every(id => /^[a-f0-9]{64}$/.test(id)),
        "MySQL daemon census is invalid"
      );
      return ids;
    },
    async qualifyImage() {
      await call(["pull", "--platform", "linux/amd64", state.image]);
      const image = fields(
        (
          await call([
            "image",
            "inspect",
            state.image,
            "--format",
            "{{json .Id}}\t{{json .Os}}\t{{json .Architecture}}\t{{json .RepoDigests}}",
          ])
        ).stdout
      );
      required(
        image.length === 4 &&
          /^sha256:[a-f0-9]{64}$/.test(image[0]) &&
          image[1] === "linux" &&
          image[2] === "amd64" &&
          Array.isArray(image[3]) &&
          image[3].includes(state.image),
        "MySQL immutable image platform differs"
      );
      state.imageId = image[0];
    },
  };
}
