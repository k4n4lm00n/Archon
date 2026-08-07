/**
 * Command-alias resolver for the `rewrite:` frontmatter mechanism.
 *
 * `resolveCommandRewrite` performs a textual rewrite pass over a slash-command
 * message: it tokenizes the leading `/command`, loads that command file, reads its
 * `rewrite:` target (if any), replaces the command token with the target, and
 * repeats. Trailing args are appended verbatim (bash-alias semantics — no
 * placeholder substitution). Resolution terminates when the leading token has no
 * command file (a built-in or unknown name) or the file has no `rewrite:` key.
 *
 * A visited-set (by command name) plus a depth cap fail loud on alias cycles,
 * self-loops, and over-deep chains via {@link CommandRewriteError}.
 */
import type { WorkflowDeps } from './deps';
import { loadCommandPrompt } from './executor-shared';
import { getRewriteTarget, CommandRewriteError } from './command-frontmatter';

/** Maximum length of an alias chain before we fail loud (guards over-deep chains). */
const MAX_REWRITE_DEPTH = 5;

/** Leading whitespace, then `/<name>`, then the remainder (args) verbatim. */
const LEADING_COMMAND_RE = /^(\s*)\/(\S+)([\s\S]*)$/;

/**
 * Split a message into its leading whitespace, the leading `/command` name, and
 * everything after it (args) preserved verbatim. Returns `null` when the message
 * is not a slash command.
 */
function splitLeadingCommand(
  message: string
): { leading: string; name: string; rest: string } | null {
  // leading whitespace, then "/<name>", then everything else (args) verbatim.
  const m = LEADING_COMMAND_RE.exec(message);
  if (!m) return null;
  return { leading: m[1], name: m[2], rest: m[3] };
}

/**
 * Resolve command aliases in a slash-command message via textual rewrite.
 *
 * @param deps - Workflow dependencies (for command-file loading/config)
 * @param cwd - Working directory (repo root) for repo-scoped command resolution
 * @param message - The raw user message (may or may not be a slash command)
 * @param configuredFolder - Optional additional command folder from config
 * @returns the fully-rewritten message; unchanged when it is not an alias
 * @throws {CommandRewriteError} on an alias cycle, self-loop, over-deep chain, or a
 *   malformed `rewrite:` target.
 */
export async function resolveCommandRewrite(
  deps: WorkflowDeps,
  cwd: string,
  message: string,
  configuredFolder?: string
): Promise<string> {
  let current = message;
  const visited = new Set<string>();

  for (;;) {
    const tok = splitLeadingCommand(current);
    if (!tok) return current; // not a slash command → unchanged (fast path)

    const loaded = await loadCommandPrompt(deps, cwd, tok.name, configuredFolder);
    // Any load failure (not_found / built-in / invalid_name / empty / permission)
    // is terminal — return unchanged so normal dispatch (built-in or AI) proceeds.
    if (!loaded.success) return current;

    const target = getRewriteTarget(loaded.content); // may throw on malformed rewrite:
    if (target === null) return current; // normal command file (no rewrite) → unchanged

    // It IS an alias → guard against cycles/depth, then rewrite.
    if (visited.has(tok.name)) {
      throw new CommandRewriteError(
        `Command alias cycle detected: ${[...visited, tok.name].join(' -> ')}`
      );
    }
    visited.add(tok.name);
    if (visited.size > MAX_REWRITE_DEPTH) {
      throw new CommandRewriteError(
        `Command alias chain too deep (> ${MAX_REWRITE_DEPTH}): ${[...visited].join(' -> ')}`
      );
    }

    // Textual rewrite: replace the "/name" token with the target, keep the
    // remainder (the user's args) verbatim. The next iteration re-tokenizes.
    current = `${tok.leading}${target}${tok.rest}`;
  }
}
