# Welcome Agents!

You are working on **MDWeb**, a personal website stack designed for FreeBSD.

## Essential Context
- **Environment**: You are in a FreeBSD-centric environment. Ignore Linux-specific assumptions (e.g., systemd).
- **Architecture**: React (Vite) frontend, Express (Node.js) backend, Markdown-based storage.
- **Planning**: All project planning, task tracking, and architectural decisions are documented in the `.plan/` directory.

## Getting Started
1. **Review the Plan**: Start by reading [.plan/0.0-MDWeb-TOC.md](.plan/0.0-MDWeb-TOC.md) to see available documentation.
2. **Workflow**: Follow the protocol in [.plan/0.1-MDWeb-Workflow.md](.plan/0.1-MDWeb-Workflow.md) for task management.
3. **Backlog**: Check [.plan/3.0-MDWeb-Implementation-Backlog.md](.plan/3.0-MDWeb-Implementation-Backlog.md) for current tasks and pick one to work on.

## Key Files
- `Makefile`: Build and deployment commands.
- `mdweb.rc`: FreeBSD service script.
- `ports/www/mdweb/`: FreeBSD port definitions (when present; see `.plan/4.0`).
- `server/`: Backend source code.
- `src/`: Frontend source code.
- Test host for package regression: `mlapointe@172.16.176.133` (see `.plan/4.1`).

## Mandatory Verification
Before submitting any work, you **MUST**:
1. **Build**: Run `npm run build` to ensure both frontend and backend compile successfully.
2. **Test**: Run `npm test` and ensure all tests pass.
3. **Plan**: Update the relevant planning documents in `.plan/` to reflect your changes and task progress.
