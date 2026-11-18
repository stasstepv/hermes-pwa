#!/usr/bin/env node
/**
 * Hermes PWA plugin installer.
 *
 * Usage:
 *   npx hermes-pwa install
 *   npx hermes-pwa install --dry-run
 *   npx hermes-pwa install --symlink
 *
 * Behavior:
 *   1. Locate HERMES_HOME from the env var or fall back to ~/.hermes
 *   2. Ensure HERMES_HOME/plugins exists
 *   3. Copy (or symlink) this repo into HERMES_HOME/plugins/hermes-pwa
 *   4. Print the next steps for the user
 *
 * Safety rules:
 *   - Never writes secrets or config files.
 *   - Never requires root (fails fast if the target is not writable).
 *   - Works on Windows, macOS and Linux paths.
 */

import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const COPY_PAYLOAD = ['dashboard', 'plugin.yaml', '__init__.py', 'push_common.py', 'LICENSE', 'NOTICE', 'README.md', 'package.json'];
const STATE_FILES = ['push_subscriptions.json', 'pending_approvals.json', 'push_delivery_state.json'];

async function copyWhitelistedPayload(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const entry of COPY_PAYLOAD) {
    const sourcePath = join(src, entry);
    const destPath = join(dest, entry);
    try {
      await lstat(sourcePath);
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    await cp(sourcePath, destPath, { recursive: true, dereference: true });
  }
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0;
}

function parseArgs() {
  return {
    dryRun: getArg('--dry-run'),
    symlink: getArg('--symlink'),
    force: getArg('--force'),
    help: getArg('--help') || getArg('-h'),
  };
}

function printHelp() {
  console.log(`Hermes PWA plugin installer

Usage:
  npx hermes-pwa install [options]

Options:
  --dry-run    Show what would happen without changing the filesystem.
  --symlink    Create a symlink instead of copying files (useful for development).
  --force      Accepted for compatibility; refreshes managed files while preserving plugin state.
  -h, --help   Show this message.
`);
}

async function readPackageVersion(src) {
  const raw = await readFile(join(src, 'package.json'), 'utf8');
  const pkg = JSON.parse(raw);
  return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
}

async function writeInstallMarker(dest, src) {
  const version = await readPackageVersion(src);
  const marker = {
    install_method: 'npm',
    package: 'hermes-pwa',
    version,
    installed_at: new Date().toISOString(),
  };
  await writeFile(join(dest, '.hermes-pwa-install.json'), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

function isPathInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}

async function copyRegularState(existing, staged) {
  try {
    if (!(await lstat(existing)).isDirectory()) return;
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  for (const name of STATE_FILES) {
    const sourcePath = join(existing, name);
    try {
      if ((await lstat(sourcePath)).isFile()) {
        await copyFile(sourcePath, join(staged, name));
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
}

async function installStaged(dest, pluginsDir, populate) {
  const staged = await mkdtemp(join(pluginsDir, '.hermes-pwa-stage-'));
  const backup = `${staged}-previous`;
  let previousMoved = false;
  let installed = false;

  try {
    await populate(staged);

    try {
      await rename(dest, backup);
      previousMoved = true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    try {
      await rename(staged, dest);
      installed = true;
    } catch (err) {
      if (previousMoved) {
        try {
          await rename(backup, dest);
        } catch (restoreErr) {
          throw new Error(`${err.message}; previous install is recoverable at ${backup}: ${restoreErr.message}`);
        }
      }
      throw err;
    }

    if (previousMoved) {
      try {
        await rm(backup, { recursive: true, force: true });
      } catch (err) {
        console.warn(`Warning: installed, but previous version remains at ${backup}: ${err.message}`);
      }
    }
  } finally {
    if (!installed) await rm(staged, { recursive: true, force: true });
  }
}

async function installCopy(src, dest, pluginsDir) {
  await installStaged(dest, pluginsDir, async (staged) => {
    await copyWhitelistedPayload(src, staged);
    await copyRegularState(dest, staged);
    await writeInstallMarker(staged, src);
  });
}

async function installSymlink(src, dest, pluginsDir) {
  await installStaged(dest, pluginsDir, async (staged) => {
    await rm(staged, { recursive: true, force: true });
    await symlink(src, staged, process.platform === 'win32' ? 'junction' : 'dir');
  });
}

async function install() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const hermesHome = process.env.HERMES_HOME
    ? resolve(process.env.HERMES_HOME)
    : join(homedir(), '.hermes');

  const pluginsDir = join(hermesHome, 'plugins');
  const dest = join(pluginsDir, 'hermes-pwa');
  const src = resolve(join(__dirname, '..'));

  console.log(`HERMES_HOME: ${hermesHome}`);
  console.log(`Source:      ${src}`);
  console.log(`Destination: ${dest}`);
  console.log(`Mode:        ${args.symlink ? 'symlink' : 'copy'}${args.dryRun ? ' (dry-run)' : ''}${args.force ? ' --force' : ''}`);

  if (args.dryRun) {
    console.log('\nDry run complete. No files were changed.');
    console.log(`\nNext steps (not executed because of --dry-run):`);
    console.log(`  1. mkdir -p ${pluginsDir}`);
    console.log(`  2. ${args.symlink ? 'symlink' : `copy whitelisted plugin payload (${COPY_PAYLOAD.join(', ')})`} ${src} → ${dest}`);
    console.log(`  3. Restart Hermes Dashboard/gateway`);
    console.log(`  4. Open Hermes Dashboard and click the Mobile tab`);
    process.exit(0);
  }

  try {
    await mkdir(pluginsDir, { recursive: true });
  } catch (err) {
    console.error(`Error: unable to create ${pluginsDir}: ${err.message}`);
    process.exit(1);
  }

  try {
    const canonicalSrc = await realpath(src);
    // Resolve the plugins directory, not the destination entry: an existing
    // development symlink is renamed and replaced as a link, so its target
    // (usually this checkout) is never written through.
    const canonicalDest = join(await realpath(pluginsDir), 'hermes-pwa');
    if (canonicalSrc === canonicalDest || isPathInside(canonicalSrc, canonicalDest)) {
      throw new Error('source and destination resolve to the same location or destination is inside the source');
    }
  } catch (err) {
    console.error(`Error: unsafe installation path: ${err.message}`);
    process.exit(1);
  }

  try {
    if (args.symlink) {
      await installSymlink(src, dest, pluginsDir);
    } else {
      await installCopy(src, dest, pluginsDir);
    }
  } catch (err) {
    console.error(`Error: install failed: ${err.message}`);
    process.exit(1);
  }

  console.log('\n✅ Hermes PWA plugin installed.');
  console.log('\nNext steps:');
  console.log('  1. Restart Hermes Dashboard/gateway if it is already running.');
  console.log('  2. Open Hermes Dashboard in your browser.');
  console.log('  3. Click the "Mobile" tab.');
  console.log('  4. Follow the on-screen instructions to install the PWA on your phone.\n');
}

await install();
