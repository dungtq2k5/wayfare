# Known Gaps — Read Before You Trip Over Them

**Current state.** Real, current, and they bite silently. Each row names the file that proves it. And when a gap is closed, just add ***Closed.*** to indicate it's closed.

| # | Gap | Where | Consequence |
| :---- | :---- | :---- | :---- |
| 1 | The selected marker's name chip can render under the Place sheet, behind the mini player, or over the area-switcher pill | `apps/mobile`, the map's selected `Marker` (MapLibre React Native's native annotation ordering) | At the sheet's half height, or near the top of the map, the selected Place's name is partly hidden; the sheet itself still names it |
| 2 | The device voice (audio tier 3, offline) shows no media card on the lock screen or in the notification shade | `apps/mobile/src/player/` — `expo-speech` has no player for `expo-audio`'s lock-screen support to attach to | Offline, a narration in the phone's own voice can only be paused or stopped from inside the app |
| 3 | Dismissing a paused narration's notification does not stop it | `expo-audio` 57 does not report the dismissal | The narration stays paused in the app, with its mini player, until the tourist stops or resumes it there |
