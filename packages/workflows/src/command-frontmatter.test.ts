import { describe, it, expect } from 'bun:test';
import {
  parseCommandFrontmatter,
  getRewriteTarget,
  CommandRewriteError,
  BUILTIN_COMMAND_NAMES,
} from './command-frontmatter';

describe('parseCommandFrontmatter', () => {
  it('parses a fenced frontmatter block and separates the body', () => {
    const content = '---\nrewrite: /help\ndescription: an alias\n---\n\n# Body\n\ntext';
    const { frontmatter, body } = parseCommandFrontmatter(content);
    expect(frontmatter).toEqual({ rewrite: '/help', description: 'an alias' });
    expect(body).toBe('\n# Body\n\ntext');
  });

  it('returns the whole content as body when there is no fence', () => {
    const content = '# Just a command\n\nNo frontmatter here.';
    const { frontmatter, body } = parseCommandFrontmatter(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe(content);
  });

  it('returns empty frontmatter on malformed YAML (stays total, no throw)', () => {
    const content = '---\n: : : not: valid: yaml\n---\nbody';
    const { frontmatter, body } = parseCommandFrontmatter(content);
    expect(frontmatter).toEqual({});
    expect(body).toBe('body');
  });

  it('returns empty frontmatter when the YAML block is not a plain object', () => {
    const content = '---\n- one\n- two\n---\nbody';
    const { frontmatter } = parseCommandFrontmatter(content);
    expect(frontmatter).toEqual({});
  });

  it('tolerates CRLF line endings', () => {
    const content = '---\r\nrewrite: /help\r\n---\r\nbody';
    const { frontmatter, body } = parseCommandFrontmatter(content);
    expect(frontmatter).toEqual({ rewrite: '/help' });
    expect(body).toBe('body');
  });

  it('tolerates a leading BOM before the fence', () => {
    const content = '﻿---\nrewrite: /help\n---\nbody';
    const { frontmatter } = parseCommandFrontmatter(content);
    expect(frontmatter).toEqual({ rewrite: '/help' });
  });

  it('handles a fence with no trailing body', () => {
    const content = '---\nrewrite: /help\n---';
    const { frontmatter, body } = parseCommandFrontmatter(content);
    expect(frontmatter).toEqual({ rewrite: '/help' });
    expect(body).toBe('');
  });
});

describe('getRewriteTarget', () => {
  it('returns the target for a valid rewrite: key', () => {
    expect(getRewriteTarget('---\nrewrite: /help\n---\nbody')).toBe('/help');
  });

  it('returns a full multi-token prefix verbatim', () => {
    expect(getRewriteTarget('---\nrewrite: /workflow list\n---\nbody')).toBe('/workflow list');
  });

  it('trims surrounding whitespace on the target', () => {
    expect(getRewriteTarget('---\nrewrite: "  /help  "\n---\nbody')).toBe('/help');
  });

  it('returns null when there is no rewrite: key (the common case)', () => {
    expect(getRewriteTarget('---\ndescription: normal command\n---\nbody')).toBeNull();
    expect(getRewriteTarget('# no frontmatter at all')).toBeNull();
  });

  it('throws CommandRewriteError when rewrite: is not a string', () => {
    expect(() => getRewriteTarget('---\nrewrite: 5\n---\nbody')).toThrow(CommandRewriteError);
  });

  it('throws CommandRewriteError when rewrite: does not start with a slash', () => {
    expect(() => getRewriteTarget('---\nrewrite: help\n---\nbody')).toThrow(CommandRewriteError);
  });
});

describe('BUILTIN_COMMAND_NAMES', () => {
  it('contains the canonical deterministic built-ins', () => {
    expect(BUILTIN_COMMAND_NAMES).toContain('help');
    expect(BUILTIN_COMMAND_NAMES).toContain('workflow');
    expect(BUILTIN_COMMAND_NAMES).toContain('worktree');
    // Mirrors the orchestrator gate exactly — guard against drift.
    expect([...BUILTIN_COMMAND_NAMES]).toEqual([
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
    ]);
  });
});
