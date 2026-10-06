import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('Codex setup creates a private server-side LibreChat key file without overwriting secrets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pi-setup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'pi-connectors', 'src');
  await mkdir(source, { recursive: true });
  const script = join(source, 'setup.ts');
  await copyFile(resolve('src/setup.ts'), script);
  await copyFile(resolve('package.json'), join(root, 'pi-connectors', 'package.json'));
  const execute = () => promisify(execFile)(process.execPath, ['--import', 'tsx', script, 'codex']);
  const first = await execute();
  const envDir = join(root, 'config', 'env', 'pi-connectors');
  const key = (await readFile(join(envDir, 'codex.key'), 'utf8')).trim();
  const environment = await readFile(join(envDir, 'librechat.env'), 'utf8');
  assert.equal(environment, `CODEX_CONNECTOR_API_KEY=${key}\n`);
  assert.equal((await stat(join(envDir, 'librechat.env'))).mode & 0o777, 0o600);
  assert.ok(!first.stdout.includes(key));
  await execute();
  assert.equal((await readFile(join(envDir, 'codex.key'), 'utf8')).trim(), key);
  assert.equal(await readFile(join(envDir, 'librechat.env'), 'utf8'), environment);
});
