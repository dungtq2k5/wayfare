import { AnalyticsEventType, LEGAL_DOCUMENT_VERSIONS, LegalDocument } from '@wayfare/contracts';
import type * as Core from '@wayfare/core';
import type { AnalyticsClient } from '@wayfare/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryKv } from '../testing/account-fakes';
import { nativeFake } from '../testing/react-native';

type Deps = Parameters<typeof AnalyticsClient.open>[0];

vi.mock('expo-sqlite/kv-store', async () => ({
  default: (await import('../testing/account-fakes')).memoryKv,
}));
vi.mock('expo-location', () => ({}));
vi.mock('../env', () => ({ API_URL: 'http://localhost:13000/api/v1' }));
vi.mock('../data/boot', () => ({ databaseReady: Promise.resolve({}) }));
vi.mock('@wayfare/api-client', () => ({ analyticsTransport: {} }));
const fake = vi.hoisted(() => ({
  client: {
    foreground: vi.fn(() => Promise.resolve()),
    flush: vi.fn(() => Promise.resolve()),
    record: vi.fn((_input: object) => Promise.resolve()),
    policyHeard: vi.fn((_version: string) => Promise.resolve()),
  },
  open: vi.fn<(deps: Deps) => Promise<unknown>>(),
}));
vi.mock('@wayfare/core', async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  AnalyticsClient: { open: fake.open },
}));

const { analytics, track } = await import('./analytics');
const { narrationTracker } = await import('./narration-tracker');
const { useAppStore } = await import('../state/app-store');
const { useNetworkStore } = await import('../network/network-store');
const { useWalkStore } = await import('../walk/store');
const { useLocationStore } = await import('../location/location-store');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the install’s analytics (ADR 0042)', () => {
  let deps: Deps;

  // Opened once for the module's life, with its listeners and its five-minute timer.
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    fake.open.mockResolvedValue(fake.client);
    useAppStore.setState({ language: null, policyVersion: 'p1' });
    await analytics();
    deps = fake.open.mock.calls[0]![0];
  });
  afterAll(() => vi.useRealTimers());
  beforeEach(() => vi.clearAllMocks());

  it('opens once, counting the app in front and the policy it holds', async () => {
    await analytics();
    expect(fake.open).not.toHaveBeenCalled();
    expect(narrationTracker).toBeDefined();
  });

  it('keeps its state in its own row of the key-value store', async () => {
    expect(await deps.load()).toBeNull();
    await deps.save({ consent: 'GRANTED' } as never);
    expect(await memoryKv.getItem('wayfare.analytics')).toBe(
      JSON.stringify({ consent: 'GRANTED' }),
    );
    expect(await deps.load()).toEqual({ consent: 'GRANTED' });
  });

  it('counts in the chosen language, English before one, at the build’s policy', () => {
    useAppStore.setState({ language: null });
    expect(deps.language()).toBe('en');
    useAppStore.setState({ language: 'ja' });
    expect(deps.language()).toBe('ja');
    expect(deps.buildPolicyVersion).toBe(LEGAL_DOCUMENT_VERSIONS[LegalDocument.PRIVACY_POLICY]);
  });

  it('remembers a newer policy it hears, and tells the client of each change', () => {
    deps.onPolicyOutdated?.('2099-01-01');
    expect(useAppStore.getState()).toMatchObject({
      policyVersion: '2099-01-01',
      policyChanged: true,
    });
    expect(fake.client.policyHeard).toHaveBeenCalledWith('2099-01-01');
  });

  it('counts with the newest position it already has, walk or Map, never one without a time', () => {
    useWalkStore.setState({ fix: null });
    useLocationStore.setState({ position: null });
    expect(deps.position()).toBeNull();
    useLocationStore.setState({ position: { lat: 1, lng: 2, accuracyM: 5 } });
    expect(deps.position()).toBeNull();
    useLocationStore.setState({ position: { lat: 1, lng: 2, accuracyM: 5, at: 100 } });
    expect(deps.position()).toEqual({ lat: 1, lng: 2, at: 100 });
    useWalkStore.setState({ fix: { lat: 3, lng: 4, t: 200 } as never });
    expect(deps.position()).toEqual({ lat: 3, lng: 4, at: 200 });
    useLocationStore.setState({ position: { lat: 1, lng: 2, accuracyM: 5, at: 300 } });
    expect(deps.position()).toEqual({ lat: 1, lng: 2, at: 300 });
    useLocationStore.setState({ position: null });
    expect(deps.position()).toEqual({ lat: 3, lng: 4, at: 200 });
  });

  it('counts a language switch, never the first run’s choice', () => {
    useAppStore.setState({ language: null });
    useAppStore.setState({ language: 'vi' });
    expect(fake.client.record).not.toHaveBeenCalled();
    useAppStore.setState({ language: 'ko' });
    expect(fake.client.record).toHaveBeenCalledWith({
      type: AnalyticsEventType.LANGUAGE_SELECTED,
      lang: 'ko',
    });
  });

  it('sends every five minutes in front, stops in the background, and starts again in front', () => {
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(fake.client.flush).toHaveBeenCalledTimes(1);
    nativeFake.appState.emit('background');
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(fake.client.flush).toHaveBeenCalledTimes(1);
    nativeFake.appState.emit('inactive');
    nativeFake.appState.emit('active');
    expect(fake.client.foreground).toHaveBeenCalledTimes(1);
    nativeFake.appState.emit('active');
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(fake.client.flush).toHaveBeenCalledTimes(2);
  });

  it('sends when the network comes back, not on any other change', () => {
    useNetworkStore.setState({ status: 'offline' });
    useNetworkStore.setState({ status: 'offline' });
    expect(fake.client.flush).not.toHaveBeenCalled();
    useNetworkStore.setState({ status: 'online' });
    expect(fake.client.flush).toHaveBeenCalledTimes(1);
  });

  it('records an event, and never throws when it can’t', async () => {
    track({ type: AnalyticsEventType.APP_OPENED } as never);
    await flush();
    expect(fake.client.record).toHaveBeenCalledWith({ type: AnalyticsEventType.APP_OPENED });
    fake.client.record.mockRejectedValueOnce(new Error('full'));
    track({ type: AnalyticsEventType.APP_OPENED } as never);
    await flush();
  });

  it('carries on when counting the app in front fails', async () => {
    fake.client.foreground.mockRejectedValueOnce(new Error('locked'));
    nativeFake.appState.emit('active');
    await flush();
    expect(fake.client.foreground).toHaveBeenCalled();
  });
});
