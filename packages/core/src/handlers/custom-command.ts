/**
 * AI-less custom commands.
 *
 * A custom command is a markdown file in a command folder: a repo's
 * `<cwd>/.archon/commands/` (+ any configured folder) or the global
 * `~/.archon/commands/`. Normally its body is handed to the AI agent as a prompt.
 *
 * If its YAML frontmatter declares a `run:` directive, the command is AI-LESS: the
 * `run` shell snippet is executed DETERMINISTICALLY (no agent/session), the caller's
 * arguments are passed as positional parameters (`$@` — data, never re-parsed as shell,
 * so caller args cannot inject) and as `$ARGUMENTS`, and the captured stdout is returned
 * as the chat reply. A command file WITHOUT `run:` is left untouched (the caller falls
 * back to the normal AI turn), so this is purely additive.
 *
 * Resolution precedence matches the rest of Archon: repo `.archon/commands/` > home
 * `~/.archon/commands/` (see getCommandFolderSearchPaths / getHomeCommandsPath).
 */
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { execFileAsync } from '@archon/git';
import {
  getCommandFolderSearchPaths,
  getHomeCommandsPath,
  findCommandFiles,
  createLogger,
} from '@archon/paths';
import type { CommandResult } from '../types';

let cachedLog: ReturnType<typeof createLogger> | undefined;
function getLog(): ReturnType<typeof createLogger> {
  if (!cachedLog) cachedLog = createLogger('custom-command');
  return cachedLog;
}

/** Default wall-clock cap for an AI-less command's subprocess (override via `timeout:` ms). */
export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
/** Cap captured stdout+stderr so a runaway command can't exhaust memory. */
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface CustomCommandFile {
  /** Command name (the filename without `.md`), i.e. what follows the leading `/`. */
  name: string;
  /** Absolute path to the resolved `.md` file. */
  path: string;
  /** Parsed YAML frontmatter (empty object when absent or unparseable). */
  frontmatter: Record<string, unknown>;
  /** Markdown body after the frontmatter (the agent prompt for non-AI-less commands). */
  body: string;
  /** The AI-less shell directive, when the frontmatter declares one. */
  run?: string;
  /** Optional per-command subprocess timeout in ms (from `timeout:` frontmatter). */
  timeoutMs?: number;
}

// Leading YAML frontmatter block: `---\n…\n---` at the very start of the file.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Split a command file into its frontmatter object and the remaining body. */
export function parseCommandFile(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return { frontmatter: {}, body: content };
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(m[1]);
  } catch {
    parsed = undefined;
  }
  const frontmatter =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  return { frontmatter, body: content.slice(m[0].length) };
}

/**
 * Resolve a command NAME to a command file, searching repo folders first (if `cwd` is
 * given) then the global home dir. Returns null if no `<name>.md` is found in any scope.
 * Never throws on a missing folder.
 */
export async function resolveCustomCommand(
  name: string,
  opts: { cwd?: string; configuredFolder?: string } = {}
): Promise<CustomCommandFile | null> {
  const dirs: string[] = [];
  if (opts.cwd) {
    for (const folder of getCommandFolderSearchPaths(opts.configuredFolder)) {
      dirs.push(join(opts.cwd, folder));
    }
  }
  dirs.push(getHomeCommandsPath()); // global scope, lower precedence than repo

  for (const dir of dirs) {
    const files = await findCommandFiles(dir); // missing dir resolves to []
    const hit = files.find(f => f.commandName === name);
    if (!hit) continue;
    const abs = join(dir, hit.relativePath);
    let content: string;
    try {
      content = await readFile(abs, 'utf8');
    } catch (err) {
      getLog().debug({ err, path: abs, name }, 'custom_command.read_failed');
      continue;
    }
    const { frontmatter, body } = parseCommandFile(content);
    const run = typeof frontmatter.run === 'string' ? frontmatter.run : undefined;
    const timeoutMs =
      typeof frontmatter.timeout === 'number' && frontmatter.timeout > 0
        ? frontmatter.timeout
        : undefined;
    return { name, path: abs, frontmatter, body, run, timeoutMs };
  }
  return null;
}

/**
 * Execute an AI-less command's `run:` directive deterministically and return its stdout as
 * a CommandResult. Arguments are passed positionally (`$@`) and via `$ARGUMENTS`; the command
 * directory is exposed as `$ARCHON_COMMAND_DIR` so a command can reference sibling scripts.
 */
export async function executeAiLessCommand(
  cmd: CustomCommandFile,
  args: string[] = [],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<CommandResult> {
  if (!cmd.run) {
    return { success: false, message: `/${cmd.name} is not an AI-less command (no \`run:\`).` };
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...opts.env,
    ARGUMENTS: args.join(' '),
    ARCHON_COMMAND_DIR: dirname(cmd.path),
    ARCHON_COMMAND_NAME: cmd.name,
  };
  const cwd = opts.cwd ?? dirname(cmd.path);
  // `bash -c '<run>' <name> <args…>`: the trusted `run` snippet runs as the script; caller args
  // are its positional parameters ($1, $@) — data, never re-parsed as shell, so they cannot
  // inject. A `run` that wants the args forwards them explicitly with "$@" (or reads $ARGUMENTS).
  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-c', cmd.run, cmd.name, ...args], {
      cwd,
      env,
      timeout: cmd.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    const out = (stdout || stderr || '').trim();
    getLog().debug({ name: cmd.name, path: cmd.path }, 'custom_command.ailess_ok');
    return { success: true, message: out || `(/${cmd.name} produced no output)` };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string; code?: number };
    const detail = (err.stderr || err.stdout || err.message || '').trim();
    getLog().warn(
      { name: cmd.name, path: cmd.path, code: err.code },
      'custom_command.ailess_failed'
    );
    return { success: false, message: `/${cmd.name} failed:\n${detail}` };
  }
}
