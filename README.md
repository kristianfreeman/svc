# svc

`svc` is a declarative CLI for macOS **user launchd** services.

This project is vibe coded, but operational behavior is strict: typed config, deterministic plans, and safety rails.

## Why it exists

Raw `launchctl` works, but gets messy fast:

- imperative commands are hard to reason about later
- plists drift from runtime state
- reboot/login behavior is easy to break accidentally
- there is no clean "what changes if I run this" preview

`svc` gives you a clear loop:

1. `validate`
2. `plan`
3. `apply`

## Scope

- Supports **launchd only** (user-level services)
- Does not try to be a general ops orchestrator

## Config location

`svc` uses a flat config layout:

```text
~/.config/svc/
  config.yaml
  namespaces/
    personal.yaml
    side-projects.yaml
```

If run from a directory containing `config.yaml`, it uses local files.

## First principles

`svc` tracks three states:

- **Desired**: YAML config
- **Managed**: `svc` ownership/hash records
- **Runtime**: current launchd jobs

`status` reports:

- `in_sync`
- `drifted`
- `unmanaged`

## Real-looking example

`~/.config/svc/config.yaml`

```yaml
schemaVersion: "1"
managedBy: svc
ownershipPrefixes:
  - com.me.
defaults:
  domain: gui
namespaces:
  personal:
    enabled: true
```

`~/.config/svc/namespaces/personal.yaml`

```yaml
schemaVersion: "1"
namespace: personal
owner:
  team: platform
  contact: platform@example.com
services:
  - label: com.me.live-log-server
    domain: gui
    user: you
    programArguments:
      - /opt/homebrew/bin/bun
      - run
      - dev:server
    workingDirectory: /Users/you/Developer/live-activity-log
    runAtLoad: true
    keepAlive: true
    standardOutPath: /Users/you/Library/Logs/live-activity-log/server.out.log
    standardErrorPath: /Users/you/Library/Logs/live-activity-log/server.err.log

  - label: com.me.live-log-web
    domain: gui
    user: you
    programArguments:
      - /opt/homebrew/bin/bun
      - run
      - dev:web
    workingDirectory: /Users/you/Developer/live-activity-log
    runAtLoad: true
    keepAlive: true
    standardOutPath: /Users/you/Library/Logs/live-activity-log/web.out.log
    standardErrorPath: /Users/you/Library/Logs/live-activity-log/web.err.log

  - label: com.me.live-log-tunnel
    domain: gui
    user: you
    programArguments:
      - /opt/homebrew/bin/cloudflared
      - tunnel
      - run
      - my-live-log
    runAtLoad: true
    keepAlive: true
    standardOutPath: /Users/you/Library/Logs/live-activity-log/tunnel.out.log
    standardErrorPath: /Users/you/Library/Logs/live-activity-log/tunnel.err.log
```

## Commands

- `svc validate [--all|--namespace ...]`
- `svc plan [--all|--namespace ...] [--prune] [--json]`
- `svc apply [--all|--namespace ...] [--prune] [--json] [--dry-run]`
- `svc status [--all|--namespace ...] [--json] [--unmanaged] [--unmanaged-prefix ...]`
- `svc doctor [--all|--namespace ...] [--json]`
- `svc logs <label> [--follow]`
- `svc namespace list [--json]`
- `svc namespace import <namespace> [--prefix ...] [--dry-run]`

## Migration workflow

Import existing user LaunchAgents by prefix:

```bash
npx tsx src/cli.ts namespace import personal --prefix com.me. --dry-run
npx tsx src/cli.ts namespace import personal --prefix com.me.
```

Then reconcile:

```bash
npx tsx src/cli.ts validate --namespace personal
npx tsx src/cli.ts plan --namespace personal --json
npx tsx src/cli.ts apply --namespace personal --json
npx tsx src/cli.ts status --namespace personal --json
```

## Development

```bash
npm install
npm run schema:generate
npm run typecheck
npm test
```

## OpenCode skills

- `svc` onboarding and migration skill: `.opencode/skills/svc-migration/SKILL.md`
