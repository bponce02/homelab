import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import type { Credential, CredentialStore, AuthOperationOptions } from '@earendil-works/pi-ai';

export class FileCredentials implements CredentialStore {
  constructor(private directory: string) {}
  private async load(): Promise<Record<string, Credential>> {
    try { return JSON.parse(await readFile(join(this.directory, 'auth.json'), 'utf8')); }
    catch (error: any) { if (error.code === 'ENOENT') return {}; throw error; }
  }
  private async transaction<T>(fn: (all: Record<string, Credential>) => Promise<T>, options?: AuthOperationOptions): Promise<T> {
    options?.signal?.throwIfAborted();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const target = join(this.directory, '.auth-lock');
    await writeFile(target, '', { flag: 'a', mode: 0o600 });
    const release = await lockfile.lock(target, { stale: 120_000, update: 10_000, retries: { retries: 50, minTimeout: 50, maxTimeout: 200 } });
    try {
      options?.signal?.throwIfAborted();
      const all = await this.load();
      const result = await fn(all);
      const temp = join(this.directory, `.auth-${randomUUID()}.tmp`);
      await writeFile(temp, JSON.stringify(all), { mode: 0o600, flag: 'wx' });
      await rename(temp, join(this.directory, 'auth.json'));
      return result;
    } finally { await release(); }
  }
  async read(id: string, options?: AuthOperationOptions) { options?.signal?.throwIfAborted(); return (await this.load())[id]; }
  async list(options?: AuthOperationOptions) {
    options?.signal?.throwIfAborted();
    return Object.entries(await this.load()).map(([providerId, value]) => ({ providerId, type: value.type }));
  }
  async modify(id: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>, options?: AuthOperationOptions) {
    return this.transaction(async all => {
      const updated = await fn(all[id]);
      if (updated !== undefined) all[id] = updated;
      return all[id];
    }, options);
  }
  async delete(id: string, options?: AuthOperationOptions) { await this.transaction(async all => { delete all[id]; }, options); }
}
