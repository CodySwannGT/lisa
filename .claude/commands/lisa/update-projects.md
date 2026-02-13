---
description: "Updates local Lisa project in batches"
---


1. read @.lisa.config.local.json 
2. go into each of those directories and checkout the branch in the value for each and pull down the latest from the remote. 
3. If you can't because of existing changes or whatever, don't do anything. Ask the human what should be done about it before moving on
4. Once you have resolution, within each of the clean projects, check out a branch to upgrade lisa
5. From lisa, run bun run dev <directory-path> -y
6. Commit, push and PR the branch to the project's target branch specified in @.lisa.config.local.json
7. If you hit any pre-push blockers, fix them and upstream anything that needs to. Do not lower any thresholds to get around a pre-push block. Instead, fix the code

For steps 4-7, use up to 4 parallel subagents to accomplish those steps
