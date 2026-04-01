---
name: svc-migration
description: >
  Install and adopt svc for existing macOS user launchd services with a safe,
  prefix-scoped migration workflow and ongoing operator guardrails.
version: 0.1.0
---

# svc-migration

## Outcome
- Install and verify `svc` on macOS.
- Import existing user LaunchAgents into `config.yaml` + `namespaces/*.yaml` safely.
- Reconcile runtime using `validate -> plan -> apply -> status` with dry-run-first safety.
- Verify reboot resilience for generated plists and launchctl targets.
- Leave a clear rollback path and a short verification report.

## When To Use
- Migrating existing user-level launchd jobs to `svc` management.
- Bootstrapping a new machine where launchd jobs already exist.
- Auditing operator safety before enabling prune/apply in automation.

## When Not To Use
- System-level daemons (`/Library/LaunchDaemons`) or root-managed services.
- Non-launchd process supervisors.
- Bulk destructive cleanup where label ownership is unclear.

## Required Inputs
- macOS environment with access to user launchd and `~/Library/LaunchAgents`.
- Target namespace name (example: `personal`) and ownership prefix list (example: `com.me.`).
- Confirmation of high-risk labels to mutate (labels matching broad or shared prefixes).
- Working directory for config source of truth:
  - local repo config (`./config.yaml`) if present, or
  - runtime config (`~/.config/svc/config.yaml`) otherwise.

## Output Contract
Produce a concise report with:
- **Scope:** selected namespace and prefixes.
- **Import Preview:** labels discovered by dry-run import.
- **Plan Summary:** create/update/restart/delete/noop counts.
- **Apply Result:** executed actions (or explicit dry-run only outcome).
- **Safety Evidence:** unmanaged prune posture, launchctl target checks, plist file checks.
- **Rollback Plan:** exact restore steps used for this migration.

## Safety Guardrails (Non-Negotiable)
1. Never run `apply --prune` during first adoption.
2. Always run dry-run import and dry-run apply before any mutating apply.
3. Keep scope namespace-specific (`--namespace <ns>`) unless explicitly told to use `--all`.
4. Require explicit human confirmation before mutating high-risk labels:
   - prefixes with high blast radius (example: `com.apple.`, `com.google.`, org-wide shared prefixes), or
   - labels not clearly owned by the current user/project.
5. Do not adopt unmanaged labels outside the approved prefix list.

## Workflow

### Phase 1: Preflight and install checks
Objective: verify tooling and runtime prerequisites.

Steps:
1. Confirm repo/deps and buildability:
   ```bash
   npm install
   npm run build
   npm run typecheck
   ```
2. Verify runtime config path decision:
   ```bash
   test -f ./config.yaml && echo "using local config" || echo "using ~/.config/svc"
   ```
3. Run health diagnostics:
   ```bash
   npx tsx src/cli.ts doctor --json
   ```

Decision gates:
- If build/typecheck fails: stop and fix before migration.
- If `doctor` reports launchctl unavailable: stop (no migration).

Validation:
- `doctor` must report `ok: true` (or equivalent all-checks pass).

### Phase 2: Discovery and prefix scoping
Objective: enumerate existing user launchd jobs and constrain migration blast radius.

Steps:
1. Inspect runtime labels (read-only):
   ```bash
   launchctl list
   ```
2. Inspect existing unmanaged labels through `svc` lens:
   ```bash
   npx tsx src/cli.ts status --namespace <ns> --unmanaged --unmanaged-prefix <prefix> --json
   ```
3. Choose the narrowest viable prefix set.

Decision gates:
- If prefix matches third-party/shared labels, stop and request explicit confirmation.
- If no prefix can isolate ownership, split migration into smaller namespaces.

Validation:
- Candidate label set is human-reviewed and approved before import.

### Phase 3: Safe import (dry-run first)
Objective: generate namespace config and ownership prefixes without mutation first.

Steps:
1. Preview import:
   ```bash
   npx tsx src/cli.ts namespace import <ns> --prefix <prefix> --dry-run
   ```
2. If preview is correct, execute import:
   ```bash
   npx tsx src/cli.ts namespace import <ns> --prefix <prefix>
   ```
3. Review written files:
   - `config.yaml` (or `~/.config/svc/config.yaml`)
   - `namespaces/<ns>.yaml` (or `~/.config/svc/namespaces/<ns>.yaml`)

Decision gates:
- If preview includes unexpected labels, adjust prefix and rerun dry-run.
- If imported specs miss required command fields, fix YAML before planning.

Validation:
- Import output includes only approved labels.

