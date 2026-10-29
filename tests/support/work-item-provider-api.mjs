/** Explicit native-shaped API data for the opt-in controlled provider. */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Serve only declared fixture resources; unsupported calls remain observable.
 * @param args - Exact native CLI argument vector.
 * @param env - Owned fixture transport configuration.
 * @param state - Native state changed only by recorded operations.
 * @returns Whether this explicit provider resource was handled.
 */
export function serveProviderApi(args, env, state) {
  if (!env.FAKE_GH_API_FILE) return false;
  const table = JSON.parse(readFileSync(env.FAKE_GH_API_FILE, "utf8"));
  const repository = env.FAKE_GH_REPOSITORY ?? "acme/code";
  const root = `repos/${repository}`;
  const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
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
  if (row) {
    if (row.concurrentState) {
      Object.assign(state, row.concurrentState);
      writeFileSync(env.FAKE_GH_STATE_FILE, JSON.stringify(state));
    }
    if (row.failure) {
      process.stderr.write(row.failure);
      process.exitCode = 1;
    } else if (row.kind === "comments") send([state.comments ?? []]);
    else if (row.kind === "assets") send([assets()]);
    else if (row.file) process.stdout.write(readFileSync(row.file));
    else send(row.json);
    return true;
  }
  if (
    args[0] === "release" &&
    args[1] === "upload" &&
    args[2] === "pr-assets"
  ) {
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
      browser_download_url: `https://github.com/${repository}/releases/download/pr-assets/${name}`,
    };
    writeFileSync(join(env.FAKE_GH_ASSET_DIRECTORY, `${id}.bin`), bytes);
    index.push(metadata);
    writeFileSync(env.FAKE_GH_ASSET_INDEX, JSON.stringify(index));
    process.stdout.write(`Uploaded ${name}\n`);
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
    if (args.includes("Accept: application/octet-stream"))
      process.stdout.write(
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
    const payload = JSON.parse(readFileSync(0, "utf8"));
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
