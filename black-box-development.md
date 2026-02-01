### Governing AI-Generated Code via the Seven Black Box Invariants

As autonomous agents increase the volume of code produced within the enterprise, software engineering leaders face a critical bottleneck: the inability of human reviewers to validate every AI-generated line. To scale AI safely, leaders must transition from a "code-centric" review model to a "black box" governance model, where the focus shifts from reading syntax to verifying strict behavioral guarantees.

### Executive Summary

**Position:** To scale autonomous AI, engineering leaders must treat AI-generated code as an immutable "black box" artifact that is validated against seven strict governance invariants rather than reviewed as human-authored source.

**Key Findings**
*   Treating AI-generated code as a black box—similar to open-source libraries or compiled binaries—allows teams to scale production without proportional increases in human review time.
*   The "black box" model requires shifting trust from the code itself to the specification and the verification pipeline.
*   If an AI-generated artifact fails any of the seven invariants, it must be rejected and regenerated, not manually patched.

**Actionable Recommendations**
*   **Establish** a "no-read" policy for AI-generated implementation code by **enforcing** the seven invariants (Functional, Tested, Secure, Scalable, Performant, Observable, Auditable) via automated pipelines.
*   **Guarantee** functional integrity by **implementing** contract-driven testing tools like Jama Connect or Pact that verify the black box fulfills its specification.
*   **Ensure** security by **requiring** static and dynamic analysis (SAST/DAST) and dependency vulnerability scanning for every AI-generated artifact before deployment.
*   **Ensure** accountability by **requiring** cryptographic signing, prompt lineage tracking, and a Software Bill of Materials (SBOM) for every AI-generated artifact before deployment.

### The Black Box Philosophy

The goal of using autonomous AI agents is to create modular, immutable, and deterministic software components. If a component meets all functional and non-functional requirements, the underlying code implementation becomes secondary. This mirrors how engineers treat trusted abstractions like compiled binaries or third-party APIs: they do not inspect the internal logic but rely on the interface contract.

In this model, the specification becomes the primary source of truth ("the What"), while the AI platform's guardrails define the construction method ("the How"). When functionality must change, engineers do not open the black box to edit the code; they update the specification and task the agent to regenerate the artifact.

### The Two Layers: Context and Enforcement

The black box governance model operates through two distinct layers that serve fundamentally different purposes.

#### Context Layer (Non-Deterministic)

The context layer tells the agent *what to build* and *how to build it*. It is the specification, the coding standards, the architectural patterns, and the project rules that shape the agent's output. This layer is inherently non-deterministic — the agent interprets these instructions, and two runs with identical context may produce different implementations that both satisfy the requirements.

| Context Source | What It Provides |
|----------------|-----------------|
| **Project specification** | Functional requirements — what the artifact must do |
| **CLAUDE.md** | Project-level instructions, constraints, and mandatory behaviors |
| **`.claude/rules/`** | Coding philosophy, patterns, conventions, and anti-patterns |
| **Skills and slash commands** | Reusable workflows and specialized domain knowledge |
| **JSDoc preambles** | Existing code intent and architectural context |
| **`package.lisa.json`** | Governance templates defining forced, default, and merged configurations |

The context layer is where engineering judgment lives. It encodes the organization's standards, the team's conventions, and the project's architectural decisions. Without it, the agent produces technically valid but contextually wrong artifacts — code that compiles but doesn't belong in this codebase.

#### Enforcement Layer (Deterministic)

The enforcement layer *proves* the agent adhered to the context. It is binary — pass or fail — with no room for interpretation. Every check is automated, reproducible, and tamper-proof. If an artifact passes all enforcement checks, it satisfies the seven governance invariants regardless of how the underlying code is structured.

| Enforcement Tool | What It Proves |
|-----------------|---------------|
| **ESLint, Prettier, ast-grep** | Code structure matches mandated patterns and formatting |
| **Jest, Playwright, Maestro** | Behavior matches specification (unit, integration, e2e) |
| **Snyk, SonarCloud, Gitleaks** | No known security vulnerabilities or leaked secrets |
| **Claude Code local review, CodeRabbit** | Semantic correctness, convention adherence, logical bugs |
| **k6, Lighthouse** | Performance and scalability meet SLOs |
| **commitlint, Husky** | Process traceability and commit hygiene |
| **GitHub Actions, branch protection** | All checks pass in a controlled environment before merge |

