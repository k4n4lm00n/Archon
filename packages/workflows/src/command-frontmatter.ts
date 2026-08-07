/**
 * Command frontmatter parsing for the `rewrite:` command-alias mechanism.
 *
 * A custom command `.md` file may declare a `---`-fenced YAML frontmatter block
 * with a single `rewrite:` key (e.g. `rewrite: /help`) that turns the file into a
 * bash-alias-style alias. This module owns the pure parsing of that frontmatter
 * and the canonical list of built-in command names shared by the orchestrator gate
 * and the command validator.
 *
 * `parseCommandFrontmatter` is total (never throws) so it is safe to call on any
 * file; only `getRewriteTarget` throws — on a *present but malformed* `rewrite:`
 * key — so callers can fail loud.
 */

/**
 * Canonical list of deterministic built-in command names.
 *
 * Single source of truth mirrored by the orchestrator's deterministic gate
 * (`@archon/core` orchestrator-agent) and the command validator (this package),
 * so a `rewrite:` target can be validated against the real built-in set.
 */
export const BUILTIN_COMMAND_NAMES = [
  'help',
  'status',
  'reset',
  'workflow',
  'register-project',
  'update-project',
  'remove-project',
  'setproject',
  'set-chat-mode',
  'commands',
  'init',
  'worktree',
] as const;

/**
 * Error thrown when a command alias (`rewrite:`) is malformed or forms a cycle /
 * over-deep chain. Defined here (the pure module) and imported by the resolver to
 * avoid a circular import (`getRewriteTarget` throws it).
 */
export class CommandRewriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandRewriteError';
  }
}

/**
 * Leading `---`-fenced frontmatter block. Tolerates an optional leading BOM
 * and CRLF line endings. Group 1 = YAML block, group 2 = body (optional).
 */
const FRONTMATTER_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/**
 * Parse the leading `---`-fenced YAML frontmatter block of a command file.
 *
 * Tolerates an optional leading BOM and CRLF line endings. Returns the parsed
 * frontmatter object (only when it is a plain object) and the remaining body.
 * This function is total: on no fence, YAML parse error, or a non-object YAML
 * result it returns an empty `frontmatter` (malformed frontmatter is surfaced by
 * the validator, not here).
 */
export function parseCommandFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) {
    return { frontmatter: {}, body: content };
  }

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(m[1]);
  } catch {
    return { frontmatter: {}, body: m[2] ?? '' };
  }

  // Only accept a plain object; null / array / primitive → no usable frontmatter.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { frontmatter: {}, body: m[2] ?? '' };
  }

  return { frontmatter: parsed as Record<string, unknown>, body: m[2] ?? '' };
}

/**
 * Extract the `rewrite:` alias target from a command file's frontmatter.
 *
 * @returns the target command string (with leading slash, e.g. `/help` or
 *   `/workflow list`) when a valid `rewrite:` key is present, or `null` when
 *   there is no `rewrite:` key (the common case — a non-alias command).
 * @throws {CommandRewriteError} when `rewrite:` is present but not a string, or is
 *   a string that does not start with `/`.
 */
export function getRewriteTarget(content: string): string | null {
  const { frontmatter } = parseCommandFrontmatter(content);
  const raw = frontmatter.rewrite;

  if (raw == null) {
    return null;
  }
  if (typeof raw !== 'string') {
    throw new CommandRewriteError('rewrite: must be a string command like "/help"');
  }

  const target = raw.trim();
  if (!target.startsWith('/')) {
    throw new CommandRewriteError('rewrite: target must start with "/" (e.g. "/help")');
  }

  return target;
}
