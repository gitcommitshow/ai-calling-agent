/**
 * One call's transcript, folded to the guest's last line. A queue row can
 * hold several calls, and opening one shows that call's full turn list.
 */
import { lastGuestLine } from '../domain/transcript';
import type { TranscriptTurn } from '../domain/types';
import { formatInZone } from '../lib/time';
import { Icon } from './Icon';

interface Props {
  transcript: TranscriptTurn[];
  startedAt: string;
  timezone: string;
}

export function CallTranscript({ transcript, startedAt, timezone }: Props) {
  const last = lastGuestLine(transcript);

  return (
    <details className="call-transcript">
      <summary className="small">
        <span className="call-transcript-line">
          <Icon name="speech" />
          <time dateTime={startedAt}>{formatInZone(startedAt, timezone)}</time>
          <span className="last-line">{last ?? 'No reply yet'}</span>
        </span>
      </summary>
      <pre className="transcript">
        {transcript.map((turn) => `${turn.role}: ${turn.text}`).join('\n')}
      </pre>
    </details>
  );
}