The enforcement layer is where trust lives. The organization does not trust the agent's interpretation of context — it trusts the deterministic pipeline that validates the output. Context without enforcement is "vibe coding." Enforcement without context produces technically valid but wrong artifacts. Both layers are required.

### Dual Enforcement: Local and CI/CD

Every invariant must be enforced at two levels: the developer's local workstation and the CI/CD pipeline. Local enforcement provides immediate feedback during generation — the autonomous agent receives validation results in real time and can regenerate on failure without waiting for a remote pipeline. CI/CD enforcement serves as the authoritative gate — no artifact reaches production without passing every invariant in a controlled, reproducible environment.

This dual-layer approach prevents two failure modes. Without local enforcement, agents waste cycles pushing artifacts that will be rejected by the pipeline, creating slow feedback loops. Without CI/CD enforcement, locally-passing artifacts may exploit environment-specific conditions (cached dependencies, stale test data, permissive configurations) that mask real failures. Both layers must run the same tools with the same configurations to ensure parity.

| Enforcement Layer | Purpose | Mechanism |
|-------------------|---------|-----------|
| **Local (workstation)** | Fast feedback during generation | Git hooks (Husky), Claude Code hooks, lint-staged, local test runs, pre-push validation |
| **CI/CD (pipeline)** | Authoritative gate before deployment | GitHub Actions workflows, pipeline stages, automated quality gates, branch protection rules |

#### Enforcement Mechanisms

**Git Hooks (Husky)**
Git hooks enforce invariants at specific points in the developer workflow. The pre-commit hook runs linting, formatting, and secrets detection on staged files. The pre-push hook runs the full test suite, slow lint rules (circular dependency detection, namespace validation), and security audits. The commit-msg hook validates conventional commit format and ensures traceability metadata is present. These hooks run identically whether triggered by a human developer or an autonomous agent.

**Claude Code Hooks**
Claude Code hooks are the critical differentiator between traditional CI/CD enforcement and AI-native governance. Unlike git hooks, which run after code is written, Claude Code hooks intercept the agent *during generation*. They can block tool calls that would violate invariants — for example, preventing a file write that introduces a linting violation or rejecting a commit attempt that would fail the pre-commit hook. This enables the "reject and regenerate" model in real time rather than after the fact. When a hook blocks an action, the agent receives the failure reason and can immediately course-correct without completing a full generate-commit-push-fail cycle.

**Agentic Code Review**
Agentic code review tools provide semantic analysis that static analysis and automated testing cannot. Unlike linters (which enforce syntactic rules) or test suites (which verify behavioral contracts), agentic reviewers evaluate whether code makes sense in the context of the broader system — catching logical bugs, convention drift, architectural anti-patterns, and subtle issues that require contextual understanding.

Lisa's reference implementation uses two complementary agentic reviewers at different enforcement checkpoints:

- **Claude Code local review (Checkpoint 1 — local workstation):** Multiple independent review agents analyze the changeset in parallel, each focused on a specific concern: convention compliance, bug detection, git history context, and code comment quality. Findings are scored on a confidence scale, and only high-confidence issues are fed back to the generating agent for correction. This prevents semantic issues from reaching the remote repository.

- **CodeRabbit (Checkpoint 3 — CI/CD pipeline):** An independent agentic reviewer analyzes the pull request in a clean environment, providing a second perspective not influenced by the generating agent's context. CodeRabbit surfaces architectural drift, hardcoded values, fragile patterns, and missing validation. Its findings must be addressed before the artifact can merge.

This dual-layer agentic review model augments — but does not replace — human review. It reduces the burden on human reviewers by surfacing semantic issues that would otherwise require line-by-line reading, allowing humans to focus on specification alignment and architectural judgment.

**Safety Net**
The Safety Net (`.safety-net.json`) prevents autonomous agents from bypassing enforcement mechanisms. It blocks commands like `--no-verify`, `git stash`, and other escape hatches that would allow an artifact to skip validation. This ensures that the invariant pipeline is tamper-proof — an agent cannot opt out of governance regardless of its instructions.

**lint-staged**
lint-staged scopes local checks to only the files that have changed, keeping feedback loops fast. Rather than running ESLint or Prettier across the entire codebase on every commit, it runs only against staged files. This is essential for autonomous agents that may generate hundreds of commits per session.

