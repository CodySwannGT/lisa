/** Explicit native-shaped API data for the opt-in controlled provider. */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const ESCAPE_FLAG = "--allow-escape-sequences";

/**
 * Serve only declared fixture resources; unsupported calls remain observable.
 * @param args - Exact native CLI argument vector.
 * @param env - Owned fixture transport configuration.
 * @param state - Native state changed only by recorded operations.
 * @param io - Where output goes and stdin comes from: the real process
 *   streams when the fake runs as an executable, captured buffers when a
 *   suite runs it in-process (see work-item-stateful-gh-core.mjs).
 * @returns Whether this explicit provider resource was handled.
 */
export function serveProviderApi(args, env, state, io) {
  if (!env.FAKE_GH_API_FILE) return false;
  const table = JSON.parse(readFileSync(env.FAKE_GH_API_FILE, "utf8"));
  const repository = env.FAKE_GH_REPOSITORY ?? "acme/code";
  const root = `repos/${repository}`;
  const send = value => io.out(`${JSON.stringify(value)}\n`);
  const assets = () =>
    JSON.parse(readFileSync(env.FAKE_GH_ASSET_INDEX, "utf8"));
  const selected = table[JSON.stringify(args)];
  const row = selected?.sequence
    ? selected.sequence[
        Math.min(selected.reads ?? 0, selected.sequence.length - 1)
      ]
    : selected;
  if (selected?.sequence) {
    const index = selected.reads ?? 0;
    selected.reads = index + 1;
    writeFileSync(env.FAKE_GH_API_FILE, JSON.stringify(table));
  }
  // `FAKE_GH_ESCAPE_MODE` models the two gh behaviours around raw bodies
  // (CodySwannGT/lisa#4773): "unknown-flag" is gh < 2.97, which rejects
  // `--allow-escape-sequences`; "refuse-escapes" is gh >= 2.97, which refuses
  // a raw body without it. The latter refuses every raw download, not only
  // ESC-bearing ones — stricter than gh, so the flag is proven always sent.
  if (
    env.FAKE_GH_ESCAPE_MODE === "unknown-flag" &&
    args.includes(ESCAPE_FLAG)
  ) {
    io.err(
      `unknown flag: ${ESCAPE_FLAG}\n\nUsage:  gh api <endpoint> [flags]\n`
    );
    io.fail(1);
    return true;
  }
  if (row) {
    if (row.concurrentState) {
      Object.assign(state, row.concurrentState);
      writeFileSync(env.FAKE_GH_STATE_FILE, JSON.stringify(state));
    }
    if (row.failure) {
      io.err(row.failure);
      io.fail(1);
    } else if (row.kind === "comments") send([state.comments ?? []]);
    else if (row.kind === "assets") send([assets()]);
    else if (row.file) io.out(readFileSync(row.file));
    else send(row.json);
    return true;
  }
  // Any evidence release: the publisher uploads to the configured tag, which
  // rotates (CodySwannGT/lisa#4692). The stored download URL carries that tag,
  // exactly as GitHub's does, so the validator's release check is exercised.
  if (args[0] === "release" && args[1] === "upload") {
    if (env.FAKE_GH_UPLOAD_FAILURE) {
      io.err(env.FAKE_GH_UPLOAD_FAILURE);
      io.fail(1);
      return true;
    }
    const tag = args[2];
    const bytes = readFileSync(args[3]);
    const index = assets();
    const id = Math.max(100, ...index.map(asset => asset.id)) + 1;
    const name = basename(args[3]);
    const metadata = {
      id,
      name,
      state: "uploaded",
      size: bytes.length,
      created_at: new Date().toISOString(),
      uploader: JSON.parse(env.FAKE_GH_PUBLISHER),
      browser_download_url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
    };
    writeFileSync(join(env.FAKE_GH_ASSET_DIRECTORY, `${id}.bin`), bytes);
    index.push(metadata);
    writeFileSync(env.FAKE_GH_ASSET_INDEX, JSON.stringify(index));
    io.out(`Uploaded ${name}\n`);
    return true;
  }
  const endpoint = args.find(value => value.startsWith("repos/"));
  const assetId = endpoint?.startsWith(`${root}/releases/assets/`)
    ? endpoint.slice(`${root}/releases/assets/`.length)
    : "";
  const asset = /^\d+$/.test(assetId) ? Number(assetId) : null;
  if (args[0] === "api" && asset) {
    const metadata = assets().find(value => value.id === asset);
    if (!metadata) return false;
    if (
      args.includes("Accept: application/octet-stream") &&
      env.FAKE_GH_ESCAPE_MODE === "refuse-escapes" &&
      !args.includes(ESCAPE_FLAG)
    ) {
      io.err(
        `the response contains terminal escape sequences; pass ${ESCAPE_FLAG} to output it anyway\n`
      );
      io.fail(1);
    } else if (args.includes("Accept: application/octet-stream"))
      io.out(
        readFileSync(join(env.FAKE_GH_ASSET_DIRECTORY, `${metadata.id}.bin`))
      );
    else send(metadata);
    return true;
  }
  if (
    args[0] === "api" &&
    args.includes("POST") &&
    endpoint === `${root}/issues/${state.number}/comments`
  ) {
    const payload = JSON.parse(io.stdin().toString("utf8"));
    const comment = {
      id: 1000 + (state.comments?.length ?? 0),
      body: payload.body,
      user: JSON.parse(env.FAKE_GH_PUBLISHER),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    state.comments ??= [];
    state.comments.push(comment);
    writeFileSync(env.FAKE_GH_STATE_FILE, JSON.stringify(state));
    send(comment);
    return true;
  }
  return false;
}
