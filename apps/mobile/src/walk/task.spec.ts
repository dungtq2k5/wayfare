import { describe, expect, it, vi } from 'vitest';

type TaskBody = (input: { data?: { locations: object[] }; error?: unknown }) => Promise<void>;

const tasks = vi.hoisted(() => ({ defined: new Map<string, TaskBody>() }));
vi.mock('expo-task-manager', () => ({
  defineTask: (name: string, body: TaskBody) => tasks.defined.set(name, body),
}));
const controller = vi.hoisted(() => ({
  WALK_TASK: 'wayfare-walk-location',
  installWalk: vi.fn(),
  hydrateWalk: vi.fn(() => Promise.resolve()),
}));
vi.mock('./controller', () => controller);

await import('./task');
const { useWalkStore } = await import('./store');

describe('the walk’s location task', () => {
  it('exists when the bundle loads, with the walk wired and read, even headless', () => {
    expect(tasks.defined.has('wayfare-walk-location')).toBe(true);
    expect(controller.installWalk).toHaveBeenCalled();
    expect(controller.hydrateWalk).toHaveBeenCalled();
  });

  it('hands each location on as a fix, and nothing on an error', async () => {
    const run = tasks.defined.get('wayfare-walk-location')!;
    await run({
      data: {
        locations: [
          { timestamp: 1, coords: { latitude: 10, longitude: 106, accuracy: 8 } },
          { timestamp: 2, coords: { latitude: 11, longitude: 107, accuracy: null } },
        ],
      },
    });
    expect(useWalkStore.getState()).toMatchObject({
      fixSeq: 2,
      fix: { t: 2, lat: 11, lng: 107, accuracyM: 9_999 },
      fixSimulated: false,
    });
    await run({ error: new Error('denied') });
    await run({});
    expect(useWalkStore.getState().fixSeq).toBe(2);
  });
});
