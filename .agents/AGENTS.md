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
