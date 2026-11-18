import { execFile } from 'node:child_process';
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, '..');
const installer = join(scriptsDir, 'install-plugin.mjs');
const safetyScript = join(scriptsDir, 'hermes-pwa-safety.sh');
const tempDirs = [];
const STATE_FILES = ['push_subscriptions.json', 'pending_approvals.json', 'push_delivery_state.json'];

async function makeTempDir(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function run(command, args, options) {
  return execFileAsync(command, args, { cwd: repoRoot, ...options });
}

async function install(env, args = []) {
  return run(process.execPath, [installer, ...args], { env });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('plugin installation safety', () => {
  it('preserves only regular plugin state files when refreshing a copy installation', async () => {
    const hermesHome = await makeTempDir('hermes-pwa-home-');
    const env = { ...process.env, HERMES_HOME: hermesHome };
    await install(env);

    const pluginDir = join(hermesHome, 'plugins', 'hermes-pwa');
    for (const [index, name] of STATE_FILES.entries()) {
      await writeFile(join(pluginDir, name), `state-${index}\n`);
    }
    await writeFile(join(pluginDir, 'obsolete.txt'), 'stale root file\n');
    await mkdir(join(pluginDir, 'dashboard', 'obsolete'), { recursive: true });
    await writeFile(join(pluginDir, 'dashboard', 'obsolete', 'old.js'), 'stale nested file\n');
    await mkdir(join(pluginDir, '.git'), { recursive: true });
    await writeFile(join(pluginDir, '.git', 'config'), 'stale metadata\n');

    await install(env);

    await Promise.all(STATE_FILES.map(async (name, index) => {
      await expect(readFile(join(pluginDir, name), 'utf8')).resolves.toBe(`state-${index}\n`);
    }));
    await expect(lstat(join(pluginDir, 'obsolete.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(join(pluginDir, 'dashboard', 'obsolete', 'old.js'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(join(pluginDir, '.git'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not follow state symlinks during a copy refresh', async () => {
    const hermesHome = await makeTempDir('hermes-pwa-home-');
    const env = { ...process.env, HERMES_HOME: hermesHome };
    await install(env);

    const pluginDir = join(hermesHome, 'plugins', 'hermes-pwa');
    await Promise.all(STATE_FILES.map(async (name, index) => {
      const external = join(hermesHome, `external-state-${index}.json`);
      await writeFile(external, `must not be copied-${index}\n`);
      await symlink(external, join(pluginDir, name));
    }));

    await install(env);

    await Promise.all(STATE_FILES.map(async (name, index) => {
      await expect(lstat(join(pluginDir, name))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(join(hermesHome, `external-state-${index}.json`), 'utf8')).resolves.toBe(`must not be copied-${index}\n`);
    }));
  });

  it.each([
    { mode: 'copy', args: [] },
    { mode: 'symlink', args: ['--symlink'] },
  ])('replaces an existing development symlink in $mode mode without touching the source', async ({ args }) => {
    const hermesHome = await makeTempDir('hermes-pwa-home-');
    const env = { ...process.env, HERMES_HOME: hermesHome };
    const dest = join(hermesHome, 'plugins', 'hermes-pwa');
    await install(env, ['--symlink']);
    expect((await lstat(dest)).isSymbolicLink()).toBe(true);

    await install(env, args);

    const installed = await lstat(dest);
    expect(installed.isSymbolicLink()).toBe(args.includes('--symlink'));
    if (!installed.isSymbolicLink()) {
      expect(installed.isDirectory()).toBe(true);
      await expect(lstat(join(dest, '.hermes-pwa-install.json'))).resolves.toBeTruthy();
    }
    await expect(lstat(join(repoRoot, 'package.json'))).resolves.toBeTruthy();
    await expect(lstat(join(repoRoot, '.hermes-pwa-install.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a destination inside the source through a symlinked plugins directory', async () => {
    const hermesHome = await makeTempDir('hermes-pwa-home-');
    const pluginsDir = join(hermesHome, 'plugins');
    await symlink(repoRoot, pluginsDir, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(install({ ...process.env, HERMES_HOME: hermesHome })).rejects.toMatchObject({ code: 1 });
    await expect(lstat(join(repoRoot, 'hermes-pwa'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('excludes Hermes configuration from a plugin-state snapshot', async () => {
    const home = await makeTempDir('hermes-pwa-home-');
    const bin = await makeTempDir('hermes-pwa-bin-');
    await mkdir(join(home, '.hermes'), { recursive: true });
    await writeFile(join(home, '.hermes', 'config.yaml'), 'sensitive-setting: retained-outside-snapshot\n');
    await writeFile(join(bin, 'hermes'), '#!/usr/bin/env bash\necho gateway-status\n');
    await chmod(join(bin, 'hermes'), 0o755);

    const { stdout } = await run('bash', [safetyScript, 'snapshot'], {
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
    });
    const archive = stdout.match(/^snapshot: (.+)$/m)?.[1];
    expect(archive).toBeTruthy();

    const { stdout: listing } = await run('tar', ['-tzf', archive]);
    expect(listing).not.toContain('config.yaml');
  });
});
