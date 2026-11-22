/** Nonblocking startup adapter; the engine also serves apply/doctor/health. */
try {
  const { ensureRailsHooks } = await import("./rails-hooks.mjs");
  const result = await ensureRailsHooks(process.cwd());
  if (result.status === "failed") process.stderr.write(`${result.detail}\n`);
} catch {
  process.stderr.write(
    "Rails Git hooks could not be installed; run bundle exec lefthook install.\n"
  );
}
