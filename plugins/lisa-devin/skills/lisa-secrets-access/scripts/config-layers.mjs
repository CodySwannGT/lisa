/** Pure shared config merge and safe, typed configuration failures. */
export class AccessFailure extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
export const plainObject = value =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Existing merge API: objects merge; arrays/scalars replace; unsafe keys drop. */
export function mergeConfigLayers(...layers) {
  const objects = layers.filter(plainObject);
  return Object.fromEntries(
    [...new Set(objects.flatMap(Object.keys))]
      .filter(key => !UNSAFE.has(key))
      .map(key => {
        const values = objects
          .filter(layer => Object.hasOwn(layer, key))
          .map(layer => layer[key]);
        const top = values.at(-1);
        return [
          key,
          plainObject(top)
            ? mergeConfigLayers(...values.filter(plainObject))
            : top,
        ];
      })
  );
}

/** Readiness refuses dangerous parsed inputs rather than silently accepting them. */
export function validateConfigLayer(value) {
  if (!plainObject(value)) throw new AccessFailure("config-invalid");
  function visit(node) {
    if (node && typeof node === "object")
      for (const key of Object.keys(node)) {
        if (UNSAFE.has(key)) throw new AccessFailure("config-invalid");
        visit(node[key]);
      }
  }
  visit(value);
  for (const field of [
    "secrets",
    "github",
    "notion",
    "linear",
    "atlassian",
    "jira",
    "gitguardian",
    "sentry",
    "posthog",
    "jam",
    "sonarcloud",
  ]) {
    if (value[field] !== undefined && !plainObject(value[field]))
      throw new AccessFailure("config-invalid");
  }
  for (const field of ["tracker", "source"]) {
    if (
      value[field] !== undefined &&
      !["github", "jira", "linear", "notion", "confluence"].includes(
        value[field]
      )
    )
      throw new AccessFailure("config-unknown");
  }
  const secrets = value.secrets ?? {};
  if (
    secrets.provider !== undefined &&
    !["env", "bitwarden", "doppler", "1password", "aws", "vault"].includes(
      secrets.provider
    )
  )
    throw new AccessFailure("config-unknown");
  if (
    secrets.surface !== undefined &&
    ![
      "local",
      "github-actions",
      "codex-cloud",
      "claude-web",
      "container",
    ].includes(secrets.surface)
  )
    throw new AccessFailure("config-unknown");
  if (secrets.bootstrap !== undefined && !plainObject(secrets.bootstrap))
    throw new AccessFailure("config-invalid");
  if (secrets.narrow !== undefined && !plainObject(secrets.narrow))
    throw new AccessFailure("config-invalid");
  const names = list =>
    Array.isArray(list) &&
    list.every(
      name => typeof name === "string" && /^[A-Z_][A-Z0-9_]*$/.test(name)
    );
  const required = secrets.require;
  if (
    required !== undefined &&
    required !== null &&
    !(
      names(required) ||
      (plainObject(required) &&
        Object.entries(required).every(
          ([key, list]) =>
            [
              "all",
              "local",
              "github-actions",
              "codex-cloud",
              "claude-web",
              "container",
            ].includes(key) && names(list)
        ))
    )
  )
    throw new AccessFailure("config-invalid");
  if (
    secrets.bootstrap?.sources !== undefined &&
    (!Array.isArray(secrets.bootstrap.sources) ||
      !secrets.bootstrap.sources.every(s => ["env", "keychain"].includes(s)))
  )
    throw new AccessFailure("config-invalid");
  if (
    secrets.bootstrap?.key !== undefined &&
    secrets.bootstrap.key !== null &&
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(secrets.bootstrap.key)
  )
    throw new AccessFailure("config-invalid");
  for (const field of ["projectIds", "excludeKeys"])
    if (
      secrets.narrow?.[field] !== undefined &&
      (!Array.isArray(secrets.narrow[field]) ||
        !secrets.narrow[field].every(v => typeof v === "string"))
    )
      throw new AccessFailure("config-invalid");
  return value;
}
