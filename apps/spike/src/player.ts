import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import type { AudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';
import { Vibration } from 'react-native';
import { AUDIO_DIR } from './config';
import { log } from './log';

/**
 * Enough to answer "can we start and finish audio from a background location callback" —
 * background playback, lock-screen metadata, a single vibration on start, a queue of one. a later doc
 * decides the product's queue rules.
 */
export class NarrationPlayer {
  private current: AudioPlayer | null = null;
  private playingPlaceId: string | null = null;

  async configure(): Promise<void> {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
    });
  }

  /** A decision that arrives while a narration plays waits for it to end; a second one replaces the first. */
  narrate(placeId: string, placeName: string): void {
    if (this.current !== null && this.playingPlaceId !== null) {
      log({ type: 'audio', event: 'interrupted', placeId: this.playingPlaceId });
      this.current.remove();
    }
    Vibration.vibrate(200);
    const source = { uri: new File(AUDIO_DIR, `${placeId}.mp3`).uri };
    const player = createAudioPlayer(source);
    player.setActiveForLockScreen(true, { title: placeName, artist: 'Wayfare' });
    player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish) {
        log({ type: 'audio', event: 'end', placeId });
        player.remove();
        if (this.current === player) {
          this.current = null;
          this.playingPlaceId = null;
        }
      }
    });
    this.current = player;
    this.playingPlaceId = placeId;
    player.play();
    log({ type: 'audio', event: 'start', placeId });
  }

  isPlaying(): boolean {
    return this.current !== null;
  }
}
