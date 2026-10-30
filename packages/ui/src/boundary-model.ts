/** A boundary's point, GeoJSON's way round: `[lng, lat]`. */
export type Vertex = readonly [number, number];

/** The editor's state: the open ring (no closing repeat) and the selected point, if any. */
export interface BoundaryState {
  readonly points: readonly Vertex[];
  readonly selected: number | null;
}

/** How far one arrow press moves a point, in degrees (the component works it out from the zoom). */
export interface Step {
  readonly lng: number;
  readonly lat: number;
}

/** What a key did: the new state, and whether the key was the editor's (so the page ignores it). */
export interface KeyResult {
  readonly state: BoundaryState;
  readonly handled: boolean;
}

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

/** How many arrow steps a new point sits from the one before, while there are too few for a shape. */
const NEW_POINT_STEPS = 10;

/**
 * Where Enter puts a new point after `index`: the middle of the edge to the next point once there
 * is a shape; before that, a few steps east of the first point and north of the second, so three
 * presses make a triangle to adjust with the arrows.
 */
function pointAfter(points: readonly Vertex[], index: number, step: Step, centre: Vertex): Vertex {
  const from = points[index];
  if (from === undefined) return centre;
  if (points.length >= 3) {
    const to = points[(index + 1) % points.length]!;
    return [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  }
  return points.length === 1
    ? [from[0] + step.lng * NEW_POINT_STEPS, from[1]]
    : [from[0], from[1] + step.lat * NEW_POINT_STEPS];
}

/**
 * The keyboard model (the handoff's A3): with the map focused, Tab and Shift+Tab move between
 * points — past either end the key is not the editor's, so focus leaves the map; the arrows move
 * the selected point by a step (ten with Shift); Delete or Backspace removes it; Enter adds one
 * after it (at the map's centre when there are none); Escape lets the selection go.
 */
export function boundaryKey(
  state: BoundaryState,
  key: string,
  { shift = false, step, centre }: { shift?: boolean; step: Step; centre: Vertex },
): KeyResult {
  const { points, selected } = state;
  const unhandled = { state, handled: false };
  switch (key) {
    case 'Tab': {
      if (points.length === 0) return unhandled;
      const next =
        selected === null ? (shift ? points.length - 1 : 0) : selected + (shift ? -1 : 1);
      if (next < 0 || next >= points.length) return unhandled;
      return { state: { points, selected: next }, handled: true };
    }
    case 'Enter': {
      const at = selected ?? points.length - 1;
      const point = pointAfter(points, at, step, centre);
      const index = points.length === 0 ? 0 : at + 1;
      return {
        state: {
          points: [...points.slice(0, index), point, ...points.slice(index)],
          selected: index,
        },
        handled: true,
      };
    }
    case 'Delete':
    case 'Backspace': {
      if (selected === null) return unhandled;
      const rest = points.filter((_, index) => index !== selected);
      return {
        state: {
          points: rest,
          selected: rest.length === 0 ? null : Math.min(selected, rest.length - 1),
        },
        handled: true,
      };
    }
    case 'Escape':
      return selected === null ? unhandled : { state: { points, selected: null }, handled: true };
    default: {
      const arrow = ARROWS[key];
      if (arrow === undefined || selected === null) return unhandled;
      const times = shift ? 10 : 1;
      return {
        state: {
          points: points.map((point, index) =>
            index === selected
              ? ([
                  point[0] + arrow[0] * step.lng * times,
                  point[1] + arrow[1] * step.lat * times,
                ] as const)
              : point,
          ),
          selected,
        },
        handled: true,
      };
    }
  }
}

/** The ring as GeoJSON stores it: closed by repeating the first point. */
export const closedRing = (points: readonly Vertex[]): Vertex[] =>
  points.length === 0 ? [] : [...points, points[0]!];

/** The ring as the editor holds it: open, the closing repeat dropped. */
export const openRing = (ring: readonly Vertex[]): Vertex[] => {
  const first = ring[0];
  const last = ring.at(-1);
  return ring.length > 1 &&
    first !== undefined &&
    last !== undefined &&
    first[0] === last[0] &&
    first[1] === last[1]
    ? ring.slice(0, -1)
    : [...ring];
};

/** The middle of the points' bounding box, where the camera's centre starts (A3). */
export function boundaryMiddle(points: readonly Vertex[]): Vertex | null {
  if (points.length === 0) return null;
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  return [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
}

const orientation = (a: Vertex, b: Vertex, c: Vertex): number => {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  return value === 0 ? 0 : value > 0 ? 1 : 2;
};
const onSegment = (a: Vertex, b: Vertex, c: Vertex): boolean =>
  b[0] <= Math.max(a[0], c[0]) &&
  b[0] >= Math.min(a[0], c[0]) &&
  b[1] <= Math.max(a[1], c[1]) &&
  b[1] >= Math.min(a[1], c[1]);

/** Whether segments `p1q1` and `p2q2` touch or cross (the orientation test). */
function segmentsMeet(p1: Vertex, q1: Vertex, p2: Vertex, q2: Vertex): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && onSegment(p1, p2, q1)) ||
    (o2 === 0 && onSegment(p1, q2, q1)) ||
    (o3 === 0 && onSegment(p2, p1, q2)) ||
    (o4 === 0 && onSegment(p2, q1, q2))
  );
}

/**
 * Whether an open ring's edges cross each other (catalog's `ST_IsValid` refuses it on save; this
 * says so before). Every pair of edges that don't share a point: 500 points is ~125 000 pairs.
 */
export function edgesCross(points: readonly Vertex[]): boolean {
  const count = points.length;
  if (count < 4) return false;
  const edge = (index: number) => [points[index]!, points[(index + 1) % count]!] as const;
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      // Neighbouring edges share a point by construction.
      if (j === i + 1 || (i === 0 && j === count - 1)) continue;
      const [a, b] = edge(i);
      const [c, d] = edge(j);
      if (segmentsMeet(a, b, c, d)) return true;
    }
  }
  return false;
}
