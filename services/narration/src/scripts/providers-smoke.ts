// pnpm --filter @wayfare/narration providers:smoke — calls the real providers once each, by hand
// and never in CI (architecture §8): the free routes are undocumented endpoints, and the Google
// ones need an account. Prints what answered, the audio's bitrate and duration, and exits 1 when
// any configured check fails. Google runs only when GOOGLE_CLOUD_PROJECT is set.
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { voiceFor } from '../config/voices';
import { parseMp3, mp3DurationMs } from '../modules/tasks/domain/mp3';
import { EdgeSpeechProvider } from '../providers/speech/edge.speech-provider';
import { GoogleSpeechProvider } from '../providers/speech/google.speech-provider';
import type { SpeechProvider } from '../providers/speech/speech-provider';
import { FreeTranslationProvider } from '../providers/translation/free.translation-provider';
import { GoogleTranslationProvider } from '../providers/translation/google.translation-provider';
import type { TranslationProvider } from '../providers/translation/translation-provider';

const SAMPLE = 'Chợ Bến Thành là một khu chợ lớn ở trung tâm Thành phố Hồ Chí Minh.';

async function translation(provider: TranslationProvider): Promise<boolean> {
  try {
    const text = await provider.translate({ text: SAMPLE, from: 'vi', to: 'en' });
    console.log(`✓ ${provider.name} translation: ${text}`);
    return text.trim() !== '';
  } catch (error) {
    console.log(
      `✗ ${provider.name} translation: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

async function speech(provider: SpeechProvider): Promise<boolean> {
  let ok = true;
  for (const lang of ['vi', 'en', 'zh-Hans', 'ja', 'ko']) {
    const voice = voiceFor(provider.name, lang);
    if (voice === null) continue;
    try {
      const listed = await provider.listVoices(voice.languageCode);
      const pinned = listed.some((candidate) => candidate.id === voice.id);
      console.log(
        `${pinned ? '✓' : '✗'} ${provider.name} ${lang}: ${voice.id} ${pinned ? 'listed' : 'NOT listed'}`,
      );
      ok &&= pinned;
    } catch (error) {
      console.log(
        `✗ ${provider.name} voices ${lang}: ${error instanceof Error ? error.message : String(error)}`,
      );
      ok = false;
    }
  }
  try {
    const voice = voiceFor(provider.name, 'en')!;
    const audio = await provider.synthesize({
      ssml: '<speak>Ben Thanh Market.<break time="600ms"/>A large market in the city centre.</speak>',
      voice,
    });
    const parsed = parseMp3(audio);
    if (!parsed.ok) throw new Error(`not an MP3: ${parsed.reason}`);
    const first = parsed.frames.find((frame) => !frame.isInfoFrame)!;
    const file = join(tmpdir(), `providers-smoke-${provider.name}.mp3`);
    writeFileSync(file, audio);
    console.log(
      `✓ ${provider.name} speech: ${audio.length} bytes, ${mp3DurationMs(parsed.frames)} ms, ` +
        `${first.bitrateKbps} kbps at ${first.sampleRate} Hz (declared ${provider.format}) → ${file}`,
    );
  } catch (error) {
    console.log(
      `✗ ${provider.name} speech: ${error instanceof Error ? error.message : String(error)}`,
    );
    ok = false;
  }
  return ok;
}

async function main(): Promise<number> {
  const project = process.env.GOOGLE_CLOUD_PROJECT || undefined;
  const results = [
    await translation(new FreeTranslationProvider()),
    await speech(new EdgeSpeechProvider()),
  ];
  if (project !== undefined) {
    results.push(await translation(new GoogleTranslationProvider(project)));
    results.push(await speech(new GoogleSpeechProvider(project)));
  } else {
    console.log('- google: skipped (GOOGLE_CLOUD_PROJECT is not set)');
  }
  return results.every(Boolean) ? 0 : 1;
}

if (require.main === module) {
  void main().then((code) => process.exit(code));
}
