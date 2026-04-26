---
sessionId: session-260426-151302-eul7
isActive: false
---

# Requirements探索

### Overview & Goals
The goal of this task is to fulfill the remaining requirements from the initial project plan and establish a robust testing environment. This includes completing the TypeScript migration, implementing homepage post iteration, and ensuring high test coverage across both frontend and backend.

### Scope
- **In Scope**:
  - Enabling and fixing strict TypeScript mode.
  - Implementing pagination or "Load More" on the homepage.
  - Fixing failing and skipped tests.
  - Adding new tests for core components and services.
  - Documentation of the testing strategy.
- **Out of Scope**:
  - Major UI redesign.
  - Introduction of new functional features not mentioned in the backlog or issues.

# Technical Design探索

### Current Implementation Context
- **Testing**: Vitest is configured with JSDOM. Some tests exist but many are skipped (`App.test.tsx`) or have minor discrepancies with current server behavior (`server.test.ts`).
- **TypeScript**: Currently in non-strict mode. Most files are `.ts` or `.tsx` but may lack rigorous typing.
- **Homepage**: Iterates through all posts at once. Sorting is done on the server, but there's no pagination.

### Proposed Changes
#### Testing Strategy (`2.2-MDWeb-Testing.md`)
- **Backend**: Focus on `server/lib` and `server/index.ts` endpoints using `supertest`.
- **Frontend**: Focus on `src/App.tsx` components using `@testing-library/react`.
- **Mocks**: Standardize mocking for `axios` and `fs` to ensure isolated tests.

#### TypeScript Hardening
- Enable `"strict": true` in `tsconfig.json`.
- This will require fixing `any` types, missing null checks, and ensuring correct interface usage.

#### Homepage Iteration
- Add a `limit` and `offset` (or `page`) parameter to `/api/posts`.
- Update `Home` component to fetch posts in chunks or provide a paginated view.

### Key Decisions
- **Strict TypeScript**: Adopt strict mode to prevent runtime errors and improve developer experience.
- **Client-Side vs Server-Side Pagination**: Start with client-side pagination given the current low post count, but design the API for future server-side pagination.
- **Test Isolation**: Prefer temp directories and mocks over modifying shared project state during tests.

# Delivery Steps

### ✓ Step 1: Initialize Testing Plan and Update Backlog
Establish the testing strategy and update the project's documentation to reflect the new tasks.
- Create `.plan/2.2-MDWeb-Testing.md` defining the testing strategy (backend unit tests, frontend component tests, coverage goals).
- Update `.plan/0.0-MDWeb-TOC.md` to include the Testing document.
- Update `.plan/3.0-MDWeb-Implementation-Backlog.md` by adding specific testing-related tasks and marking started tasks as `IN_PROGRESS`.

### ✓ Step 2: Complete TypeScript Migration (Strict Mode)
Enable strict mode in TypeScript and resolve all type-related issues across the project.
- Modify `tsconfig.json` to set `"strict": true`.
- Fix type errors in `server/index.ts`, `server/lib/*.ts`, and `src/App.tsx`.
- Ensure proper type definitions for all API responses and component props.
- Mark task `002` as `DONE` in the backlog.

### ✓ Step 3: Implement Homepage Post Iteration
Improve the homepage to support better navigation through posts.
- Implement pagination or "Load More" functionality in the `Home` component in `src/App.tsx`.
- (Optional) Add server-side support for pagination in `server/index.ts` if needed for performance.
- Mark task `003` as `DONE` in the backlog.

### ✓ Step 4: Expand and Fix Unit Tests
Fix existing tests and expand coverage to reach at least 80% for core logic.
- Update `tests/server.test.ts` to expect `403` status for blocked directory traversal attempts.
- Unskip and implement tests in `tests/App.test.tsx`, ensuring the main user flows (listing posts, viewing post, login) are covered.
- Add missing unit tests for `server/lib/auth.ts` and `server/lib/ai-service.ts` if needed.
- Verify all tests pass with `npm test`.