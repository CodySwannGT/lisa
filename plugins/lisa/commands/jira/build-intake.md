---
description: "Run one JIRA build-intake cycle. Finds tickets in Status=Ready, claims each via In Progress, runs the implementation flow via jira-agent, and transitions to On Dev on completion. Symmetric counterpart to /notion-prd-intake."
allowed-tools: ["Skill"]
argument-hint: "<project key> | <full JQL filter>"
---

Use the /lisa:jira-build-intake skill to scan for Ready JIRA tickets, claim them, run the build flow, and transition to On Dev. $ARGUMENTS
