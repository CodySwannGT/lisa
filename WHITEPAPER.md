# Lisa: Zero-Trust Governance for AI-Native Software Development

## Abstract

As autonomous AI agents become capable of generating production-quality code at scale, enterprises face a fundamental governance challenge: how to trust code that no human has read. Traditional code review processes — designed for human authors working at human speed — cannot scale to validate the volume of artifacts that AI agents produce. This paper introduces Lisa, a **zero-trust governance framework** that shifts enterprise trust from **reading code** to **verifying behavioral guarantees** through layered, automated enforcement. Lisa adopts a zero-trust posture toward all code: no artifact — whether written by a human developer, an AI agent, or a combination of both — is trusted until it has been verified by the enforcement pipeline. Lisa embeds governance directly into the software development lifecycle (SDLC), enabling organizations to adopt AI-assisted development without sacrificing quality, security, or compliance. While Lisa's reference implementation targets specific technology stacks, its architecture — context layers, enforcement pipelines, and black-box invariants — is stack-agnostic and applicable to any enterprise engineering organization.

---

## 1. Introduction

### 1.1 The Scaling Problem

Enterprise software teams are adopting AI code generation tools at an accelerating rate. These tools — large language model (LLM) agents such as Claude Code, GitHub Copilot, and Cursor — can produce hundreds of files per session, implement entire features from specifications, and generate their own test suites. The productivity gains are substantial. The governance gap is equally substantial.

Traditional SDLC governance assumes a human author and a human reviewer. A developer writes code, a peer reviews it, automated checks validate it, and the code is merged. This model breaks when the author is an AI agent producing code faster than any human can read it. If the organization requires a human to review every AI-generated line, the productivity gains of AI are negated by the review bottleneck.

But the scaling problem reveals a deeper truth: **human-authored code was never fully trustworthy either.** Peer review catches some defects, but studies consistently show that manual code review misses security vulnerabilities, performance regressions, and subtle logic errors. The difference is that human-authored code arrives slowly enough to create an illusion of control. AI-generated code arrives too fast for that illusion to hold — forcing organizations to confront a trust problem that always existed.

### 1.2 The Zero-Trust Insight

Lisa addresses this gap by applying a **zero-trust model** to all code — a principle borrowed from network security and adapted for the SDLC. In zero-trust network architectures, no device or user is trusted by default, regardless of whether they are inside or outside the network perimeter. Every request must be authenticated and authorized. Lisa applies this same principle to software artifacts: **no code is trusted by default, regardless of whether it was written by a human or an AI agent.** Every artifact must be verified by the enforcement pipeline before it can be deployed.

This zero-trust posture is paired with a **black-box trust** model borrowed from how engineers already work. Engineers do not inspect the source code of every open-source library they depend on, every compiled binary they deploy, or every third-party API they call. They trust these artifacts because they trust the **interface contract** and the **verification pipeline** — not the implementation.

AI-generated code — and human-authored code — can be governed the same way. If an artifact satisfies its specification, passes all tests, contains no security vulnerabilities, meets performance thresholds, and is fully auditable, the underlying implementation is secondary. The organization shifts trust from the code itself to the specification and the verification pipeline. The author's identity — human, AI, or hybrid — is irrelevant to the trust decision.

### 1.3 Scope of This Paper

This paper describes Lisa's architecture, its integration points within the enterprise SDLC, and its applicability across technology stacks. Lisa's reference implementation provides concrete tooling for TypeScript ecosystems (including Node.js, React Native/Expo, NestJS, and AWS CDK), but the governance model — context layers, enforcement checkpoints, and behavioral invariants — is technology-agnostic. Throughout this paper, specific tools (e.g., ESLint, Jest, Snyk) are cited as reference implementations of governance capabilities that can be fulfilled by equivalent tools in any stack.

---

## 2. Architecture Overview

Lisa operates through two fundamental layers and three enforcement checkpoints. Together, these ensure that **all code** — regardless of author — meets enterprise standards through automated, deterministic verification. While AI-generated code motivated the creation of this model, the enforcement pipeline is author-agnostic: a human developer's commit passes through the same hooks, linters, test suites, and CI/CD gates as an AI agent's commit. This eliminates the governance asymmetry where AI code is scrutinized while human code passes with a cursory review.

### 2.1 The Two Layers

#### 2.1.1 The Context Layer (Non-Deterministic)

