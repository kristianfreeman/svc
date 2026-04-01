# Project Agent Rules

## Purpose

- `svc` declaratively manages macOS user-level `launchd` services.
- Optimize for operator safety, deterministic reconcile behavior, and reboot resilience.
- Keep the UX simple: `validate` -> `plan` -> `apply`.

## Project Context

- This project is vibe coded, but runtime behavior is strict and typed.
- YAML is the authoring format; typed schemas and semantic validation are the source of truth.
- `launchd` is the runtime system of record.

## Safety Invariants

- Reject unknown keys in all configs.
- Fail fast on schema or semantic validation errors.
- Never touch unmanaged services during prune operations.
- Scope operations to selected namespaces unless `--all` is explicitly used.
- Prefer dry-runs and plans before mutation.

## Managed State Model

- Desired state lives in `ops/launchd/root.yaml` and `ops/launchd/namespaces/*.yaml`.
- Managed records track ownership and hash-based convergence.
- Runtime jobs that already exist may be adopted into managed state during migration.

## Code Boundaries

- `src/config`: schemas, parsing, semantic validation
- `src/planner`: desired graph + action planning
- `src/commands`: CLI command behaviors
- `src/launchd`: launchctl/plist adapter
- `src/state`: managed records store

## Contribution Guidelines

- Keep changes deterministic and testable.
- Add tests for validation, plan semantics, and apply safety when behavior changes.
- Preserve JSON output stability for automation consumers.
- Update `README.md` when command behavior or safety guarantees change.

## Release Checklist

- `npm run schema:generate`
- `npm run typecheck`
- `npm test`
