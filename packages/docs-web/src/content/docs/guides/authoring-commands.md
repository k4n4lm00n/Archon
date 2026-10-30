---
title: Authoring Commands
description: Write prompt templates that serve as building blocks for AI workflow nodes.
category: guides
area: workflows
audience: [user]
status: current
sidebar:
  order: 2
---

This guide explains how to write effective commands for Archon's AI workflow system. Commands are the building blocks of workflows - each command is a prompt template that instructs the AI agent what to do.

## What is a Command?

A command is a **markdown file** that serves as a detailed instruction set for an AI agent. When a workflow executes a step like `- command: investigate-issue`, Archon:

1. Loads the command from its workflow package, or from the shared command search path for a legacy workflow
2. Substitutes variables like `$ARGUMENTS` with actual values
3. Sends the entire document as a prompt to the AI
4. The AI follows the instructions and produces output

**Most commands are prompts, not code.** They guide AI behavior through clear instructions. (One
exception: a command with a `run:` directive is executed deterministically with no AI — see
[AI-less Commands](#ai-less-commands-deterministic-run) below.)

---

## File Format

Shared commands live in `.archon/commands/` relative to the working directory. Ordinary command nodes load them at runtime. When a workflow is composed through `include:`, Archon resolves and snapshots its command bodies during load-time composition so references and declared inputs can be validated before the nodes join the parent's DAG. A packaged workflow keeps its commands beside the YAML in `<workflow>/commands/`; those references resolve only inside the owning package and do not fall back to shared commands.

> **Bundled commands live inside their workflow packages:** Commands shipped with Archon sit beside the workflow that uses them, under `.archon/workflows/<pack>/<workflow>/commands/`, and are embedded into the binary at build time. There is no shared bundled command directory. For your own commands use an owning workflow package's `commands/`, `.archon/commands/` (project-scoped), or `~/.archon/commands/` (home-scoped).

> **CLI vs Server:** The CLI reads commands from wherever you run it, including uncommitted changes. The server uses the registered project's saved checkout path. An existing local registration can point to your checkout or a subdirectory of it, so the server reads local files there. A new webhook registration creates a managed clone at `~/.archon/workspaces/owner/repo/source/`, or at a suffixed path such as `owner/repo-2/source/` when that project name is taken; commit and push changes from another checkout so that clone can receive them when it syncs. Worktree runs use files in their worktree.

Commands use this structure:

```markdown
---
description: One-line description shown in /commands list
argument-hint: <expected-input-format>
---

# Command Name

**Input**: $ARGUMENTS

---

[Instructions for the AI agent...]
```

### Frontmatter Fields

| Field | Required | Purpose |
|-------|----------|---------|
| `description` | Recommended | Shown in `/commands` list and workflow routing |
| `argument-hint` | Optional | Tells users what input to provide |
| `run` | Optional | Makes the command **AI-less**: a shell snippet run deterministically instead of prompting the AI (see below) |
| `timeout` | Optional | For `run:` commands, the subprocess timeout in ms (default 60000) |

---

## AI-less Commands (deterministic `run:`)

Most commands are prompts for an AI agent. Sometimes you want the opposite: a slash command
that just **runs a script and returns its output**, with no agent, no session, and no
non-determinism — a config toggle, a status query, a canned report. Declare a `run:` directive in
the frontmatter and the command becomes **AI-less**:

```markdown
---
description: Show disk usage of the repo
run: du -sh . 2>/dev/null
---
```

When a chat message is a slash command whose name matches such a file, Archon executes the `run:`
snippet directly and returns its **stdout** as the reply. Nothing is sent to an AI. A command file
*without* `run:` keeps the normal prompt behavior, so this is purely opt-in.

### How it runs

- The snippet runs via `bash -c`, with the working directory set to the project root (or the
  command file's directory when there is no project).
- The caller's arguments are available **both** as positional parameters (`"$@"`, `$1`, `$2`, …)
  **and** as `$ARGUMENTS` (the whole argument string). The arguments are passed as data, never
  re-interpreted as shell — so `/mycmd "$(rm -rf /)"` is safe; the text is a literal argument.
  A `run:` that wants the arguments must forward them explicitly (e.g. `mytool "$@"`).
- `$ARCHON_COMMAND_DIR` is set to the command file's directory, so a command can call a sibling
  script: `run: bash "$ARCHON_COMMAND_DIR/report.sh" "$@"`.
- A non-zero exit becomes an error reply carrying the command's stderr. Output is capped (1 MB)
  and the subprocess is killed after `timeout` ms (default 60000).

### Where they live

AI-less commands are discovered on demand from the same places as other commands, **repo first,
then home**:

1. `<project>/.archon/commands/<name>.md` — project-scoped (committed with the repo).
2. `~/.archon/commands/<name>.md` — home-scoped, available in every project.

### Example

```markdown
---
description: Toggle a project setting without spinning up an agent
argument-hint: <key> <on|off>
run: bash "$ARCHON_COMMAND_DIR/set-flag.sh" "$@"
---
```

Typing `/toggle feature-x on` runs `set-flag.sh feature-x on` and posts its output back — instantly,
deterministically, with no model call.

### Security

A `run:` snippet is trusted content (it lives in the repo or your home dir, same trust level as a
workflow's `script:` nodes). Only the **arguments** come from the chat, and they are always passed
as inert positional data. Treat a command file's `run:` exactly as you would any script you commit.

---

## The Golden Rule: Artifacts Are Everything

> **The artifact you produce IS the specification for the next step.**

In multi-step workflows, agents don't share memory. The ONLY way to pass information between steps is through **artifacts** - files saved to disk.

```
Step 1: investigate-issue    Step 2: implement-issue
┌─────────────────────┐      ┌─────────────────────┐
│ AI Agent A          │      │ AI Agent B          │
│                     │      │                     │
│ Analyzes issue      │      │ Reads artifact      │
│ Produces artifact ──┼──────┼─> Executes plan     │
│                     │      │                     │
└─────────────────────┘      └─────────────────────┘
        │                            │
        ▼                            │
  $ARTIFACTS_DIR/                    │
  issues/issue-123.md ◄──────────────┘
```

### Why This Matters

- **No shared context**: Each workflow node can run with `context: fresh`
- **Resumability**: If a step fails, the artifact preserves progress
- **Auditability**: Artifacts create a paper trail of AI decisions
- **Handoff quality**: The artifact determines if the next step succeeds

### What Makes a Good Artifact

The artifact must contain **everything the next agent needs**:

| Include | Why |
|---------|-----|
| Problem statement | Next agent needs context |
| Specific file paths + line numbers | No guessing where to look |
| Actual code snippets | Not summaries - real code |
| Step-by-step implementation plan | Actionable without questions |
| Validation commands | How to verify success |
| Edge cases and risks | What to watch out for |

**Bad artifact**: "Fix the authentication bug in the login handler"

**Good artifact**:
````markdown
## Problem
Users get 401 errors when token refresh races with API calls.

## Root Cause
`src/auth/refresh.ts:45` - The refresh lock doesn't wait for in-flight requests.

## Implementation Plan

### Step 1: Add request queue
**File**: `src/auth/refresh.ts`
**Lines**: 45-60

**Current code:**
```typescript
async function refresh() {
  // Current problematic code
}
```

**Change to:**
```typescript
async function refresh() {
  // Fixed code with queue
}
```

### Step 2: Add test
**File**: `src/auth/refresh.test.ts`
**Action**: CREATE

```typescript
describe('refresh', () => {
  it('queues requests during refresh', async () => {
    // Test implementation
  });
});
```

## Validation
```bash
bun run type-check
bun test src/auth/
```
````

---

## Command Structure

### Phase-Based Organization

Break commands into clear phases. This helps the AI:
- Know where it is in the process
- Self-verify before proceeding
- Recover if something fails

```markdown
## Phase 1: LOAD - Get Context

### 1.1 First action
[Instructions...]

### 1.2 Second action
[Instructions...]

**PHASE_1_CHECKPOINT:**
- [ ] Data loaded
- [ ] Context understood
- [ ] Ready to proceed

---

## Phase 2: ANALYZE - Process Information

[...]
```

### Why Phases Work

1. **Chunked reasoning**: AI handles complex tasks better in pieces
2. **Self-verification**: Checkpoints force the AI to validate progress
3. **Debugging**: When something fails, you know which phase
4. **Consistency**: Similar structure across commands = predictable behavior

### Common Phase Patterns

| Phase Name | Purpose | Example Actions |
|------------|---------|-----------------|
| LOAD | Gather inputs and context | Read files, fetch from GitHub, parse arguments |
| EXPLORE | Understand the codebase | Search for patterns, trace code flow |
| ANALYZE | Form conclusions | Root cause analysis, design decisions |
| GENERATE | Produce output | Write artifact, create files |
| VALIDATE | Verify correctness | Run tests, check types, review output |
| COMMIT | Save to git | Stage, commit, push |
| REPORT | Communicate results | Output summary to user |

---

## Checkpoints

End each phase with a checkpoint:

```markdown
**PHASE_2_CHECKPOINT:**
- [ ] Root cause identified with evidence
- [ ] All affected files listed
- [ ] Implementation approach determined
```

### Why Checkpoints Matter

- **Self-regulation**: AI verifies it completed all steps
- **Quality gate**: Prevents rushing to next phase
- **Debugging aid**: Shows where process broke down
- **Documentation**: Records what was accomplished

---

## Variable Substitution

Archon replaces variables in command text before sending to the AI. The most commonly used variables in commands:

| Variable | Value |
|----------|-------|
| `$ARGUMENTS` / `$USER_MESSAGE` | User's whole input message (positional `$1`/`$2`/`$3` are not supported) |
| `$ARTIFACTS_DIR` | Pre-created artifacts directory for this workflow run |
| `$BASE_BRANCH` | The run's resolved or recorded base branch; see [resolution and child inheritance rules](/reference/variables/#workflow-variables) |
| `$DOCS_DIR` | Documentation directory path (default: `docs/`) |
| `$WORKFLOW_ID` | Unique workflow run ID |
| `$CONTEXT` | GitHub issue/PR context (if available) |

See the [Variable Reference](/reference/variables/) for the complete list, including the deprecated `$LOOP_USER_INPUT` and `$REJECTION_REASON`, node output references, substitution order, and context variable behavior.

### Usage Pattern

Always show the input at the top:

```markdown
# Investigate Issue

**Input**: $ARGUMENTS

---

## Your Mission
[...]
```

This ensures the AI knows exactly what it's working with.

---

## Artifact Conventions

### Where Artifacts Live

Artifacts are stored **outside the repository** in the Archon workspace directory. Use the `$ARTIFACTS_DIR` variable to reference the pre-created artifacts directory for each workflow run:

```
~/.archon/workspaces/owner/repo/artifacts/runs/{workflow-id}/
```

This keeps artifacts out of git and avoids polluting the working tree.

### Naming Conventions

| Artifact Type | Path Pattern |
|---------------|--------------|
| Issue investigation | `$ARTIFACTS_DIR/issues/issue-{number}.md` |
| Free-form investigation | `$ARTIFACTS_DIR/issues/investigation-{timestamp}.md` |
| PR review scope | `$ARTIFACTS_DIR/reviews/pr-{number}/scope.md` |
| Code review findings | `$ARTIFACTS_DIR/reviews/pr-{number}/code-review-findings.md` |

### Instructing the AI to Save

Be explicit about artifact creation:

```markdown
## Phase 4: GENERATE - Create Artifact

### 4.1 Create Directory

```bash
mkdir -p $ARTIFACTS_DIR/issues
```

### 4.2 Write Artifact

Write to `$ARTIFACTS_DIR/issues/issue-{number}.md`:

```markdown
# Investigation: {Title}

**Issue**: #{number}
**Type**: {BUG|ENHANCEMENT}
...
```

**CRITICAL**: This artifact is the ONLY way to pass information to the next
workflow step. Include everything needed for implementation:

- Exact file paths with line numbers
- Actual code snippets (not summaries)
- Step-by-step implementation instructions
- Validation commands
- Edge cases to handle

The implementing agent will work ONLY from this artifact.
```

---

## Writing Effective Instructions

### Be Explicit About Tools

Tell the AI which tools to use:

```markdown
### 2.1 Search for Relevant Code

Use Task tool with subagent_type="Explore":

```
Find all files related to authentication:
- Token handling
- Session management
- Login/logout flows
```

### 2.2 Check Git History

```bash
git log --oneline -10 -- {affected-file}
git blame -L {start},{end} {affected-file}
```
```

### Provide Decision Trees

Help the AI handle different scenarios:

```markdown
### 3.2 Handle Git State

```
┌─ IN WORKTREE?
│  └─ YES → Use it (assume it's for this work)
│
├─ ON MAIN BRANCH?
│  └─ Clean? → Create branch: fix/issue-{number}
│  └─ Dirty? → STOP, ask user to commit/stash
│
└─ ON FEATURE BRANCH?
   └─ Use it (assume it's for this work)
```
```

### Include Error Handling

Tell the AI what to do when things go wrong:

```markdown
## Handling Edge Cases

### Artifact not found
```
Artifact not found at $ARTIFACTS_DIR/issues/issue-{number}.md

Run `/investigate-issue {number}` first.
```

### Code has drifted
```
Code has changed since investigation:

File: src/x.ts:45
- Artifact expected: {snippet}
- Actual code: {different}

Options:
1. Re-run /investigate-issue
2. Proceed with manual adjustments
```
```

---

## Success Criteria

End every command with clear success criteria:

```markdown
## Success Criteria

- **ARTIFACT_COMPLETE**: All sections filled with specific content
- **EVIDENCE_BASED**: Every claim has file:line reference
- **IMPLEMENTABLE**: Next agent can execute without questions
- **COMMITTED**: Artifact saved in git
```

These serve as:
- Final checklist for the AI
- Definition of "done"
- Quality bar for the command

---

## Template: Basic Command

```markdown
---
description: Brief description of what this command does
argument-hint: <expected-input>
---

# Command Name

**Input**: $ARGUMENTS

---

## Your Mission

{1-2 sentences explaining the goal and what success looks like}

**Output artifact**: `$ARTIFACTS_DIR/{category}/{name}.md`

---

## Phase 1: LOAD - Gather Context

### 1.1 Parse Input

{Instructions for understanding the input}

### 1.2 Load Dependencies

{Instructions for loading required context}

**PHASE_1_CHECKPOINT:**
- [ ] Input parsed correctly
- [ ] Required context loaded

---

## Phase 2: PROCESS - Do the Work

### 2.1 Main Action

{Core instructions}

### 2.2 Secondary Action

{Supporting instructions}

**PHASE_2_CHECKPOINT:**
- [ ] Main work completed
- [ ] Results validated

---

## Phase 3: GENERATE - Create Artifact

### 3.1 Artifact Location

```bash
mkdir -p $ARTIFACTS_DIR/{category}
```

**Path**: `$ARTIFACTS_DIR/{category}/{name}.md`

### 3.2 Artifact Content

Write this structure:

```markdown
# {Title}

**Created**: {timestamp}
**Input**: {original input}

## Summary

{Key findings/results}

## Details

{Comprehensive information for next step}

## Next Steps

{What the next agent should do with this}
```

**CRITICAL**: Include everything the next workflow step needs.

**PHASE_3_CHECKPOINT:**
- [ ] Artifact file created
- [ ] All sections populated
- [ ] Information is actionable

---

## Phase 4: COMMIT - Save Work

```bash
git add .
git commit -m "{Descriptive message}"
```

**PHASE_4_CHECKPOINT:**
- [ ] Changes committed

---

## Phase 5: REPORT - Output Results

```markdown
## Complete

**Artifact**: `$ARTIFACTS_DIR/{category}/{name}.md`

### Summary

{Brief results}

### Next Step

Run `/{next-command}` to continue.
```

---

## Success Criteria

- **CONTEXT_LOADED**: Required information gathered
- **WORK_COMPLETE**: Main task accomplished
- **ARTIFACT_SAVED**: Output written to correct location
- **COMMITTED**: Changes saved to git
```

---

## Anti-Patterns to Avoid

### 1. Vague Instructions

Bad:
```markdown
Analyze the code and find the problem.
```

Good:
```markdown
### 2.1 Trace the Error Path

1. Find where the error originates using grep:
   ```bash
   grep -r "ErrorType" src/
   ```

2. Read the file and identify the function:
   ```bash
   cat src/handlers/error.ts
   ```

3. Document the call chain leading to the error.
```

### 2. Missing Artifact Instructions

Bad:
```markdown
## Results

Output your findings.
```

Good:
```markdown
## Phase 4: GENERATE - Create Artifact

Write to `$ARTIFACTS_DIR/issues/issue-{number}.md`:

[Exact template with all required sections]

**CRITICAL**: This artifact is the handoff to the implementing agent.
```

### 3. No Error Handling

Bad:
```markdown
Create the PR.
```

Good:
```markdown
### Create PR

**First, check if PR already exists:**
```bash
gh pr list --head $(git branch --show-current)
```

**If PR exists**: Use existing PR, skip creation.

**If no PR**: Create new PR:
```bash
gh pr create --title "..." --body "..."
```
```

### 4. Assuming Context

Bad:
```markdown
Fix the bug in the file we discussed.
```

Good:
```markdown
### 1.1 Load Artifact

```bash
cat $ARTIFACTS_DIR/issues/issue-{number}.md
```

Extract:
- File paths to modify
- Line numbers for changes
- Expected behavior
```

---

## Testing Your Command

1. **Run it manually**: `bun run cli workflow run {workflow} "test input"`
2. **Check artifact output**: Does it contain everything needed?
3. **Simulate next step**: Can another agent work from just the artifact?
4. **Edge cases**: What happens with bad input? Missing files?

---

## Summary

1. **Commands are prompts** - Write clear instructions for AI agents
2. **Artifacts are the handoff** - The ONLY way to pass data between steps
3. **Use phases** - Break work into verifiable chunks
4. **Be explicit** - Tell the AI exactly what to do, where, and how
5. **Include everything** - The next agent works ONLY from your artifact
