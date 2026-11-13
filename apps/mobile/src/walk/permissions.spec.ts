import { describe, expect, it } from 'vitest';
import { runStartFlow } from './permissions';
import type { Answer, ForegroundStatus, PermissionDeps, PermissionScreen } from './permissions';

interface Script {
  foreground?: ForegroundStatus[];
  background?: boolean;
  backgroundAfterSettings?: boolean;
  android13?: boolean;
  answers?: Answer[];
  flags?: { backgroundExplained?: boolean; notificationsExplained?: boolean };
}

function setup(script: Script) {
  const shown: PermissionScreen[] = [];
  const calls: string[] = [];
  const grants = [...(script.foreground ?? [{ granted: true, canAskAgain: true }])];
  const answers = [...(script.answers ?? [])];
  const flags = {
    backgroundExplained: script.flags?.backgroundExplained ?? false,
    notificationsExplained: script.flags?.notificationsExplained ?? false,
  };
  let current = grants.shift()!;
  const deps: PermissionDeps = {
    foreground: () => Promise.resolve(current),
    requestForeground: () => {
      calls.push('requestForeground');
      current = grants.shift() ?? current;
      return Promise.resolve(current);
    },
    background: () => Promise.resolve(script.background ?? false),
    requestBackground: () => {
      calls.push('requestBackground');
      return Promise.resolve(script.backgroundAfterSettings ?? true);
    },
    notificationsNeedAsking: () => Promise.resolve(script.android13 ?? true),
    requestNotifications: () => {
      calls.push('requestNotifications');
      return Promise.resolve();
    },
    openAppSettings: () => calls.push('openAppSettings'),
    ask: (screen) => {
      shown.push(screen);
      return Promise.resolve(answers.shift() ?? 'primary');
    },
    flags: () => flags,
    mark: (flag) => {
      flags[flag] = true;
    },
  };
  return { deps, shown, calls, flags };
}

describe('the start flow', () => {
  it('lands on W3b after every explainer is accepted', async () => {
    const { deps, shown, calls } = setup({});
    expect(await runStartFlow(deps)).toEqual({ kind: 'ready', background: true });
    expect(shown).toEqual(['background-explainer', 'settings-step', 'notifications-explainer']);
    expect(calls).toEqual(['requestBackground', 'requestNotifications']);
  });

  it('asks for foreground location first, then goes on', async () => {
    const { deps, calls } = setup({
      foreground: [
        { granted: false, canAskAgain: true },
        { granted: true, canAskAgain: true },
      ],
    });
    expect((await runStartFlow(deps)).kind).toBe('ready');
    expect(calls[0]).toBe('requestForeground');
  });

  it('shows W5 when location is refused, and ends if the tourist says not now', async () => {
    const { deps, shown } = setup({
      foreground: [
        { granted: false, canAskAgain: true },
        { granted: false, canAskAgain: true },
      ],
      answers: ['secondary'],
    });
    expect(await runStartFlow(deps)).toEqual({ kind: 'abandoned' });
    expect(shown).toEqual(['location-denied']);
  });

  it('asks again on W5 *Try again*', async () => {
    const { deps, shown, calls } = setup({
      foreground: [
        { granted: false, canAskAgain: true },
        { granted: false, canAskAgain: true },
        { granted: true, canAskAgain: true },
      ],
      answers: ['primary'],
    });
    expect((await runStartFlow(deps)).kind).toBe('ready');
    expect(shown[0]).toBe('location-denied');
    expect(calls.filter((call) => call === 'requestForeground')).toHaveLength(2);
  });

  it('shows W5b when Android will not ask again, and opens settings', async () => {
    const { deps, shown, calls } = setup({
      foreground: [{ granted: false, canAskAgain: false }],
    });
    expect(await runStartFlow(deps)).toEqual({ kind: 'abandoned' });
    expect(shown).toEqual(['location-denied-forever']);
    expect(calls).toEqual(['openAppSettings']);
  });

  it('becomes a foreground-only walk when the tourist keeps the app-open option (W6)', async () => {
    const { deps, calls } = setup({ answers: ['secondary'] });
    expect(await runStartFlow(deps)).toEqual({ kind: 'ready', background: false });
    expect(calls).not.toContain('requestBackground');
  });

  it('becomes foreground-only when Android settings leave background off', async () => {
    const { deps } = setup({ backgroundAfterSettings: false });
    expect(await runStartFlow(deps)).toEqual({ kind: 'ready', background: false });
  });

  it('shows each explainer once per install', async () => {
    const first = setup({});
    await runStartFlow(first.deps);
    const second = setup({
      flags: { backgroundExplained: true, notificationsExplained: true },
      backgroundAfterSettings: false,
    });
    expect(await runStartFlow(second.deps)).toEqual({ kind: 'ready', background: false });
    expect(second.shown).toEqual([]);
  });

  it('skips the background screens when background is already granted', async () => {
    const { deps, shown } = setup({ background: true });
    expect(await runStartFlow(deps)).toEqual({ kind: 'ready', background: true });
    expect(shown).toEqual(['notifications-explainer']);
  });

  it('still runs the walk when notifications are declined', async () => {
    const { deps, calls } = setup({ answers: ['primary', 'primary', 'secondary'] });
    expect(await runStartFlow(deps)).toEqual({ kind: 'ready', background: true });
    expect(calls).not.toContain('requestNotifications');
  });

  it('does not ask about notifications before Android 13', async () => {
    const { deps, shown } = setup({ android13: false });
    await runStartFlow(deps);
    expect(shown).not.toContain('notifications-explainer');
  });
});
