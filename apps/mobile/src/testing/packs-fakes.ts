// An in-memory `expo-file-system` for the packs' specs:
// vi.mock('expo-file-system', async () => (await import('../testing/packs-fakes')).fileSystem).
// The disk is a map of paths to bytes; folders are the paths `create` made. A spec says how a
// download answers through `disk.download`, and reads what is on the phone through `disk`.

type Bytes = Uint8Array;

const files = new Map<string, Bytes>();
const folders = new Set<string>();

/** What a transfer does: write the file's bytes, or throw like the native module. */
type Download = (url: string, path: string, onProgress: (bytes: number) => void) => Promise<void>;

export const disk = {
  files,
  folders,
  availableDiskSpace: 5_000_000_000,
  download: ((_url, path) => {
    files.set(path, new Uint8Array([1, 2, 3]));
    return Promise.resolve();
  }) as Download,
  /** What a resumable task answers: `null` is a task paused before it ended. */
  taskResult: { uri: 'done' } as { uri: string } | null,
  paused: 0,
  resumedFrom: [] as string[],
  reset() {
    files.clear();
    folders.clear();
    this.availableDiskSpace = 5_000_000_000;
    this.download = (_url, path) => {
      files.set(path, new Uint8Array([1, 2, 3]));
      return Promise.resolve();
    };
    this.taskResult = { uri: 'done' };
    this.paused = 0;
    this.resumedFrom = [];
  },
};

const pathOf = (parent: Directory | string, names: string[]) =>
  [typeof parent === 'string' ? parent : parent.uri, ...names]
    .filter((part) => part !== '')
    .join('/');

export class Directory {
  readonly uri: string;
  constructor(parent: Directory | string, ...names: string[]) {
    this.uri = pathOf(parent, names);
  }
  get name(): string {
    return this.uri.split('/').at(-1)!;
  }
  get exists(): boolean {
    return folders.has(this.uri);
  }
  create(_options?: { intermediates?: boolean }): void {
    folders.add(this.uri);
  }
  delete(): void {
    for (const path of [...files.keys()]) if (path.startsWith(`${this.uri}/`)) files.delete(path);
    for (const path of [...folders])
      if (path === this.uri || path.startsWith(`${this.uri}/`)) folders.delete(path);
  }
  list(): (Directory | File)[] {
    const below = (path: string) =>
      path.startsWith(`${this.uri}/`) && !path.slice(this.uri.length + 1).includes('/');
    return [
      ...[...folders].filter(below).map((path) => new Directory(path)),
      ...[...files.keys()].filter(below).map((path) => new File(path)),
    ];
  }
}

export class File {
  readonly uri: string;
  constructor(parent: Directory | string, ...names: string[]) {
    this.uri = pathOf(parent, names);
  }
  get name(): string {
    return this.uri.split('/').at(-1)!;
  }
  get exists(): boolean {
    return files.has(this.uri);
  }
  get size(): number {
    return files.get(this.uri)?.length ?? 0;
  }
  delete(): void {
    files.delete(this.uri);
  }
  write(content: Bytes | string): void {
    files.set(this.uri, typeof content === 'string' ? new TextEncoder().encode(content) : content);
  }
  bytes(): Promise<Bytes> {
    return Promise.resolve(files.get(this.uri) ?? new Uint8Array());
  }
  text(): Promise<string> {
    return Promise.resolve(new TextDecoder().decode(files.get(this.uri)));
  }
  move(target: File): void {
    files.set(target.uri, files.get(this.uri)!);
    files.delete(this.uri);
  }
  static downloadFileAsync(
    url: string,
    target: File,
    options: { onProgress: (event: { bytesWritten: number }) => void; signal?: AbortSignal },
  ): Promise<void> {
    return disk.download(url, target.uri, (bytesWritten) => options.onProgress({ bytesWritten }));
  }
}

export class DownloadTask {
  constructor(
    readonly url: string,
    readonly target: File | string,
    readonly options: { onProgress: (event: { bytesWritten: number }) => void },
  ) {}
  static fromSavable(
    savable: { url: string; fileUri: string; resumeData: string },
    options: { onProgress: (event: { bytesWritten: number }) => void },
  ): DownloadTask {
    disk.resumedFrom.push(savable.resumeData);
    return new DownloadTask(savable.url, savable.fileUri, options);
  }
  private async run(): Promise<{ uri: string } | null> {
    const path = typeof this.target === 'string' ? this.target : this.target.uri;
    await disk.download(this.url, path, (bytesWritten) =>
      this.options.onProgress({ bytesWritten }),
    );
    return disk.taskResult;
  }
  downloadAsync() {
    return this.run();
  }
  resumeAsync() {
    return this.run();
  }
  pauseAsync(): Promise<void> {
    disk.paused += 1;
    return Promise.resolve();
  }
}

export const fileSystem = {
  Directory,
  File,
  DownloadTask,
  Paths: {
    document: new Directory('file:///doc'),
    get availableDiskSpace() {
      return disk.availableDiskSpace;
    },
  },
};
