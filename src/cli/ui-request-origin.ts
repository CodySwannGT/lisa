/**
 * Restrict origins to the exact loopback authority advertised by `lisa ui`.
 * @param origin - Incoming Origin header
 * @param host - Incoming Host header
 * @returns Whether origin exactly matches the loopback listener
 */
export function isExpectedLoopbackOrigin(
  origin: string | undefined,
  host: string | undefined
): boolean {
  if (origin === undefined || host === undefined) return false;
  try {
    const parsed = new URL(origin);
    return (
      origin === parsed.origin &&
      parsed.protocol === "http:" &&
      parsed.host === host &&
      isLoopbackHost(parsed.host)
    );
  } catch {
    return false;
  }
}

/**
 * Match the config writer's accepted 127.0.0.1 authority shape.
 * @param host - URL authority to inspect
 * @returns Whether the authority is valid loopback
 */
function isLoopbackHost(host: string): boolean {
  if (host === "127.0.0.1") return true;
  const prefix = "127.0.0.1:";
  if (!host.startsWith(prefix)) return false;
  const portText = host.slice(prefix.length);
  const digitsOnly = Array.from(portText).every(
    character => character >= "0" && character <= "9"
  );
  const port = Number(portText);
  return (
    portText.length > 0 &&
    portText.length <= 5 &&
    digitsOnly &&
    port > 0 &&
    port <= 65_535
  );
}
