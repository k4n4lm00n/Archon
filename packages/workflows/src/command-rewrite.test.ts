import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as realPaths from '@archon/paths';

// Mock only the logger so real path helpers run against the tmp dirs below.
// Mirrors load-command-prompt.test.ts (same @archon/paths mock shape) so both
// files can share a mock-isolation batch without conflicting.
const mockLogFn = mock(() => {});
const mockLogger = {
  info: mockLogFn,
  warn: mockLogFn,
  error: mockLogFn,
  debug: mockLogFn,
  trace: mockLogFn,
  fatal: mockLogFn,
  child: mock(() => mockLogger),
  bindings: mock(() => ({ module: 'test' })),
  isLevelEnabled: mock(() => true),
  level: 'info',
};
mock.module('@archon/paths', () => ({
  ...realPaths,
  createLogger: mock(() => mockLogger),
}));

import { resolveCommandRewrite } from './command-rewrite';
import { CommandRewriteError } from './command-frontmatter';
import type { WorkflowDeps } from './deps';

// Defaults OFF so only the repo + (empty) home scopes are searched — full isolation.
function makeDeps(): WorkflowDeps {
  return {
    loadConfig: async () => ({ defaults: { loadDefaultCommands: false } }),
  } as unknown as WorkflowDeps;
}

describe('resolveCommandRewrite', () => {
  let archonHome: string;
  let repoRoot: string;
  let prevArchonHome: string | undefined;

  function writeCommand(name: string, content: string): void {
    writeFileSync(join(repoRoot, '.archon', 'commands', `${name}.md`), content);
  }

  function alias(target: string): string {
    return `---\nrewrite: ${target}\n---\n\n# alias\n\nbody`;
  }

  beforeEach(() => {
    prevArchonHome = process.env.ARCHON_HOME;
    archonHome = mkdtempSync(join(tmpdir(), 'archon-home-'));
    repoRoot = mkdtempSync(join(tmpdir(), 'archon-repo-'));
    process.env.ARCHON_HOME = archonHome;
    mkdirSync(join(archonHome, 'commands'), { recursive: true });
    mkdirSync(join(repoRoot, '.archon', 'commands'), { recursive: true });
  });

  afterEach(() => {
    if (prevArchonHome === undefined) delete process.env.ARCHON_HOME;
    else process.env.ARCHON_HOME = prevArchonHome;
    rmSync(archonHome, { recursive: true, force: true });
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('returns non-slash messages unchanged (fast path)', async () => {
    expect(await resolveCommandRewrite(makeDeps(), repoRoot, 'hello world')).toBe('hello world');
  });

  it('rewrites an alias to its target and appends args verbatim', async () => {
    writeCommand('alias', alias('/help'));
    expect(await resolveCommandRewrite(makeDeps(), repoRoot, '/alias foo')).toBe('/help foo');
    expect(await resolveCommandRewrite(makeDeps(), repoRoot, '/alias')).toBe('/help');
  });

  it('preserves interior whitespace/args verbatim', async () => {
    writeCommand('alias', alias('/help'));
    expect(await resolveCommandRewrite(makeDeps(), repoRoot, '/alias  foo  bar')).toBe(
      '/help  foo  bar'
    );
  });

  it('terminates when the target is a built-in (no command file)', async () => {
    writeCommand('alias', alias('/help'));
    // `help` has no help.md → loadCommandPrompt not-found → terminal.
    expect(await resolveCommandRewrite(makeDeps(), repoRoot, '/alias x')).toBe('/help x');
  });

  it('resolves through to another (non-alias) command file and stops there', async () => {
    writeCommand('a', alias('/b'));
    writeCommand('b', '# normal command\n\nno rewrite here');
    expect(await resolveCommandRewrite(makeDeps(), repoRoot, '/a x')).toBe('/b x');
  });

  it('resolves an alias→alias chain to the final built-in', async () => {
    writeCommand('a', alias('/b'));
    writeCommand('b', alias('/help'));
    expect(await resolveCommandRewrite(makeDeps(), repoRoot, '/a')).toBe('/help');
  });

  it('preserves fixed args in a multi-token target and appends user args', async () => {
    writeCommand('wl', alias('/workflow list'));
    expect(await resolveCommandRewrite(makeDeps(), repoRoot, '/wl mine')).toBe(
      '/workflow list mine'
    );
  });

  it('throws on a self-loop', async () => {
    writeCommand('loop', alias('/loop'));
    await expect(resolveCommandRewrite(makeDeps(), repoRoot, '/loop')).rejects.toThrow(
      CommandRewriteError
    );
  });

  it('throws on an A→B→A cycle', async () => {
    writeCommand('a', alias('/b'));
    writeCommand('b', alias('/a'));
    await expect(resolveCommandRewrite(makeDeps(), repoRoot, '/a')).rejects.toThrow(
      CommandRewriteError
    );
  });

  it('throws when the alias chain exceeds the depth cap', async () => {
    // a1→a2→…→a6→/a7, a chain of 6 aliases exceeds MAX_REWRITE_DEPTH (5).
    for (let i = 1; i <= 6; i++) {
      writeCommand(`a${i}`, alias(`/a${i + 1}`));
    }
    await expect(resolveCommandRewrite(makeDeps(), repoRoot, '/a1')).rejects.toThrow(/too deep/);
  });

  it('passes through an unknown/typo command unchanged', async () => {
    expect(await resolveCommandRewrite(makeDeps(), repoRoot, '/unknown-xyz foo')).toBe(
      '/unknown-xyz foo'
    );
  });

  it('throws on a malformed rewrite: target', async () => {
    writeCommand('bad', '---\nrewrite: 5\n---\n\nbody');
    await expect(resolveCommandRewrite(makeDeps(), repoRoot, '/bad')).rejects.toThrow(
      CommandRewriteError
    );
  });
});
