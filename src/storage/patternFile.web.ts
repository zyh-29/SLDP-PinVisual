/**
 * Export and import files in the browser: Export downloads a .json file, Import opens the file picker.
 * Nothing leaves the computer.
 */

/** Import can open a file (on phones the user pastes the text instead). */
export const canPickFile = true;

/** Downloads the text as a file. Resolves true once handed to the browser. */
export async function savePatternFile(json: string, fileName: string): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before the link is released.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

/** Opens the file picker; resolves the chosen file's text, or null if the user cancelled. */
export function pickPatternFile(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    const done = () => input.remove();
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      done();
      if (!file) return resolve(null);
      file.text().then(resolve, () => reject(new Error('Could not read that file.')));
    });
    input.addEventListener('cancel', () => {
      done();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}
