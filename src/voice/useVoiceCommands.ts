import { useEffect, useRef, useState } from 'react';

import { GRID } from '@/config/hardware';
import { usePattern } from '@/state/PatternProvider';
import { useBoardActions } from '@/state/useBoardActions';
import { useSavedPatterns } from '@/state/useSavedPatterns';
import { isCompatible, toPattern } from '@/storage/patternStore';
import { announce, lastAnnouncement, screenReaderOn, stopSpeaking } from './announce';
import { HINT_WORDS, parseCommand } from './commands';
import { listeningCue } from './cue';
import { cancelListening, finishListening, listen, recognitionSupport, type RecognitionSupport } from './recognizer';
import { type Pending, runCommand, type VoiceContext } from './runCommand';
import { useVoicePrefs } from './voicePrefs';

export type VoicePhase = 'idle' | 'downloading' | 'listening';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Voice commands on the Display tab: listen for one command, do it, and say what happened. Typed commands go
 * through the same path, so everything said can also be typed (and the other way round).
 */
export function useVoiceCommands() {
  const { pattern, setPattern, undo, redo, canUndo, redoCount } = usePattern();
  const { send, reset, connected, busy } = useBoardActions();
  const { patterns } = useSavedPatterns();
  const [prefs] = useVoicePrefs();
  const [phase, setPhase] = useState<VoicePhase>('idle');
  /** What was heard (or typed) last. */
  const [heard, setHeard] = useState<string | null>(null);
  /** The app's answer to it. */
  const [reply, setReply] = useState('');
  /** A command waiting for "yes". */
  const [pending, setPending] = useState<Pending>(null);
  const [support, setSupport] = useState<RecognitionSupport | null>(null);

  useEffect(() => {
    let live = true;
    recognitionSupport().then((s) => {
      if (live) setSupport(s);
    });
    return () => {
      live = false;
    };
  }, []);

  // Listening takes a few seconds: the command is run against the app as it is when it ends, not when it began.
  const latest = useRef({ pattern, connected, busy, canUndo, redoCount, pending, patterns, send, reset, undo, redo, setPattern });
  useEffect(() => {
    latest.current = { pattern, connected, busy, canUndo, redoCount, pending, patterns, send, reset, undo, redo, setPattern };
  });

  const say = (text: string) => {
    setReply(text);
    announce(text);
  };

  /** Runs what was heard: the first of the recogniser's guesses that is a command (they're best first). */
  const run = (transcripts: string[]) => {
    const now = latest.current;
    const names = now.patterns.map((p) => p.name);
    let used = transcripts[0] ?? '';
    let cmd = parseCommand(used, names);
    for (const t of transcripts) {
      const c = parseCommand(t, names);
      if (c.kind !== 'unknown') {
        used = t;
        cmd = c;
        break;
      }
    }
    const ctx: VoiceContext = {
      pattern: now.pattern,
      connected: now.connected,
      busy: now.busy,
      canUndo: now.canUndo,
      canRedo: now.redoCount > 0,
      pending: now.pending,
      saved: now.patterns.map((s) => ({ name: s.name, pattern: isCompatible(s, GRID.rows, GRID.cols) ? toPattern(s) : null })),
      lastReply: lastAnnouncement(),
    };
    const out = runCommand(cmd, ctx);
    setHeard(used);
    setPending(out.pending);
    if (out.show) now.setPattern(out.show.pattern, out.show.source);
    if (out.effect === 'stop') {
      stopSpeaking();
      setReply('');
      return;
    }
    if (out.reply) say(out.reply);
    if (out.effect === 'undo') now.undo();
    else if (out.effect === 'redo') now.redo();
    else if (out.effect === 'send') now.send();
    else if (out.effect === 'reset') now.reset();
  };

  /** Starts listening for one command; while listening, stops and uses what was heard so far. */
  const toggleListening = async () => {
    if (phase !== 'idle') {
      finishListening();
      return;
    }
    stopSpeaking();
    setPhase('listening');
    listeningCue('start');
    // Let the tone (and a screen reader's "Speak, button") finish before the microphone opens.
    await wait(screenReaderOn() ? 600 : 200);
    const names = latest.current.patterns.map((p) => p.name);
    const res = await listen({
      allowOnline: prefs.onlineRecognition,
      hints: [...HINT_WORDS, ...names],
      onStatus: (s) => setPhase(s),
    });
    setPhase('idle');
    listeningCue('stop');
    if (res.ok) run(res.transcripts);
    else if (res.reason === 'no-speech') say("I didn't hear anything. Press Speak, then say a command, or say help.");
    else if (res.reason !== 'cancelled') say(res.message);
  };

  /** A typed command. */
  const runText = (text: string) => {
    if (text.trim()) run([text]);
  };

  const confirm = () => run(['yes']);
  const cancel = () => run(['no']);

  /** Stops listening and drops what was heard (leaving the screen, for one). */
  useEffect(() => () => cancelListening(), []);

  return { phase, heard, reply, pending, support, onlineAllowed: prefs.onlineRecognition, toggleListening, runText, confirm, cancel };
}
