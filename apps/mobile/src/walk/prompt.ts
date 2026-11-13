import { create } from 'zustand';
import type { Answer, PermissionScreen } from './permissions';

interface PromptState {
  /** The start-flow screen on show (W2–W5b), with the way to answer it. */
  prompt: { screen: PermissionScreen; answer: (answer: Answer) => void } | null;
}

export const usePrompt = create<PromptState>(() => ({ prompt: null }));

/** Shows a start-flow screen and resolves with the button the tourist pressed. */
export function askWalkPrompt(screen: PermissionScreen): Promise<Answer> {
  return new Promise((resolve) => {
    usePrompt.setState({
      prompt: {
        screen,
        answer: (answer) => {
          usePrompt.setState({ prompt: null });
          resolve(answer);
        },
      },
    });
  });
}
