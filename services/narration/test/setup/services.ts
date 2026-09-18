// narration's services wired by hand, with in-memory stand-ins for catalog, the queue, the socket
// and storage — so a suite drives the pipeline step by step and reads what it wrote.
import { createHash } from 'node:crypto';
import { AudioStatus, newId, PlaceKind, PlaceStatus, TranslationSource } from '@wayfare/contracts';
import type { SocketEventKey, SocketPayload } from '@wayfare/contracts';
import {
  audioStatusProto,
  placeKindProto,
  placeStatusProto,
  translationSourceProto,
} from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { OutboxService } from '@wayfare/nest-common';
import type { StorageProvider } from '@wayfare/nest-common/storage';
import type { CatalogServiceGrpcClient } from '../../src/modules/catalog/catalog-service-grpc.client';
import { JobsService } from '../../src/modules/jobs/jobs.service';
import { NarrationService } from '../../src/modules/narration/narration.service';
import type { PrismaService } from '../../src/modules/prisma/prisma.service';
import { ProgressService } from '../../src/modules/progress/progress.service';
import { ProvidersHealthService } from '../../src/modules/providers-health/providers-health.service';
import { SynthesisRecoverJob } from '../../src/modules/scheduled/synthesis-recover.job';
import type { TaskQueue } from '../../src/modules/tasks/tasks.module';
import { TasksService } from '../../src/modules/tasks/tasks.service';
import { configuredChains } from '../../src/providers/configured-providers';
import type { ProviderChains } from '../../src/providers/configured-providers';
import { testConfig } from './database';

export const sha = (value: string) => createHash('sha256').update(value).digest('hex');

/** One language row of a Place, as catalog reports it. */
export function localizationState(
  lang: string,
  hash: string,
  audio: { status?: AudioStatus; hash?: string | null } = {},
): catalogGrpc.LocalizationState {
  const audioHash = audio.hash === undefined ? hash : audio.hash;
  const ready = (audio.status ?? AudioStatus.READY) === AudioStatus.READY && audioHash !== null;
  return {
    lang,
    sourceContentHash: hash,
    translationSource: translationSourceProto.toProto(
      lang === 'vi' ? TranslationSource.SOURCE : TranslationSource.MACHINE,
    ),
    audioStatus: audioStatusProto.toProto(audio.status ?? AudioStatus.READY),
    ...(ready
      ? {
          audioSourceContentHash: audioHash,
          audioObjectPath: `audio/${audioHash.slice(0, 12)}-${lang}.mp3`,
          audioSha256: 'e'.repeat(64),
          audioBytes: 1000,
          audioDurationMs: 2000,
        }
      : {}),
  };
}

/** catalog as narration sees it: a Place or menu item's source per id, set by the test. */
export class FakeCatalog {
  readonly sources = new Map<string, catalogGrpc.GetLocalizationSourceResponse>();
  calls = 0;
  /** When set, every call rejects — a transport error. */
  down = false;

  /** Adds or replaces a Place; returns its id and hash. */
  place(
    input: {
      id?: string;
      name?: string;
      description?: string;
      status?: PlaceStatus;
      kind?: PlaceKind;
      deleted?: boolean;
      localizations?: catalogGrpc.LocalizationState[];
    } = {},
  ): { id: string; hash: string } {
    const id = input.id ?? newId();
    const name = input.name ?? 'Chợ Bến Thành';
    const description = input.description ?? 'Chợ có từ năm 1914. Chợ rất đông khách.';
    const hash = sha(`${name}\n${description}`);
    this.sources.set(id, {
      place: {
        kind: placeKindProto.toProto(input.kind ?? PlaceKind.EDITORIAL),
        status: placeStatusProto.toProto(input.status ?? PlaceStatus.ACTIVE),
        deleted: input.deleted ?? false,
        contentHash: hash,
        nameVi: name,
        descriptionVi: description,
        localizations: input.localizations ?? [],
      },
    });
    return { id, hash };
  }

  /** Adds or replaces a menu item. */
  menuItem(input: { id?: string; placeId?: string; name?: string } = {}): {
    id: string;
    hash: string;
  } {
    const id = input.id ?? newId();
    const name = input.name ?? 'Phở bò';
    const hash = sha(name);
    this.sources.set(id, {
      menuItem: { placeId: input.placeId ?? newId(), contentHash: hash, nameVi: name },
    });
    return { id, hash };
  }

  localizationSource(
    _type: string,
    id: string,
  ): Promise<catalogGrpc.GetLocalizationSourceResponse> {
    this.calls += 1;
    if (this.down) return Promise.reject(new Error('14 UNAVAILABLE: catalog is down'));
    return Promise.resolve(this.sources.get(id) ?? { notFound: {} });
  }
}

