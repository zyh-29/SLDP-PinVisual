import type { CommandResult } from '@/protocol/CommandClient';
import { sendWhenFree } from '../sendWhenFree';

const ok: CommandResult = { ok: true, commandId: 1, attempts: 1 };
const busy: CommandResult = { ok: false, commandId: null, attempts: 0, failure: 'busy', message: 'Another command is still in progress.' };
const timeout: CommandResult = { ok: false, commandId: 2, attempts: 3, failure: 'timeout', message: 'No answer' };

/** A board that answers with `answers` in turn; time moves on by each wait. */
function fake(answers: CommandResult[]) {
  let clock = 0;
  const sends: number[] = [];
  return {
    sends,
    send: async () => {
      sends.push(clock);
      return answers[Math.min(sends.length - 1, answers.length - 1)];
    },
    now: () => clock,
    wait: async (ms: number) => {
      clock += ms;
    },
  };
}

describe('sendWhenFree', () => {
  it('asks again while the board is busy, then gives back its answer', async () => {
    const b = fake([busy, busy, ok]);
    const res = await sendWhenFree(b.send, { cancelled: () => false, now: b.now, wait: b.wait });
    expect(res).toEqual(ok);
    expect(b.sends).toEqual([0, 300, 600]);
  });

  it('gives back other failures at once', async () => {
    const b = fake([timeout]);
    expect(await sendWhenFree(b.send, { cancelled: () => false, now: b.now, wait: b.wait })).toEqual(timeout);
    expect(b.sends).toHaveLength(1);
  });

  it('stops asking after giveUpMs', async () => {
    const b = fake([busy]);
    const res = await sendWhenFree(b.send, { cancelled: () => false, now: b.now, wait: b.wait, giveUpMs: 1000 });
    expect(res).toEqual(busy);
    expect(b.sends).toEqual([0, 300, 600, 900, 1200]);
  });

  it('sends nothing more once cancelled (the user moved to another step)', async () => {
    const b = fake([busy]);
    let stop = false;
    const res = sendWhenFree(b.send, {
      cancelled: () => stop,
      now: b.now,
      wait: async (ms) => {
        await b.wait(ms);
        stop = b.sends.length >= 2;
      },
    });
    expect(await res).toBeNull();
    expect(b.sends).toHaveLength(2);
  });
});
