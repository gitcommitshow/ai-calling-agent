/**
 * Calls already placed to one guest, newest first. Each row links the campaign
 * that dialed, shows the answers that call captured, and folds the transcript
 * the same way the campaign queue does.
 */
import Link from 'next/link';
import { capturedAnswers } from '../domain/captured';
import {
  ATTEMPT_STATUS_LABELS,
  CALL_OUTCOME_LABELS,
  type Attempt,
  type Campaign,
} from '../domain/types';
import { formatInZone } from '../lib/time';
import { CallTranscript } from './CallTranscript';
import { Icon } from './Icon';
import { CALL_OUTCOME_ICONS } from './status-icons';

interface Props {
  eventId: string;
  timezone: string;
  attempts: Attempt[];
  campaigns: Campaign[];
}

export function GuestCallList({ eventId, timezone, attempts, campaigns }: Props) {
  if (attempts.length === 0) return null;
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const ordered = [...attempts].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return (
    <ul className="guest-calls">
      {ordered.map((attempt) => {
        const campaign = campaignById.get(attempt.campaignId);
        const answers = capturedAnswers(attempt.capturedFields, campaign?.fields ?? []);
        const live = attempt.status !== 'done';
        const outcome = live
          ? ATTEMPT_STATUS_LABELS[attempt.status]
          : attempt.outcome
            ? CALL_OUTCOME_LABELS[attempt.outcome]
            : 'No outcome';

        return (
          <li key={attempt.id}>
            <span className="guest-call-line small">
              <Icon
                name={live ? 'phone' : CALL_OUTCOME_ICONS[attempt.outcome ?? 'failed']}
              />
              <time dateTime={attempt.startedAt}>{formatInZone(attempt.startedAt, timezone)}</time>
              {campaign ? (
                <Link href={`/events/${eventId}/campaigns/${campaign.id}`}>{campaign.name}</Link>
              ) : (
                <span>{attempt.campaignId}</span>
              )}
              <span className="muted">{outcome}</span>
            </span>
            {answers.length > 0 ? (
              <span className="toolbar">
                {answers.map((answer) => (
                  <span key={answer.key} className="chip">
                    <Icon name="check" /> {answer.label}: {answer.value}
                  </span>
                ))}
              </span>
            ) : null}
            {attempt.transcript.length > 0 ? (
              <CallTranscript
                transcript={attempt.transcript}
                startedAt={attempt.startedAt}
                timezone={timezone}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