/** The synthesis queue in memory: items by id, drained by priority on request. */
export class FakeTaskQueue {
  readonly items = new Map<
    string,
    { taskId: string; attempts: number; priority: number; delayMs?: number }
  >();
  runsWorker = false;
  run: (taskId: string) => Promise<void> = () => Promise.resolve();

  add(taskId: string, attempts: number, priority: number, delayMs?: number): Promise<void> {
    this.items.set(`${taskId}-${attempts}`, { taskId, attempts, priority, delayMs });
    return Promise.resolve();
  }

  remove(taskId: string, attempts: number): Promise<void> {
    this.items.delete(`${taskId}-${attempts}`);
    return Promise.resolve();
  }

  has(taskId: string, attempts: number): Promise<boolean> {
    return Promise.resolve(this.items.has(`${taskId}-${attempts}`));
  }

  start(): void {}

  /** The next item by priority, removed; null when empty. */
  take(): { taskId: string; attempts: number } | null {
    const [first] = [...this.items.entries()].toSorted(([, a], [, b]) => a.priority - b.priority);
    if (first === undefined) return null;
    this.items.delete(first[0]);
    return first[1];
  }

  /** Runs items until none is left (delays ignored), at most `limit`. */
  async drain(limit = 200): Promise<number> {
    let ran = 0;
    for (let item = this.take(); item !== null && ran < limit; item = this.take()) {
      await this.run(item.taskId);
      ran++;
    }
    return ran;
  }
}

/** The socket emitter, recording frames. */
export class FrameRecorder {
  readonly frames: { rooms: string[]; event: SocketEventKey; payload: unknown }[] = [];

  toRoom<K extends SocketEventKey>(
    room: string | readonly string[],
    event: K,
    payload: SocketPayload<K>,
  ): void {
    this.frames.push({ rooms: typeof room === 'string' ? [room] : [...room], event, payload });
  }

  of(event: SocketEventKey): unknown[] {
    return this.frames.filter((frame) => frame.event === event).map((frame) => frame.payload);
  }
}

/** Object storage in memory. */
export class MemoryStorage implements StorageProvider {
  readonly objects = new Map<string, { data: Buffer; cacheControl: string }>();
  /** When set, uploads wait until this many are pending, then all finish together. */
  barrier: number | null = null;
  private waiting: (() => void)[] = [];

  signUpload(): never {
    throw new Error('narration signs no uploads');
  }
  stat(path: string) {
    const object = this.objects.get(path);
    return Promise.resolve(object === undefined ? null : { bytes: object.data.length });
  }
  download(path: string): Promise<Buffer> {
    return Promise.resolve(this.objects.get(path)!.data);
  }
  upload(path: string, data: Buffer, options: { contentType: string; cacheControl: string }) {
    this.objects.set(path, { data, cacheControl: options.cacheControl });
    if (this.barrier === null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
      if (this.waiting.length >= this.barrier!)
        for (const release of this.waiting.splice(0)) release();
    });
  }
  delete(path: string): Promise<void> {
    this.objects.delete(path);
    return Promise.resolve();
  }
  readinessCheck() {
    return { name: 'storage', check: () => Promise.resolve() };
  }
}

/** A Redis the voice cache can use: nothing cached, writes ignored. */
const noCache = {
  get: () => Promise.resolve(null),
  set: () => Promise.resolve('OK'),
};

/** narration's services, wired by hand the way the modules wire them. */
export function narrationServices(
  prisma: PrismaService,
  options: { chains?: ProviderChains; catalog?: FakeCatalog } = {},
) {
  const config = testConfig();
  const outbox = new OutboxService();
  const catalog = options.catalog ?? new FakeCatalog();
  const frames = new FrameRecorder();
  const queue = new FakeTaskQueue();
  const storage = new MemoryStorage();
  const chains =
    options.chains ??
    configuredChains({ TRANSLATION_PROVIDER_ORDER: ['fake'], TTS_PROVIDER_ORDER: ['fake'] });
  const health = new ProvidersHealthService(chains, noCache as never);
  const client = catalog as unknown as CatalogServiceGrpcClient;
  const tasks = new TasksService(
    prisma,
    outbox,
    client,
    health,
    new ProgressService(frames),
    queue as unknown as TaskQueue,
    storage,
  );
  queue.run = (taskId) => tasks.run(taskId);
  const jobs = new JobsService(prisma, outbox, tasks, client, health);
  const narration = new NarrationService(client, jobs, tasks, config);
  const recover = new SynthesisRecoverJob(tasks, queue as unknown as TaskQueue);
  return { catalog, queue, frames, storage, chains, health, tasks, jobs, narration, recover };
}
