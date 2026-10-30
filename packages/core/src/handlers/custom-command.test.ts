// @archon-test-isolated
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  parseCommandFile,
  resolveCustomCommand,
  executeAiLessCommand,
  type CustomCommandFile,
} from './custom-command';

describe('parseCommandFile', () => {
  test('parses YAML frontmatter and strips it from the body', () => {
    const { frontmatter, body } = parseCommandFile(
      '---\ndescription: hi\nrun: echo ok\n---\nBody line\n'
    );
    expect(frontmatter).toEqual({ description: 'hi', run: 'echo ok' });
    expect(body).toBe('Body line\n');
  });

  test('no frontmatter → empty object and full body', () => {
    const { frontmatter, body } = parseCommandFile('Just a prompt $ARGUMENTS');
    expect(frontmatter).toEqual({});
    expect(body).toBe('Just a prompt $ARGUMENTS');
  });

  test('malformed YAML frontmatter → empty object, body after the block', () => {
    const { frontmatter, body } = parseCommandFile('---\n: : bad\n---\nrest');
    expect(frontmatter).toEqual({});
    expect(body).toBe('rest');
  });
});

describe('resolveCustomCommand', () => {
  let repo: string;
  let home: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'archon-cmd-repo-'));
    home = await mkdtemp(join(tmpdir(), 'archon-cmd-home-'));
    await mkdir(join(repo, '.archon', 'commands'), { recursive: true });
    await mkdir(join(home, 'commands'), { recursive: true });
    prevHome = process.env.ARCHON_HOME;
    process.env.ARCHON_HOME = home;
  });
  afterEach(async () => {
    if (prevHome === undefined) delete process.env.ARCHON_HOME;
    else process.env.ARCHON_HOME = prevHome;
    await rm(repo, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  test('resolves a repo-scope command and extracts run/timeout', async () => {
    await writeFile(
      join(repo, '.archon', 'commands', 'foo.md'),
      '---\nrun: echo hi\ntimeout: 5000\n---\nbody'
    );
    const cmd = await resolveCustomCommand('foo', { cwd: repo });
    expect(cmd?.name).toBe('foo');
    expect(cmd?.run).toBe('echo hi');
    expect(cmd?.timeoutMs).toBe(5000);
  });

  test('returns null when the command file is absent', async () => {
    expect(await resolveCustomCommand('nope', { cwd: repo })).toBeNull();
  });

  test('a non-run command file resolves but has no run directive', async () => {
    await writeFile(join(repo, '.archon', 'commands', 'prompt.md'), '---\ndescription: x\n---\nhi');
    const cmd = await resolveCustomCommand('prompt', { cwd: repo });
    expect(cmd).not.toBeNull();
    expect(cmd?.run).toBeUndefined();
  });

  test('falls back to the global ~/.archon/commands when not in the repo', async () => {
    await writeFile(join(home, 'commands', 'glob.md'), '---\nrun: echo global\n---\n');
    const cmd = await resolveCustomCommand('glob', { cwd: repo });
    expect(cmd?.run).toBe('echo global');
    expect(cmd?.path.startsWith(home)).toBe(true);
  });

  test('repo wins over home for the same name (precedence)', async () => {
    await writeFile(join(repo, '.archon', 'commands', 'dup.md'), '---\nrun: echo repo\n---\n');
    await writeFile(join(home, 'commands', 'dup.md'), '---\nrun: echo home\n---\n');
    const cmd = await resolveCustomCommand('dup', { cwd: repo });
    expect(cmd?.run).toBe('echo repo');
  });
});

describe('executeAiLessCommand', () => {
  const mk = (
    run: string | undefined,
    over: Partial<CustomCommandFile> = {}
  ): CustomCommandFile => ({
    name: 't',
    path: '/tmp/t.md',
    frontmatter: {},
    body: '',
    run,
    ...over,
  });

  test('returns stdout as the message and exposes args via $ARGUMENTS', async () => {
    const res = await executeAiLessCommand(mk('echo "$ARGUMENTS"'), ['a', 'b']);
    expect(res.success).toBe(true);
    expect(res.message).toBe('a b');
  });

  test('passes args positionally (injection-safe)', async () => {
    const res = await executeAiLessCommand(mk('printf "%s\\n" "$@"'), ['x y', '$(whoami)']);
    expect(res.success).toBe(true);
    // the metacharacter arg is passed as literal data, not evaluated
    expect(res.message).toBe('x y\n$(whoami)');
  });

  test('non-zero exit → success:false with stderr detail', async () => {
    const res = await executeAiLessCommand(mk('echo boom >&2; exit 3'));
    expect(res.success).toBe(false);
    expect(res.message).toContain('boom');
  });

  test('a command with no run directive is rejected', async () => {
    const res = await executeAiLessCommand(mk(undefined), []);
    expect(res.success).toBe(false);
    expect(res.message).toContain('not an AI-less command');
  });
});
