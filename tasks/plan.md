# Codex model coordination for AyahX

Original setup scope below is complete. On 2026-10-15 the owner activated full
enterprise implementation, external infrastructure and gated deployment.
The execution plan is the preserved package's 28 tasks and the row-level
`docs/implementation/ayahx-plan/COVERAGE.md`; progress, verification and next
actions live in that directory. No second independent plan is introduced.

## Decisions

- Use native Codex custom agents, without an API router or a second agent runtime.
- Keep personal Codex configuration unchanged. Project root is the user's
  `C:\Users\cpazi\Desktop\ayahX`; old Downloads examples in the package are stale.
- Sol coordinates and integrates; Luna handles bounded work; Astra reviews
  consequential decisions. Avoid mandatory three-model discussion per task.
- Limit spawned concurrency to two. Use compact, fresh-context handoffs,
  one writer per file, bounded review cycles, and persistent progress.
- Routing and review budgets are agent instructions, not a hard token quota.

## Ordered work

1. Verify installed model/catalog and native configuration support.
2. Add project defaults, three custom agents, and enterprise routing policy.
3. Add a preview-first launcher, Arabic guide and unstarted plan checkpoints.
4. Verify effective configuration through the installed Codex runtime, review
   with Astra, and run the toolkit checks. Record evidence and remaining limits.

## Acceptance

- All three exact requested model IDs are present in the installed catalog.
- Native runtime loads Sol/medium and project subagent defaults. Standalone
  role definitions parse and match the documented schema; live role dispatch
  is explicitly deferred until execution rather than claimed as tested.
- Starting implementation requires an explicit start action; preview/check
  does not run inference or implement enterprise features.
- Every enterprise task ID remains represented, with deployment and live-data
  gates intact. Existing source code and supplied package remain untouched.
- Global config SHA256 remains unchanged and validation has fresh evidence.

Task list: `tasks/todo.md`. Enterprise execution state is separately kept in
`docs/implementation/ayahx-plan/`.