### Phase 4: Reconcile with dry-run/apply/status
Objective: converge desired, managed, and runtime state safely.

Steps:
1. Validate config:
   ```bash
   npx tsx src/cli.ts validate --namespace <ns>
   ```
2. Review plan:
   ```bash
   npx tsx src/cli.ts plan --namespace <ns> --json
   ```
3. Preview apply (mandatory):
   ```bash
   npx tsx src/cli.ts apply --namespace <ns> --dry-run --json
   ```
4. Mutating apply only after review:
   ```bash
   npx tsx src/cli.ts apply --namespace <ns> --json
   ```
5. Verify status:
   ```bash
   npx tsx src/cli.ts status --namespace <ns> --json
   ```

Decision gates:
- If plan contains `delete` actions, do not proceed unless this is an intentional managed cleanup.
- If plan contains actions for unapproved labels, stop and fix config scope.

Validation:
- Status should move targeted labels to `in_sync`.

### Phase 5: Reboot resilience and runtime integrity
Objective: ensure services survive logout/reboot with correct launchd targeting.

Steps:
1. Verify plist files exist in user LaunchAgents:
   ```bash
   ls ~/Library/LaunchAgents/<label>.plist
   ```
2. Verify launchctl path is GUI user domain:
   ```bash
   launchctl print gui/$(id -u)/<label>
   ```
3. Optional restart check for one service:
   ```bash
   npx tsx src/cli.ts plan --namespace <ns>
   npx tsx src/cli.ts apply --namespace <ns>
   ```
4. Post-login/reboot recheck:
   ```bash
   npx tsx src/cli.ts status --namespace <ns> --json
   ```

Decision gates:
- If plist is missing under `~/Library/LaunchAgents`, stop and re-run scoped apply.
- If `launchctl print gui/<uid>/<label>` fails after apply, inspect logs and plist contents before retry.

Validation:
- Each migrated label has both plist presence and `launchctl print` success.

### Phase 6: Rollback guidance
Objective: provide fast recovery if migration introduces regressions.

Steps:
1. Back up config before first mutating apply:
   ```bash
   cp ~/.config/svc/config.yaml ~/.config/svc/config.yaml.bak
   cp -R ~/.config/svc/namespaces ~/.config/svc/namespaces.bak
   ```
2. To roll back managed runtime changes for namespace:
   ```bash
   npx tsx src/cli.ts plan --namespace <ns>
   npx tsx src/cli.ts apply --namespace <ns>
   ```
   (Use prior known-good config contents before this step.)
3. If needed, manually restore previous plists to `~/Library/LaunchAgents` and bootstrap:
   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<label>.plist
   ```

Decision gates:
- If rollback requires deleting labels, require explicit confirmation and exact label list.

Validation:
- `status --namespace <ns> --json` shows expected stable state after rollback.

## Decision Rules
- If user asks for broad prune during onboarding, default to no prune and explain why.
- If labels span multiple ownership prefixes, split into multiple namespaces.
- If any command output is ambiguous, rerun with `--json` and decide from machine-readable summary.
- If migration scope is unclear, pause before mutation and request explicit prefix + label approval.

## Common Pitfalls
- Pitfall: Importing with an overly broad prefix.
  - Fix: rerun dry-run import with narrower prefix; do not apply until clean.
- Pitfall: Running `apply --prune` on first adoption.
  - Fix: rerun without prune; only prune after multiple clean status runs.
- Pitfall: Assuming local `config.yaml` when operating from another cwd.
  - Fix: explicitly confirm active config path before import/apply.
- Pitfall: Treating `launchctl list` as ownership truth.
  - Fix: use `status --unmanaged --unmanaged-prefix` plus namespace ownership review.

## Verification Checklist (Agent-Executable)
Run and report pass/fail for each item:
1. `npx tsx src/cli.ts doctor --json` succeeds.
2. `namespace import <ns> --prefix <prefix> --dry-run` returns only approved labels.
3. `validate --namespace <ns>` succeeds.
4. `apply --namespace <ns> --dry-run --json` reviewed with no unapproved actions.
5. Mutating `apply --namespace <ns> --json` executed (or intentionally skipped).
6. `status --namespace <ns> --json` shows expected `in_sync` labels.
7. For at least one label: plist file exists and `launchctl print gui/$(id -u)/<label>` succeeds.
8. Rollback backup files exist or rollback method is explicitly documented.

## References
- `README.md`
- `src/cli.ts`
- `src/commands/import.ts`
- `src/commands/apply.ts`
- `src/launchd/adapter.ts`

## Maintenance
- Owner: `svc` maintainers
- Last updated: 2026-04-01
