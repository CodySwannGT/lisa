<!--
  GENERATED FILE. Do not edit it by hand: the next regeneration overwrites it.
  It is rendered from the `question` of every in-scope criterion in
  spec/tasc-criteria.json, under the section titles of
  spec/tasc-0.1-draft.md.
  To change a question, edit the catalogue, then run:
    bun run build:readiness-questionnaire
-->

# Agentic Readiness Questionnaire

This is intended for operators, teams, and stakeholders
who want to understand what an autonomous software factory needs without reading
the formal control specification first.

## Governance and Accountability

1. Is every action an agent takes recorded under the agent's own account rather than a person's?
2. Can any shipped line of code be followed back, step by step, to the request that asked for it?
3. Is every change reviewed, verified and approved for release by someone or something other than the agent that wrote it?
4. Are the accounts and permissions your agents hold reviewed on a set schedule?
5. Are records of agent sessions kept for a stated length of time, with a stated limit on who may read them?
6. Is agent spending capped for every run and checked against the provider's own usage records?
7. Is there a named person, with a named backup, who answers for what the agents do?
8. Is every decision to accept a risk instead of fixing it made and recorded by a named person who is allowed to make it?
9. Does someone independent regularly re-check a sample of the approvals your agents give?

## Communication and Operator Legibility

10. Can someone who is not an engineer understand every message the agents send out, such as rejections, questions and results?
11. Does every scheduled agent run end by stating one outcome from a fixed list, with a one-line summary anyone can read?
12. Does every scheduled agent job have a written guide in the repository saying what it is for, what starts it and what an operator should do?
13. When the agents ask a person for help, does the request say what is broken or what must be decided, and what to do about it?

## Risk Assessment: the Agent Threat Model

14. Is there a written list of the ways your agents could be attacked or misled, with a safeguard named for each one?
15. Is content that agents fetch from outside treated as information to read, never as instructions to follow?
16. Is a trust decision made before agents act on instruction files that arrive with outside code?
17. Is every lesson an agent saves for later checked before it is kept, labelled with where it came from, and removable?
18. Is it written down what an agent could reach if it were taken over, with that reach kept to what the agent needs?
19. Is it recorded which agents can ask which other agents to act, so that no agent can get another to do what it may not do itself?

## Monitoring, Sensors, and Finding Integrity

20. Do errors, logs, performance figures and problems reported by users all reach the agents as signals to act on?
21. Would you find out if a monitor stopped working, rather than mistaking its silence for good news?
22. When monitoring spots a problem, does it become a tracked work item that passes the same entry checks as any other work?
23. When an agent makes a mistake, is the lesson recorded and turned into a rule or check that stops the next agent repeating it?
24. Is every automatic source of findings filtered before its findings become work, with its rate of false alarms measured?
25. Are the numbers your decisions rest on produced by something other than the agents being judged, and checked against an independent record?
26. Is a defect closed only when its underlying cause is fixed, or when a named person has accepted the risk on the record?
27. Do you regularly re-test your agents against your own set of tasks, so you would notice if they got worse?

## Enforcement Integrity

28. Are the required checks enforced in a place the agents cannot skip, switch off or work around?
29. Are the local copies of your checks generated from the same source as the required ones, with any difference caught automatically?
30. Does every kind of agent you use face the same checks, with any gap written down and covered elsewhere?
31. Is a change that lowers a quality bar refused unless it is made on its own and separately approved?
32. Has every required check been shown to stop a change that deliberately breaks its rule?
33. When the agents' instructions change, is any new risk the change brings written down and reviewed before it takes effect?
34. Are the rules that exist only as instructions to agents listed, with a measurement of how often they are broken?
35. Is every rule you hold yourselves to kept in a versioned file a program can read, with the checks produced from that file?
36. Is there one list of every rule, where it is enforced, what measures it and who answers for it, kept in step with what actually runs?

## Identity, Credentials, and Access

37. Do agents sign in to every outside system as themselves, with only the access they need, rather than with a person's login?
38. When an agent acts with a person's permissions, is that explicit, limited in time and reach, and logged?
39. Are passwords, keys and tokens kept in a dedicated store, out of the repository and out of the text agents read?
40. For every place agents run, is each sign-in they need written down and shown to work from that place?
41. Is what agents can reach over the network limited to what the work needs?

## System Operations and Recovery

42. Is every scheduled agent job registered, with what starts it and what happens when a run is missed written down?
43. If an agent's change breaks production, is there a set way to undo it that has actually been tried?
44. When the agents cannot carry on, do they stop and tell a person exactly what is needed instead of stalling in silence?
45. Do you measure, and report internally, how much work is finished with no person stepping in?
46. Do you measure how good the delivered work is, including how much is rejected, redone or found faulty after release?

## Change Management

47. Must every change be independently reviewed, pass the required checks and have its review findings resolved before it can be merged?
48. Are the agents' instructions kept under version control and put through the same checks as the code?
49. Are the model version and its settings fixed, with any change to them tested on your own tasks before use and able to be undone?
50. Is work turned away before agents start it when the request is unclear or the tools and access it needs cannot be shown to work?
51. Is a release to production blocked until someone or something other than the releasing agent approves it?
52. Is each work item checked automatically against a definition of ready for its type before agents may build it?
53. Do you keep your own set of test tasks for judging agents, reviewed on a schedule and hidden from the agents it judges?
54. Are the riskier parts of the system marked, with automatic limits on what agents may do there without a person?
55. Before a new agent's work is relied on, is it run on trial beside the existing checks and tested with deliberately faulty work?

## Third Parties and Supply Chain

56. For each company that supplies a model, are its availability, data retention and training-use terms written down, with a plan for an outage?
57. Is a new outside package refused unless it passes a review or an automatic safety scan?
58. Is a change refused when it brings in an outside package whose licence is not on your approved list?
59. Is every connector that gives agents access to outside tools fixed to a version, checked before use and listed?
60. Was each vendor-hosted service your agents run on assessed for isolation, network access, secret storage and scheduling before real work ran there?

## Software Integrity

61. Is a change refused when the automated tests of individual pieces of code fail?
62. Is a change refused when the share of code exercised by tests falls below a minimum you have set?
63. Do you measure whether your tests would actually catch a mistake, including the defects you have already fixed?
64. Is a release blocked unless every user-facing requirement has an automated walk-through that passed against a running build?
65. After a change ships, does someone or something other than its author use the software and record whether it does what was asked?
66. Is every check that passed after release turned into a permanent automated test?
67. Is a change refused when it breaks your limits on code size, complexity, structure, unused code or house style?
68. Before release, is the software tested under load against response-time and capacity targets you have stated?
69. Are automatically generated inputs, not only hand-written examples, used to test the rules your software must always obey?
70. Is a change refused when it contains code copied from elsewhere whose licence has not been identified and honoured?

## Data Protection

71. Is it defined which kinds of data agents may see, with production and personal data kept out or masked automatically?
72. Are records of agent sessions protected as carefully as the most sensitive data that could appear in them?
73. For every outside company that receives what agents read, is its data retention and training use written down and acceptable under your data duties?

## User-Facing Integrity

74. Are screens built by agents put together from an approved set of components rather than styled one by one?
75. Do colours, spacing and type come from one defined set of values, so that anything outside it is caught automatically?
76. Is every finished screen compared automatically with its approved design, within a difference limit you have set?
77. Are the intended user journeys, including small screens and accessibility, run automatically against the working interface?
