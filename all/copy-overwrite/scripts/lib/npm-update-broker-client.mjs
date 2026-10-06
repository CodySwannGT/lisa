// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Bounded native socket transport supplies a fixed recipe ID, never executable authority or credentials. */
import { createConnection } from "node:net";
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { required, keys } from "./npm-update-contract.mjs";

function brokerPath(context, recipe) {
  keys(context, ["root", "path", "deadline"]);
  const root = lstatSync(context.root);
  const socket = lstatSync(context.path);
  required(
    root.isDirectory() &&
      !root.isSymbolicLink() &&
      realpathSync(context.root) === context.root &&
      root.uid === process.getuid() &&
      (root.mode & 0o077) === 0 &&
      context.path === join(context.root, "controller.sock") &&
      socket.isSocket() &&
      socket.uid === process.getuid() &&
      (socket.mode & 0o077) === 0,
    "broker pathname ownership differs"
  );
  required(
    typeof recipe === "string" &&
      /^[a-zA-Z0-9-]{1,128}$/.test(recipe) &&
      Number.isSafeInteger(context.deadline) &&
      context.deadline > Date.now() &&
      context.deadline <= Date.now() + 1_800_000,
    "invalid broker request or lifetime"
  );
  return context.path;
}

function nativeResult(bytes) {
  const text = new TextDecoder("utf8", { fatal: true }).decode(bytes);
  const result = JSON.parse(text);
  required(text === `${JSON.stringify(result)}\n`, "ambiguous broker response");
  required(result.ok === true, "controller request refused");
  keys(result, ["ok", "code", "stdout", "stderr"]);
  required(
    Number.isInteger(result.code) &&
      result.code >= 0 &&
      result.code <= 255 &&
      [result.stdout, result.stderr].every(
        value =>
          typeof value === "string" && /^[A-Za-z0-9+/]*={0,2}$/.test(value)
      ),
    "invalid broker native result"
  );
  const stdout = Buffer.from(result.stdout, "base64");
  const stderr = Buffer.from(result.stderr, "base64");
  required(
    stdout.toString("base64") === result.stdout &&
      stderr.toString("base64") === result.stderr &&
      stdout.length + stderr.length <= 8_388_608,
    "broker capture differs or exceeds bound"
  );
  return { code: result.code, stdout, stderr };
}

/** The server's immutable recipe owns full stdin and all subprocess options. */
export async function invokeControllerRecipe(context, recipe) {
  const path = brokerPath(context, recipe);
  return new Promise((resolve, reject) => {
    const socket = createConnection(path);
    const chunks = [];
    let size = 0;
    const timer = setTimeout(
      () => socket.destroy(new Error("controller phase expired")),
      context.deadline - Date.now()
    );
    socket.on("connect", () => socket.end(`${JSON.stringify({ recipe })}\n`));
    socket.on("data", chunk => {
      size += chunk.length;
      if (size > 11_185_000)
        socket.destroy(new Error("broker response exceeds capture bound"));
      else chunks.push(chunk);
    });
    socket.on("error", reject);
    socket.on("close", () => clearTimeout(timer));
    socket.on("end", () => {
      try {
        resolve(nativeResult(Buffer.concat(chunks)));
      } catch (error) {
        reject(error);
      }
    });
  });
}
