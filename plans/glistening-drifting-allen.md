# Plan: Gartner Research Paper — "Your AI Coding Agents Are Only as Good as Your Harness"

## Overview

Write a Gartner-style research paper for Software Engineering Leaders explaining what an AI coding harness is and why it's the most critical investment for AI-assisted software development. The paper draws on real-world harness architecture (unnamed) and extensive industry research.

**Audience:** VPs of Engineering, CTOs, Directors of Platform Engineering
**Tone:** Authoritative, practical, evidence-backed — Gartner analyst style
**Goal:** Convince leaders that the model is commodity; the harness is the moat.
**Length:** Comprehensive paper (15-20 pages)
**Thesis approach:** The "mediocre model + great harness > great model + no harness" argument is included as a supporting finding, not the central thesis. The central thesis is: "The harness is the most critical and underinvested component of AI-assisted software development."
**Tool references:** Name specific tools (Claude Code, Cursor, GitHub Spec Kit, MCP, SonarQube, etc.) as concrete examples. This adds credibility and actionability.
**Evidence:** Public research only (Anthropic, Pixee, ThoughtWorks, Spotify, HumanLayer, etc.)

---

## Proposed Paper Structure

### Title
**"Your AI Coding Agents Are Only as Good as Your Harness"**
*Why Software Engineering Leaders Must Invest in Agent Infrastructure, Not Just Agent Intelligence*

