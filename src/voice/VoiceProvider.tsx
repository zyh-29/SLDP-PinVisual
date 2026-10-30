import { type Href, router, useFocusEffect, usePathname } from 'expo-router';
import { createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { GRID } from '@/config/hardware';
import type { Pattern } from '@/domain/pattern';
import { usePattern } from '@/state/PatternProvider';
import { useBoardActions } from '@/state/useBoardActions';
import { patternStore } from '@/state/useSavedPatterns';
import { isCompatible, toPattern } from '@/storage/patternStore';
import { aiStatus, aiSuggest } from './aiFallback';
import { announce, lastAnnouncement, screenReaderOn, stopSpeaking } from './announce';
import { HINT_WORDS, type ImageAction, type ImageSetting, matchName, parseCommand, type Tab } from './commands';
import { listeningCue } from './cue';
import { credit, type Picture, searchPictures } from './pictureSearch';
import { cancelListening, finishListening, listen, recognitionSupport, type RecognitionSupport } from './recognizer';
import { type Effect, type Pending, runCommand } from './runCommand';
import { useVoicePrefs, type VoicePrefs } from './voicePrefs';

export type VoicePhase = 'idle' | 'downloading' | 'listening' | 'thinking' | 'searching';

/** What the Image tab lets voice do while it's open (see useImageVoice). Each returns what to say, or an error. */
export interface ImageVoiceHandler {
  /** Draws "y = x^2 - 3"; null when drawn, else why not. */
  drawEquation(text: string): string | null;
  run(action: ImageAction): Promise<string>;
  setSetting(setting: ImageSetting, on: boolean): string;
  adjust(setting: 'tolerance' | 'sensitivity', up: boolean): string;
  /** Loads a picture by address; null when loaded, else why not. */
  loadPicture(uri: string): Promise<string | null>;
  /** The Image tab's pins (for "send" and "what's on the board" while it's open). */
  result(): Pattern | null;
  send(): void;
}

interface VoiceValue {
  phase: VoicePhase;
  heard: string | null;
  reply: string;
  pending: Pending;
  support: RecognitionSupport | null;
  prefs: VoicePrefs;
  setPrefs: (change: Partial<VoicePrefs>) => void;
  /** The picture search result on show, for its credit. */
  picture: Picture | null;
  toggleListening: () => void;
  runText: (text: string) => void;
  confirm: () => void;
  cancel: () => void;
  /** Opens voice control (if closed) and starts listening: Magic Tap. */
  openAndListen: () => void;
  registerImage: (h: RefObject<ImageVoiceHandler> | null) => void;
}

const VoiceContext = createContext<VoiceValue | null>(null);

const PATHS = { display: '/', image: '/image', saved: '/saved', pinTest: '/pin-test', device: '/device' } as const satisfies Record<Tab, Href>;
const TAB_NAMES: Record<Tab, string> = { display: 'Display', image: 'Image', saved: 'Saved', pinTest: 'Pin Test', device: 'Device' };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Voice commands for the whole app: one conversation shared by the Display tab's panel and the Image tab's bar.
 * Every command goes to the tab it belongs to: pins to Display, graphs, the camera and pictures to Image.
 */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const { pattern, setPattern, undo, redo, canUndo, redoCount } = usePattern();
  const board = useBoardActions();
  const [prefs, setPrefs] = useVoicePrefs();
  const pathname = usePathname();
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [heard, setHeard] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [support, setSupport] = useState<RecognitionSupport | null>(null);
  const [results, setResults] = useState<{ query: string; pictures: Picture[]; index: number } | null>(null);

  useEffect(() => {
    let live = true;
    recognitionSupport().then((s) => {
      if (live) setSupport(s);
    });
    return () => {
      live = false;
    };
  }, []);

  // Commands take seconds (listening, the AI, the internet): they act on the app as it is when they finish.
  const latest = useRef({ pattern, canUndo, redoCount, pending, pathname, board, results, prefs, setPattern, undo, redo });
  useEffect(() => {
    latest.current = { pattern, canUndo, redoCount, pending, pathname, board, results, prefs, setPattern, undo, redo };
  });

  // The Image tab's handler while it's open, and anyone waiting for it to open.
  const image = useRef<RefObject<ImageVoiceHandler> | null>(null);
  const waiting = useRef<((h: ImageVoiceHandler) => void)[]>([]);
  const registerImage = useCallback((h: RefObject<ImageVoiceHandler> | null) => {
    image.current = h;
    if (h) waiting.current.splice(0).forEach((w) => w(h.current));
  }, []);

  /** The Image tab's handler, opening the tab first if needed (null if it didn't open). */
  const imageTab = async (): Promise<ImageVoiceHandler | null> => {
    if (image.current) return image.current.current;
    router.navigate(PATHS.image);
    return Promise.race([
      new Promise<ImageVoiceHandler>((resolve) => waiting.current.push(resolve)),
      wait(4000).then(() => null),
    ]);
  };

  const say = (text: string) => {
    if (!text) return;
    setReply(text);
    announce(text);
  };

  const showPicture = async (list: Picture[], index: number, query: string) => {
    const h = await imageTab();
    if (!h) return say('The Image tab did not open.');
    const p = list[index];
    setResults({ query, pictures: list, index });
    const err = await h.loadPicture(p.uri);
    if (err) return say(`That picture could not be loaded. ${list.length > 1 ? 'Say next for another.' : ''}`.trim());
    say(`Picture ${index + 1} of ${list.length}: ${credit(p)}. Say next for another, or use this pattern.`);
  };

  const search = async (query: string, pictures: boolean) => {
    const now = latest.current;
    const saved = pictures ? [] : await patternStore.list().then((r) => r.patterns.map((p) => p.name)).catch(() => [] as string[]);
    const q = query.toLowerCase();
    const matches = saved.filter((n) => n.toLowerCase().includes(q) || matchName(query, [n]));
    if (matches.length && !pictures) {
      return say(
        `${matches.length === 1 ? 'One saved pattern matches' : `${matches.length} saved patterns match`}: ${matches.join(', ')}. ` +
          `Say open saved, then the name.${now.prefs.onlinePictures ? ` Or say find pictures of ${query}.` : ''}`,
      );
    }
    if (!now.prefs.onlinePictures)
      return say(
        `${pictures ? '' : `No saved pattern matches ${query}. `}Searching for pictures uses the internet, so it is off. ` +
          'To use it, turn on Online Picture Search in the Device tab.',
      );
    setPhase('searching');
    try {
      const found = await searchPictures(query);
      setPhase('idle');
      if (!found.length) return say(`No pictures of ${query} were found. Try another word.`);
      await showPicture(found, 0, query);
    } catch (e) {
      setPhase('idle');
      say(e instanceof Error ? e.message : String(e));
    }
  };

  const doEffect = async (effect: Effect | undefined, outReply: string) => {
    const now = latest.current;
    const onImage = now.pathname.startsWith('/image');
    if (!effect) return say(outReply);
    if (typeof effect === 'string') {
      say(outReply);
      if (effect === 'undo') now.undo();
      else if (effect === 'redo') now.redo();
      else if (effect === 'stop') stopSpeaking();
      else if (effect === 'send') {
        const h = onImage ? image.current?.current : null;
        if (h?.result()) h.send();
        else void now.board.send();
      } else if (effect === 'reset') void now.board.lowerPins(!onImage);
      return;
    }
    switch (effect.type) {
      case 'run':
        return run([effect.text]);
      case 'graph': {
        const h = await imageTab();
        if (!h) return say('The Image tab did not open.');
        const err = h.drawEquation(effect.text);
        return say(err ? `I couldn't draw that. ${err}` : outReply);
      }
      case 'image': {
        const h = await imageTab();
        if (!h) return say('The Image tab did not open.');
        return say(await h.run(effect.action));
      }
      case 'setting': {
        const h = await imageTab();
        return say(h ? h.setSetting(effect.setting, effect.on) : 'The Image tab did not open.');
      }
      case 'adjust': {
        const h = await imageTab();
        return say(h ? h.adjust(effect.setting, effect.up) : 'The Image tab did not open.');
      }
      case 'navigate':
        router.navigate(PATHS[effect.tab]);
        return say(`${TAB_NAMES[effect.tab]} tab.`);
      case 'search':
        return search(effect.query, effect.pictures);
      case 'next': {
        const r = now.results;
        if (!r?.pictures.length) return say('There is no picture search to go through. Say find pictures of, then something.');
        const i = (r.index + (effect.back ? -1 : 1) + r.pictures.length) % r.pictures.length;
        return showPicture(r.pictures, i, r.query);
      }
      case 'voiceOff':
        say(outReply);
        cancelListening();
        setPrefs({ voiceControl: false });
        return;
    }
  };

  /** Runs what was heard (or typed): the first of the recogniser's guesses that is a command. */
  const run = async (transcripts: string[]): Promise<void> => {
    const names = await patternStore
      .list()
      .then((r) => r.patterns)
      .catch(() => []);
    const now = latest.current;
    let used = transcripts[0] ?? '';
    let cmd = parseCommand(used, names.map((p) => p.name));
    for (const t of transcripts) {
      const c = parseCommand(t, names.map((p) => p.name));
      if (c.kind !== 'unknown') {
        used = t;
        cmd = c;
        break;
      }
    }
    setHeard(used);

    // Not a listed command: the on-device AI (where there is one) suggests one, which must be confirmed.
    if (cmd.kind === 'unknown' && cmd.heard && (await aiStatus()) === 'available') {
      setPhase('thinking');
      const suggestion = await aiSuggest(cmd.heard);
      setPhase('idle');
      if (suggestion && parseCommand(suggestion, names.map((p) => p.name)).kind !== 'unknown') {
        setPending({ suggestion });
        return say(`Did you mean: ${suggestion}? Say yes or no.`);
      }
    }

    const onImage = now.pathname.startsWith('/image');
    const imageResult = onImage ? (image.current?.current.result() ?? null) : null;
    const out = runCommand(cmd, {
      pattern: now.pattern,
      active: imageResult ?? undefined,
      connected: now.board.connected,
      busy: now.board.busy,
      canUndo: now.canUndo,
      canRedo: now.redoCount > 0,
      pending: now.pending,
      saved: names.map((s) => ({ name: s.name, pattern: isCompatible(s, GRID.rows, GRID.cols) ? toPattern(s) : null })),
      lastReply: lastAnnouncement(),
    });
    setPending(out.pending);
    if (out.show) {
      now.setPattern(out.show.pattern, out.show.source);
      // The preview is on the Display tab: go there to feel or check it.
      if (now.pathname !== '/') router.navigate('/');
    }
    if (out.effect === 'stop') {
      stopSpeaking();
      setReply('');
      return;
    }
    await doEffect(out.effect, out.reply);
  };

  const toggleListening = async () => {
    if (phase === 'listening' || phase === 'downloading') {
      finishListening();
      return;
    }
    if (phase !== 'idle') return;
    stopSpeaking();
    setPhase('listening');
    listeningCue('start');
    // Let the tone (and a screen reader's "Speak, button") finish before the microphone opens.
    await wait(screenReaderOn() ? 600 : 200);
    const names = await patternStore
      .list()
      .then((r) => r.patterns.map((p) => p.name))
      .catch(() => [] as string[]);
    const res = await listen({ allowOnline: prefs.onlineRecognition, hints: [...HINT_WORDS, ...names], onStatus: (s) => setPhase(s) });
    setPhase('idle');
    listeningCue('stop');
    if (res.ok) await run(res.transcripts);
    else if (res.reason === 'no-speech') say("I didn't hear anything. Press Speak, then say a command, or say help.");
    else if (res.reason !== 'cancelled') say(res.message);
  };

  const value: VoiceValue = {
    phase,
    heard,
    reply,
    pending,
    support,
    prefs,
    setPrefs,
    picture: results ? results.pictures[results.index] : null,
    toggleListening: () => void toggleListening(),
    runText: (text) => {
      if (text.trim()) void run([text]);
    },
    confirm: () => void run(['yes']),
    cancel: () => void run(['no']),
    openAndListen: () => {
      if (!prefs.voiceControl) setPrefs({ voiceControl: true });
      void toggleListening();
    },
    registerImage,
  };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

export function useVoice(): VoiceValue {
  const v = useContext(VoiceContext);
  if (!v) throw new Error('useVoice must be used inside VoiceProvider');
  return v;
}

/** The Image tab offers its actions to voice while it's open. */
export function useImageVoice(handler: ImageVoiceHandler) {
  const { registerImage } = useVoice();
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useFocusEffect(
    useCallback(() => {
      registerImage(ref);
      return () => registerImage(null);
    }, [registerImage]),
  );
}
