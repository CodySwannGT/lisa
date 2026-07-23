/** Validation contract for the optional Kane browser provider config. */

/** Kane CLI empirical-browser provider configuration. */
export interface KaneBrowserConfig {
  readonly enabled?: boolean;
  readonly version?: string;
  readonly cloudUploadApproved?: boolean;
  readonly allowedEnvironments?: readonly string[];
  readonly projectId?: string;
  readonly folderId?: string;
  readonly timeoutSeconds?: number;
}

/** Browser-provider configuration nested under `verification`. */
export interface BrowserVerificationConfig {
  readonly kane?: KaneBrowserConfig;
}

/** Official SonarQube MCP provider configuration (single Sonar substrate). */
export interface SonarVerificationConfig {
  readonly enabled?: boolean;
  readonly edition?: "cloud" | "server";
  readonly organization?: string;
  readonly projectKey?: string;
  readonly serverUrl?: string;
}

/** Empirical verification provider configuration. */
export interface VerificationConfig {
  readonly browser?: BrowserVerificationConfig;
  readonly sonar?: SonarVerificationConfig;
}

const PRODUCTION_ENVIRONMENTS = new Set(["prod", "production"]);

/**
 * Detect ASCII control characters without a control-character regex.
 * @param value - Candidate string
 * @returns True when a control character is present
 */
function containsControlCharacter(value: string): boolean {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
}

/**
 * Validate an optional non-empty string.
 * @param value - Untrusted field value
 * @param source - Config source shown in errors
 * @param field - Dotted field name
 * @returns Valid string or undefined
 */
function optionalString(
  value: unknown,
  source: string,
  field: string
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    containsControlCharacter(value)
  ) {
    throw new Error(
      `Invalid ${field} in ${source}: expected a non-empty string`
    );
  }
  return value;
}

/**
 * Validate an optional boolean.
 * @param value - Untrusted field value
 * @param source - Config source shown in errors
 * @param field - Dotted field name
 * @returns Valid boolean or undefined
 */
function optionalBoolean(
  value: unknown,
  source: string,
  field: string
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`Invalid ${field} in ${source}: expected a boolean`);
  }
  return value;
}

/**
 * Validate the non-production allow-list.
 * @param value - Untrusted allow-list
 * @param source - Config source shown in errors
 * @returns Valid environment names or undefined
 */
function allowedEnvironments(
  value: unknown,
  source: string
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `Invalid verification.browser.kane.allowedEnvironments in ${source}: expected a non-empty string array`
    );
  }
  const environments = value.map((entry, index) =>
    optionalString(
      entry,
      source,
      `verification.browser.kane.allowedEnvironments[${String(index)}]`
    )
  );
  if (environments.some(environment => environment === undefined)) {
    throw new Error(
      `Invalid verification.browser.kane.allowedEnvironments in ${source}: expected strings`
    );
  }
  const normalized = environments as string[];
  if (
    normalized.some(environment =>
      PRODUCTION_ENVIRONMENTS.has(environment.toLowerCase())
    )
  ) {
    throw new Error(
      `Invalid verification.browser.kane.allowedEnvironments in ${source}: production is never permitted`
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(
      `Invalid verification.browser.kane.allowedEnvironments in ${source}: duplicate values are not allowed`
    );
  }
  return normalized;
}

/**
 * Validate the bounded provider timeout.
 * @param value - Untrusted timeout value
 * @param source - Config source shown in errors
 * @returns Valid seconds or undefined
 */
function optionalTimeout(value: unknown, source: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 600) {
    throw new Error(
      `Invalid verification.browser.kane.timeoutSeconds in ${source}: expected an integer from 1 to 600`
    );
  }
  return Number(value);
}

/**
 * Require an exact semantic version when a version is present.
 * @param version - Optional provider version
 * @param source - Config source shown in errors
 */
function assertExactVersion(version: string | undefined, source: string): void {
  if (version !== undefined && !/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(
      `Invalid verification.browser.kane.version in ${source}: expected an exact semantic version`
    );
  }
}

