/** Closed observations from the pinned Chrome 154 Linux sandbox status page. */
export const LAYER_ONE_TYPES = Object.freeze([
  "SUID",
  "Namespace",
  "None",
  "unreported",
]);

/**
 * Chrome 154 emits one Layer 1 Sandbox row instead of the former SUID Yes/No row.
 * @param {unknown} html Actual native page source, retained only privately.
 * @returns {{nativeSandboxVerified: boolean, layer1Sandbox: string, suidSandboxActive: boolean}} Closed sandbox observations.
 */
export function sandboxStatus(html) {
  const rows =
    typeof html === "string"
      ? [
          ...html.matchAll(
            /<tr[^>]*>\s*<td[^>]*>\s*Layer 1 Sandbox\s*<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<\/tr>/g
          ),
        ]
      : [];
  const value = rows.length === 1 ? rows[0][1].trim() : "unreported";
  const layer1Sandbox = LAYER_ONE_TYPES.includes(value) ? value : "unreported";
  return {
    nativeSandboxVerified:
      typeof html === "string" &&
      html.includes("You are adequately sandboxed.") &&
      !html.includes("You are NOT adequately sandboxed."),
    layer1Sandbox,
    suidSandboxActive: layer1Sandbox === "SUID",
  };
}
