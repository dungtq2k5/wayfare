import { describe, expect, it, vi } from 'vitest';
import { NARRATION_VOICES, voiceFor } from '../../config/voices';
import { withVoice } from './edge.speech-provider';
import { FakeSpeechProvider, silentMp3 } from './fake.speech-provider';
import { GoogleSpeechProvider } from './google.speech-provider';
import type { GoogleSpeechClient } from './google.speech-provider';

describe('the voice registry', () => {
  it('pins a voice per launch language and provider, and no long-tail one', () => {
    for (const provider of ['fake', 'google', 'edge'] as const) {
      for (const lang of ['vi', 'en', 'zh-Hans', 'ja', 'ko']) {
        expect(voiceFor(provider, lang), `${provider} ${lang}`).not.toBeNull();
      }
      expect(voiceFor(provider, 'fr')).toBeNull();
    }
    expect(NARRATION_VOICES.google['zh-Hans']?.languageCode).toBe('cmn-CN');
    expect(voiceFor('fake', 'constructor')).toBeNull();
  });
});

describe('FakeSpeechProvider', () => {
  it('returns silent MP3 frames sized by the text, and fails when told to', async () => {
    const fake = new FakeSpeechProvider();
    const audio = await fake.synthesize({
      ssml: '<speak>abc</speak>',
      voice: { id: 'fake-en', languageCode: 'en' },
    });
    expect(audio.subarray(0, 4)).toEqual(Buffer.from([0xff, 0xf3, 0x44, 0xc0]));
    expect(audio.length % 96).toBe(0);
    expect(silentMp3(48).length).toBe(2 * 96);
    await expect(
      new FakeSpeechProvider(true).synthesize({
        ssml: 'x',
        voice: { id: 'v', languageCode: 'en' },
      }),
    ).rejects.toThrow();
  });
});

describe('GoogleSpeechProvider', () => {
  it('sends SSML, MP3 at 24 kHz, and the voice with its language code', async () => {
    const synthesizeSpeech = vi.fn<GoogleSpeechClient['synthesizeSpeech']>(() =>
      Promise.resolve([{ audioContent: new Uint8Array([1, 2, 3]) }] as const),
    );
    const google = new GoogleSpeechProvider('p', {
      synthesizeSpeech,
      listVoices: () =>
        Promise.resolve([
          {
            voices: [{ name: 'cmn-CN-Wavenet-A', languageCodes: ['cmn-CN'], ssmlGender: 'FEMALE' }],
          },
        ] as const),
    });
    const audio = await google.synthesize({
      ssml: '<speak>市场</speak>',
      voice: { id: 'cmn-CN-Wavenet-A', languageCode: 'cmn-CN' },
    });
    expect([...audio]).toEqual([1, 2, 3]);
    expect(synthesizeSpeech).toHaveBeenCalledWith({
      input: { ssml: '<speak>市场</speak>' },
      voice: { languageCode: 'cmn-CN', name: 'cmn-CN-Wavenet-A' },
      audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 24_000 },
    });
    await expect(google.listVoices('cmn-CN')).resolves.toEqual([
      { id: 'cmn-CN-Wavenet-A', languageCode: 'cmn-CN', gender: 'FEMALE' },
    ]);
    expect([google.format, google.maxInputBytes]).toEqual(['mp3_24khz_32kbps_mono', 5_000]);
  });
});

describe('the Edge route', () => {
  it('puts the voice inside the document, and flattens what the endpoint refuses', () => {
    const voice = { id: 'vi-VN-HoaiMyNeural', languageCode: 'vi-VN' };
    expect(withVoice('<speak>Chợ Bến Thành<break time="600ms"/>Mô tả.</speak>', voice)).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="vi-VN"><voice name="vi-VN-HoaiMyNeural">Chợ Bến Thành. Mô tả.</voice></speak>',
    );
    expect(
      withVoice(
        '<speak>Tên!<break time="600ms"/><sub alias="Ben Tahn">Bến Thành</sub> và <phoneme alphabet="ipa" ph="fɜː">Phở</phoneme> &#38; co</speak>',
        voice,
      ),
    ).toContain('>Tên! Ben Tahn và Phở &#38; co</voice>');
  });
});
