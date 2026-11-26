import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  channel: vi.fn((_id: string, _options: object) => Promise.resolve()),
  schedule: vi.fn(
    (_request: { identifier: string; content: Record<string, unknown>; trigger: object }) =>
      Promise.resolve('id'),
  ),
  dismiss: vi.fn((_id: string) => Promise.resolve()),
}));
vi.mock('expo-notifications', () => ({
  AndroidImportance: { LOW: 2 },
  setNotificationChannelAsync: native.channel,
  scheduleNotificationAsync: native.schedule,
  dismissNotificationAsync: native.dismiss,
}));
vi.mock('../i18n', () => ({
  tourist: () => ({
    t: (key: string, args?: object) => (args ? `${key} ${JSON.stringify(args)}` : key),
  }),
}));
vi.mock('./area-name', () => ({ areaName: () => 'District 1' }));

const { notifyPack } = await import('./notify');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const shown = () => native.schedule.mock.calls.map(([request]) => request.content.title);
let clock = 100_000;

describe('Android’s download notification (N1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clock += 60_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
  });

  it('says the progress on a quiet channel, at most every five seconds, and a tap opens the pack', async () => {
    const progress = { done: 1_000_000, total: 4_000_000, stage: 'photo' as const };
    notifyPack('a1', 'en', 'progress', progress);
    await flush();
    clock += 4_999;
    notifyPack('a1', 'en', 'progress', progress);
    await flush();
    clock += 1;
    notifyPack('a1', 'en', 'progress', progress);
    await flush();
    expect(native.channel).toHaveBeenCalledTimes(1);
    expect(native.channel.mock.calls[0]![1]).toMatchObject({ importance: 2, sound: null });
    expect(native.schedule).toHaveBeenCalledTimes(2);
    const [request] = native.schedule.mock.calls[0]!;
    expect(request).toMatchObject({
      identifier: 'pack-a1-en',
      content: {
        title: 'pack.notification.downloading {"area":"District 1"}',
        sticky: true,
        data: { pack: { areaId: 'a1', lang: 'en' } },
      },
      trigger: { channelId: 'downloads' },
    });
    expect(request.content.body).toContain('pack.stage.photo');
  });

  it('replaces it with what the run ended in', async () => {
    notifyPack('a2', 'en', 'waiting-wifi');
    notifyPack('a2', 'en', 'ready', { done: 5, total: 5, stage: 'checking' });
    notifyPack('a2', 'en', 'ready');
    notifyPack('a2', 'en', 'failed');
    await flush();
    expect(shown()).toEqual([
      'pack.notification.waitingWifi {"area":"District 1"}',
      'pack.notification.ready {"area":"District 1"}',
      'pack.notification.ready {"area":"District 1"}',
      'pack.notification.stopped',
    ]);
  });

  it('removes it on a pause or a delete, and keeps it while the run goes on', async () => {
    for (const state of ['downloading', 'checking', 'waiting-connection'] as const)
      notifyPack('a3', 'en', state);
    await flush();
    expect(native.dismiss).not.toHaveBeenCalled();
    expect(native.schedule).not.toHaveBeenCalled();
    notifyPack('a3', 'en', 'paused');
    notifyPack('a3', 'en', null);
    await flush();
    expect(native.dismiss).toHaveBeenCalledWith('pack-a3-en');
    expect(native.dismiss).toHaveBeenCalledTimes(2);
  });

  it('shows nothing, and throws nothing, without the permission', async () => {
    native.schedule.mockRejectedValueOnce(new Error('no permission'));
    notifyPack('a4', 'en', 'failed');
    await flush();
    expect(native.schedule).toHaveBeenCalled();
  });
});
