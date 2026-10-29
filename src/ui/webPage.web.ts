/**
 * Page-wide styles for the website, added once when the app loads.
 *
 * Text can't be selected or copied with the mouse (or by a long press on phones): this is an app, not a document,
 * and dragging across the pins, the timeline or a button otherwise highlights text. Text boxes still can be, so
 * typing, selecting and pasting a name works as usual.
 */
const CSS = `
*, *::before, *::after { user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
input, textarea, [contenteditable="true"], [contenteditable="true"] * { user-select: text; -webkit-user-select: text; -webkit-touch-callout: default; }
`;

if (typeof document !== 'undefined' && !document.getElementById('pinvisual-page')) {
  const style = document.createElement('style');
  style.id = 'pinvisual-page';
  style.textContent = CSS;
  document.head.appendChild(style);
}

export {};
