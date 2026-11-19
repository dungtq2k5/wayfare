// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, settle } from '../testing/render-hook';
import { phone, resetPhone } from '../testing/walk-fakes';

vi.mock('expo-location', async () => (await import('../testing/walk-fakes')).expoLocation);
vi.mock('../i18n', () => ({ tourist: () => ({ t: (key: string) => key }) }));
const notifications = vi.hoisted(() => ({
  granted: true,
  handler: null as null | { handleNotification: () => Promise<object> },
  setNotificationHandler: vi.fn((handler: { handleNotification: () => Promise<object> }) => {
    notifications.handler = handler;
  }),
  setNotificationChannelAsync: vi.fn((_id: string, _channel: object) => Promise.resolve()),
  scheduleNotificationAsync: vi.fn((_request: object) => Promise.resolve('id')),
  getPermissionsAsync: vi.fn(() => Promise.resolve({ granted: notifications.granted })),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));
vi.mock('expo-notifications', () => notifications);
const files = vi.hoisted(() => ({
  exists: false,
  text: '',
  shareable: true,
  shared: [] as unknown[],
}));
vi.mock('expo-file-system', () => ({
  Paths: { document: '/docs' },
  File: class {
    uri = 'file:///docs/walk-log.jsonl';
    get exists() {
      return files.exists;
    }
    get size() {
      return files.text.length;
    }
    create() {
      files.exists = true;
    }
    write(text: string, options?: { append?: boolean }) {
      files.text = options?.append ? files.text + text : text;
    }
    text() {
      return Promise.resolve(files.text);
    }
    delete() {
      files.exists = false;
      files.text = '';
    }
  },
}));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(files.shareable),
  shareAsync: (...args: unknown[]) => {
    files.shared.push(args);
    return Promise.resolve();
  },
}));
const env = vi.hoisted(() => ({ diagnostics: true }));
vi.mock('../env', () => ({
  get DIAGNOSTICS_ENABLED() {
    return env.diagnostics;
  },
}));
const focus = vi.hoisted(() => ({ refocus: null as null | (() => void) }));
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return {
    useFocusEffect: (effect: () => () => void) =>
      useEffect(() => {
        let cleanup = effect();
        focus.refocus = () => {
          cleanup();
          cleanup = effect();
        };
        return () => cleanup();
      }, [effect]),
  };
});

const { notifyWalkEnded } = await import('./notifications');
const { deleteWalkLog, shareWalkLog, walkLog } = await import('./log');
const { useWalkPermissions } = await import('./use-walk-permissions');

describe('the idle-end notification (N1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows in the list but never as a banner over the app’s own notice', async () => {
    expect(await notifications.handler!.handleNotification()).toMatchObject({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
    });
  });

  it('says the walk ended and how many Places were heard, on the quiet Walk channel', async () => {
    await notifyWalkEnded(3);
    expect(notifications.setNotificationChannelAsync.mock.calls[0]).toMatchObject([
      'walk',
      { name: 'walk.notification.channel', sound: null, vibrationPattern: null },
    ]);
    expect(notifications.scheduleNotificationAsync.mock.calls[0]![0]).toMatchObject({
      content: { title: 'walk.notification.ended', data: { walkEnded: true } },
      trigger: { channelId: 'walk', seconds: 1 },
    });
  });

  it('sends nothing, and fails nothing, without the permission', async () => {
    notifications.scheduleNotificationAsync.mockRejectedValueOnce(new Error('not allowed'));
    await expect(notifyWalkEnded(0)).resolves.toBeUndefined();
  });
});

describe('the walk log on the phone', () => {
  beforeEach(() => {
    files.exists = false;
    files.text = '';
    files.shareable = true;
    files.shared = [];
  });

  it('creates the file at the first line, appends each line, and prints it in a Diagnostics build', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await walkLog.append({ type: 'walk', event: 'begin' });
    env.diagnostics = false;
    await walkLog.append({ type: 'walk', event: 'ready' });
    env.diagnostics = true;
    expect(files.text.trim().split('\n')).toHaveLength(2);
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toMatch(/^WALKLOG \{"type":"walk","event":"begin"\}$/);
    info.mockRestore();
  });

  it('rolls past 5 MB, keeping the newest half from a line boundary', async () => {
    const old = `${'{"old":1}\n'.repeat(300_000)}${'{"new":1}\n'.repeat(300_000)}`;
    files.exists = true;
    files.text = old;
    await walkLog.append({ type: 'walk', event: 'stop' });
    expect(files.text.length).toBeLessThan(old.length / 2 + 100);
    expect(files.text.startsWith('{"new":1}\n')).toBe(true);
    expect(files.text.endsWith('{"type":"walk","event":"stop"}\n')).toBe(true);
  });

  it('shares the file when there is one and the phone can share', async () => {
    expect(await shareWalkLog()).toBe(false);
    files.exists = true;
    files.shareable = false;
    expect(await shareWalkLog()).toBe(false);
    files.shareable = true;
    expect(await shareWalkLog()).toBe(true);
    expect(files.shared[0]).toEqual([
      'file:///docs/walk-log.jsonl',
      { mimeType: 'application/x-ndjson', dialogTitle: 'Wayfare walk log' },
    ]);
  });

  it('is deleted with the install, and a missing one is fine', () => {
    deleteWalkLog();
    files.exists = true;
    files.text = 'x';
    deleteWalkLog();
    expect(files).toMatchObject({ exists: false, text: '' });
  });
});

describe('what the phone allows the walk (S1)', () => {
  beforeEach(() => resetPhone());

  it('reads always, while open, or none, and the notifications, each time the screen is in front', async () => {
    const rendered = await renderHook(() => useWalkPermissions());
    await settle();
    expect(rendered.current()).toEqual({ location: 'always', notifications: true });
    phone.backgroundGranted = false;
    notifications.granted = false;
    focus.refocus!();
    await settle();
    expect(rendered.current()).toEqual({ location: 'while-open', notifications: false });
    phone.foreground = { granted: false, canAskAgain: true };
    focus.refocus!();
    await settle();
    expect(rendered.current()?.location).toBe('none');
    notifications.granted = true;
  });

  it('drops an answer that comes after the screen left', async () => {
    let answer: (value: { granted: boolean }) => void = () => undefined;
    notifications.getPermissionsAsync.mockReturnValueOnce(
      new Promise((resolve) => (answer = resolve)),
    );
    const rendered = await renderHook(() => useWalkPermissions());
    expect(rendered.current()).toBeNull();
    rendered.unmount();
    answer({ granted: true });
    await settle();
    expect(rendered.current()).toBeNull();
  });
});
