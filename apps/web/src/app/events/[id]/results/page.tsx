/**
 * Results page: one card per attempt plus the event summary, readable without
 * listening to any call. Each card carries the call's timeline, so the outcome
 * can be understood from the record alone.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AttemptTimeline } from '../../../../components/AttemptTimeline';
import { Icon } from '../../../../components/Icon';
import { OpenQuestions } from '../../../../components/OpenQuestions';
import { LiveRefresh } from '../../../../components/LiveRefresh';
import { CALL_OUTCOME_ICONS } from '../../../../components/status-icons';
import {
  getEvent,
  getSummary,
  listAttempts,
  listCampaigns,
  listGuests,
  loadSettings,
  ServerApiError,
} from '../../../../lib/server-api';
import { formatInZone } from '../../../../lib/time';
import {
  ATTEMPT_STATUS_LABELS,
  CALL_OUTCOME_LABELS,
  type CallOutcome,
} from '../../../../domain/types';

export const dynamic = 'force-dynamic';

export default async function ResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const [event, guests, campaigns, attempts, summary, org] = await Promise.all([
      getEvent(id),
      listGuests(id),
      listCampaigns(id),
      listAttempts(id),
      getSummary(id),
      loadSettings(),
    ]);

    const guestById = new Map(guests.map((guest) => [guest.id, guest]));
    const campaignName = new Map(campaigns.map((campaign) => [campaign.id, campaign.name]));
    const outcomesWithCounts = (Object.entries(summary.outcomes) as [CallOutcome, number][]).filter(
      ([, count]) => count > 0,
    );
    const openRows = attempts.flatMap((attempt) => {
      const guest = guestById.get(attempt.guestId);
      return (attempt.openQuestions ?? [])
        .filter((question) => question.status === 'open')
        .map((question) => ({
          questionId: question.id,
          text: question.text,
          attemptId: attempt.id,
          guestId: attempt.guestId,
          guestName: guest?.name ?? attempt.guestId,
          campaignId: attempt.campaignId,
          campaignName: campaignName.get(attempt.campaignId) ?? attempt.campaignId,
        }));
    });

    return (
      <div className="stack">
        <LiveRefresh active={summary.liveCount > 0} />
        <div>
          <h1>Results: {event.name}</h1>
          <p className="muted small">
            <Link href={`/events/${event.id}`}>Back to the event</Link>
          </p>
          <div className="toolbar">
            <span className="chip strong">
              <Icon name="users" /> {summary.guestCount} guests
            </span>
            <span className="chip strong">
              <Icon name="phone" /> {summary.attemptCount} attempts
            </span>
            {summary.liveCount > 0 ? (
              <span className="chip strong">
                <span className="live-dot" /> {summary.liveCount} in progress
              </span>
            ) : null}
            {outcomesWithCounts.map(([outcome, count]) => (
              <span key={outcome} className="chip">
                <Icon name={CALL_OUTCOME_ICONS[outcome]} /> {CALL_OUTCOME_LABELS[outcome]}: {count}
              </span>
            ))}
          </div>
        </div>

        <OpenQuestions eventId={event.id} rows={openRows} callingHoursMode={org.callingHoursMode} />

        <section className="card">
          <h2>By campaign</h2>
          <div className="card-grid">
            {summary.campaigns.map((campaignSummary) => (
              <article key={campaignSummary.campaignId} className="entity-card">
                <div className="entity-card-head">
                  <div>
                    <h3>{campaignSummary.name}</h3>
                    <span className="chip">
                      <Icon name="list" /> {campaignSummary.type}
                    </span>
                  </div>
                </div>
                <div className="meta">
                  <span className="meta-row">
                    <Icon name="users" />
                    <span>
                      {campaignSummary.queued} queued, {campaignSummary.attempted} attempted
                      {campaignSummary.liveCount > 0
                        ? `, ${campaignSummary.liveCount} in progress`
                        : ''}
                    </span>
                  </span>
                  {Object.entries(campaignSummary.captured).map(([fieldKey, values]) => (
                    <span key={fieldKey} className="meta-row">
                      <Icon name="check" />
                      <span>
                        <strong>{fieldKey}</strong>{' '}
                        {Object.entries(values).length === 0
                          ? 'no answers yet'
                          : Object.entries(values)
                              .map(([value, count]) => `${value}: ${count}`)
                              .join(', ')}
                      </span>
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Attempts</h2>
          {attempts.length === 0 ? (
            <p className="empty">
              No attempts yet. Start a run from a campaign page, or run{' '}
              <code>npm run seed</code> to see example results.
            </p>
          ) : (
            <div className="card-grid">
              {attempts.map((attempt) => {
                const guest = guestById.get(attempt.guestId);
                const captured = Object.entries(attempt.capturedFields);
                const live = attempt.status !== 'done';

                const resolved = (attempt.openQuestions ?? []).filter(
                  (question) => question.status === 'resolved',
                );

                return (
                  <article key={attempt.id} id={`attempt-${attempt.id}`} className="entity-card">
                    <div className="entity-card-head">
                      <div>
                        <h3>{guest?.name ?? attempt.guestId}</h3>
                        {live ? (
                          <span className="chip strong">
                            <span className="live-dot" /> {ATTEMPT_STATUS_LABELS[attempt.status]}
                          </span>
                        ) : (
                          <span className="chip strong">
                            <Icon
                              name={CALL_OUTCOME_ICONS[attempt.outcome ?? 'failed']}
                            />
                            {attempt.outcome
                              ? CALL_OUTCOME_LABELS[attempt.outcome]
                              : 'No outcome recorded'}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="meta">
                      <span className="meta-row">
                        <Icon name="list" />
                        <span className="truncate">
                          {campaignName.get(attempt.campaignId) ?? attempt.campaignId}
                        </span>
                      </span>
                      <span className="meta-row">
                        <Icon name="calendar" />
                        <span>{formatInZone(attempt.startedAt, event.timezone)}</span>
                      </span>
                      <span className="meta-row">
                        <Icon name="stack" />
                        <span>
                          {attempt.voiceBackend ?? 'no backend recorded'}
                          {attempt.fallbackUsed ? ' (fallback)' : ''}
                        </span>
                      </span>
                    </div>

                    {resolved.length > 0 ? (
                      <div className="toolbar">
                        {resolved.map((question) => (
                          <span key={question.id} className="chip">
                            <Icon name="check" /> Answered: {question.text}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {captured.length > 0 ? (
                      <div className="toolbar">
                        {captured.map(([key, value]) => (
                          <span key={key} className="chip">
                            <Icon name="check" /> {key}: {value}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="status-line">
                        <Icon name="minusCircle" />
                        <span>Nothing captured</span>
                      </p>
                    )}

                    {attempt.error ? (
                      <p className="status-line blocked">
                        <Icon name="alert" />
                        <span>{attempt.error}</span>
                      </p>
                    ) : null}

                    {attempt.timeline.length > 0 ? (
                      <details open={live}>
                        <summary className="small">
                          <Icon name="clock" /> Call timeline ({attempt.timeline.length} steps)
                        </summary>
                        <AttemptTimeline
                          timeline={attempt.timeline}
                          timezone={event.timezone}
                        />
                      </details>
                    ) : null}

                    {attempt.transcript.length > 0 ? (
                      <details>
                        <summary className="small">
                          <Icon name="speech" /> Transcript ({attempt.transcript.length} turns)
                        </summary>
                        <pre className="transcript">
                          {attempt.transcript.map((turn) => `${turn.role}: ${turn.text}`).join('\n')}
                        </pre>
                      </details>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );
  } catch (error) {
    if (error instanceof ServerApiError && error.status === 404) notFound();
    return (
      <p className="notice error">
        <Icon name="alert" /> {(error as Error).message}
      </p>
    );
  }
}
