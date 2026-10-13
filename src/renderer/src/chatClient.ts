import type { ApiMessage } from '../../shared/types';
import { uid } from './util';

/** Stream a chat completion through the main process (no CORS, key never reaches the renderer). */
export function streamChat(
  messages: ApiMessage[],
  onDelta: (t: string) => void,
  signal: AbortSignal,
  purpose?: 'compact',
): Promise<void> {
  const requestId = uid();
  return new Promise<void>((resolve, reject) => {
    const off = window.api.chat.onEvent((ev) => {
      if (ev.requestId !== requestId) return;
      if (ev.type === 'delta') onDelta(ev.text);
      else if (ev.type === 'done') {
        off();
        resolve();
      } else {
        off();
        const err = new Error(ev.error);
        if (ev.aborted) err.name = 'AbortError';
        reject(err);
      }
    });
    signal.addEventListener('abort', () => window.api.chat.abort(requestId), { once: true });
    window.api.chat.start({ requestId, messages, purpose }).catch((e) => {
      off();
      reject(e);
    });
  });
}
