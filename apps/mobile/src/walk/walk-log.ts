/** The log file, so the rolling rule is testable without a phone. */
export interface LogFile {
  /** Bytes on disk now. */
  size(): number;
  append(text: string): Promise<void>;
  read(): Promise<string>;
  write(text: string): Promise<void>;
}

/** The size at which the file rolls. */
export const WALK_LOG_MAX_BYTES = 5 * 1024 * 1024;

/** The newest half of `text`, starting at a line boundary: the oldest half is dropped. */
export function dropOldestHalf(text: string): string {
  const cut = text.indexOf('\n', Math.floor(text.length / 2));
  return cut === -1 ? '' : text.slice(cut + 1);
}

/**
 * One JSON line per event, appended in order. Writes are chained so lines never interleave, the
 * file is read only when it must roll, and a failing write is swallowed: the log must never take
 * the walk down.
 */
export function createWalkLog(file: LogFile, maxBytes: number = WALK_LOG_MAX_BYTES) {
  let chain: Promise<void> = Promise.resolve();
  return {
    append(event: object): Promise<void> {
      chain = chain
        .then(async () => {
          await file.append(JSON.stringify(event) + '\n');
          if (file.size() > maxBytes) await file.write(dropOldestHalf(await file.read()));
        })
        .catch(() => undefined);
      return chain;
    },
  };
}
