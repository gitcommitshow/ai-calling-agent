/**
 * The lifecycle of one attempt, oldest step first. This is what lets the
 * organizer see what happened on a call without listening to it: when it was
 * dialed, whether it was answered, which backend ran it, and how it ended.
 */
import { Icon } from './Icon';
import { ATTEMPT_EVENT_LABELS, type AttemptEvent, type AttemptEventKind } from '../domain/types';
import type { IconName } from './Icon';

const EVENT_ICONS: Record<AttemptEventKind, IconName> = {
  created: 'list',
  dialing: 'phone',
  ringing: 'clock',
  answered: 'checkCircle',
  machine_detected: 'voicemail',
  backend_started: 'stack',
  call_ended: 'phoneOff',
  extraction_started: 'speech',
  extraction_done: 'check',
  extraction_failed: 'alert',
  error: 'alert',
  interrupted: 'minusCircle',
};

interface Props {
  timeline: AttemptEvent[];
  timezone: string;
}

function clockTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function AttemptTimeline({ timeline, timezone }: Props) {
  if (timeline.length === 0) return null;

  return (
    <ol className="timeline">
      {timeline.map((event, index) => (
        <li key={`${event.at}-${event.kind}-${index}`}>
          <time dateTime={event.at}>{clockTime(event.at, timezone)}</time>
          <span>
            <Icon name={EVENT_ICONS[event.kind]} /> {ATTEMPT_EVENT_LABELS[event.kind]}
          </span>
          {event.detail ? <span className="detail truncate">{event.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}
