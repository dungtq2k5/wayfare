import { requireNativeModule } from 'expo';

interface NoisyAudioEvents extends Record<string, (...args: never[]) => void> {
  onBecomingNoisy: () => void;
}

const NoisyAudio = requireNativeModule<{
  addListener: <Name extends keyof NoisyAudioEvents>(
    name: Name,
    listener: NoisyAudioEvents[Name],
  ) => { remove: () => void };
}>('NoisyAudio');

/** Calls `onNoisy` when Android says the audio output is about to become loud (headphones out). */
export function onBecomingNoisy(onNoisy: () => void): () => void {
  const subscription = NoisyAudio.addListener('onBecomingNoisy', onNoisy);
  return () => {
    subscription.remove();
  };
}
