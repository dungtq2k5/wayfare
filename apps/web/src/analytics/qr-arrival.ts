'use client';

/** A page a sticker opened (`?via=qr`) whose first story hasn't played yet. */
let pending = false;

/** The page arrived from the gateway's `/q/`: its first story entered by the QR. */
export function markQrArrival(): void {
  pending = true;
}

/** Whether this story is that first one; asking clears it. */
export function takeQrArrival(): boolean {
  const was = pending;
  pending = false;
  return was;
}
