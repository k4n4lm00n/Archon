---
description: Switch the archon-pr-monitor project's AI provider between Claude and Pi
---

# Switch PR-monitor Provider Command

Deterministically flips the **archon-pr-monitor** project's AI provider between
Claude and Pi/LiteLLM (Qwen) — the provider that answers when a human talks to the
PR-monitor in chat, so routine status checks can run cheaply on Pi. It does **not**
touch the PR-sync daemon itself (that is plain bash and uses no AI).

**Scope** — the switch changes exactly two things and leaves every other topic
untouched:

1. the **codebase default**, so *future* PR topics inherit the choice when scoped, and
2. the topics of the PRs the daemon is **currently monitoring** — derived by reading
   the daemon's own state file(s) (a PR is monitored iff its state has a `pr_<N>` key
   and no `done_<N>` key). Merged/closed PR topics and control/discussion topics are
   **not** touched.

This is the per-project analogue of `/switch-provider` (which flips the GLOBAL
orchestrator). Unlike that one, it needs **no server restart** — the provider is
read fresh from the database on the next message.

## Usage

```
/switch-pr-monitor-provider pi|claude [<target>]
```

## Arguments

- `provider` — either `pi` or `claude`
- `target` *(optional)* — flip just **one** monitored PR topic instead of the whole
  set, and leave the codebase default alone. Accepts a PR number (`2383` or `#2383`),
  a full topic name (`"PR-mon - Archon - 2383"`), or a Zulip topic link.

## What it does

Without a target:

1. Validates the provider argument (`pi` or `claude`).
2. Runs `/home/user/.archon/workspaces/local/archon-pr-monitor/source/pr-monitor-switch.sh <provider>` (host script), which updates the
   `archon-pr-monitor` codebase default **and** only the scoped topics of currently
   monitored PRs (read from the daemon state file). All other topics are untouched.
3. Reports the new provider. No restart is required.

With a target: updates only that one scoped topic; the codebase default is unchanged.

## Examples

```
/switch-pr-monitor-provider pi          # future PRs + monitored PR topics -> Pi/LiteLLM (Qwen), cheap
/switch-pr-monitor-provider claude      # -> Claude, for complex debugging
/switch-pr-monitor-provider pi 2383     # flip ONLY the PR #2383 topic to Pi; default unchanged
```

## Notes

- Pi/LiteLLM (Qwen) is weaker at reasoning than Claude — use it for cheap, routine
  monitoring chatter; flip back to `claude` for hard investigation (e.g. diagnosing
  a blocked PR).
- A topic must be **scoped** to the archon-pr-monitor codebase for this to affect
  it. A monitored PR whose topic is not yet a scoped conversation will simply inherit
  the new default when it is first scoped (the command reports how many are pending).

Task: Run `/home/user/.archon/workspaces/local/archon-pr-monitor/source/pr-monitor-switch.sh $1 $2` (host script) (drop `$2` if empty)
and report the result to the user.

## Project Context

- **Project**: archon-pr-monitor
- **AI Assistant**: pi (LiteLLM/Qwen) for cheap deterministic command handling
- **Script**: `pr-monitor-switch.sh` / `pr-monitor-switch.ts` at the project root
