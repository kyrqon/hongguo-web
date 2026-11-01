import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One process owns this store. Writes are serialized and replaced atomically. */
export async function openStore(directory) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'accounts.json');
  let state;
  try {
    state = JSON.parse(await readFile(file, 'utf8'));
    if (state.version !== 1 || !Array.isArray(state.users) || !Array.isArray(state.sessions)) {
      throw new Error('Unsupported accounts database format');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    state = { version: 1, users: [], sessions: [] };
  }
  let pending = Promise.resolve();
  const save = () => {
    const snapshot = JSON.stringify(state);
    const operation = pending.then(async () => {
      const temporary = `${file}.tmp`;
      await writeFile(temporary, snapshot, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, file);
    });
    pending = operation.catch(() => {});
    return operation;
  };
  return { state, save, flush: () => pending };
}
