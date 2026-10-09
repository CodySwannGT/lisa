// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Pending allocation, owned mutations and cleanup share the original absolute phase. */
import { randomBytes } from "node:crypto";
import { required } from "./npm-update-contract.mjs";
import {
  runtimeTime,
  assertDockerQualified,
} from "./npm-update-rails-tool-identity.mjs";
import {
  createMysqlStorage,
  assertMysqlRoot,
} from "./npm-update-rails-mysql-storage.mjs";
import { createMysqlDaemon } from "./npm-update-rails-mysql-daemon.mjs";
export { assertMysqlRoot } from "./npm-update-rails-mysql-storage.mjs";
export { mysqlFailure } from "./npm-update-rails-mysql-daemon.mjs";

const IMAGE =
  "mysql@sha256:80f4933e3835f9dc4d35a28ec500d7986cb4414e6c6821c5461239cb7beb8995";

async function allocate(daemon, storage, state) {
  await daemon.qualifyImage();
  const mounts = storage.files.flatMap(file => [
    "--mount",
    `type=bind,src=${file.file},dst=/run/lisa-${file.name},readonly`,
  ]);
  state.pending = true;
  const created = await daemon.call([
    "create",
    "--platform",
    "linux/amd64",
    "--name",
    state.name,
    "--label",
    `lisa.npm.mysql=${state.nonce}`,
    "--publish",
    "127.0.0.1::3306",
    ...mounts,
    "--mount",
    "type=tmpfs,dst=/var/lib/mysql,tmpfs-mode=0700",
    "--env",
    "MYSQL_ROOT_PASSWORD_FILE=/run/lisa-root-password",
    IMAGE,
    "--partial-revokes=ON",
  ]);
  const id = created.stdout.toString().trim();
  required(/^[a-f0-9]{64}$/.test(id), "MySQL native create identity malformed");
  state.containerId = id;
  state.pending = false;
  await daemon.inspect(id);
  await daemon.call(["start", id]);
  required(
    (await daemon.inspect(id))?.running === true,
    "MySQL owned container is not running"
  );
}

async function closeResource(daemon, storage, state, before, deadline) {
  const cleanupDeadline = Math.min(deadline, Date.now() + 10000);
  runtimeTime(cleanupDeadline);
  const observed =
    state.pending || state.containerId
      ? await daemon.inspect(state.containerId ?? state.name, cleanupDeadline)
      : null;
  if (observed) {
    if (observed.running)
      await daemon.call(
        ["stop", "--time", "1", observed.id],
        undefined,
        [0],
        cleanupDeadline
      );
    const stopped = await daemon.inspect(observed.id, cleanupDeadline);
    required(stopped && !stopped.running, "MySQL owned container did not stop");
    await daemon.call(
      ["container", "rm", stopped.id],
      undefined,
      [0],
      cleanupDeadline
    );
    required(
      (await daemon.inspect(stopped.id, cleanupDeadline)) === null &&
        (await daemon.inspect(state.name, cleanupDeadline)) === null,
      "MySQL owned container remains"
    );
  }
  const after = await daemon.census(cleanupDeadline);
  required(
    before.every(id => after.includes(id)),
    "MySQL foreign daemon census changed"
  );
  state.foreignPreserved = true;
  storage.remove();
  state.closed = true;
}

/** One pending authority recovers lost native replies; cleanup failure never hides opening failure. */
export async function openMysqlResource({
  root,
  deadline,
  docker,
  user,
  password,
}) {
  required(
    /^lisa_[a-f0-9]{24}$/.test(user) && /^[a-f0-9]{64}$/.test(password),
    "MySQL synthetic account identity differs"
  );
  runtimeTime(deadline);
  assertMysqlRoot(root);
  await assertDockerQualified(docker, deadline);
  const nonce = randomBytes(32).toString("hex");
  const state = {
    nonce,
    name: `lisa-npm-mysql-${nonce}`,
    image: IMAGE,
    pending: false,
    containerId: null,
    imageId: null,
    port: null,
    closed: false,
    foreignPreserved: false,
  };
  const storage = createMysqlStorage(
    root,
    { nonce, name: state.name, image: IMAGE },
    user,
    password
  );
  const daemon = createMysqlDaemon(docker, storage, state, deadline);
  let before = [];
  let closing;
  const close = () =>
    (closing ??= closeResource(daemon, storage, state, before, deadline));
  try {
    before = await daemon.census();
    await allocate(daemon, storage, state);
    return {
      state,
      close,
      async query(sql, application = false) {
        required(
          !state.closed &&
            (await daemon.inspect(state.containerId))?.running === true,
          "MySQL query ownership is not running"
        );
        const result = await daemon.call(
          [
            "exec",
            "-i",
            state.containerId,
            "mysql",
            `--defaults-extra-file=/run/lisa-${application ? "app" : "admin"}.cnf`,
            "--batch",
            "--raw",
            "--skip-column-names",
          ],
          sql
        );
        return result.stdout.toString();
      },
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "MySQL open and owned cleanup failed",
        { cause: error }
      );
    }
    throw error;
  }
}
