/**
 * On-device AI help for sentences the command list doesn't know (see aiFallback.web.ts). Phones: not yet. Apple's
 * on-device model (iOS 26) needs a native module and an iPhone to test it on; until then commands work as listed.
 */
export type AiStatus = 'available' | 'downloadable' | 'unavailable';

export async function aiStatus(): Promise<AiStatus> {
  return 'unavailable';
}

export async function aiSuggest(_said: string): Promise<string | null> {
  return null;
}
