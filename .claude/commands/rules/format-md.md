---
description: "Format any markdown file according to brief.md standard template"
argument-hint: "[markdown-file-path]"
---

# Format Markdown File

Format any markdown file according to the brief.md standard template structure. Provide the markdown file path as argument.

## Usage

```bash
/format-md path/to/file.md
```

## Standard Template Format

The command will reorganize markdown content into this standard structure:

```markdown
# [Document Title]

## Context

[Brief description of the problem or situation]

## Goal

[What needs to be achieved]

## Changes

[List of specific changes needed]

## Implementation

[Detailed steps or technical implementation details]

## Notes

[Additional information, constraints, or special considerations]
```

## Instructions

1. **Read the file**: Read the markdown file provided in $ARGUMENTS
2. **Extract title**:
   - Use the first # heading as title
   - If no # title found, create one that fits the content
3. **Categorize content**:
   - **Context**: Problem/Background/Issue/Current state descriptions
   - **Goal**: Solution/Objective/Purpose/Target statements
   - **Changes**: Requirements/Features/Scope/What's needed items
   - **Implementation**: Steps/Technical details/How to do it/Code blocks
   - **Notes**: Additional info/Warnings/Considerations/Important notes
4. **Reformat**:
   - Move all content into appropriate standard sections
   - Unify language like English
   - Keep code blocks, lists, and formatting intact
5. **Write back**: Save the formatted content to the same file

## Content Mapping Rules

### Headers that map to sections:

- **Context**: Context, Problem, Background, Issue, Current State, Description
- **Goal**: Goal, Objective, Solution, Purpose, Target, What, Solution Overview
- **Changes**: Changes, Requirements, Features, Scope, Deliverables, What's Needed
- **Implementation**: Implementation, Steps, Technical Details, How, Approach, Process
- **Notes**: Notes, Considerations, Constraints, Additional Information, Warnings, Important

Execute this formatting process on the markdown file specified in $ARGUMENTS.