The context layer tells the AI agent **what to build** and **how to build it**. It encodes the organization's standards, the team's conventions, and the project's architectural decisions. This layer is inherently non-deterministic — the agent interprets instructions, and two runs with identical context may produce different implementations that both satisfy the requirements.

| Context Source | What It Provides | Enterprise Equivalent |
|----------------|------------------|-----------------------|
| Project specification | Functional requirements — what the artifact must do | Requirements document, Jira epic, user story |
| Agent configuration files | Project-level instructions, constraints, mandatory behaviors | Development standards document |
| Convention rules | Coding philosophy, patterns, anti-patterns | Style guide, architecture decision records (ADRs) |
| Reusable skills | Domain knowledge and specialized workflows | Runbooks, tribal knowledge documentation |
| Pre-built commands | Orchestrated multi-step workflows | CI/CD pipeline definitions, Makefiles |
| Template governance | Forced, default, and merged configuration policies | Configuration management database (CMDB) |
| Code documentation | Existing code intent and architectural context | Inline documentation, design documents |

Without context, an AI agent produces technically valid but contextually wrong artifacts — code that compiles but does not belong in the codebase. Context encodes **organizational intent**.

#### 2.1.2 The Enforcement Layer (Deterministic)

The enforcement layer **proves** the agent adhered to the context. It is binary — pass or fail — with no room for interpretation. Every check is automated, reproducible, and tamper-proof.

| Enforcement Category | What It Proves | Example Tools |
|---------------------|---------------|---------------|
| Static analysis and formatting | Code structure matches mandated patterns | ESLint, Prettier, Checkstyle, Spotless, Rubocop, Black, ast-grep |
| Automated testing | Behavior matches specification | Jest, Playwright, Pytest, JUnit, RSpec, Maestro |
| Security scanning | No known vulnerabilities or leaked secrets | Snyk, SonarCloud, OWASP ZAP, GitGuardian, Gitleaks, Bandit, FOSSA |
| Agentic code review | Semantic correctness, convention adherence, logical bugs | Claude Code local review, CodeRabbit, Amazon CodeGuru |
| Performance validation | Latency and throughput meet SLOs | k6, Lighthouse, Gatling, Apache Bench |
| Process traceability | Commit hygiene and audit trail | commitlint, Husky, Conventional Commits |
| Pipeline gates | All checks pass in a controlled environment | GitHub Actions, GitLab CI, Jenkins, Azure DevOps |

Without enforcement, the organization relies on the author's claim of correctness — whether that author is an AI agent interpreting a prompt or a human developer self-certifying their own code review. Lisa calls this gap "vibe coding" when applied to AI, but the same gap exists in traditional development: a developer who claims "I tested it locally" provides no more verifiable proof than an agent that claims "I followed the specification." The zero-trust model eliminates this gap for both.

**Context without enforcement is aspirational. Enforcement without context produces technically valid but wrong artifacts. Both layers are required — for all code, from all authors.**

### 2.2 The Three Enforcement Checkpoints

Every invariant must be enforced at three points in the SDLC, each serving a distinct purpose:

#### Checkpoint 1: During Generation (Real-Time Hooks)

AI-native governance tools can intercept the agent **during code generation** — before a file is written, before a commit is created, before a command is executed. This is the critical differentiator between traditional CI/CD enforcement and AI-native governance.

When a hook blocks an action, the agent receives the failure reason and can immediately course-correct without completing a full generate-commit-push-fail cycle. This enables a "reject and regenerate" model in real time.

**Example:** An agent writes a file that introduces a linting violation. A post-write hook runs the linter on the changed file, detects the violation, and returns the error to the agent. The agent fixes the violation before proceeding — no human intervention required.

**Example tools:** Claude Code hooks, IDE-integrated linters, language server protocol (LSP) diagnostics.

