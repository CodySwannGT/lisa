#!/usr/bin/env node
/** Resolve the Expo pilot's credential inside its GitHub Actions job. */
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

import { get, readConfig } from "./resolve-secret.mjs";
import { ENV_KEY } from "./providers.mjs";
import {
  BIN_DIR,
  ensureOnPath,
  loadPinnedInstaller,
} from "../../lisa-setup-workstation/scripts/cli.mjs";
import {
  installEntry,
  planProvider,
  resolveProvider,
} from "../../lisa-setup-workstation/scripts/workstation.mjs";

/** Provision only the selected provider, using the existing pinned installer. */
async function prepareProvider(name) {
  const provider = resolveProvider(name);
  let plan = planProvider(provider);
  if (plan.action === "present") return;
  ensureOnPath(BIN_DIR);
  plan = planProvider(provider);
  if (plan.action === "present") return;
  if (plan.action !== "install") throw new Error("Provider needs setup");
  const installed = installEntry({ ...provider, name: provider.binary }, plan, {
    installPinned: await loadPinnedInstaller(),
  });
  if (installed.action !== "installed")
    throw new Error("Provider setup failed");
}

/** Keep the bootstrap inside this subprocess; export only the selected value. */
async function resolveToken() {
  const explicit = process.env.EXPO_TOKEN;
  const bootstrap = process.env.LISA_SECRETS_BOOTSTRAP;
  delete process.env.LISA_SECRETS_BOOTSTRAP;
  if (explicit) return explicit;

  process.env.LISA_SECRETS_SURFACE = "github-actions";
  const cfg = readConfig();
  if (cfg.provider === "env") return "";
  if (
    bootstrap &&
    (!ENV_KEY.test(cfg.bootstrap.key ?? "") ||
      cfg.bootstrap.key === "EXPO_TOKEN")
  ) {
    throw new Error("Invalid bootstrap key");
  }
  await prepareProvider(cfg.provider);
  if (bootstrap) process.env[cfg.bootstrap.key] = bootstrap;
  return get("EXPO_TOKEN", cfg);
}

if (process.argv.includes("--help")) {
  // Safe to inspect without preparing a provider or reading/exporting a token.
  console.log("Environment: EXPO_TOKEN LISA_SECRETS_BOOTSTRAP GITHUB_ENV");
  console.log(
    "An explicit EXPO_TOKEN takes precedence; otherwise resolve through the configured provider and export only EXPO_TOKEN to GITHUB_ENV."
  );
} else
  try {
    const destination = process.env.GITHUB_ENV;
    if (!destination) throw new Error("GITHUB_ENV is required");
    const token = await resolveToken();
    if (token) {
      const masked = token
        .replaceAll("%", "%25")
        .replaceAll("\r", "%0D")
        .replaceAll("\n", "%0A");
      console.log(`::add-mask::${masked}`);
      const delimiter = randomUUID();
      appendFileSync(
        destination,
        `EXPO_TOKEN<<${delimiter}\n${token}\n${delimiter}\n`
      );
    }
  } catch {
    // Provider errors can contain captured subprocess output. Never echo it.
    console.error(
      "Unable to resolve EXPO_TOKEN. Check the configured provider, bootstrap input, and secrets.require; ensure the runner can install its provider CLI."
    );
    process.exitCode = 1;
  }
