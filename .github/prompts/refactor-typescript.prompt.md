---
agent: 'agent'
description: 'Refactor Typescript file to meet Typescript 5.x and ES2022 best practices.'
tools: ['runCommands', 'runTasks', 'edit', 'runNotebooks', 'search', 'Microsoft Docs/*', 'context7/*', 'todos', 'runSubagent', 'usages', 'problems', 'changes', 'testFailure', 'openSimpleBrowser', 'fetch', 'githubRepo']
---
# Refactor Typescript
You are refactoring `${fileBasename}` to align with [TypeScript 5 / ES2022 best practices](../instructions/typescript-5-es2022.instructions.md). Operate on the selected file, pulling in nearby modules or tests only as supporting context.

## Inputs
- `${input:focus:Refactor focus (optional, e.g. "JSDoc only")}`

## Steps
- Determine scope: if `${input:focus}` or the chat request limits the refactor, confine analysis and edits to that focus while safeguarding existing behavior elsewhere.
- Inspect `${file}` to understand its purpose, public API, and dependencies before changing code. Note any assumptions or consumers.
- Compare the implementation against the linked guidance; flag issues such as implicit `any`, outdated async patterns, poor error handling, or violations of the project's modular structure.
- Refactor the file to satisfy the guidance: tighten typings, modernize async logic, simplify control flow, reuse shared utilities, and preserve DI/lifecycle contracts.
- Validate that the refactor keeps the extension functional: consider initialization order, disposal hooks, configuration reads, and performance budgets.

## Output
- Provide the updated code for `${fileBasename}` (complete file or minimal diff) and highlight critical decisions, noting how you honored `${input:focus}` when supplied.
- Summarize improvements in bullets plus any follow-up tasks.
- Recommend validation steps (ex: `npm run lint`, targeted tests) relevant to the touched logic.

