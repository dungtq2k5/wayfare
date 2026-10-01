import { Camera, Map } from '@maplibre/maplibre-react-native';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MANIFEST_FILE, MAP_DIR } from './config';

/** The pilot D1 area's center and zoom (`services/catalog/prisma/seed/pilot-d1/area.json`). */
const CENTER: [number, number] = [106.7005, 10.7765];
const DEFAULT_ZOOM = 16;

/**
 * The local pack first — a style whose source URLs are rewritten from the pack's public
 * prefix to the local directory (architecture §6), fed straight to MapLibre Native. If the
 * archive does not render, that is the spike's finding, not a bug to fix here.
 */
export function OfflineMap(): React.JSX.Element {
  const [style, setStyle] = useState<StyleSpecification | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (!MANIFEST_FILE.exists) throw new Error('no manifest — download first');
      const manifest = JSON.parse(MANIFEST_FILE.textSync()) as {
        mapPack: { pmtiles: { url: string } } | null;
      };
      if (manifest.mapPack === null) throw new Error('manifest has no map pack');
      const styleFile = new File(MAP_DIR, 'style.json');
      if (!styleFile.exists) throw new Error('style.json not downloaded');
      const remotePrefix = manifest.mapPack.pmtiles.url.replace(/[^/]+$/, '');
      const mapsAt = remotePrefix.indexOf('maps/');
      if (mapsAt < 0) throw new Error(`unexpected pack URL: ${remotePrefix}`);
      const bucketBase = remotePrefix.slice(0, mapsAt);
      const localBase = MAP_DIR.uri.endsWith('/') ? MAP_DIR.uri : `${MAP_DIR.uri}/`;
      // The archive is saved flat as map.pmtiles; glyphs and sprites keep their bucket path under
      // the map directory, so a second swap of the bucket base makes them local too. The archive
      // goes first: afterwards its URL no longer contains the bucket base.
      const swapped = styleFile
        .textSync()
        .replaceAll(`pmtiles://${remotePrefix}`, `pmtiles://${localBase}`)
        .replaceAll(bucketBase, localBase);
      setStyle(JSON.parse(swapped) as StyleSpecification);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  if (errorMessage !== null) {
    return (
      <View style={styles.center}>
        <Text>{errorMessage}</Text>
      </View>
    );
  }
  if (style === null) {
    return (
      <View style={styles.center}>
        <Text>loading the local pack…</Text>
      </View>
    );
  }
  return (
    <Map style={styles.map} mapStyle={style}>
      <Camera initialViewState={{ center: CENTER, zoom: DEFAULT_ZOOM }} />
    </Map>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
