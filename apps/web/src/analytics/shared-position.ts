'use client';

/**
 * The position the tourist already shared with the map's *Near me*, and when — the only one the
 * web counts with. It never asks for location for counting.
 */
let shared: { lat: number; lng: number; at: number } | null = null;

export function sharePosition(point: { lat: number; lng: number }): void {
  shared = { ...point, at: Date.now() };
}

export const sharedPosition = (): { lat: number; lng: number; at: number } | null => shared;
