---
description: Show the archon-pr-monitor project's current AI provider
---

# PR-monitor Provider Status Command

Shows which AI provider (Claude or Pi/LiteLLM) the **archon-pr-monitor** project
and its scoped Zulip topics currently use. Read-only — makes no changes.

## Usage

```
/pr-monitor-provider-status
```

## What it does

Runs `/home/user/.archon/workspaces/local/archon-pr-monitor/source/pr-monitor-switch.sh status` (host script) and reports the codebase
default provider plus every Zulip topic scoped to the project and its provider.

Task: Run `/home/user/.archon/workspaces/local/archon-pr-monitor/source/pr-monitor-switch.sh status` (host script) and report the output to the user.

## Project Context

- **Project**: archon-pr-monitor
- **Script**: `pr-monitor-switch.sh` at the project root
