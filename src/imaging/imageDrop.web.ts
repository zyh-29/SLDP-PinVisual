/**
 * Bringing an image into the web app by dragging it onto the page (a file, or an image from another web page) or
 * pasting it. Used through imageInput.web.ts.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ImageSource } from './imageInput.web';

const imageFile = (files: FileList | null | undefined) => Array.from(files ?? []).find((f) => f.type.startsWith('image/'));

/**
 * What a drag can carry. From Finder or the desktop: a file. From a web page (Google Images, another tab):
 * no file at all, only a link (text/uri-list) and the <img> tag (text/html). Both must be accepted, or the
 * browser never even delivers the drop to the page.
 */
const carriesImage = (e: DragEvent) => {
  const types = Array.from(e.dataTransfer?.types ?? []);
  return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/html');
};

/** The image address in a drag from a web page: the <img src> from the HTML, else the first link. */
export function imageUrlFromDrop(html: string, uriList: string): string | null {
  const src = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  if (src) return src.replace(/&amp;/g, '&');
  const link = uriList
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
  return link ?? null;
}

/** Fetches a dropped image address into a local object URL. Fails when the site doesn't allow its images to be used elsewhere (CORS). */
async function loadDroppedUrl(url: string): Promise<string> {
  if (url.startsWith('data:image/') || url.startsWith('blob:')) return url;
  if (!/^https?:/i.test(url)) throw new Error("That isn't an image.");
  let response: Response;
  try {
    response = await fetch(url, { mode: 'cors' });
  } catch {
    throw new Error(
      "That website doesn't let other pages use its images. Right-click the image, choose Copy Image, then press Cmd+V (Ctrl+V) here.",
    );
  }
  if (!response.ok) throw new Error(`Couldn't download that image (error ${response.status}).`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error("That link isn't an image.");
  return URL.createObjectURL(blob);
}

/**
 * While the screen is focused: accepts an image dropped anywhere on the page (a file, or an image dragged
 * from another web page) or pasted with Cmd/Ctrl+V. Returns true while something is dragged over the page.
 */
export function useImageDrop(onImage: (source: ImageSource) => void, onError?: (message: string) => void): boolean {
  const [over, setOver] = useState(false);
  // Listeners are attached once per focus; they call the latest callbacks through these refs.
  const latest = useRef(onImage);
  const latestError = useRef(onError);
  useEffect(() => {
    latest.current = onImage;
    latestError.current = onError;
  });
  useFocusEffect(
    useCallback(() => {
      let depth = 0;
      const deliver = (file: File | undefined) => {
        if (file) latest.current({ uri: URL.createObjectURL(file) });
      };
      const fail = (message: string) => latestError.current?.(message);
      const enter = (e: DragEvent) => {
        if (!carriesImage(e)) return;
        e.preventDefault();
        depth++;
        setOver(true);
      };
      const overHandler = (e: DragEvent) => {
        if (!carriesImage(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      };
      const leave = (e: DragEvent) => {
        if (!carriesImage(e)) return;
        depth = Math.max(0, depth - 1);
        if (depth === 0) setOver(false);
      };
      const drop = (e: DragEvent) => {
        if (!carriesImage(e)) return;
        e.preventDefault();
        depth = 0;
        setOver(false);
        const dt = e.dataTransfer;
        const files = Array.from(dt?.files ?? []);
        const file = imageFile(dt?.files);
        if (file) return deliver(file);
        if (files.length) return fail("That file isn't an image.");
        // Dragged from a web page: only a link and the <img> tag arrive.
        const url = imageUrlFromDrop(dt?.getData('text/html') ?? '', dt?.getData('text/uri-list') ?? '');
        if (!url) return fail("That isn't an image.");
        loadDroppedUrl(url).then(
          (uri) => latest.current({ uri }),
          (err: unknown) => fail(err instanceof Error ? err.message : String(err)),
        );
      };
      const paste = (e: ClipboardEvent) => {
        const file = imageFile(e.clipboardData?.files);
        if (!file) return;
        e.preventDefault();
        deliver(file);
      };
      window.addEventListener('dragenter', enter);
      window.addEventListener('dragover', overHandler);
      window.addEventListener('dragleave', leave);
      window.addEventListener('drop', drop);
      window.addEventListener('paste', paste);
      return () => {
        window.removeEventListener('dragenter', enter);
        window.removeEventListener('dragover', overHandler);
        window.removeEventListener('dragleave', leave);
        window.removeEventListener('drop', drop);
        window.removeEventListener('paste', paste);
        setOver(false);
      };
    }, []),
  );
  return over;
}

