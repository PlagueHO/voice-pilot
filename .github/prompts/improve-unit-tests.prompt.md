---
agent: 'agent'
description: 'Improve Unit Tests to improve coverage and reliability.'
tools: ['runCommands', 'runTasks', 'edit', 'runNotebooks', 'search', 'Microsoft Docs/*', 'context7/*', 'todos', 'runSubagent', 'usages', 'problems', 'changes', 'testFailure', 'openSimpleBrowser', 'fetch', 'githubRepo']
---
# Improve Unit Tests

You must improve the unit tests for `${fileBasename}` to align with testing best practices. Operate on the selected file, pulling in nearby modules or tests only as supporting context. You must use testing guidelines from [AGENTS.md](../../AGENTS.md).

## Instructions
1. Analyze the existing unit tests for `${fileBasename}` and identify areas for improvement, such as:
   - Increasing test coverage to cover untested code paths.
   - Enhancing test reliability by reducing flakiness and dependencies on external systems.
   - Improving test readability and maintainability by refactoring test code.
2. Implement the necessary changes to the unit tests, ensuring they adhere to best practices.
3. Validate your changes by running the unit tests and ensuring all tests pass successfully.
   - Run VS Code Task `npm run lint` to ensure code quality.
   - Run VS Code Task `npm run test:unit` to validate your changes.

# Top 5 Things to Unit Test
1. **Functionality**: Ensure that each function behaves as expected with valid inputs.
2. **Edge Cases**: Test how functions handle edge cases and unusual inputs.
3. **Error Handling**: Verify that functions correctly handle errors and exceptions.
4. **Boundary Conditions**: Test the limits of input ranges to ensure proper handling.
5. **State Changes**: Ensure that functions correctly modify the state of objects or variables.

If you think the functionality under test is not correct, you must stop and ask for guidance. For example, if `function sum(a, b) { return a - b; }` is being tested, you must stop and ask for clarification before proceeding.
