---
sessionId: session-260426-151302-eul7
isActive: false
---

# Requirements探索

### Overview & Goals
The goal of this task is to perform a security assessment of the MDWeb project and create a formal security plan following the CloudBSD Application Planning Guidelines. This will identify vulnerabilities and provide a roadmap for hardening the application against common attacks.

### Scope
- **In Scope**:
  - Risk assessment of the Node.js/Express backend and React frontend.
  - Designing mitigations for identified vulnerabilities (JWT secrets, security headers, XSS, directory traversal).
  - Planning for secure management of AI API keys and secrets.
  - FreeBSD-specific hardening recommendations.
  - Integration of security tasks into the implementation backlog.
  - Implementation of identified security mitigations.
- **Out of Scope**:
  - Comprehensive penetration testing or formal security audits.
  - External network security (firewall configuration outside the app).

# Technical Design探索

### Current Implementation Context
- **Backend**: Express.js server using `jwt` for auth and `bcrypt` for passwords.
- **Identified Risks**:
  - **Weak Secrets**: Hardcoded fallback for `JWT_SECRET` ('freebsd_guy_secret_key').
  - **Missing Headers**: Lack of standard security headers (e.g., `helmet`).
  - **Permissive CORS**: `cors()` middleware used with default (permissive) settings.
  - **Rate Limiting**: No protection against brute-force or DDoS.
  - **Input Sanitization**: Inconsistent use of `sanitize-html`; blog posts are not sanitized on the server before saving.
  - **Directory Traversal**: Basic checks exist but could be more robust.
  - **Secret Storage**: AI API keys stored in `config.json` with potential corruption during "sanitization".

### Proposed Planning Changes
We will introduce a dedicated security design document: `.plan/2.1-MDWeb-Security.md`.

#### Document Structure (`2.1-MDWeb-Security.md`)
1. **Infrastructure**: FreeBSD-specific hardening (jail compatibility, file permissions for `www` user).
2. **Application Middleware**: Proposal for `helmet`, `express-rate-limit`, and tighter `cors` configuration.
3. **Authentication**: Strategy for fixing the broken login and enforcing strong `JWT_SECRET` via environment variables.
4. **Data Protection**: Recommendations for handling `config.json` securely and avoiding corrupting API keys with HTML sanitizers.
5. **Input Validation**: Centralized sanitization strategy for Markdown content.

### Key Decisions
- **FreeBSD First**: Focus on security measures compatible with FreeBSD deployment patterns (e.g., `rc` scripts and `ports`).
- **Standardized Middleware**: Adopt well-known Express security libraries rather than custom implementations.
- **Environment Parity**: Enforce that sensitive secrets MUST be provided via environment variables in production, with no hardcoded fallbacks.

# Delivery Steps

### ✓ Step 1: Create Security Planning Document
Analyze the codebase for security vulnerabilities and document them in a new planning file.
- Create `.plan/2.1-MDWeb-Security.md`.
- Include sections for:
  - Infrastructure Security (FreeBSD specifics).
  - Application Security (Express middleware, Auth).
  - Data Security (Secret management, API keys).
  - Input Validation (XSS, Directory Traversal).
  - AI Security (Prompt injection).
- Document specific mitigations for found risks (e.g., hardcoded JWT secret, missing helmet, lack of rate limiting).

### ✓ Step 2: Update Planning Metadata and Backlog
Update the master TOC and implementation backlog to reflect the new security focus.
- Update `0.0-MDWeb-TOC.md` to include the Security document.
- Append identified security tasks to `3.0-MDWeb-Implementation-Backlog.md` with appropriate IDs and descriptions.

### ✓ Step 3: Implement Core Security Middleware
Install and configure helmet, express-rate-limit, and tighten CORS.
- Install `helmet` and `express-rate-limit`.
- Apply `helmet` with secure CSP in `server/index.ts`.
- Apply `express-rate-limit` to login and AI endpoints.
- Restrict `cors` settings to specific origins.

### ✓ Step 4: Harden Authentication and Secret Management
Remove hardcoded JWT secret fallback and fix API key sanitization bug.
- Update `server/index.ts` to require `JWT_SECRET`.
- Fix `server/index.ts` and `server/lib/config.ts` to avoid sanitizing AI API keys with HTML sanitizer.
- Fix the broken login issue (verify admin credentials/hashing).
- Standardize directory traversal checks across the server.

### ✓ Step 5: Verification and Final Review
Verify security headers are present and test functionality.
- Verify security headers are present in responses.
- Test rate limiting on login endpoint.
- Ensure login and AI features still work correctly.