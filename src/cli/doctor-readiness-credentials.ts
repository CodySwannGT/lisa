/**
 * Credential over-authority detection for the delivery/authority readiness
 * dimension — ship blocker B3 (PRD #1739, #1896).
 *
 * B3 asks whether the credential that ships carries only the authority it needs.
 * The question is answered offline from what the workflows *declare*, because a
 * credential's blast radius is a property of the declaration, not of any
 * particular run: a token granted `write-all` is over-authorized whether or not
 * today's run happened to use it.
 *
 * Four declarations are treated as material over-authority: inherited secrets
 * (`secrets: inherit` hands a called workflow everything), `write-all`/`read-all`
 * blanket permission grants, a job that uses the repository token with no
 * `permissions` block at all (so it takes the repository default rather than a
 * stated minimum), and static long-lived deployment credentials in jobs that
 * should use a scoped or federated credential instead. Each is provable from
 * the declaration alone.
 *
 * A fifth signal — one secret NAME appearing under several environments — is
 * reported as an *observation*, never a blocker: environment secrets are meant
 * to reuse one name per environment, and repository-scope versus
 * environment-scope is not decidable from YAML.
 *
 * It lives beside the delivery producer rather than inside it for file-size
 * hygiene — the same split the blocker gate and journey wiring already use.
 * @module cli/doctor-readiness-credentials
 */
import type {
  ParsedWorkflow,
  ParsedWorkflowJob,
  WorkflowBlock,
} from "./doctor-readiness-workflows.js";

/** Blanket permission scalars that grant far more than any one job needs. */
const BLANKET_PERMISSIONS = new Set(["write-all", "read-all"]);

/** Matches every `secrets.NAME` reference inside a job's declared text. */
const SECRET_REFERENCE = /secrets\.(\w+)/g;

/** Static credential names and inputs that keyless or scoped auth should replace. */
const STATIC_CREDENTIAL_KEYS = [
  "aws-access-key-id",
  "aws-secret-access-key",
  "NPM_TOKEN",
  "GCP_SERVICE_ACCOUNT_JSON",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AZURE_CREDENTIALS",
  "ADMIN_PAT",
  "BOT_ADMIN_PAT",
  "GH_ADMIN_PAT",
];

/** Static cloud credential inputs that OIDC (`id-token: write`) can replace. */
const OIDC_REPLACEABLE_KEYS = new Set([
  "aws-access-key-id",
  "aws-secret-access-key",
  "GCP_SERVICE_ACCOUNT_JSON",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AZURE_CREDENTIALS",
]);

/** Matches a repository-token reference in either of its spellings. */
const REPOSITORY_TOKEN = /\b(?:GITHUB_TOKEN|GH_TOKEN)\b|github\.token/;

/** One secret referenced by one deployment environment. */
interface SecretEnvironmentPair {
  readonly secret: string;
  readonly environment: string;
}

/**
 * Flatten every string a job declares — step commands, actions, `env`, and
 * `with` — into one searchable blob so a credential reference is found wherever
 * it is stated.
 * @param job - The parsed job
 * @returns Newline-joined declared text
 */
function jobText(job: ParsedWorkflowJob): string {
  return job.steps
    .flatMap(step => [step.run, step.uses, step.inputs])
    .filter(part => part !== "")
    .join("\n");
}

/**
 * Whether a permissions block grants OIDC token minting, which is what makes a
 * keyless cloud login possible.
 * @param permissions - A job- or workflow-level permissions block
 * @returns True when `id-token` is granted write
 */
function grantsOidc(permissions: WorkflowBlock): boolean {
  return (
    typeof permissions === "object" &&
    permissions !== null &&
    permissions["id-token"] === "write"
  );
}

/**
 * Report a blanket `write-all`/`read-all` grant at either scope.
 * @param scope - Human-readable scope label for the evidence line
 * @param permissions - The permissions block to inspect
 * @returns Evidence lines (empty when the grant is scoped)
 */
function blanketGrantViolations(
  scope: string,
  permissions: WorkflowBlock
): readonly string[] {
  if (typeof permissions === "string" && BLANKET_PERMISSIONS.has(permissions)) {
    return [
      `${scope} declares \`permissions: ${permissions}\`, granting every ` +
        "scope the repository token can carry instead of only what the job needs",
    ];
  }
  return [];
}

/**
 * Report an inherited secret block, which hands a called workflow every secret
 * the repository holds rather than the ones it needs.
 * @param where - Evidence location label
 * @param job - The parsed job
 * @returns Evidence lines (empty when secrets are mapped explicitly)
 */
function inheritedSecretViolations(
  where: string,
  job: ParsedWorkflowJob
): readonly string[] {
  return job.secrets === "inherit"
    ? [
        `${where} declares \`secrets: inherit\`, handing the called workflow ` +
          "every secret in the repository rather than the ones it needs",
      ]
    : [];
}

/**
 * Report a job that uses the repository token with no `permissions:` block at
 * either scope, so it runs at the repository default instead of a stated
 * minimum.
 * @param where - Evidence location label
 * @param workflow - The workflow declaring the job
 * @param job - The parsed job
 * @param text - The job's flattened declared text
 * @returns Evidence lines (empty when permissions are declared)
 */
function unscopedTokenViolations(
  where: string,
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob,
  text: string
): readonly string[] {
  const token = REPOSITORY_TOKEN.exec(text)?.[0];
  const unscoped =
    token !== undefined &&
    job.permissions === null &&
    workflow.permissions === null;
  return unscoped
    ? [
        `${where} uses ${token} with no \`permissions:\` block at either ` +
          "scope, so it runs with the repository default rather than a stated minimum",
      ]
    : [];
}

