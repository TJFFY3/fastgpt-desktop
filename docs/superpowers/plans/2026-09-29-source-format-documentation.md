# Source Formatting and Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consistently format eligible production source and document the responsibility of its files, declarations, and meaningful objects without behavior changes.

**Architecture:** Add a pinned, repository-level formatter for TypeScript, TSX, and CSS, then apply it only to an explicit production-source allowlist. Document modules in their existing boundaries: desktop process layers, renderer UI, shared contracts, model adapter, storage, agent core, and native file helper; no runtime interfaces or source layout change.

**Tech Stack:** Node.js 22+, npm workspaces, Prettier 3.9.9, TypeScript 5.9.3, React 19, Vitest, Playwright, C/clang-format when available.

**Spec:** `docs/superpowers/specs/2026-09-29-source-format-documentation-design.md`

## Global Constraints

- Modify only `apps/desktop/src/`, `packages/*/src/`, `apps/desktop/native/safe-files-posix.c`, and the formatter dependency/configuration; preserve the unrelated `.idea/workspace.xml` deletion.
- Exclude all tests, fixtures, end-to-end tests, `scripts/`, tool configuration, documentation other than this plan/spec, dependencies, and generated/compiled outputs.
- Use Prettier 3.9.9 pinned exactly for TypeScript, TSX, and CSS; do not pass C through Prettier.
- Add file headers and comments for meaningful classes, interfaces, type aliases, enums, functions, methods, React components/hooks, and domain-bearing named object literals.
- Comments must explain responsibility, boundary, or data semantics; avoid restating a name/type and avoid disposable local-variable comments.
- Preserve exports, imports, signatures, persistence schemas, IPC contracts, and behavior.

## Review Focus

- Excluded paths: a formatter glob must not modify any test, fixture, script, configuration, or output file; verify with `git diff --name-only`.
- Idempotence: a second formatter check must report no changes for every TypeScript, TSX, and CSS production file.
- Type declaration preservation: `.d.ts` globals and shared IPC/protocol contracts must continue to typecheck unchanged.
- Native-helper safety: C formatting/comments must retain a successful safe-file native build.
- Comment usefulness: public and domain-bearing declarations must gain role-oriented comments without misleading consumers or implying changed behavior.

---

### Task 1: Establish source-only formatter configuration

**Files:**
- Create: `.prettierrc.json`
- Modify: `package.json`, `package-lock.json`
- Verify: the explicit TypeScript/TSX/CSS allowlist under `apps/desktop/src/` and `packages/*/src/`

**Interfaces:**
- Consumes: npm workspace root `package.json` scripts and existing Node 22+ environment.
- Produces: `prettier@3.9.9` as an exact root development dependency and a repository formatting policy used by later tasks.

- [ ] **Step 1: Add the failing formatter check**

Add an npm `format:check` command that invokes Prettier only on `apps/desktop/src/**/*.{ts,tsx,css}` and `packages/*/src/**/*.ts`; use explicit quoted patterns so shell expansion cannot include excluded paths.

- [ ] **Step 2: Run the formatter check to verify the unformatted baseline**

Run: `npm run format:check`

Expected: FAIL because the current production TypeScript/TSX/CSS files do not conform to the new policy.

- [ ] **Step 3: Pin and configure Prettier**

Install exact `prettier@3.9.9` at the workspace root, create `.prettierrc.json` with a stable project-wide policy (two-space indentation, semicolons, single quotes, trailing commas where valid, 100-character print width, LF endings), and add `format` alongside `format:check` using the same allowlist.

- [ ] **Step 4: Verify formatter coverage and exclusions**

Run: `npm run format:check`

Expected: the command reports only files under the allowlist; it may still fail before Task 2 formats them.

- [ ] **Step 5: Commit formatter setup**

```bash
git add package.json package-lock.json .prettierrc.json
git commit -m "chore: add source formatter configuration"
```

### Task 2: Format and document desktop process and native helper modules

**Files:**
- Modify: `apps/desktop/src/main/**/*.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/worker/index.ts`, `apps/desktop/native/safe-files-posix.c`
- Verify: `npm run build:safe-files`, `npm run typecheck`

**Interfaces:**
- Consumes: formatter policy from Task 1; existing Electron IPC, worker, protocol, credential, service, and filesystem interfaces.
- Produces: consistently formatted and responsibility-documented desktop runtime modules with no interface changes.

- [ ] **Step 1: Add module and declaration documentation**

For every listed module, add a file header and comments for process services, IPC validators/objects, protocol handlers, worker protocol adapters, filesystem policy and storage objects, exported helpers, classes, interfaces/types, methods, and domain-bearing literals. Use JSDoc for TypeScript and C block comments for the native helper.

- [ ] **Step 2: Format the TypeScript/TSX/CSS subset**

Run: `npm run format`

Expected: only allowed TypeScript, TSX, and CSS files are rewritten; inspect the C file separately and use `clang-format` only if installed and it preserves the file's valid compilation.

- [ ] **Step 3: Build the native helper**

Run: `npm run build:safe-files`

Expected: PASS and emits the expected native helper output without source diagnostics.