AI-native governance also enables **agentic code review** at this checkpoint. Before a pull request is submitted, a local code review agent (e.g., Claude Code's local-code-review) can analyze the changeset for convention violations, logical bugs, and specification drift — providing the same semantic analysis that a human reviewer would, but automated and repeatable. Findings above a confidence threshold are fed back to the generating agent for immediate correction, closing the feedback loop before code leaves the workstation.

#### Checkpoint 2: Before Commit (Local Git Hooks)

Before code leaves the developer's workstation, git hooks enforce a second layer of validation. Pre-commit hooks run formatting, linting, and secret detection on staged files. Pre-push hooks run the full test suite and slower analysis tools.

Critically, these hooks run identically whether triggered by a human developer or an autonomous agent. This is a defining characteristic of Lisa's zero-trust model: the enforcement layer does not distinguish between authors. A human developer who introduces a security vulnerability is blocked by the same hook that blocks an AI agent. The governance pipeline is author-blind.

**Example tools:** Husky, lint-staged, pre-commit (Python), Gitleaks, commitlint.

#### Checkpoint 3: In CI/CD (Pipeline Gates)

Even after local hooks pass, the CI/CD pipeline runs every check again in a clean, reproducible environment. This prevents locally-passing artifacts from exploiting environment-specific conditions (cached dependencies, stale test data, permissive configurations).

**Example tools:** GitHub Actions, GitLab CI/CD, Jenkins, Azure DevOps Pipelines, CircleCI.

In addition to deterministic checks, the CI/CD pipeline can invoke **agentic code review tools** (e.g., CodeRabbit, Amazon CodeGuru) that analyze pull requests for semantic issues, architectural drift, and subtle bugs that static analysis cannot detect. These tools operate as independent reviewers — their findings are treated as enforcement signals that must be addressed before the artifact can merge. When paired with local agentic review (Checkpoint 1), this creates a dual-layer agentic review model: the local review catches issues during generation, and the CI/CD review provides a second independent assessment in a clean environment.

| Checkpoint | Purpose | Failure Mode It Prevents |
|------------|---------|--------------------------|
| During Generation | Real-time feedback to the agent | Agent completes an entire artifact before discovering it violates a rule |
| Before Commit | Local gate before code leaves the workstation | Broken code reaches the remote repository |
| CI/CD Pipeline | Authoritative gate in a clean environment | Locally-passing code exploits environment-specific conditions |

Without local enforcement, agents waste cycles pushing artifacts that will be rejected by the pipeline. Without CI/CD enforcement, locally-passing artifacts may mask real failures. Both must run the same tools with the same configurations to ensure parity.

---

## 3. The Seven Governance Invariants

For any artifact to be deployed safely, it must satisfy seven behavioral invariants. These serve as the **definition of done** for all code — whether produced by an autonomous agent, a human developer, or a pair programming session between both. Each invariant must pass both locally and in CI/CD before the artifact is considered valid. The invariants are author-agnostic: they define what the code must prove about itself, not who wrote it.

### 3.1 Functional

The artifact must implement the intended requirements precisely. It is not enough for code to compile or pass type checks — it must behaviorally match the specification. Contract-driven testing and formal verification ensure the output honors the agreed-upon contract.

**Enforcement examples:** Static analysis (ESLint, Checkstyle, Clippy), formatting (Prettier, Black, gofmt), dead code detection (Knip, vulture), structural pattern matching (ast-grep, Semgrep), agentic code review (Claude Code local review, CodeRabbit).

### 3.2 Tested

Quality must be validated through rigorous, automated testing. The artifact must arrive with its own comprehensive test suite — unit, integration, and end-to-end — generated by the agent or a secondary "verifier" agent. Integration and end-to-end tests ensure the artifact is compatible with the existing system, not just correct in isolation.

**Enforcement examples:** Unit testing (Jest, Pytest, JUnit, RSpec), integration testing (Supertest, TestContainers), end-to-end testing (Playwright, Cypress, Maestro, Selenium), contract testing (Pact).

### 3.3 Secure

The artifact must pass static application security testing (SAST), dynamic application security testing (DAST), and dependency vulnerability scanning. It must contain no known vulnerabilities, no leaked secrets, and must comply with the organization's security policies.

**Enforcement examples:** SAST (SonarCloud, CodeQL, Bandit), DAST (OWASP ZAP, Burp Suite), dependency scanning (Snyk, Dependabot, npm audit), secret detection (Gitleaks, GitGuardian, TruffleHog), license compliance (FOSSA, WhiteSource).

### 3.4 Scalable

Introducing the artifact must not degrade the system's ability to scale under load. It must be validated in the context of the broader system to ensure it does not introduce bottlenecks, resource contention, or architectural constraints that limit horizontal or vertical scaling.

**Enforcement examples:** Stress and spike testing (k6, Gatling, Locust), container resource profiling (cAdvisor), database query analysis (EXPLAIN plans, pganalyze).

### 3.5 Performant

The artifact must meet established Service Level Objectives (SLOs) for latency and throughput. Functional correctness without performance is insufficient — an endpoint that returns correct data in 30 seconds is rejected if the SLO is 200 milliseconds.

**Enforcement examples:** Load testing (k6, Apache Bench, wrk), frontend performance (Lighthouse, WebPageTest), APM baselines (Datadog, New Relic, Dynatrace).

### 3.6 Observable

The artifact must emit continuous telemetry for runtime behavior, drift, and anomalies. It must support vendor-neutral instrumentation standards to ensure that once deployed, its health and operations are transparent to the platform team.

**Enforcement examples:** Distributed tracing and metrics (OpenTelemetry), error tracking (Sentry, Bugsnag), logging standards (structured JSON logging), AST-based verification that observability SDK initialization is present.

### 3.7 Auditable

The artifact's entire provenance must be reconstructable for compliance and debugging. This includes linking the artifact to its originating prompt, model version, and data lineage so that defects can be traced to the exact instruction or context that caused them. It also requires a Software Bill of Materials (SBOM) and cryptographic signing to prove provenance.

**Enforcement examples:** Conventional commits (commitlint), automated versioning (standard-version, semantic-release), SBOM generation (Syft, CycloneDX), cryptographic signing (Sigstore, cosign).

---

## 4. Integration with the Enterprise SDLC

Lisa maps directly to the phases of a standard enterprise SDLC, augmenting each phase with AI-native governance.

### 4.1 Requirements and Specification

In a Lisa-governed workflow, the specification is the **primary source of truth**. Implementation teams create specifications (user stories, design documents, acceptance criteria), and the AI agent generates artifacts to fulfill them.

Lisa's bootstrap phase automates requirements analysis:

1. **Research** — Parallel subagents analyze the existing codebase, find relevant patterns, and look up external documentation.
2. **Gap detection** — The system identifies ambiguities, missing information, or unresolved questions in the specification.
3. **Human checkpoint** — If gaps exist, the workflow stops until a human resolves them. This prevents the agent from implementing based on assumptions.

This mirrors traditional requirements review but automates the discovery of what is missing.

### 4.2 Design and Planning

Lisa's planning phase breaks work into small, independent, atomic tasks — each with clear acceptance criteria and a verification method. Tasks must be:

- **Self-contained** — No dependencies on other tasks
- **Testable** — Clear criteria for pass/fail
- **Small** — Completable in a single agent session

This aligns with agile decomposition practices but enforces stricter independence constraints to enable parallel agent execution.

### 4.3 Implementation

Implementation follows a strict test-driven development (TDD) cycle:

1. **Write failing tests** that define expected behavior
2. **Write implementation** code to make tests pass
3. **Run verification** to confirm correctness
4. **Create atomic commits** with conventional commit messages

The context layer (rules, skills, conventions) guides the agent's implementation choices. The enforcement layer (hooks, linters, test runners) validates every output in real time.

### 4.4 Code Review

Lisa shifts code review from "read every line" to "verify invariants passed." The reviewer's role changes:

| Traditional Review | Lisa-Governed Review |
|-------------------|---------------------|
| Read every line of code | Verify all seven invariants pass |
| Check style and formatting | Automated by enforcement layer |
| Look for security issues | Automated by SAST/DAST/dependency scanning |
| Verify tests exist and pass | Automated by test pipeline |
| Check for dead code | Automated by dead code detection |
| Semantic review by one human | Augmented by agentic code review tools |
| **Focus: implementation correctness** | **Focus: specification alignment** |

The human reviewer focuses on whether the artifact fulfills the specification and makes architectural sense — not whether the code is well-formatted or the tests pass. Those guarantees are provided by the enforcement layer.

#### 4.4.1 Agentic Code Review

Lisa introduces **agentic code review** as a governance capability that augments — but does not replace — human review. Agentic code reviewers are AI-powered tools that analyze code changes for semantic correctness, convention adherence, logical bugs, and architectural drift. Unlike static analysis (which enforces syntactic rules), agentic review evaluates whether the code makes sense in the context of the broader system.

Lisa's reference implementation uses two complementary agentic reviewers:

| Reviewer | Scope | When It Runs | What It Catches |
|----------|-------|-------------|-----------------|
| **Claude Code local review** | Convention compliance, logical bugs, CLAUDE.md adherence, git history context | Before PR submission (local workstation) | Deviations from project conventions, subtle logic errors, missing edge cases |
| **CodeRabbit** | Architectural patterns, code quality, security concerns, best practices | During CI/CD (pull request) | Hardcoded values, fragile patterns, missing validation, architectural drift |

The two reviewers serve different purposes at different checkpoints:

- **Local agentic review (Checkpoint 1):** Multiple independent review agents analyze the changeset in parallel — each focused on a specific concern (convention compliance, bug detection, historical context). Findings above a confidence threshold are automatically fed back to the generating agent for correction before the code leaves the workstation. This prevents issues from reaching the remote repository.

- **CI/CD agentic review (Checkpoint 3):** An independent agentic reviewer (e.g., CodeRabbit) analyzes the pull request in a clean environment, providing a second perspective that is not influenced by the generating agent's context. Its findings are addressed before the artifact can merge.

This dual-layer agentic review model mirrors the dual-enforcement principle that applies to all of Lisa's checks: local review provides fast feedback during generation, while CI/CD review provides an authoritative independent assessment. Neither replaces human review — both reduce the burden on human reviewers by surfacing issues that would otherwise require line-by-line reading.

**Stack-agnostic equivalents:** CodeRabbit, Amazon CodeGuru, Codacy, DeepSource, Sourcery, Qodo (formerly CodiumAI).

This transformation applies equally to human-authored code. A senior developer's pull request passes through the same invariant pipeline — including agentic code review — as a junior developer's or an AI agent's. The zero-trust model eliminates the common antipattern where senior engineers receive rubber-stamp reviews while junior engineers receive line-by-line scrutiny. Trust is placed in the pipeline, not in the author's reputation.

### 4.5 Testing and Quality Assurance

Lisa enforces testing at every checkpoint:

| Test Type | Local (Workstation) | CI/CD (Pipeline) |
|-----------|-------------------|-------------------|
| Unit tests | Run during generation and pre-push | Full suite in clean environment |
| Integration tests | Run during generation and pre-push | Full suite with real dependencies |
| End-to-end tests | Optional locally | Required before merge (Playwright, Maestro, Cypress) |
| Security tests | Secret scanning pre-commit | Full SAST/DAST suite |
| Agentic code review | Claude Code local review before PR | CodeRabbit review on pull request |
| Performance tests | Not applicable locally | Load, stress, spike testing |

### 4.6 Deployment and Release

Lisa's auditable invariant ensures every artifact has:

- **Conventional commit history** — Machine-parseable change log
- **Automated versioning** — Semantic version bumps based on commit types
- **SBOM** — Complete dependency inventory
- **Cryptographic signing** — Provenance proof
- **Prompt lineage** — Link to the specification and context that generated the artifact

This enables automated release pipelines with full traceability from specification to production deployment.

### 4.7 Continuous Improvement

Lisa includes a **debrief phase** after every project:

1. **Extract learnings** — What patterns worked, what didn't
2. **Evaluate for reuse** — A specialized evaluator agent determines whether learnings should become new skills, new rules, or can be omitted
3. **Update governance** — New rules and skills are added to the context layer

This creates a self-improving governance system where every project makes the next one better.

---

## 5. Template Governance and Configuration Management

Enterprise codebases require consistent configuration across projects — linting rules, dependency policies, CI/CD workflows, and security settings. Lisa manages this through a template governance system with three semantic behaviors.

### 5.1 Three Configuration Behaviors

| Behavior | Semantics | Use Case |
|----------|-----------|----------|
| **Force** | Lisa's values completely replace the project's values | Governance-critical configs: mandatory linting rules, required dependencies, commit hooks |
| **Defaults** | Project's values are preserved; Lisa provides a fallback | Helpful starting templates that projects can override: language version, build targets |
| **Merge** | Arrays are concatenated and deduplicated | Shared lists where both Lisa and the project contribute: trusted dependencies, plugin lists |

This model separates **governance-critical** configuration (which the platform team controls) from **project-specific** configuration (which implementation teams control), without requiring either to understand the other's domain.

### 5.2 Inheritance Chains

Template configurations inherit through a type hierarchy:

```
base/                    <- Applied to every project
└── language/            <- All projects using this language
    ├── framework-a/     <- Framework-specific overrides
    ├── framework-b/     <- Framework-specific overrides
    └── library/         <- Library/package-specific overrides
```

A project using Framework A receives configurations from: `base/` -> `language/` -> `framework-a/`. This eliminates configuration duplication and ensures governance changes propagate to all affected projects.

### 5.3 File Management Strategies

Template directories use four strategies for managing files in target projects:

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| **Overwrite** | Replaced on every governance update | Files that must stay synchronized (CI workflows, linting configs) |
| **Create-only** | Created if absent, never overwritten | Files that projects customize after initial creation (local configs) |
| **Merge** | Contents merged rather than replaced | Files where both governance and project contribute (ignore lists) |
| **Package governance** | Semantic force/defaults/merge on package manifests | Dependency and script management |

---

## 6. Safety and Tamper Prevention

A zero-trust governance system is only as strong as its weakest bypass. The most common bypass is not a sophisticated attack — it is a developer (human or AI) using a flag like `--no-verify` to skip a slow pre-commit hook. Lisa includes mechanisms to prevent both human developers and AI agents from circumventing enforcement, because the zero-trust model requires that **no author can opt out of governance.**

### 6.1 Safety Net

The Safety Net prevents agents from using escape hatches that would bypass governance:

- **Blocked commands:** `--no-verify`, `--force`, `git stash` (when used to avoid hooks), and other flags that skip validation
- **Blocked patterns:** Direct commits to protected branches, force pushes, hook bypasses
- **Custom rules:** Organizations can define additional blocked patterns specific to their governance requirements

The Safety Net is configured declaratively and enforced at the tool level — the agent cannot execute a blocked command regardless of its instructions.

### 6.2 Branch Protection

Branch protection rules close the final governance loop:

- Required status checks must pass before merge
- Force pushes are blocked on protected branches
- Pull request reviews are required
- Direct commits to environment branches (main, staging, dev) are blocked

Even if an agent bypasses local enforcement, the CI/CD gate and branch protection are immovable.

### 6.3 The Reject-and-Regenerate Model

When an AI-generated artifact fails any invariant, it is **rejected and regenerated** — never manually patched. This is fundamental to the black-box model:

1. The agent generates an artifact
2. The enforcement layer validates it against all seven invariants
3. If any invariant fails, the agent receives the failure reason
4. The agent regenerates the artifact (or the failing component)
5. Validation runs again

This cycle continues until all invariants pass or the agent reports that it cannot satisfy the requirements (triggering a human checkpoint). Manual patching of AI-generated code is explicitly prohibited because it breaks the black-box trust model — a patched artifact is neither fully human-authored nor fully machine-generated, making provenance unclear.

Note that the reject-and-regenerate model applies the same zero-trust principle to AI that traditional CI/CD applies to human developers: if a human's pull request fails CI, the developer fixes and resubmits — they do not manually override the pipeline. Lisa simply ensures that AI agents are held to the same standard, and that neither humans nor agents can bypass the pipeline.

---

## 7. Roles and Responsibilities

Lisa defines two roles that map to existing enterprise organizational structures.

### 7.1 Platform Expert

The platform expert is a senior engineer (or team) with deep expertise in AI tooling, static analysis, CI/CD, and security. They are responsible for:

**Context Layer:**
- Writing rules and conventions that encode organizational standards
- Creating skills that document domain knowledge and patterns
- Building slash commands that provide simple interfaces for implementation teams
- Designing subagents for specialized research and implementation tasks

**Enforcement Layer:**
- Configuring hooks for real-time validation during generation
- Setting up static analysis (linting, formatting, structural pattern matching)
- Designing CI/CD pipelines with security, performance, and quality gates
- Configuring the Safety Net to prevent governance bypass
- Integrating enterprise security tools (SAST, DAST, dependency scanning, license compliance)

The platform expert builds both layers so that implementation teams do not need to understand how they work.

### 7.2 Implementation Team

Implementation teams are developers who use Lisa without needing AI expertise. Their workflow is:

1. Receive a specification (ticket, user story, design document)
2. Run pre-built commands to bootstrap research and detect gaps
3. Answer questions when the system identifies ambiguities
4. Run execution commands to generate implementation
5. Review and merge the result

No prompt engineering. No context management. No understanding of AI limitations. The platform expert's job is to make this workflow reliable.

### 7.3 Organizational Mapping

| Enterprise Role | Lisa Role | Responsibility |
|----------------|-----------|----------------|
| Staff/Principal Engineer | Platform Expert | Build and maintain governance layers |
| Platform Engineering Team | Platform Expert | CI/CD, security tooling, infrastructure |
| Security Team | Platform Expert (collaboration) | Define security policies enforced by Lisa |
| Development Teams | Implementation Team | Use commands, answer questions, review PRs |
| QA Engineers | Both | Define test strategies (Platform), execute test workflows (Implementation) |

---

## 8. Compliance and Audit

Enterprise organizations operate under regulatory frameworks that require demonstrable controls over software development processes. Lisa's governance model maps directly to common compliance requirements.

### 8.1 Compliance Framework Mapping

| Framework | Relevant Controls | How Lisa Addresses Them |
|-----------|------------------|------------------------|
| **SOC 2 Type II** | CC6.1 (Access Controls), CC7.1 (Operations), CC7.2 (Monitoring), CC8.1 (Change Management) | Branch protection, automated testing, observability invariant, conventional commits |
| **ISO 27001** | A.8.1 (Asset Management), A.12.1 (Operational Security), A.14.2 (Security in Development) | SBOM generation, security scanning, enforcement pipeline |
| **HIPAA** | 164.312 (Access, Audit, Integrity, Transmission Security) | Audit trail, cryptographic signing, secret detection, automated security gates |
| **PCI-DSS v4.0** | Requirements 2, 6, 11 (Passwords, Secure Dev, Security Testing) | Secret scanning, SAST/DAST, dependency vulnerability scanning |

### 8.2 Audit Trail

Every CI/CD run generates an audit log containing:

- Workflow execution details and timestamps
- Job status for all quality checks
- Security scan results with vulnerability details
- Compliance control validation results
- Artifact retention for audit trails
- Prompt lineage linking artifacts to their originating specifications

This audit trail is generated automatically — implementation teams do not need to maintain it manually.

### 8.3 Evidence Packages

Lisa can generate evidence packages for compliance audits that include:

- All CI/CD run logs for a given time period
- Security scan results and remediation history
- Test coverage reports and trends
- Change management records (conventional commits, PR reviews)
- SBOM and dependency vulnerability history

---

## 9. Stack-Agnostic Applicability

While Lisa's reference implementation targets TypeScript ecosystems, the governance model applies to any technology stack. The key insight is that every stack has equivalent tools for each governance capability.

### 9.1 Capability Mapping Across Stacks

| Governance Capability | TypeScript (Reference) | Python | Java/Kotlin | Go | Rust |
|----------------------|----------------------|--------|-------------|-----|------|
| Static analysis | ESLint | Ruff, Pylint, Flake8 | Checkstyle, Spotbugs | go vet, staticcheck | Clippy |
| Formatting | Prettier | Black, isort | Spotless, google-java-format | gofmt | rustfmt |
| Unit testing | Jest | Pytest | JUnit, Kotest | go test | cargo test |
| E2E testing | Playwright | Playwright, Selenium | Playwright, Selenium | Playwright | — |
| Security scanning | Snyk, npm audit | Bandit, Safety, pip-audit | OWASP Dependency-Check, SpotBugs | govulncheck, gosec | cargo-audit, cargo-deny |
| Dead code detection | Knip | vulture, autoflake | — | deadcode | — |
| Structural patterns | ast-grep | ast-grep, Semgrep | ast-grep, Semgrep, ArchUnit | ast-grep, Semgrep | ast-grep, Semgrep |
| Agentic code review | Claude Code local review, CodeRabbit | Claude Code local review, CodeRabbit | Claude Code local review, CodeRabbit, Amazon CodeGuru | Claude Code local review, CodeRabbit | Claude Code local review, CodeRabbit |
| Commit hygiene | commitlint, Husky | commitlint, pre-commit | commitlint, Husky | commitlint, Husky | commitlint, Husky |

### 9.2 Extending to New Stacks

Adding a new stack to Lisa requires:

1. **Detector** — Logic to identify the stack from project markers (e.g., `pom.xml` for Java, `go.mod` for Go, `Cargo.toml` for Rust)
2. **Template directory** — Configuration files, rules, and skills specific to the stack
3. **Enforcement mappings** — Which tools fulfill each invariant for the stack
4. **Inheritance registration** — Where the stack fits in the template hierarchy

The governance model (two layers, three checkpoints, seven invariants) remains identical regardless of stack.

---

## 10. Measured Outcomes and Success Criteria

### 10.1 For Implementation Teams

- **No AI expertise required** — Teams run commands and answer questions
- **No prompt engineering** — The governance system handles context and instructions
- **No context management** — Subagents isolate complexity from the main workflow
- **Consistent quality** — Enforcement ensures every artifact meets the same standards
- **Faster onboarding** — Skills and rules document patterns that would otherwise be tribal knowledge

### 10.2 For Platform Teams

- **Scalable governance** — Adding new projects does not require proportional increases in review capacity
- **Self-improving system** — The debrief phase captures learnings that improve future implementations
- **Measurable compliance** — Audit trails and evidence packages are generated automatically
- **Reduced toil** — Configuration management, dependency updates, and enforcement setup are templated

### 10.3 For the Organization

- **Zero-trust guarantee** — All code, from all authors, is verified by the same deterministic pipeline
- **Trust equation:** `Code Trust = f(Context x Enforcement x Human Checkpoints)` — author identity is not a variable
- **Institutional knowledge** captured in rules and skills rather than individual expertise
- **Reproducible workflows** across projects, teams, and technology stacks
- **Democratized AI access** — Every developer benefits equally from AI tooling regardless of AI expertise
- **Uniform code quality** — No governance asymmetry between senior and junior developers, or between human and AI authors

---

## 11. Getting Started

### 11.1 Phased Adoption

Lisa is designed for incremental adoption. Organizations do not need to implement all seven invariants simultaneously.

**Phase 1: Foundation**
- Establish project convention files and behavioral rules
- Add basic enforcement hooks (formatting, linting)
- Create one or two slash commands for common workflows

**Phase 2: Testing and Security**
- Enforce TDD through hooks and CI/CD gates
- Add security scanning (SAST, secret detection, dependency scanning)
- Implement branch protection rules

**Phase 3: Full Governance**
- Add performance and scalability testing
- Implement observability verification
- Enable compliance frameworks and audit logging
- Configure template governance for multi-project consistency

**Phase 4: Continuous Improvement**
- Enable the debrief phase to capture learnings
- Build stack-specific skills and rules
- Expand to additional technology stacks

### 11.2 The Core Principle

**Implementation teams should not need to be AI experts to benefit from AI.**

The platform expert's job is to create a system where teams can:

1. Get a specification or ticket
2. Run a few commands
3. Answer questions when asked
4. Review and merge

The more guardrails the organization builds (formatting, linting, testing, secret scanning, performance validation), the more freedom it can safely give **all developers** — human and AI alike. Every guardrail added to the enforcement pipeline raises the quality floor for the entire organization, not just for AI-generated code. **Zero-trust governance benefits every author equally.** Lisa provides the framework to build both the context that guides authors and the enforcement that verifies them.

---

## 12. Conclusion

The enterprise adoption of AI code generation is not a tooling problem — it is a governance problem. Organizations that treat AI-generated code as untrusted while implicitly trusting human-authored code have a double standard that neither scales nor delivers consistent quality. Organizations that accept any code without verification — human or AI — will produce insecure, unmaintainable systems.

Lisa provides a third path: **zero-trust governance for all code.** Every artifact — whether written by a senior engineer, a junior developer, an AI agent, or a collaboration between human and machine — is treated as a governed black box, validated against strict behavioral invariants rather than reviewed based on the author's identity or reputation. The context layer encodes what to build and how to build it. The enforcement layer proves the code adheres to the context. Human checkpoints ensure the specification is correct and the output makes architectural sense.

While AI-generated code motivated the creation of this model, the zero-trust approach delivers benefits that extend far beyond AI governance. It eliminates the review asymmetry between senior and junior developers. It replaces subjective "looks good to me" approvals with deterministic verification. It ensures that every artifact — from every author — meets the same quality, security, and compliance bar. The enforcement pipeline does not ask "who wrote this?" It asks "does this meet our standards?"

This model scales because it decouples trust from both comprehension and authorship. The organization does not need to understand every line of code, and it does not need to know who wrote it. It needs to understand the specification, trust the enforcement pipeline, and verify the invariants. Everything else is implementation detail.

---

## References

- OpenTelemetry Specification — https://opentelemetry.io/docs/specs/
- Sigstore Project — https://www.sigstore.dev/
- OWASP Top 10 — https://owasp.org/www-project-top-ten/
- Conventional Commits — https://www.conventionalcommits.org/
- CycloneDX SBOM Standard — https://cyclonedx.org/
