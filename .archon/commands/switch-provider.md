---
description: Switch the global Archon orchestrator provider between Claude and Pi
---

# Switch Provider Command

This command is part of the **archon-switch-orchestrator-provider** project and switches the global Archon orchestrator provider between Claude and Pi/LiteLLM without requiring AI processing.

## Usage

```
/switch-provider pi|claude
```

## Arguments

- `provider` - Either `pi` or `claude`

## What it does

1. Validates the provider argument
2. Calls the orchestrator-switch script to modify config.yaml
3. Restarts the server to apply the change
4. Confirms the switch with the user

## Examples

```
/switch-provider pi
/switch-provider claude
```

## Notes

- Pi/LiteLLM uses Qwen3.6 which is weaker at workflow routing than Claude
- Use Claude when you need high-quality workflow decisions
- Use Pi when Claude is out of credits

Task: Switch the orchestrator provider to $1

## Project Context

- **Project**: archon-switch-orchestrator-provider
- **Scoped to**: `archon-switch-orchestrator-provider` topic in #DarkFactory stream
- **AI Assistant**: pi (LiteLLM/Qwen3.6)
