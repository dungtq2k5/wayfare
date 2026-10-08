# Known Gaps — Read Before You Trip Over Them

**Current state.** Real, current, and they bite silently. Each row names the file that proves it. And when a gap is closed, just add ***Closed.*** to indicate it's closed.

| # | Gap | Where | Consequence |
| :---- | :---- | :---- | :---- |
| 1 | The selected marker's name chip can render under the Place sheet or over the area-switcher pill | `apps/mobile`, the map's selected `Marker` (MapLibre React Native's native annotation ordering) | At the sheet's half height, or near the top of the map, the selected Place's name is partly hidden; the sheet itself still names it |
