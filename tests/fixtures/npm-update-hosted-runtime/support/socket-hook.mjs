/** A real owned Unix socket exercises nested hook scratch without granting provider or browser credit. */
import { createServer } from "node:net";
import { lstatSync, mkdirSync, realpathSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";

const {
  LISA_SCRATCH_ROOT: root,
  LISA_SCRATCH_TOKEN: token,
  TMPDIR: inheritedTemporary,
  HOME: home,
} = process.env;
if (!root) throw new Error("original owned scratch root is absent");
const temporary = join(root, "tmp");
if (
  inheritedTemporary !== temporary ||
  realpathSync(temporary) !== temporary ||
  !/^[a-f0-9]{64}$/.test(token ?? "") ||
  lstatSync(temporary).uid !== process.getuid()
)
  throw new Error("original owned scratch authority is absent");
const directory = join(temporary, "12345678");
const socket = join(directory, "s".repeat(31));
mkdirSync(directory, { mode: 0o700 });
const directoryIdentity = lstatSync(directory);
const witness = {
  root,
  home,
  tokenBytes: token.length / 2,
  temporaryBytes: Buffer.byteLength(temporary),
  socketBytes: Buffer.byteLength(socket),
  nativeBind: false,
  socketAbsent: false,
};
const server = createServer();
/** Refuse pathname replacement before removing the exclusively created empty directory. */
function removeDirectory() {
  const actual = lstatSync(directory);
  if (
    actual.dev !== directoryIdentity.dev ||
    actual.ino !== directoryIdentity.ino ||
    !actual.isDirectory() ||
    actual.isSymbolicLink()
  )
    throw new Error("owned socket directory identity differs");
  rmdirSync(directory);
}
// The retained native RED already observed libuv's overlong-path truncation.
// Future refusal controls never ask it to create a guessed sibling socket.
if (witness.socketBytes > (process.platform === "darwin" ? 103 : 107)) {
  removeDirectory();
  process.stdout.write(JSON.stringify({ ...witness, code: "ENAMETOOLONG" }));
  process.exitCode = 1;
} else {
  server.once("error", error => {
    removeDirectory();
    process.stdout.write(JSON.stringify({ ...witness, code: error.code }));
    process.exitCode = 1;
  });
  server.listen(socket, () => {
    const state = {};
    try {
      if (!lstatSync(socket).isSocket() || dirname(socket) !== directory)
        throw new Error("native socket identity differs");
      witness.nativeBind = true;
    } catch (error) {
      state.failure = error;
    }
    server.close(() => {
      try {
        lstatSync(socket);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        witness.socketAbsent = true;
      }
      if (!witness.socketAbsent) throw new Error("owned socket remains");
      removeDirectory();
      process.stdout.write(
        JSON.stringify({ ...witness, code: state.failure?.code })
      );
      if (state.failure) process.exitCode = 1;
    });
  });
}
