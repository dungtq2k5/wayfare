// In-memory stand-ins for expo-sqlite's key-value store and expo-file-system, for the player's and
// the data layer's specs: `vi.mock('expo-sqlite/kv-store', () => import('../testing/player-fakes').then((m) => m.kvStoreModule))`.

/**
 * The fakes' state lives on the global object: a spec that resets its modules gets a new copy of
 * this file inside its mocks, and both copies must see the same storage.
 */
const shared = globalThis as typeof globalThis & {
  __playerFakes?: { kv: typeof kvState; files: typeof filesState };
};
const kvState = { items: new Map<string, string>(), failing: false };
const filesState = {
  existing: new Map<string, Uint8Array>(),
  /** What `File.downloadFileAsync` writes: the url's bytes. */
  downloads: new Map<string, Uint8Array>(),
  /** Paths whose `delete` throws. */
  undeletable: new Set<string>(),
  failCreate: false,
};
shared.__playerFakes ??= { kv: kvState, files: filesState };

/** expo-sqlite/kv-store's default export, over a map a spec can read and break. */
export const kv = shared.__playerFakes.kv;

const answer = <T>(value: () => T): Promise<T> =>
  kv.failing ? Promise.reject(new Error('storage unavailable')) : Promise.resolve(value());

export const kvStoreModule = {
  default: {
    getItem: (key: string) => answer(() => kv.items.get(key) ?? null),
    setItem: (key: string, value: string) => answer(() => void kv.items.set(key, value)),
    removeItem: (key: string) => answer(() => void kv.items.delete(key)),
    getItemAsync: (key: string) => answer(() => kv.items.get(key) ?? null),
    setItemAsync: (key: string, value: string) => answer(() => void kv.items.set(key, value)),
    removeItemAsync: (key: string) => answer(() => void kv.items.delete(key)),
  },
};

/** expo-file-system's `File`, `Directory` and `Paths`, over a set of paths that exist. */
export const files = shared.__playerFakes.files;

const join = (...parts: (string | { uri: string })[]) =>
  parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');

class FakeFile {
  readonly uri: string;
  constructor(...parts: (string | { uri: string })[]) {
    this.uri = join(...parts);
  }
  get exists() {
    return files.existing.has(this.uri);
  }
  create() {
    if (files.failCreate) throw new Error('read-only');
    files.existing.set(this.uri, new Uint8Array());
  }
  write(bytes: Uint8Array) {
    files.existing.set(this.uri, bytes);
  }
  delete() {
    if (files.undeletable.has(this.uri)) throw new Error('busy');
    files.existing.delete(this.uri);
  }
  bytes() {
    return Promise.resolve(files.existing.get(this.uri) ?? new Uint8Array());
  }
  static downloadFileAsync(url: string, target: FakeFile) {
    const bytes = files.downloads.get(url);
    if (bytes === undefined) return Promise.reject(new Error('404'));
    files.existing.set(target.uri, bytes);
    return Promise.resolve(target);
  }
}

class FakeDirectory {
  readonly uri: string;
  constructor(...parts: (string | { uri: string })[]) {
    this.uri = join(...parts);
  }
  get exists() {
    return [...files.existing.keys()].some((path) => path.startsWith(`${this.uri}/`));
  }
  create() {}
  delete() {
    for (const path of [...files.existing.keys()])
      if (path.startsWith(`${this.uri}/`)) files.existing.delete(path);
  }
}

export const fileSystemModule = {
  File: FakeFile,
  Directory: FakeDirectory,
  Paths: { cache: { uri: 'cache:' }, document: { uri: 'doc:' } },
};
