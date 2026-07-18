/**
 * Pure join of ci.yml inputs, Lisa gate config, and secret presence for the
 * CI Quality jobs Active column.
 * @module cli/ui-ci-quality-jobs-compute
 */
import {
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "../sync/json-path.js";

/** Inputs the project's `ci.yml` forwards into Lisa's quality workflow. */
export interface CiWorkflowInputs {
  readonly skipJobs: readonly string[];
  readonly verifyEnforced: boolean;
  readonly complianceFramework: string;
  readonly requireApproval: boolean;
  readonly zapTargetUrl: string;
}

/** Presence-only secret inventory, or an honest unknown. */
export type RepoSecretsPresence =
  | { readonly state: "value"; readonly names: ReadonlySet<string> }
  | {
      readonly state: "unknown";
      readonly reason: string;
      readonly message: string;
    };

/** One Quality-jobs row for the Active column. */
export type CiQualityJobEntry = {
  readonly [key: string]: JsonValue;
  readonly id: string;
  readonly label: string;
  /** `true` active, `false` off, `null` unknown (never a false off). */
  readonly active: boolean | null;
  readonly reason: string;
};

/** Structured probe value for the Quality jobs table. */
export type CiQualityJobsValue = {
  readonly [key: string]: JsonValue;
  readonly jobs: CiQualityJobEntry[];
};

/** Catalog entry describing how one Quality job becomes active. */
interface QualityJobSpec {
  readonly id: string;
  readonly label: string;
  readonly secret?: string;
  readonly gate?:
    | "mutation"
    | "verify_enforced"
    | "compliance_framework"
    | "zap_target_url"
    | "require_approval";
}

/** Jobs shown in the console Quality jobs table, in display order. */
const QUALITY_JOB_SPECS: readonly QualityJobSpec[] = [
  { id: "lint", label: "🧹 Lint" },
  { id: "lint_slow", label: "🐢 Slow Lint Rules" },
  { id: "typecheck", label: "🔍 Type Check" },
  { id: "format", label: "📐 Check Formatting" },
  { id: "build", label: "🏗️ Build" },
  { id: "test:unit", label: "🧪 Run Unit Tests" },
  { id: "test:integration", label: "🧪 Run Integration Tests" },
  { id: "test:e2e", label: "🧪 Run E2E Tests" },
  { id: "playwright_e2e", label: "🎭 Playwright E2E Tests" },
  {
    id: "maestro_e2e",
    label: "📱 Maestro Cloud E2E",
    secret: "MAESTRO_API_KEY",
  },
  { id: "e2e_coverage", label: "🧭 E2E Route Coverage" },
  { id: "test:mutation", label: "🧬 Mutation Testing Gate", gate: "mutation" },
  {
    id: "verification_coverage",
    label: "✅ Verification Coverage",
    gate: "verify_enforced",
  },
  { id: "dead_code", label: "🗑️ Dead Code Detection" },
  { id: "sg_scan", label: "🔎 AST Grep Scan" },
  { id: "npm_security_scan", label: "🔒 Security Scan" },
  {
    id: "sonarcloud",
    label: "🔍 SonarCloud SAST",
    secret: "SONAR_TOKEN",
  },
  { id: "snyk", label: "🛡️ Snyk", secret: "SNYK_TOKEN" },
  {
    id: "secret_scanning",
    label: "🔐 GitGuardian",
    secret: "GITGUARDIAN_API_KEY",
  },
  {
    id: "license_compliance",
    label: "📜 FOSSA",
    secret: "FOSSA_API_KEY",
  },
  {
    id: "zap_baseline",
    label: "🕷️ OWASP ZAP Baseline",
    gate: "zap_target_url",
  },
  {
    id: "compliance_validation",
    label: "🧾 Compliance Validation",
    gate: "compliance_framework",
  },
  {
    id: "approval_gate",
    label: "🚦 Approval Gate",
    gate: "require_approval",
  },
];

/**
 * Read whether the mutation gate is enabled in merged Lisa config.
 * @param config - Merged config
 * @returns True only when explicitly enabled
 */
function mutationGateEnabled(config: JsonObject): boolean {
  if (!isJsonObject(config.quality)) {
    return false;
  }
  if (!isJsonObject(config.quality.mutation)) {
    return false;
  }
  if (!isJsonObject(config.quality.mutation.gate)) {
    return false;
  }
  return config.quality.mutation.gate.enabled === true;
}

/**
 * Resolve a config/workflow gate into an off-reason, or undefined when open.
 * @param gate - Gate kind on the job spec
 * @param inputs - ci.yml inputs
 * @param config - Merged Lisa config
 * @returns Off reason when the gate closes the job
 */
function gateOffReason(
  gate: QualityJobSpec["gate"],
  inputs: CiWorkflowInputs,
  config: JsonObject
): string | undefined {
  if (gate === "mutation" && !mutationGateEnabled(config)) {
    return "mutation gate is disabled";
  }
  if (gate === "verify_enforced" && !inputs.verifyEnforced) {
    return "verify_enforced is off";
  }
  if (
    gate === "compliance_framework" &&
    (inputs.complianceFramework.length === 0 ||
      inputs.complianceFramework === "none" ||
      inputs.complianceFramework === "(none)")
  ) {
    return "no compliance_framework configured";
  }
  if (gate === "zap_target_url" && inputs.zapTargetUrl.length === 0) {
    return "zap_target_url is not set";
  }
  if (gate === "require_approval" && !inputs.requireApproval) {
    return "require_approval is off";
  }
  return undefined;
}

/**
 * Resolve secret presence into active/off/unknown for one job.
 * @param secretName - Required Actions secret
 * @param secrets - Presence inventory or unknown
 * @returns Job active state and reason
 */
function secretActiveState(
  secretName: string,
  secrets: RepoSecretsPresence
): Pick<CiQualityJobEntry, "active" | "reason"> {
  if (secrets.state === "unknown") {
    return {
      active: null,
      reason:
        secrets.reason === "not-authenticated"
          ? "not authenticated"
          : secrets.message,
    };
  }
  if (!secrets.names.has(secretName)) {
    return {
      active: false,
      reason: `${secretName} secret is not set`,
    };
  }
  return { active: true, reason: "" };
}

/**
 * Join ci.yml inputs, gate config, and secret presence into Active-column rows.
 * @param inputs - Parsed ci.yml quality inputs
 * @param config - Merged Lisa config
 * @param secrets - Presence-only secret inventory
 * @returns Probe value for the Quality jobs table
 */
export function computeCiQualityJobs(
  inputs: CiWorkflowInputs,
  config: JsonObject,
  secrets: RepoSecretsPresence
): CiQualityJobsValue {
  const skipped = new Set(inputs.skipJobs);
  const jobs = QUALITY_JOB_SPECS.map((spec): CiQualityJobEntry => {
    if (skipped.has(spec.id)) {
      return {
        id: spec.id,
        label: spec.label,
        active: false,
        reason: `ci.yml skip_jobs includes ${spec.id}`,
      };
    }
    const closed = gateOffReason(spec.gate, inputs, config);
    if (closed !== undefined) {
      return {
        id: spec.id,
        label: spec.label,
        active: false,
        reason: closed,
      };
    }
    if (spec.secret !== undefined) {
      const secretState = secretActiveState(spec.secret, secrets);
      return {
        id: spec.id,
        label: spec.label,
        active: secretState.active,
        reason: secretState.reason,
      };
    }
    return {
      id: spec.id,
      label: spec.label,
      active: true,
      reason: "",
    };
  });
  return { jobs };
}
