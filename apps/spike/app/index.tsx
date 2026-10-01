import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { AppState, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LOG_FILE } from '../src/config';
import { download } from '../src/download';
import { log } from '../src/log';
import { OfflineMap } from '../src/map';
import { startWalk, stopWalk, testNarration } from '../src/walk-task';

const LOG_TAIL_LINES = 20;
const LOG_POLL_MS = 2_000;

/** D2's one screen: Download, Start/Stop walk, the map, the live log tail, Share log. */
export default function Index(): React.JSX.Element {
  const [status, setStatus] = useState('idle');
  const [walking, setWalking] = useState(false);
  const [tail, setTail] = useState<string[]>([]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!LOG_FILE.exists) return;
      const lines = LOG_FILE.textSync().trim().split('\n');
      setTail(lines.slice(-LOG_TAIL_LINES));
    }, LOG_POLL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Hermes may lack the ES2023 array-by-copy methods the shared packages use (finding for check 2).
    const support = `toSorted:${typeof (Array.prototype as { toSorted?: unknown }).toSorted}`;
    console.log(support);
    log({ type: 'appState', state: support });
    setStatus(support);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      log({ type: 'appState', state });
    });
    return () => subscription.remove();
  }, []);

  const onDownload = async (): Promise<void> => {
    setStatus('downloading…');
    try {
      await download(setStatus);
    } catch (error) {
      setStatus(`download failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  /** A failed step names itself with its stack, instead of an uncaught promise rejection. */
  const fail = (step: string, error: unknown): void => {
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`${step} failed: ${detail}`);
    log({ type: 'appState', state: `error in ${step}: ${detail.slice(0, 500)}` });
    setStatus(`${step} failed: ${detail.slice(0, 600)}`);
  };

  /** Foreground, then background, then notification permission, in that order, so the report can name each screen. */
  const onStartWalk = async (): Promise<void> => {
    let step = 'foreground permission';
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (!foreground.granted) return setStatus('foreground location refused');
      step = 'background permission';
      const background = await Location.requestBackgroundPermissionsAsync();
      if (!background.granted) return setStatus('background location refused');
      step = 'notification permission';
      await Notifications.requestPermissionsAsync();
      step = 'startWalk';
      const diagnosis = await startWalk();
      setWalking(true);
      setStatus(`walking — ${diagnosis}`);
    } catch (error) {
      fail(step, error);
      // Leave nothing half-started: a retry begins from a clean state.
      await stopWalk().catch(() => undefined);
    }
  };

  const onStopWalk = async (): Promise<void> => {
    try {
      await stopWalk();
      setWalking(false);
      setStatus('stopped');
    } catch (error) {
      fail('stopWalk', error);
    }
  };

  /** One tap, screen on: the audio path by itself, with no location involved. */
  const onTestNarration = async (): Promise<void> => {
    try {
      setStatus(await testNarration());
    } catch (error) {
      fail('test narration', error);
    }
  };

  /** One foreground fix, to tell "the OS gives us no fix" from "our task is not receiving one". */
  const onFixNow = async (): Promise<void> => {
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setStatus(
        `fix ${fix.coords.latitude.toFixed(5)}, ${fix.coords.longitude.toFixed(5)} ±${fix.coords.accuracy?.toFixed(0) ?? '?'} m${fix.mocked === true ? ' (mocked)' : ''}`,
      );
    } catch (error) {
      fail('fix now', error);
    }
  };

  const onShareLog = async (): Promise<void> => {
    if (!LOG_FILE.exists) return;
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(LOG_FILE.uri);
  };

  return (
    <View style={styles.root}>
      <View style={styles.controls}>
        <Button title="Download" onPress={() => void onDownload()} />
        <Button
          title={walking ? 'Stop walk' : 'Start walk'}
          onPress={() => void (walking ? onStopWalk() : onStartWalk())}
        />
        <Button title="Test narration" onPress={() => void onTestNarration()} />
        <Button title="Fix now" onPress={() => void onFixNow()} />
        <Button title="Share log" onPress={() => void onShareLog()} />
        <Text>{status}</Text>
      </View>
      <View style={styles.map}>
        <OfflineMap />
      </View>
      <ScrollView style={styles.log}>
        {tail.map((line, index) => (
          <Text key={index} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 48 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 8, alignItems: 'center' },
  map: { height: 340 },
  log: { flex: 1, backgroundColor: '#111', padding: 8 },
  logLine: { color: '#0f0', fontFamily: 'monospace', fontSize: 10 },
});