- [ ] **Step 4: Typecheck desktop contracts**

Run: `npm run typecheck`

Expected: PASS with no changed public contract errors.

- [ ] **Step 5: Commit desktop documentation**

```bash
git add apps/desktop/src apps/desktop/native/safe-files-posix.c
git commit -m "docs: document desktop source modules"
```

### Task 3: Format and document renderer modules

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`, `main.tsx`, `env.d.ts`, `styles.css`, `components/*.tsx`, `hooks/*.ts`
- Verify: `npm run typecheck`, `npm test -- --run apps/desktop/tests/chat-view.test.ts apps/desktop/tests/run-trace.test.ts`

**Interfaces:**
- Consumes: existing renderer props, `DesktopApi`, shared view types, and styling selectors.
- Produces: documented UI composition, component prop objects, hook state/event behavior, and style section purposes without selector or interaction changes.

- [ ] **Step 1: Add file, component, hook, prop-object, and style-section comments**

Document each module's UI responsibility; describe components and hooks at their declarations; document props and configuration objects that carry UI behavior; add CSS file and section comments only where they identify a user-facing area. Do not add comments to JSX layout literals with no independent semantic role.

- [ ] **Step 2: Run formatter and inspect renderer-only diff**

Run: `npm run format && git diff --check -- apps/desktop/src/renderer`

Expected: PASS; line-wrap and indentation changes are formatting-only outside added documentation.

- [ ] **Step 3: Run targeted renderer tests**

Run: `npm test -- --run apps/desktop/tests/chat-view.test.ts apps/desktop/tests/run-trace.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit renderer documentation**

```bash
git add apps/desktop/src/renderer
git commit -m "docs: document renderer source modules"
```

### Task 4: Format and document shared, model-adapter, agent-core, and storage packages

**Files:**
- Modify: `packages/shared/src/*.ts`, `packages/model-adapter/src/*.ts`, `packages/agent-core/src/*.ts`, `packages/storage/src/*.ts`
- Verify: `npm run typecheck`, `npm test -- --run packages/shared/tests packages/model-adapter/tests packages/agent-core/tests packages/storage/tests`

**Interfaces:**
- Consumes: existing workspace exports, persistent records, agent APIs, OpenAI-compatible request/stream behavior, Zod schemas, and SQLite-like storage boundary.
- Produces: consistently formatted core package modules with documented public contracts, persistence records, schema objects, adapters, registries, runners, and repositories.

- [ ] **Step 1: Document shared contracts and schemas**

Add headers and role-oriented comments in `packages/shared/src` for exported types/interfaces/classes, schemas, feature/event/IPC object contracts, and non-trivial helpers; retain exact serialized field names and union values.

- [ ] **Step 2: Document model, agent, and persistence boundaries**

Add headers and declaration/domain-object comments in model adapter, agent core, and storage modules. Explain adapter request/stream conversion, tool registration/policy/execution, database migration/namespace/repository responsibilities, and record-mapping objects without altering SQL or runtime logic.

- [ ] **Step 3: Run formatter and package checks**

Run: `npm run format && npm run typecheck`

Expected: PASS; a subsequent `npm run format:check` reports no changed files.

- [ ] **Step 4: Run package test suites**

Run: `npm test -- --run packages/shared/tests packages/model-adapter/tests packages/agent-core/tests packages/storage/tests`

Expected: PASS.

- [ ] **Step 5: Commit package documentation**

```bash
git add packages/shared/src packages/model-adapter/src packages/agent-core/src packages/storage/src
git commit -m "docs: document shared package source modules"
```

### Task 5: Run cross-repository quality and scope verification

**Files:**
- Verify: all modified allowlisted production files, `.prettierrc.json`, `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: the formatter setup and all documented modules from Tasks 1-4.
- Produces: evidence that behavior, source-only scope, and formatting idempotence are preserved.

- [ ] **Step 1: Check the modified-file allowlist**

Run: `git diff --name-only HEAD~4..HEAD` (or compare against the pre-work baseline commit if commit count differs).

Expected: only source allowlist files, formatter setup, and the already-committed design/plan documentation appear; `.idea/workspace.xml` is not staged or changed by this work.

- [ ] **Step 2: Confirm formatter idempotence**

Run: `npm run format:check`

Expected: PASS with no formatting differences.

- [ ] **Step 3: Run complete verification**

Run: `npm run typecheck && npm test`

Expected: both commands PASS. If a failure is demonstrably pre-existing, record its exact command and diagnostic separately rather than modifying excluded tests.

- [ ] **Step 4: Inspect behavior-sensitive source changes**

Run: `git diff --check HEAD~4..HEAD && git diff --word-diff=plain HEAD~4..HEAD -- apps/desktop/src packages apps/desktop/native/safe-files-posix.c`

Expected: PASS with comments and formatting only; no changed runtime string literals, SQL, schemas, IPC channel names, selectors, or function signatures.

- [ ] **Step 5: Commit verification adjustments if required**

If verification needs a source-only correction, commit it with `chore: verify source formatting and documentation`; otherwise no new commit is required.
