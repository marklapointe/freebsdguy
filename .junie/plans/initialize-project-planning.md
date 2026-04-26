---
sessionId: session-260426-151302-eul7
isActive: false
---

# Requirements

### Overview & Goals
The goal of this task is to establish a structured planning environment for the **MDWeb** project, following the [CloudBSD Application Planning Guidelines](https://github.com/cloudbsdorg/application_guidelines/tree/main/Planning). This will enable better collaboration between human developers and autonomous agents by providing a single source of truth for project scope, architecture, and task tracking.

### Scope
- **In Scope**:
  - Creation of a `.plan/` directory.
  - Creation of mandatory meta-documents (`TOC`, `Workflow`).
  - Creation of a high-level project overview.
  - Creation of an agent-friendly entry point (`AGENTS_START_HERE.md`).
  - Mapping existing project issues into a structured task backlog.
- **Out of Scope**:
  - Implementation of functional code changes (e.g., fixing login bugs).
  - Modifying the existing application logic or UI.

# Technical Design

### Current Implementation
The project **MDWeb** is a personal website stack currently consisting of:
- **Frontend**: React (Vite) with Tailwind CSS.
- **Backend**: Express (Node.js) using TypeScript (`tsx`).
- **Features**: Markdown-based blog posts, AI summarization (Ollama/OpenAI), Theme management.
- **Deployment**: FreeBSD-centric with `Makefile`, `ports`, and `rc` scripts.

### Proposed Changes
We will implement the `.plan/` directory following the `<Major>.<Minor>-<Project>-<Topic>.md` convention.

#### File Structure
```
.plan/
├── 0.0-MDWeb-TOC.md
├── 0.1-MDWeb-Workflow.md
├── 1.0-MDWeb-Overview.md
└── 3.0-MDWeb-Implementation-Backlog.md
AGENTS_START_HERE.md
```

#### Document Contents
1.  **0.0-MDWeb-TOC.md**: Links to all planning documents with their current status (`PENDING`, `STALE`, `DONE`).
2.  **0.1-MDWeb-Workflow.md**: Protocol for task claiming, completion, and the standardized task table format (ID, Task, Status, Assigned To, etc.).
3.  **1.0-MDWeb-Overview.md**: Executive summary of MDWeb, architecture diagrams (React/Express/Markdown), and target use cases.
4.  **3.0-MDWeb-Implementation-Backlog.md**: Initial implementation tasks, including:
    - Fixing the login issue mentioned in `issues.md`.
    - Ensuring full TypeScript coverage.
    - Implementing the homepage post iteration feature.
5.  **AGENTS_START_HERE.md**: A root-level entry point that reminds agents they are in a FreeBSD environment (ignoring Linux-isms) and guides them to the `.plan/` directory.

### Key Decisions
- **Project Identifier**: `MDWeb` will be used for all document naming.
- **Task Management**: We will use the standardized Markdown table format defined in the guidelines to track progress within the repository.
- **FreeBSD First**: Documentation will emphasize that the project is designed for FreeBSD, aligning with the `mdweb.rc` and `ports/` structure.

# Delivery Steps

### ✓ Step 1: Initialize .plan directory and meta-documents
Initialize the `.plan/` directory structure and create the foundational meta-documents.
- Create the `.plan/` directory at the project root.
- Implement `0.0-MDWeb-TOC.md` containing the master table of contents and document statuses.
- Implement `0.1-MDWeb-Workflow.md` defining the task-claiming protocol and standardized task table format.

### ✓ Step 2: Document project overview and architecture
Document the project's purpose, architecture, and core components in the overview document.
- Create `1.0-MDWeb-Overview.md` covering:
  - Project summary (Personal website with AI-powered blogging).
  - High-level architecture (React frontend, Express backend).
  - Key features (AI summarization, Markdown storage, Theme management).
  - Platform details (FreeBSD deployment focus).

### ✓ Step 3: Create agent entry point and implementation backlog
Establish the primary entry point for agents and initialize the implementation backlog.
- Create `AGENTS_START_HERE.md` at the root with a project summary, FreeBSD environment reminder, and links to the planning documents.
- Create `3.0-MDWeb-Implementation-Backlog.md` with initial tasks derived from `issues.md`, such as fixing the login issue and completing the TypeScript migration.