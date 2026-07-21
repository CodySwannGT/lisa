import { runUi, type StatusProbe } from "../../../src/cli/ui-cmd.ts";

const DEFAULT_PORT = "4783";
const port = process.argv[2] ?? DEFAULT_PORT;

const probes: readonly StatusProbe[] = [
  {
    id: "github-authenticated",
    timeoutMs: 100,
    run: async () => ({ state: "value", value: true }),
  },
  {
    id: "github-unauthenticated",
    timeoutMs: 100,
    run: async () => ({
      state: "unknown",
      reason: "not-authenticated",
      message: "GitHub CLI is not authenticated",
    }),
  },
  {
    id: "throwing-probe",
    timeoutMs: 100,
    run: async () => {
      throw new Error("Deterministic fixture failure");
    },
  },
  {
    id: "timing-out-probe",
    timeoutMs: 25,
    run: async signal =>
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  },
  {
    id: "not-applicable-probe",
    timeoutMs: 100,
    run: async () => ({ state: "not-applicable" }),
  },
];

const unavailable = {
  state: "unknown" as const,
  reason: "fixture-unavailable",
  message: "Unavailable in the shared browser fixture",
};
const server = await runUi(
  process.cwd(),
  { port, sync: false },
  {
    probes,
    setupReadiness: {
      readConfig: async () => ({}),
      readHealth: async () => {
        throw new Error("No Health fixture");
      },
      readGithub: async () => unavailable,
      readDeployPipeline: async () => unavailable,
      readAutomations: async () => unavailable,
      readExpectedAutomationIds: async () => [],
      readExpectedSecretNames: async () => [],
    },
  }
);

const close = (): void => {
  server.close(() => process.exit(0));
};

process.once("SIGINT", close);
process.once("SIGTERM", close);