/**
 * Report static long-lived cloud keys in a job that could have authenticated
 * keylessly through OIDC.
 * @param where - Evidence location label
 * @param workflow - The workflow declaring the job
 * @param job - The parsed job
 * @param text - The job's flattened declared text
 * @returns Evidence lines (empty when the job is keyless or already OIDC-enabled)
 */
function staticKeyViolations(
  where: string,
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob,
  text: string
): readonly string[] {
  const oidcGranted =
    grantsOidc(job.permissions) || grantsOidc(workflow.permissions);
  const staticKey = STATIC_CREDENTIAL_KEYS.find(
    key =>
      text.includes(key) && !(oidcGranted && OIDC_REPLACEABLE_KEYS.has(key))
  );
  if (staticKey === undefined) {
    return [];
  }
  return [
    `${where} authenticates with the static long-lived credential ` +
      `\`${staticKey}\` instead of a scoped or federated deployment credential`,
  ];
}

/**
 * Detect per-job credential over-authority inside one workflow.
 * @param workflow - The parsed workflow
 * @param job - The job to inspect
 * @returns Evidence lines for this job (empty when scoped correctly)
 */
function jobCredentialViolations(
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob
): readonly string[] {
  const where = `${workflow.file} job \`${job.id}\``;
  const text = jobText(job);
  return [
    ...blanketGrantViolations(where, job.permissions),
    ...inheritedSecretViolations(where, job),
    ...unscopedTokenViolations(where, workflow, job, text),
    ...staticKeyViolations(where, workflow, job, text),
  ];
}

/**
 * Pair every secret reference with each deployment environment that uses it.
 * @param workflows - Parsed workflows
 * @returns One pair per (secret, environment) reference
 */
function secretEnvironmentPairs(
  workflows: readonly ParsedWorkflow[]
): readonly SecretEnvironmentPair[] {
  const jobs = workflows.flatMap(workflow => workflow.jobs);
  return jobs
    .filter(job => job.environment.length > 0)
    .flatMap(job => jobSecretEnvironmentPairs(job));
}

/**
 * Pair one job's secret references with the environments that job deploys to.
 * @param job - A job declaring at least one environment
 * @returns One pair per (secret, environment) reference in this job
 */
function jobSecretEnvironmentPairs(
  job: ParsedWorkflowJob
): readonly SecretEnvironmentPair[] {
  const secrets = [...jobText(job).matchAll(SECRET_REFERENCE)]
    .map(match => match[1] ?? "")
    // GITHUB_TOKEN is minted fresh per job per run, so it cannot be "shared"
    // between environments — reporting it as such is impossible by construction.
    .filter(secret => secret !== "GITHUB_TOKEN");
  return secrets.flatMap(secret =>
    job.environment.map(environment => ({ secret, environment }))
  );
}

/**
 * Sort and de-duplicate a list of names for stable evidence text.
 * @param names - Raw names
 * @returns Unique names in locale order
 */
function uniqueSorted(names: readonly string[]): readonly string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

/**
 * Note each secret NAME that appears under more than one deployment environment.
 *
 * This is informational, never a standing blocker. GitHub environment secrets
 * are *supposed* to reuse one name across environments — that is the recommended
 * least-privilege pattern, with a distinct value stored per environment — and
 * whether a given name resolves to a repository-scoped secret (genuinely shared)
 * or an environment-scoped one (correctly isolated) is not decidable from the
 * YAML. Blocking on it would fail correct repositories for doing the right thing.
 * @param workflows - Parsed workflows
 * @returns Observation lines (empty when no name is reused)
 */
function sharedSecretObservations(
  workflows: readonly ParsedWorkflow[]
): readonly string[] {
  const pairs = secretEnvironmentPairs(workflows);
  return uniqueSorted(pairs.map(pair => pair.secret)).flatMap(secret => {
    const environments = uniqueSorted(
      pairs.filter(pair => pair.secret === secret).map(pair => pair.environment)
    );
    return environments.length > 1
      ? [
          `secret name \`${secret}\` appears under ${environments.length} ` +
            `deployment environments (${environments.join(", ")}). If it is an ` +
            "environment-scoped secret this is the recommended pattern; if it " +
            "is repository-scoped, one credential spans every environment. " +
            "Which one it is cannot be determined from the workflow files.",
        ]
      : [];
  });
}

/** The credential half of a delivery/authority assessment. */
export interface CredentialFindings {
  /** Provable over-authority: each line stands blocker B3. */
  readonly violations: readonly string[];
  /** Observations that are real but not decidable offline; never blocking. */
  readonly informational: readonly string[];
}

/**
 * Detect credential over-authority across the repository's workflows.
 *
 * Violations are ordered by consequence: blanket grants and inherited secrets
 * first (they are unbounded), then narrower over-authority. Anything the
 * workflow files cannot settle lands in `informational`, which carries no
 * `blocker` key and therefore can never flip a verdict.
 * @param workflows - Parsed workflows
 * @returns Violations and informational observations
 */
export function detectCredentialFindings(
  workflows: readonly ParsedWorkflow[]
): CredentialFindings {
  return {
    violations: [
      ...workflows.flatMap(workflow =>
        blanketGrantViolations(workflow.file, workflow.permissions)
      ),
      ...workflows.flatMap(workflow =>
        workflow.jobs.flatMap(job => jobCredentialViolations(workflow, job))
      ),
    ],
    informational: sharedSecretObservations(workflows),
  };
}
