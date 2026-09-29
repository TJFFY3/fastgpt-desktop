# Source formatting and documentation design

## Goal

Make the production source tree consistently formatted and self-explanatory without changing runtime behaviour. Every eligible source file receives a concise header, and meaningful declarations receive comments that describe their role rather than restating their names or types.

## Scope

The change applies to production code in:

- `apps/desktop/src/`
- `packages/*/src/`
- `apps/desktop/native/safe-files-posix.c`

It excludes all test and fixture directories, end-to-end tests, build or developer scripts, tool configuration, documentation outside this design, dependencies, and generated or compiled output. Package manifests change only as required to pin the formatter development dependency. The existing unrelated `.idea/workspace.xml` modification remains untouched.

## Formatting

Add a repository Prettier configuration pinned through the project development dependencies. Format supported TypeScript, TSX, JavaScript, CSS, JSON, YAML, Markdown, and C source only when those files are within the eligible production-source paths. Formatting uses the repository's configured rules and is idempotent.

The C source file is formatted with the available C formatter or minimally normalized by hand if the formatter cannot preserve its build-compatible syntax. It is not passed through a TypeScript formatter.

## Documentation rules

Each eligible file begins with a short language-appropriate header that explains the module's responsibility.

Comments are added for:

- classes, interfaces, type aliases, enums, and C structs;
- exported and non-trivial internal functions, class methods, React components, and hooks;
- named objects and object literals that represent configuration, protocol payloads, schemas, maps, persistent records, or other domain concepts;
- CSS sections when they group a UI area or behavior.

Comments explain why a declaration exists, what boundary it owns, or how consumers should interpret it. They do not duplicate obvious identifiers, annotate disposable local variables, or add documentation where TypeScript's type expression already gives the complete meaning. Inline object literals passed as one-off implementation details are documented only when they carry domain or behavioral meaning; the surrounding declaration is the preferred comment location.

## Implementation approach

1. Identify the eligible source file list with explicit directory filters, then preserve the current git state as the baseline.
2. Add the formatter dependency and configuration, then run it only over that list.
3. Work module by module, adding headers and declaration comments while retaining imports, exports, signatures, and behavior.
4. Review the diff for accidental edits outside the allowlist and for comments that merely repeat code.
5. Run type checking and the current automated test suite. Fix any unintended formatting or type regressions before completion.

## Error handling and rollback

No code path or runtime interface changes are intentional. If a formatter changes a syntax-sensitive C or generated-looking file, limit formatting for that file to safe manual normalization and keep its behavior unchanged. If test or typecheck failures expose a change caused by this work, correct the affected edit; unrelated pre-existing failures are reported separately with their command output.

## Acceptance criteria

- Only the eligible production source files and the formatter setup are changed.
- Tests, scripts, fixtures, configuration, and compiled output are unchanged.
- All eligible files have a responsibility header.
- Meaningful declaration and domain-object definitions have useful comments.
- The chosen formatter reports no further changes after a second run.
- Type checking and the existing test suite pass, or any pre-existing failure is clearly identified.
