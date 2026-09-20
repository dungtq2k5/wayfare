#!/usr/bin/env bash
# pnpm tiles:build --area <code> [--bbox <w,s,e,n> --area-id <uuid>] [--no-upload]
#
# Cuts an area's map pack from the pinned Protomaps daily build (architecture §6, ADR 0023): the
# archive with `pmtiles extract` (only the byte ranges it needs are fetched — seconds, little
# memory), the glyph ranges Vietnamese needs and the sprites from the pinned assets commit, then
# `upload.mjs` writes the style, checks the budget, uploads everything under
# `maps/<areaCode>/<buildId>/` and prints the registration body.
#
# A seeded area is read from the seed corpus (services/catalog/prisma/seed/pilot-*/area.json); an
# area an admin created takes --bbox and --area-id. No service needs to run.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
# shellcheck source=./versions.env
source "$here/versions.env"

area='' bbox='' area_id='' upload=1
while [[ $# -gt 0 ]]; do
  case $1 in
    --area) area=$2; shift 2 ;;
    --bbox) bbox=$2; shift 2 ;;
    --area-id) area_id=$2; shift 2 ;;
    --no-upload) upload=0; shift ;;
    *) echo "✗ unknown argument $1" >&2; exit 2 ;;
  esac
done
[[ -n $area ]] || { echo '✗ --area <code> is required' >&2; exit 2; }

cache=$here/.cache
out=$cache/build/$area
rm -rf "$out"
mkdir -p "$out"

# The area's box, from the seed corpus unless given, widened by 500 m on every side.
if [[ -z $bbox ]]; then
  read -r bbox area_id < <(node -e '
    const { readdirSync, readFileSync } = require("node:fs");
    const { join } = require("node:path");
    const [seedDir, code] = process.argv.slice(1);
    for (const dir of readdirSync(seedDir).filter((name) => name.startsWith("pilot-"))) {
      let area;
      try { area = JSON.parse(readFileSync(join(seedDir, dir, "area.json"), "utf8")); } catch { continue; }
      if (area.code !== code) continue;
      const ring = area.boundary.coordinates[0];
      const lngs = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
      console.log(`${Math.min(...lngs)},${Math.min(...lats)},${Math.max(...lngs)},${Math.max(...lats)} ${area.id}`);
      process.exit(0);
    }
    console.error(`✗ no seeded area ${code}: pass --bbox and --area-id for an area an admin created`);
    process.exit(1);' "$root/services/catalog/prisma/seed" "$area")
fi
[[ -n $area_id ]] || { echo '✗ --area-id is required with --bbox' >&2; exit 2; }
margin_bbox=$(node -e '
  const [w, s, e, n] = process.argv[1].split(",").map(Number);
  const dLat = 500 / 111_320;
  const dLng = 500 / (111_320 * Math.cos((((s + n) / 2) * Math.PI) / 180));
  console.log([w - dLng, s - dLat, e + dLng, n + dLat].map((v) => v.toFixed(6)).join(","));' "$bbox")
echo "✓ $area: box $bbox, with a 500 m margin $margin_bbox"

# The pinned CLI and style generator, downloaded once.
cli=$cache/pmtiles-$PMTILES_VERSION/pmtiles
if [[ ! -x $cli ]]; then
  mkdir -p "$(dirname "$cli")"
  curl -sSfL "https://github.com/protomaps/go-pmtiles/releases/download/v$PMTILES_VERSION/go-pmtiles_${PMTILES_VERSION}_Linux_x86_64.tar.gz" |
    tar xz -C "$(dirname "$cli")" pmtiles
fi
basemaps=$cache/basemaps-$BASEMAPS_VERSION/package
if [[ ! -d $basemaps ]]; then
  mkdir -p "$(dirname "$basemaps")"
  curl -sSfL "https://registry.npmjs.org/@protomaps/basemaps/-/basemaps-$BASEMAPS_VERSION.tgz" |
    tar xz -C "$(dirname "$basemaps")"
fi

# The archive: only the area's tiles, from zoom MIN_ZOOM to the build's maximum.
"$cli" extract "$PROTOMAPS_BUILD_URL" "$out/map.pmtiles" --bbox="$margin_bbox" \
  --minzoom="$MIN_ZOOM" --maxzoom="$MAX_ZOOM" --quiet
echo "✓ map.pmtiles: $(stat -c %s "$out/map.pmtiles") bytes, zoom $MIN_ZOOM–$MAX_ZOOM"

# The glyph ranges of every font stack the style uses (architecture §6), and the sprites.
assets=https://raw.githubusercontent.com/protomaps/basemaps-assets/$BASEMAPS_ASSETS_COMMIT
mapfile -t stacks < <(node -e '
  const basemaps = require(process.argv[1] + "/dist/cjs/index.cjs");
  const stacks = new Set();
  const collect = (value) => {
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) stacks.add(value.join(","));
    else if (Array.isArray(value)) value.forEach(collect);
  };
  for (const layer of basemaps.layers("protomaps", basemaps.namedFlavor(process.argv[2]), { lang: process.argv[3] }))
    collect(layer.layout?.["text-font"]);
  for (const stack of stacks) if (stack.startsWith("Noto")) console.log(stack);' \
  "$basemaps" "$BASEMAPS_FLAVOR" "$BASEMAPS_LANG")
mapfile -t ranges < <(cd "$root/services/catalog" && node -e '
  for (const range of require("@wayfare/contracts").MAP_PACK_GLYPH_RANGES) console.log(range);')
for stack in "${stacks[@]}"; do
  mkdir -p "$out/fonts/$stack"
  for range in "${ranges[@]}"; do
    curl -sSfL -o "$out/fonts/$stack/$range.pbf" "$assets/fonts/${stack// /%20}/$range.pbf"
  done
done
# U+1E00–1EFF (7680-7935) is what Vietnamese names need; a pack without it is refused here.
for stack in "${stacks[@]}"; do
  [[ -s "$out/fonts/$stack/7680-7935.pbf" ]] || { echo "✗ $stack lacks U+1E00–1EFF" >&2; exit 1; }
done
echo "✓ glyphs: ${#stacks[@]} font stacks × ${#ranges[@]} ranges (U+1E00–1EFF included)"
mkdir -p "$out/sprites/v4"
for file in "$BASEMAPS_FLAVOR.json" "$BASEMAPS_FLAVOR.png" "$BASEMAPS_FLAVOR@2x.json" "$BASEMAPS_FLAVOR@2x.png"; do
  curl -sSfL -o "$out/sprites/v4/$file" "$assets/sprites/v4/$file"
done
echo '✓ sprites'

[[ $upload == 1 ]] || { echo "✓ built in $out (not uploaded)"; exit 0; }
node "$here/upload.mjs" --out "$out" --area "$area" --area-id "$area_id" --basemaps "$basemaps"
