import { type Href, router, useFocusEffect, usePathname } from 'expo-router';
import { createContext, type ReactNode, type RefObject, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { GRID } from '@/config/hardware';
import { countRaised, type Pattern } from '@/domain/pattern';
import { usePattern } from '@/state/PatternProvider';
import { useBoardActions } from '@/state/useBoardActions';
import { patternStore } from '@/state/useSavedPatterns';
import type { ConversionPrefs } from '@/state/useConversionSettings';
import { isCompatible, toPattern } from '@/storage/patternStore';
import { aiStatus, aiSuggest } from './aiFallback';
import { announce, lastAnnouncement, screenReaderOn, stopSpeaking } from './announce';
import { type Command, HINT_WORDS, type ImageAction, type ImageSetting, matchName, parseCommand, type Tab } from './commands';
import { listeningCue } from './cue';
import { credit, type Picture, searchPicturesFast } from './pictureSearch';
import { PictureCheck } from './PictureCheck';
import { cancelListening, finishListening, listen, recognitionSupport, type RecognitionSupport } from './recognizer';
import { type Effect, type Pending, runCommand } from './runCommand';
import { understand } from './understand';
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
  /** The Image tab's conversion settings as a newly loaded picture would get them (for checking search results). */
  pictureSettings(): ConversionPrefs;
  /** The pins for the picture at `uri` once they're final (nothing still being worked out); null if it never settles. */
  settled(uri: string): Promise<Pattern | null>;
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
/** Search results in a row skipped for making no useful pins, before one is shown anyway. */
const SKIP_POOR = 3;

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
  /** The picture search being gone through. `complete`: every source has answered, so the count is final. */
  const [results, setResults] = useState<{ query: string; pictures: Picture[]; index: number; complete?: boolean } | null>(null);

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

  // Search results being checked off screen (PictureCheck, rendered below): what pins each would make.
  const [checks, setChecks] = useState<{ uri: string; settings: ConversionPrefs }[]>([]);
  const checkWaiters = useRef(new Map<string, (pins: Pattern | null) => void>());
  const checked = useCallback((uri: string, pins: Pattern | null) => {
    const resolve = checkWaiters.current.get(uri);
    if (!resolve) return;
    checkWaiters.current.delete(uri);
    setChecks((c) => c.filter((x) => x.uri !== uri));
    resolve(pins);
  }, []);
  /** The pins a picture would make on the Image tab with its current settings, worked out off screen. */
  const checkPicture = (uri: string, settings: ConversionPrefs) =>
    new Promise<Pattern | null>((resolve) => {
      const before = checkWaiters.current.get(uri);
      checkWaiters.current.set(uri, (pins) => {
        before?.(pins);
        resolve(pins);
      });
      if (!before) setChecks((c) => [...c, { uri, settings }]);
      // A picture that never finishes loading counts as no use.
      setTimeout(() => checked(uri, null), 10_000);
    });

  /**
   * Shows a search result on the Image tab. Results whose pins say nothing (two pins or fewer, or nearly all of
   * them: the conversion picked a detail, or the whole frame) are skipped quietly, up to SKIP_POOR in a row, going
   * the same way ("next" or "previous"). This one and the next few are checked at once, off screen, and the first
   * useful one is shown: one wait instead of loading them on the tab one after another.
   */
  const showPicture = async (list: Picture[], index: number, query: string, step = 1): Promise<void> => {
    const h = await imageTab();
    if (!h) return say('The Image tab did not open.');
    const settings = h.pictureSettings();
    const n = Math.min(SKIP_POOR + 1, list.length);
    const order = Array.from({ length: n }, (_, k) => (((index + k * step) % list.length) + list.length) % list.length);
    const pending = order.map((i) => checkPicture(list[i].uri, settings));
    let chosen = order[n - 1];
    for (let k = 0; k < n; k++) {
      const pins = await pending[k];
      const raised = pins ? countRaised(pins) : 0;
      if (pins && raised > 2 && raised < pins.rows * pins.cols - 1) {
        chosen = order[k];
        break;
      }
    }
    const p = list[chosen];
    setResults((r) => (r?.query === query && r.pictures.length >= list.length ? { ...r, index: chosen } : { query, pictures: list, index: chosen }));
    const err = await h.loadPicture(p.uri);
    if (err) return say(`That picture could not be loaded. ${list.length > 1 ? 'Say next for another.' : ''}`.trim());
    // Answer once the tab shows the pins (read through the ref: the tab's handler is renewed on every render).
    await (image.current?.current ?? h).settled(p.uri);
    // The count only once it's final: slower sources may still be adding to the list.
    const r = latest.current.results;
    const of = r?.query === query && r.complete ? ` of ${r.pictures.length}` : '';
    say(`Picture ${chosen + 1}${of}: ${credit(p)}. Say next for another, or use this pattern.`);
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
      // The first results arrive as soon as the best source has answered; slower sources add to the list for "next".
      const found = await searchPicturesFast(query);
      found.complete.then(
        (all) => setResults((r) => (r?.query === query ? { ...r, pictures: all.length > r.pictures.length ? all : r.pictures, complete: true } : r)),
        () => {},
      );
      if (!found.pictures.length) {
        const all = await found.complete.catch(() => [] as Picture[]);
        setPhase('idle');
        if (!all.length) return say(`No pictures of ${query} were found. Try another word.`);
        return showPicture(all, 0, query);
      }
      await showPicture(found.pictures, 0, query);
      setPhase('idle');
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
        return showPicture(r.pictures, i, r.query, effect.back ? -1 : 1);
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
    const saved = names.map((p) => p.name);
    // The first of the recogniser's guesses that's understood (understand.ts: the rules, then the voice model);
    // failing that, the first one the voice model would ask about.
    const readings = transcripts.map((text) => ({ text, u: understand(text, saved) }));
    const chosen = readings.find((r) => r.u.command.kind !== 'unknown') ?? readings.find((r) => r.u.confirm) ?? readings[0];
    const used = chosen?.text ?? '';
    const cmd: Command = chosen?.u.command ?? { kind: 'unknown', heard: '' };
    setHeard(used);

    // The voice model is fairly sure, not certain: ask before doing anything.
    if (chosen?.u.confirm) {
      setPending({ suggestion: chosen.u.confirm });
      return say(`Did you mean: ${chosen.u.confirm}? Say yes or no.`);
    }

    // Neither the rules nor the voice model understood: the browser's on-device AI (where there is one) suggests a
    // command, which must be confirmed.
    if (cmd.kind === 'unknown' && cmd.heard && (await aiStatus()) === 'available') {
      setPhase('thinking');
      const suggestion = await aiSuggest(cmd.heard);
      setPhase('idle');
      if (suggestion && parseCommand(suggestion, saved).kind !== 'unknown') {
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

  return (
    <VoiceContext.Provider value={value}>
      {children}
      {checks.map((c) => (
        <PictureCheck key={c.uri} uri={c.uri} settings={c.settings} onDone={checked} />
      ))}
    </VoiceContext.Provider>
  );
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
