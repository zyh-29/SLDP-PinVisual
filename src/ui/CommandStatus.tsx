import type { CommandState } from '@/device/DeviceController';
import { Button, StatusBanner } from './components';

/**
 * Wording rules: success means the board *acknowledged* the command. The app
 * never claims pins physically moved - there is no position sensing.
 */
export function CommandStatus({
  command,
  onRetrySend,
  onRetryReset,
  connected,
}: {
  command: CommandState;
  onRetrySend: () => void;
  onRetryReset: () => void;
  connected: boolean;
}) {
  switch (command.status) {
    case 'idle':
      return null;
    case 'sending': {
      const p = command.progress;
      const what = command.kind === 'pattern' ? 'Sending pattern…' : 'Sending reset…';
      const detail = !p
        ? 'Preparing command.'
        : p.phase === 'retry_wait'
          ? `No reply yet. Retrying (attempt ${p.attempt} of ${p.maxAttempts}).`
          : p.phase === 'writing'
            ? `Writing to the board (attempt ${p.attempt} of ${p.maxAttempts}).`
            : `Waiting for the board to acknowledge (attempt ${p.attempt} of ${p.maxAttempts}).`;
      return <StatusBanner tone="progress" title={what} message={detail} />;
    }
    case 'succeeded':
      if (command.kind === 'pattern') {
        return command.isMock ? (
          <StatusBanner tone="success" title="Mock board received pattern" message="Simulated acknowledgement. No hardware was involved." />
        ) : (
          <StatusBanner
            tone="success"
            title="Board received pattern"
            message="The board acknowledged the command. Pin positions are not sensed, so the app cannot verify them."
          />
        );
      }
      return command.isMock ? (
        <StatusBanner tone="success" title="Mock board acknowledged reset" message="Simulated. No hardware was involved." />
      ) : (
        <StatusBanner
          tone="success"
          title="Board acknowledged reset"
          message="The board accepted the lower-all command. The app cannot verify the pins physically moved."
        />
      );
    case 'failed':
      return command.kind === 'pattern' ? (
        <StatusBanner
          tone="error"
          title="Pattern not confirmed"
          message={`${command.message} The board may not show this pattern.`}
          action={connected ? <Button title="Retry Send" icon="refresh" variant="secondary" onPress={onRetrySend} compact /> : undefined}
        />
      ) : (
        <StatusBanner
          tone="error"
          title="Reset failed"
          message={`${command.message} The pins may not have been lowered.`}
          action={connected ? <Button title="Retry Reset" icon="refresh" variant="destructive" onPress={onRetryReset} compact /> : undefined}
        />
      );
  }
}
