# Agentic Readiness Questionnaire

This is intended for operators, teams, and stakeholders
who want to understand what an autonomous software factory needs without reading
the formal control specification first.

## The bottom line

1. What fraction of work ships with zero human touches?
2. Besides autonomy rate, do you measure whether the delivered work was any good?

## Credentials & access

3. Where do your agents' secrets live?
4. What sits between the agent and the network?
5. Do agents authenticate as themselves, or borrow a human login?
6. How often are static credentials rotated?

## Where agents run

7. What sandbox do unattended agents run in?
8. What durable scheduler keeps agents moving when nobody prompts them?
9. Which coding agents operate this project?
10. Do all of those agents get the same guardrails?
11. Is agent network egress restricted?

## The agent's program

12. Is production work driven by pre-vetted skills, or free-form prompts?
13. Do prompt and skill changes go through the same gates as code?
14. How is a model upgrade qualified before agents use it?
15. How are model, effort, and tool configuration assigned by task class?
16. Do agent-program and model qualifications report repeated-run distributions?
17. When an agent makes a mistake, what stops the next agent repeating it?
18. Is the reasoning / effort level pinned alongside the model version?
19. Do you have your own task suite for judging agents — and can the agents see it?
20. When a new agent joins the roster, how does it earn trust?

## Work intake

21. Where do product requirements (PRDs) live?
22. What tracks work items?
23. Is there a knowledge source agents read for project context?
24. Is that knowledge source maintained, or rotting?
25. Is incoming work validated before agents build it?
26. Is there a definition of ready, enforced per work-item type?
27. Are requirements written as testable atoms?

## Correctness gates

28. Is unit behaviour proven on every change?
29. Minimum unit-test coverage you enforce?
30. What drives end-to-end journeys?
31. Does every user-facing requirement and critical state map to an executable end-to-end journey?
32. How is end-to-end proof tiered without weakening the release gate?
33. Do you run mutation testing?
34. Do escaped defects become replayable efficacy tests?
35. Is the system load-tested against SLOs before release?
36. Are generated tests and synthetic user findings measured before intake?
37. Can a quality threshold be quietly lowered?
38. Does anything generate new test inputs, or do you only re-run the same suite?
39. Can your tests still catch the bugs you have already fixed?

## Security gates

40. What blocks a committed secret?
41. What does static security analysis?
42. What audits dependency vulnerabilities?
43. What scans your infrastructure code?
44. Do you produce an SBOM and sign released artifacts?
45. Are dependency licenses checked against an allowlist?
46. What catches licensed or proprietary code reproduced directly into your source?

## Agent attack surface

47. Is there a written threat model for your agents?
48. What stops fetched content from becoming instructions?
49. What can agents read on the open internet?
50. Which codebases may an agent draw from — and what stops one client's source reaching another's?
51. When an agent crosses repositories, how are the destination repository's controls activated?
52. Can an agent add a new dependency unreviewed?
53. Are destructive operations blocked at the tool layer?
54. How are MCP servers and connectors vetted?
55. Are instruction files from cloned repos trusted automatically?
56. Can a bad learning persist and steer future runs?
57. Does the threat model cover agent misreporting and fabricated evidence?
58. If an agent escapes its sandbox, what can it reach?
59. Can one agent get another to do what it is not allowed to do itself?
60. Does every threat in your model map to a control, and every control to a threat?

## Code health

61. Are file and function size limits enforced?
62. What is your per-function complexity ceiling?
63. Is project and module structure enforced?
64. Is your house coding style enforced automatically?
65. Is dead code detected and removed?
66. With the author hidden, could a reviewer tell who — or what — wrote a change?

## Design & UI

67. Do agents build UI from a design system, or style ad-hoc?
68. Are design tokens the source of truth for style?
69. Is your design tool connected for agents to read?
70. Are design components mapped to code components?
71. Is every implemented screen mechanically compared with its source design?

## Review & merge

72. What reviews every diff before merge?
73. Must review findings be resolved before merge?
74. What happens when review capacity is saturated?
75. When CI or another gate rejects agent output, what happens next?
76. Which authoritative gates run before work reaches CI?
77. Are your quality gates unskippable server-side?
78. When did a gate last actually block a change?
79. Which of your rules live only in agent instructions — and how often are they broken?
80. Where do your control obligations live — and do the gates come from there?
81. Can you enumerate every control, where it is enforced, and when it last fired?
82. Is autonomy the same everywhere, or tiered by risk?

## Ship & rollback

83. What stands between a merged PR and production?
84. Is production deploy gated by a protected environment?
85. Can you roll back a bad deploy?
86. When a deployment fails before reaching users, what heals it?
87. How do changes reach users?
88. What promotes a canary or staged rollout — observed signal, or a timer?

## Verify & acceptance

89. After a change ships, does anything use the product?
90. Is shipped work checked against its original spec?
91. Who adjudicates evidence produced by the ADS itself?
92. Does each passing verification become a regression test?
93. When an agent proves a bug or a fix, where does the proof run?

## Observe

94. What captures production errors?
95. What holds your logs and metrics?
96. Does a production threshold crossing become a work item automatically?
97. Do user-reported problems enter the same signal pipeline?
98. Are finding sources measured for false positives or rejection rate?
99. What tells you what users actually do?
100. Are cost and governance metrics reconciled against an independent source?
101. Would you notice if your agents got worse without you changing anything?

## Operate & recover

102. How would you learn a scheduled loop died?
103. An agent breaks production — what happens?
104. Do monitoring findings close on root cause instead of symptom silence?
105. When the pipeline itself cannot proceed, does it escalate?
106. Could a non-technical operator understand what the system tells them?
107. Does every scheduled loop end each run in a named outcome?
108. When an agent breaks production, does the incident record say who answers for it — and which gate should have caught it?

## Governance & accountability

109. Is every agent action attributable to the agent?
110. Can you answer why any given line of code was written?
111. Can you trace an artifact to the prompt and model that produced it?
112. Does the agent that wrote a change approve its own work?
113. Are agent permissions periodically reviewed?
114. Are models pinned, with a plan for vendor outage?
115. Are there spend caps and runaway-loop protection?
116. Can production data or PII enter an agent's context?
117. Are agent transcripts retained, with an access boundary?
118. Who computes the numbers your gates and dashboards depend on?
119. Are instruction-level residual risks reviewed before promotion?
120. Who is accountable when an agent breaks something?
121. Who can accept a risk the system decided not to fix?
122. Does anyone re-examine a sample of the approvals your agents make?
