IMPORTANT: The automated workflow eliminates the need for `/clear` between phases

1. Create a file inside specs/ called `<something>.md` and describe what you want claude to do in as much detail as possible. See any `brief.md` for an example.
2. run `/project:bootstrap @specs/<something>.md` inside the claude session
   1. This will create a new project directory in `projects/`
   2. This will conduct comprehensive codebase and web research
   3. This will detect knowledge gaps in the research
   4. **If gaps are found**: Review `projects/<project-name>/research.md` and resolve any "Open Questions" before proceeding to step 3
   5. **If no gaps found**: Proceed directly to step 3
3. run `/project:execute @projects/<project-name>` inside the claude session
   1. This will validate research completeness (abort if gaps exist)
   2. This will create tasks for the project based on the research and brief
   3. This will implement all tasks following TDD practices
   4. This will verify that all the tasks were actually completed
   5. This will take any patterns, findings or rules that weren't already captured and add them to `PROJECT_RULES.md`

If you prefer the manual workflow with individual commands, see `HUMAN_MANUAL.md` for the step-by-step process.
