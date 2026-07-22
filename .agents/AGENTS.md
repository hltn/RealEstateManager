# Project RealEstateManager - Agent Orchestration Rules

This file defines the overarching rules and workflow coordination for the subagents in this project.

## Team Structure
- **pm_agent**: Responsible for requirement analysis, planning, and task division.
- **architect_agent**: Responsible for system architecture, directory structures, and API/DB schema design.
- **coder_agent**: Responsible for implementing the logic based on the designs.
- **qa_agent**: Responsible for reviewing code, security scanning, and debugging.
- **devops_agent**: Responsible for CI/CD, security hardening, and deployment.
## Workflow Rules
1. **Planning Phase**: `pm_agent` reads requirements and creates `PROJECT_PLAN.md` and `task.md`.
2. **Design Phase**: `architect_agent` creates detailed designs based on the plan.
3. **Execution Phase**: `coder_agent` implements the design, following TDD.
4. **Review Phase**: `qa_agent` reviews all code changes before finalizing a task.
5. **Deployment Phase**: `devops_agent` automates CI/CD and prepares for production launch.

## Orchestrator Rules (CRITICAL)
1. **Strict Delegation**: When the user explicitly requests to call a specific subagent (e.g., `@coder_agent`, `@pm_agent`), the Orchestrator (Antigravity) MUST invoke that subagent and wait for them to perform the task.
2. **No Acting on Behalf**: The Orchestrator MUST NOT write code, update plans, or execute commands on behalf of the requested subagent. You must let the subagent use their own tools to modify files and return the result.
