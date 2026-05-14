---
name: block-env-branch-push
enabled: true
event: bash
action: block
pattern: git\s+push\s+.*\b(main|dev|staging|production)\b
---

**Direct push to environment branch blocked!**

You are attempting to push directly to an environment branch (main, dev, staging, or production). This is forbidden by project rules.

**What to do instead:**
- Create a feature branch: `git checkout -b feat/your-change`
- Push your feature branch: `git push -u origin feat/your-change`
- Open a pull request for code review