**GitHub Actions**
GitHub Actions workflows serve as the authoritative CI/CD enforcement layer. Every pull request triggers quality workflows (linting, type checking, tests, formatting, build verification), security workflows (SAST, dependency scanning, secrets detection, license compliance), and performance workflows (load testing, Lighthouse audits). No artifact can merge without all workflow checks passing.

**Branch Protection Rules**
Branch protection rules ensure that CI/CD enforcement cannot be circumvented. Required status checks must pass before merge, force pushes are blocked on protected branches, and pull request reviews are required. This closes the loop — even if an agent bypasses local enforcement, the CI/CD gate is immovable.

### The Seven Governance Invariants

For an AI-generated black box to be deployed safely, it must satisfy seven critical invariants. These requirements serve as the definition of done for autonomous agents. Each invariant must pass both locally and in CI/CD before the artifact is considered valid.

**1. Functional**
The artifact must implement the intended requirements precisely. It is not enough for the code to compile; it must behaviorally match the specification. Tools like formal verification (TLA+) or contract testing (Pact) ensure the output honors the agreed-upon contract.

*Enforcement tools: ESLint, Prettier, knip, ast-grep, Claude Code local review, CodeRabbit*

**2. Tested**
Quality must be validated through rigorous, automated testing. The black box must arrive with its own comprehensive test suite (unit, integration, and end-to-end) generated by the agent or a secondary "verifier" agent. Integration and end-to-end tests ensure the artifact is compatible with the existing system, not just correct in isolation.

*Enforcement tools: Jest, Playwright, Maestro*

**3. Secure**
The artifact must pass static application security testing (SAST), dynamic application security testing (DAST), and dependency vulnerability scanning. It must contain no known vulnerabilities and comply with the organization's security policies.

*Enforcement tools: Snyk, SonarCloud, ZAP (OWASP), GitGuardian, Gitleaks, FOSSA*

**4. Scalable**
Introducing the artifact must not degrade the system's ability to scale under load. It must be validated in the context of the broader system to ensure it does not introduce bottlenecks, resource contention, or architectural constraints that limit horizontal or vertical scaling.

*Enforcement tools: k6*

**5. Performant**
The solution must meet established Service Level Objectives (SLOs) for latency and throughput. If the code functions correctly but fails to meet speed requirements, it is rejected.

*Enforcement tools: k6, Lighthouse*

**6. Observable**
The black box must emit continuous telemetry for runtime behavior, drift, and anomalies. It must support vendor-neutral instrumentation standards to ensure that once deployed, its health and operations are transparent to the platform team. Error tracking must be integrated to surface failures in real time.

*Enforcement tools: OpenTelemetry, Sentry*

**7. Auditable**
The artifact's entire provenance must be reconstructable for compliance and debugging. This includes linking the artifact to its originating prompt, model version, and data lineage so that defects can be traced to the exact instruction or context that caused them. It also requires a Software Bill of Materials (SBOM) and cryptographic signing (e.g., Sigstore) to prove provenance. If the generation process cannot be audited, the artifact is considered compromised.

*Enforcement tools: commitlint, Husky, standard-version*

### Tool Matrix

| Invariant | Local (Workstation) | CI/CD (Pipeline) |
|-----------|--------------------|--------------------|
| **Functional** | ESLint, Prettier, knip, ast-grep, Claude Code local review | ESLint, Prettier, knip, ast-grep, CodeRabbit |
| **Tested** | Jest (unit, integration) | Jest (unit, integration), Playwright, Maestro |
| **Secure** | Gitleaks | Snyk, SonarCloud, ZAP (OWASP), GitGuardian, FOSSA |
| **Scalable** | — | k6 (stress, spike, soak) |
| **Performant** | — | k6 (smoke, load), Lighthouse |
| **Observable** | ast-grep (SDK init checks) | ast-grep (SDK init checks) |
| **Auditable** | commitlint, Husky | standard-version, SBOM generation, Sigstore |

### The "Black Box" Problem

If an AI-generated artifact fails to meet even one of these invariants, it should never be deployed. This rigor is the primary defense against "vibe coding," where developers accept AI output based on a superficial check rather than structural guarantees. Without these guardrails, AI agents become "tech debt factories" that produce unmaintainable and insecure code.
