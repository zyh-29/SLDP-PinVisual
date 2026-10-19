/**
 * Export and import on phones: Export opens the share sheet with the file's text (save it to Files or Notes,
 * AirDrop it, send it to yourself). Import is done by pasting that text, so no file-picker library is needed.
 * The browser version (patternFile.web.ts) downloads and opens real files.
 */
import { Share } from 'react-native';

/** Import can open a file; false here: the user pastes the exported text. */
export const canPickFile = false;

/** Opens the share sheet. Resolves true when the user shared it (false when dismissed). */
export async function savePatternFile(json: string, fileName: string): Promise<boolean> {
  const res = await Share.share({ message: json, title: fileName });
  return res.action === Share.sharedAction;
}

/** Not available on phones (see canPickFile). */
export async function pickPatternFile(): Promise<string | null> {
  return null;
}
