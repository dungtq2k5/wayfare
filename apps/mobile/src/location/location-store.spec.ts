import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expoLocation, phone, resetPhone } from '../testing/walk-fakes';
import {
  acquireWatch,
  locateOnce,
  refreshPermission,
  requestForegroundLocation,
  useLocationStore,
} from './location-store';

vi.mock('expo-location', async () => (await import('../testing/walk-fakes')).expoLocation);

describe('the location permission (never asked at launch)', () => {
  beforeEach(() => {
    resetPhone();
    useLocationStore.setState({ permission: 'unknown', position: null });
  });

  it('reads it without asking: granted, askable again, or refused for good', async () => {
    expect(await refreshPermission()).toBe('granted');
    phone.foreground = { granted: false, canAskAgain: true };
    expect(await refreshPermission()).toBe('unknown');
    phone.foreground = { granted: false, canAskAgain: false };
    expect(await refreshPermission()).toBe('denied');
    expect(useLocationStore.getState().permission).toBe('denied');
    expect(expoLocation.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks for the foreground only; one “Don’t allow” leaves it askable', async () => {
    expect(await requestForegroundLocation()).toBe(true);
    expect(useLocationStore.getState().permission).toBe('granted');
    phone.foreground = { granted: false, canAskAgain: true };
    expect(await requestForegroundLocation()).toBe(false);
    expect(useLocationStore.getState().permission).toBe('unknown');
    phone.foreground = { granted: false, canAskAgain: false };
    await requestForegroundLocation();
    expect(useLocationStore.getState().permission).toBe('denied');
    expect(expoLocation.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('watching the position', () => {
  beforeEach(() => {
    resetPhone();
    useLocationStore.setState({ permission: 'unknown', position: null });
  });

  it('starts at the first screen, follows the fixes, and stops at the last release', async () => {
    const first = await acquireWatch();
    const second = await acquireWatch();
    expect(expoLocation.watchPositionAsync).toHaveBeenCalledTimes(1);
    phone.watchers[0]!({ coords: { latitude: 1, longitude: 2, accuracy: null }, timestamp: 9 });
    expect(useLocationStore.getState().position).toEqual({ lat: 1, lng: 2, accuracyM: 50, at: 9 });
    first();
    first();
    expect(phone.watchers).toHaveLength(1);
    second();
    expect(phone.watchers).toHaveLength(0);
    await acquireWatch();
    expect(expoLocation.watchPositionAsync).toHaveBeenCalledTimes(2);
  });

  it('watches nothing without the permission, or with the phone’s location off', async () => {
    phone.foreground = { granted: false, canAskAgain: true };
    (await acquireWatch())();
    phone.foreground = { granted: true, canAskAgain: true };
    phone.servicesEnabled = false;
    (await acquireWatch())();
    expect(expoLocation.watchPositionAsync).not.toHaveBeenCalled();
  });
});

describe('locate me', () => {
  beforeEach(() => {
    resetPhone();
    useLocationStore.setState({ permission: 'granted', position: null });
  });

  it('reads one fix and shows it', async () => {
    expect(await locateOnce()).toEqual({ lat: 10.77, lng: 106.7, accuracyM: 12 });
    expect(useLocationStore.getState().position).toEqual({ lat: 10.77, lng: 106.7, accuracyM: 12 });
  });

  it('asks the phone to turn location on, and reads a fix once it is', async () => {
    expoLocation.hasServicesEnabledAsync.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expoLocation.getCurrentPositionAsync.mockResolvedValueOnce({
      coords: { latitude: 1, longitude: 2, accuracy: null as unknown as number },
      timestamp: 1,
    });
    expect(await locateOnce()).toEqual({ lat: 1, lng: 2, accuracyM: 50 });
    expect(expoLocation.enableNetworkProviderAsync).toHaveBeenCalled();
  });

  it('says location is off when the tourist declines, or it stays off', async () => {
    phone.servicesEnabled = false;
    expoLocation.enableNetworkProviderAsync.mockRejectedValueOnce(new Error('declined'));
    expect(await locateOnce()).toBe('services-off');
    expect(await locateOnce()).toBe('services-off');
  });

  it('says there is no fix when the phone can’t find one', async () => {
    expoLocation.getCurrentPositionAsync.mockRejectedValueOnce(new Error('timeout'));
    expect(await locateOnce()).toBe('no-fix');
  });
});