### Abstract / Key Findings (1 page)
- Organizations investing in AI coding tools without harness infrastructure see 1.7x more defects than human-written code (Pixee.ai research)
- The harness — not the model — determines code quality, security, and team velocity
- Three recommendations for SE leaders (preview of the paper's conclusions)

### Section 1: The Problem — "Vibe Coding" at Scale (2 pages)
- The current state: teams adopting AI coding tools (Copilot, Cursor, Claude Code) and seeing fast code generation but rising technical debt
- The "vibe coding" backlash — fast output without governance creates problems faster than teams can fix them
- Anthropic's finding: engineers can "fully delegate" only 0-20% of tasks; the rest requires supervision
- **The gap:** Organizations optimized for model selection but underinvested in the infrastructure that governs how agents operate

### Section 2: What Is an AI Coding Harness? (3-4 pages)
- **Definition:** "The infrastructure that wraps around an AI model to manage long-running tasks. It is not the agent itself. It is the software system that governs how the agent operates, ensuring it remains reliable, efficient, and steerable." (Parallel.ai)
- **The OS Analogy:** "The Model is the CPU, the Context Window is the RAM, and the Agent Harness is the Operating System" (Philipp Schmid / Hugging Face)
- **The 3D Printer Analogy:** A harness doesn't just produce code — it produces coordinated artifacts: implementation code, test code, documentation, changelogs, release notes. The platform team builds the printer; the implementation team configures it, writes specs, and runs them through.
- **Distinguish from related concepts:**
  - Agent Framework (building blocks, no runtime governance)
  - Agent Runtime (execution/state, no opinionated defaults)
  - AI Governance Framework (policy/compliance, not coding-specific)

#### The Five Capabilities of a Mature Harness

**2a. Context Engineering (The Knowledge Layer)**
- Context engineering ≠ prompt engineering. It's "the strategic curation of tokens available to language models during inference" (Anthropic)
- Context plumbing: infrastructure that pipes knowledge from where it's created to where it's needed (Matt Webb)
- Layered context: rules files, skills, agents, hooks, settings, templates
- Progressive context access: ticketing systems, documentation platforms, server logs
- Spotify's finding: "careful context engineering is essential for producing reliable, mergeable pull requests"
- Manus AI: "KV-cache hit rate is the single most important metric for a production-stage AI agent"

**2b. Backpressure (The Enforcement Layer)**
- Borrowed from distributed systems: the mechanism that applies real-time feedback to agents and forces self-correction
- Multi-layer enforcement: formatting → linting → AST pattern scanning → pre-commit hooks → branch protection → CI/CD
- HumanLayer's "context-efficient backpressure": condense success signals, expand failure signals to conserve tokens
- Key principle: blocking hooks (exit 1) force agents to fix errors; notification hooks (exit 0) only inform
- The feedback loop: hook fails → agent receives error → agent retries → hook re-validates

**2c. Self-Verification (The Proof Layer)**
- "Never assume something works because the code 'looks correct.' Run a command, observe the output, compare to expected result."
- Verification types: unit tests, API curl scripts, coverage thresholds, Playwright/Cypress recordings, documentation checks
- Every task requires a "proof command" — one empirical command that demonstrates the work is done
- UI tasks open a browser and self-verify; API tasks run curl and self-verify

**2d. Skills & Tooling Integration (The Capability Layer)**
- Skills: specialized instruction sets invoked on-demand (not always-loaded context)
- MCP (Model Context Protocol): the industry-standard integration protocol (97M+ monthly SDK downloads, supported by Anthropic, OpenAI, Google, Microsoft)
- Integration across the SDLC: Jira/Linear, SonarQube, Snyk, k6, GitHub, etc.
- "Canned prompts that can be run like bash scripts" — making it easy for non-platform engineers to use

**2e. Spec-Driven Workflow (The Intent Layer)**
- Prompt = what to build; Context = knowledge of how; Backpressure = enforcement of requirements
- Plan → Task → Implement → Review → Verify cycle
- ThoughtWorks: "one of the most important practices to emerge in 2025"
- GitHub Spec Kit: Specify → Plan → Tasks → Implement
- The philosophical shift: "code is the source of truth" becomes "intent is the source of truth"

### Section 3: The Organizational Model — Who Builds and Who Uses the Harness (2 pages)

**Platform Team (Builds the Harness)**
- Creates governance rules, coding philosophy, enforcement hooks
- Designs skills and agent configurations
- Maintains template inheritance (force/defaults/merge semantics)
- Establishes verification standards
- Integrates with SDLC tools via MCP and APIs

**Implementation Team (Uses the Harness)**
- "Blended teams" of engineers + product who work together to produce specs and verify output
- Engineers shift from writing code to orchestrating agents
- Product managers can participate more directly in implementation
- The team configures the harness, writes specs, runs specs through, verifies output
- If the product isn't right: tweak instructions, adjust configs, try again, give feedback to platform team

**The New Feedback Loop**
- Implementation team discovers gaps → feeds back to platform team → platform team improves harness → all teams benefit
- This is organizational learning encoded in infrastructure

### Section 4: From Workstation to Production — The Harness Extends Everywhere (1-2 pages)
- The harness isn't just an IDE plugin — it extends from developer workstation to CI/CD to production
- Pre-commit hooks enforce at the workstation
- CI/CD pipelines enforce at integration
- Production monitoring feeds back into the knowledge graph
- Platform engineering for AI agents: treating agents as "first-class platform citizens with RBAC, quotas, and governance" (PlatformEngineering.org)

### Section 5: Maturity Model — Where Is Your Organization? (1-2 pages)

| Level | Description | Characteristics |
|-------|-------------|-----------------|
| **Level 0: No Harness** | Individual developers using AI tools ad-hoc | No governance, inconsistent quality, "vibe coding" |
| **Level 1: Basic Guardrails** | Linting and pre-commit hooks applied to AI output | Reactive enforcement, no context engineering |
| **Level 2: Context-Aware** | Rules files, skills, and structured context injection | Proactive guidance, but manual verification |
| **Level 3: Self-Correcting** | Backpressure loops with automated retry and self-verification | Closed-loop feedback, empirical proof required |
| **Level 4: Spec-Driven** | Full spec → plan → task → verify workflow with platform team | Intent as source of truth, multi-artifact production |
| **Level 5: Organizational Learning** | Knowledge graphs, cross-team feedback loops, continuous harness improvement | Institutional knowledge encoded in infrastructure |

### Section 6: Recommendations for Software Engineering Leaders (1-2 pages)
1. **Invest in harness infrastructure before (or alongside) model selection** — the model is commodity; the harness is your competitive advantage
2. **Establish a platform engineering function for AI agents** — someone must own the harness
3. **Adopt MCP as your integration standard** — it's already won the protocol war
4. **Implement backpressure, not just guardrails** — enforcement must be real-time and blocking, not post-hoc
5. **Require empirical verification for every AI-generated artifact** — "trust but verify" doesn't work; verify first
6. **Move toward spec-driven development** — invest in specification quality, not prompt engineering
7. **Restructure teams around the harness** — platform team builds it, blended implementation teams use it

### Glossary of Terms (1 page)
Define all emerging terminology with industry-standard definitions and sources.

---

## Resolved Questions

- **Length:** Comprehensive (15-20 pages) ✓
- **Thesis:** "Mediocre model + great harness" included as supporting finding, not central thesis ✓
- **Tool references:** Name specific tools as examples ✓
- **Evidence:** Public research only ✓

## Open Questions (to resolve during writing)

1. **The 3D printer analogy:** How central should this be? Running thread or sidebar? It's vivid but could be dismissed as oversimplification by C-suite readers.
2. **Knowledge graph depth:** Industry adoption is only 27%. Should this be "what's next" rather than a current recommendation?

---

## Suggestions for Things to Include

1. **The "Invisible Tax" of Ungoverned AI Code:** Frame the problem in financial terms. Every AI-generated line without governance creates a hidden maintenance cost. Leaders understand cost/risk better than technical arguments.

2. **The Security Angle:** AI-generated code introduces novel attack surfaces. Guardrails aren't just about quality — they're about AppSec. Reference OWASP's emerging work on AI-specific vulnerabilities. This gives CISOs a reason to champion the harness.

3. **The "Vibe Coding" → "Technical Debt Avalanche" Pipeline:** Name the anti-pattern explicitly. Teams that skip harness investment are building a debt bomb. Use the ThoughtWorks quote: "Spec drift and hallucination are inherently difficult to avoid. We still need highly deterministic CI/CD practices."

4. **Cost Analysis of Context Engineering:** Manus AI's finding that KV-cache hit rate is the most important metric suggests there's a direct cost optimization story. Better context engineering = fewer wasted tokens = lower API costs = faster execution. This resonates with finance-minded leaders.

5. **The "Human-in-the-Loop" Spectrum:** Rather than binary "human vs. AI," show the spectrum from full delegation to full human control. Different task types warrant different levels of AI autonomy, and the harness enables this calibration.

6. **Comparison Table: Harness vs. No Harness:** A side-by-side table showing what happens with and without each harness capability (context engineering, backpressure, self-verification, etc.). Visual and scannable.

7. **The "First 90 Days" Playbook:** Practical guidance for leaders who read this and want to act. What should they do in weeks 1-4, 5-8, 9-12? This makes the paper actionable, not just informative.

8. **Quote from Guy Podjarny (Tessl):** "By end of 2027, developers working with agents won't look at code most of the time." This is provocative and forward-looking — good for the "where this is headed" section.

9. **The "Agent RBAC" Concept:** Treating AI agents like any other user persona with permissions, quotas, and governance. This is familiar territory for IT leaders and makes the harness concept tangible.

10. **DX/DORA Connection:** "Nearly 90% of enterprises now have internal platforms, surpassing Gartner's 2026 prediction of 80% a full year early." Position the harness as the next evolution of platform engineering — a familiar concept extended to a new domain.

---

## Key Sources to Cite

| Source | Key Quote / Finding |
|--------|-------------------|
| Anthropic Engineering Blog | "Effective harnesses for long-running agents" — defines the harness concept |
| Aakash Gupta (Medium) | "The model is commodity. The harness is moat." |
| Philipp Schmid (Hugging Face) | "Model = CPU, Context Window = RAM, Harness = OS" |
| Salesforce | Enterprise harness definition with governance framing |
| HumanLayer | "Context-efficient backpressure" — token conservation in feedback loops |
| Anthropic 2026 Report | Engineers shift from writing code to orchestrating agents; 0-20% full delegation |
| Pixee.ai | AI-generated code has 1.7x more defects; 87% of enterprises lack AI security frameworks |
| ThoughtWorks | Spec-driven development as "one of the most important practices to emerge in 2025" |
| GitHub | Spec Kit and the shift from "code as truth" to "intent as truth" |
| Spotify Engineering | "Careful context engineering is essential for reliable, mergeable PRs" |
| PlatformEngineering.org | AI agents as "first-class platform citizens" |
| CNCF | "Stop viewing AI as a feature and start architecting for agentic infrastructure" |
| MCP Anniversary | 97M+ monthly SDK downloads, 10K+ servers, industry standard |

---

## Skills to Use During Execution
- `/jsdoc-best-practices` — for any code examples in the paper
- `/git:commit` — for committing the paper drafts
- `/git:submit-pr` — for submitting the final paper

## Output
- **File:** `/Users/cody/workspace/ai-coding-harness-paper.md` (outside Lisa repo — this is a standalone paper, not a codebase artifact)
- **Branch:** Create a new branch `docs/ai-coding-harness-paper` from `main` for any Lisa-adjacent changes; the paper itself lives outside the repo

## Task List (for execution)

1. **Write the paper draft** — Create the full paper in markdown following the agreed structure
2. **Review with CodeRabbit** — Review the paper for quality (coderabbit:review)
3. **Review with /plan:local-code-review** — Local review pass
4. **Implement review suggestions** — Address valid feedback
5. **Simplify with code-simplifier** — Clean up prose and structure
6. **Update documentation** — Ensure any referenced docs are accurate
7. **Verify all verification metadata** — Confirm all tasks have empirical checks
8. **Archive the plan** — Move plan to `./plans/completed/`, rename appropriately, move task sessions, commit and push

## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| 7956cc16-a369-4bf3-b1f2-0d3ef0100843 | 2026-02-04T03:52:18Z | plan |
