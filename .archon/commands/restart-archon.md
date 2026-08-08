---
description: Restart the Archon orchestrator server
---

# Restart Archon Command

This command is part of the **archon-switch-orchestrator-provider** project and restarts the Archon orchestrator server to apply configuration changes without requiring AI processing.

## Usage

```
/restart-archon
```

## What it does

1. Checks if the server is running
2. Restarts the server using the orchestrator-switch script
3. Waits for the server to become healthy
4. Confirms the restart with the user

## Examples

```
/restart-archon
```

## Notes

- Use this command after making configuration changes
- The server will be unavailable during restart (~30-60 seconds)
- This command works with any provider (Claude or Pi)

Task: Restart the Archon orchestrator server

## Project Context

- **Project**: archon-switch-orchestrator-provider
- **Scoped to**: `archon-switch-orchestrator-provider` topic in #DarkFactory stream
- **AI Assistant**: pi (LiteLLM/Qwen3.6)