/**
 * Validate the optional Kane provider block.
 * @param value - Untrusted provider value
 * @param source - Config source shown in errors
 * @returns Valid provider config or undefined
 */
function validateKaneConfig(
  value: unknown,
  source: string
): KaneBrowserConfig | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Invalid verification.browser.kane in ${source}: expected an object`
    );
  }
  const input = value as Record<string, unknown>;
  const enabled = optionalBoolean(
    input.enabled,
    source,
    "verification.browser.kane.enabled"
  );
  const cloudUploadApproved = optionalBoolean(
    input.cloudUploadApproved,
    source,
    "verification.browser.kane.cloudUploadApproved"
  );
  const version = optionalString(
    input.version,
    source,
    "verification.browser.kane.version"
  );
  const environments = allowedEnvironments(input.allowedEnvironments, source);
  const projectId = optionalString(
    input.projectId,
    source,
    "verification.browser.kane.projectId"
  );
  const folderId = optionalString(
    input.folderId,
    source,
    "verification.browser.kane.folderId"
  );
  const timeoutSeconds = optionalTimeout(input.timeoutSeconds, source);
  assertExactVersion(version, source);
  return {
    ...(enabled === undefined ? {} : { enabled }),
    ...(version === undefined ? {} : { version }),
    ...(cloudUploadApproved === undefined ? {} : { cloudUploadApproved }),
    ...(environments === undefined
      ? {}
      : { allowedEnvironments: environments }),
    ...(projectId === undefined ? {} : { projectId }),
    ...(folderId === undefined ? {} : { folderId }),
    ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
  };
}

/**
 * Validate the optional SonarQube MCP provider config (single Sonar substrate).
 * @param value - Untrusted sonar value
 * @param source - Config source shown in errors
 * @returns Valid sonar config or undefined
 */
function validateSonarConfig(
  value: unknown,
  source: string
): SonarVerificationConfig | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Invalid verification.sonar in ${source}: expected an object`
    );
  }
  const input = value as Record<string, unknown>;
  const enabled = optionalBoolean(
    input.enabled,
    source,
    "verification.sonar.enabled"
  );
  const edition = optionalString(
    input.edition,
    source,
    "verification.sonar.edition"
  );
  if (edition !== undefined && edition !== "cloud" && edition !== "server") {
    throw new Error(
      `Invalid verification.sonar.edition in ${source}: expected "cloud" or "server"`
    );
  }
  const organization = optionalString(
    input.organization,
    source,
    "verification.sonar.organization"
  );
  const projectKey = optionalString(
    input.projectKey,
    source,
    "verification.sonar.projectKey"
  );
  const serverUrl = optionalString(
    input.serverUrl,
    source,
    "verification.sonar.serverUrl"
  );
  return {
    ...(enabled === undefined ? {} : { enabled }),
    ...(edition === undefined ? {} : { edition }),
    ...(organization === undefined ? {} : { organization }),
    ...(projectKey === undefined ? {} : { projectKey }),
    ...(serverUrl === undefined ? {} : { serverUrl }),
  };
}

/**
 * Validate the optional verification tree.
 * @param value - Untrusted verification value
 * @param source - Config source shown in errors
 * @returns Valid verification config or undefined
 */
export function validateVerificationConfig(
  value: unknown,
  source: string
): VerificationConfig | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid verification in ${source}: expected an object`);
  }
  const record = value as Record<string, unknown>;
  const sonar = validateSonarConfig(record.sonar, source);
  const sonarPart = sonar === undefined ? {} : { sonar };
  const browser = record.browser;
  if (browser === undefined) return sonarPart;
  if (
    browser === null ||
    typeof browser !== "object" ||
    Array.isArray(browser)
  ) {
    throw new Error(
      `Invalid verification.browser in ${source}: expected an object`
    );
  }
  const kane = validateKaneConfig(
    (browser as Record<string, unknown>).kane,
    source
  );
  return { browser: kane === undefined ? {} : { kane }, ...sonarPart };
}
