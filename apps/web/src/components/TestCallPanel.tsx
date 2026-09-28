'use client';

/**
 * One-click pipeline test plus number/prompt overrides. Posts to the test-call
 * API and lists that page's tests, polling only while one is still live.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultCampaign } from '../domain/default-campaign';
import { formatIndianPhone, normalizeIndianPhone } from '../domain/phone';
import { assembleTestPrompt } from '../domain/test-prompt';
import type { OrgSettings } from '../domain/settings';
import {
  ATTEMPT_STATUS_LABELS,
  CALL_OUTCOME_LABELS,
  type Campaign,
  type CampaignType,
  type Event,
  type TestCall,
  type TestCallPromptSource,
} from '../domain/types';
import { AttemptTimeline } from './AttemptTimeline';
import { Icon } from './Icon';
import { CALL_OUTCOME_ICONS } from './status-icons';
import type { TestCallPromptSourceInput } from '../lib/server-api';

const POLL_MS = 3000;
const MASTER_TYPES: CampaignType[] = ['pre-event', 'post-event'];

type PromptChoice = 'default' | 'master:pre-event' | 'master:post-event' | 'custom' | `campaign:${string}`;

interface Props {
  event: Event | null;
  campaigns: Campaign[];
  settings: OrgSettings;
  initialTestCalls: TestCall[];
}

function isLive(call: TestCall): boolean {
  return call.status !== 'done';
}

/** Short label for the prompt a stored test used. */
function promptSourceLabel(call: TestCall, campaigns: Campaign[]): string {
  if (call.promptSource.kind === 'builtin') return 'Built-in pipeline test';
  if (call.promptSource.kind === 'master') return `Master: ${call.promptSource.campaignType}`;
  if (call.promptSource.kind === 'campaign') {
    const campaignId = call.promptSource.campaignId;
    return campaigns.find((item) => item.id === campaignId)?.name ?? 'Campaign prompt';
  }
  return 'Custom prompt';
}

/** Map the form choice onto the stored prompt source the preview and POST share. */
function choiceToSource(
  choice: PromptChoice,
  customPrompt: string,
  event: Event | null,
  campaigns: Campaign[],
): { promptSource: TestCallPromptSource; campaign: Campaign | null } {
  if (choice === 'default') {
    if (!event) return { promptSource: { kind: 'builtin' }, campaign: null };
    const fallback = defaultCampaign(campaigns, event, new Date());
    if (fallback) {
      return { promptSource: { kind: 'campaign', campaignId: fallback.id }, campaign: fallback };
    }
    return { promptSource: { kind: 'master', campaignType: 'pre-event' }, campaign: null };
  }
  if (choice === 'master:pre-event') {
    return { promptSource: { kind: 'master', campaignType: 'pre-event' }, campaign: null };
  }
  if (choice === 'master:post-event') {
    return { promptSource: { kind: 'master', campaignType: 'post-event' }, campaign: null };
  }
  if (choice === 'custom') {
    return { promptSource: { kind: 'custom', prompt: customPrompt }, campaign: null };
  }
  const campaignId = choice.slice('campaign:'.length);
  const campaign = campaigns.find((item) => item.id === campaignId) ?? null;
  return { promptSource: { kind: 'campaign', campaignId }, campaign };
}

export function TestCallPanel({ event, campaigns, settings, initialTestCalls }: Props) {
  const [to, setTo] = useState('');
  const [choice, setChoice] = useState<PromptChoice>('default');
  const [customPrompt, setCustomPrompt] = useState('');
  const [calls, setCalls] = useState(initialTestCalls);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timezone = event?.timezone ?? 'Asia/Kolkata';
  const live = calls.some(isLive);
  const listQuery = event ? `?eventId=${encodeURIComponent(event.id)}` : '';

  const { promptSource, campaign } = useMemo(
    () => choiceToSource(choice, customPrompt, event, campaigns),
    [campaigns, choice, customPrompt, event],
  );
  const language = campaign?.language ?? 'en';
  const fields = campaign?.fields ?? [];
  const preview = useMemo(
    () =>
      assembleTestPrompt({
        promptSource,
        event,
        campaign,
        settings,
        language,
        fields,
      }),
    [campaign, event, fields, language, promptSource, settings],
  );

  const refreshList = useCallback(async () => {
    const response = await fetch(`/api/test-calls${listQuery}`, { cache: 'no-store' });
    const payload = (await response.json()) as { testCalls?: TestCall[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? 'could not list test calls');
    setCalls(payload.testCalls ?? []);
  }, [listQuery]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const tick = async () => {
      try {
        await refreshList();
      } catch (pollError) {
        if (!cancelled) setError((pollError as Error).message);
      }
    };
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live, refreshList]);

  async function placeCall() {
    setBusy(true);
    setError(null);
    try {
      let toPayload: string | undefined;
      if (to.trim()) {
        const parsed = normalizeIndianPhone(to);
        if (!parsed.phone) throw new Error(parsed.reason ?? 'invalid number');
        toPayload = parsed.phone;
      } else if (!settings.testNumber) {
        throw new Error('set a test number in Settings, or enter a number for this call');
      }

      const promptPayload: TestCallPromptSourceInput =
        choice === 'default'
          ? { kind: 'default' }
          : choice === 'custom'
            ? { kind: 'custom', prompt: customPrompt }
            : choice.startsWith('master:')
              ? { kind: 'master', campaignType: choice.slice('master:'.length) as CampaignType }
              : { kind: 'campaign', campaignId: choice.slice('campaign:'.length) };

      const response = await fetch('/api/test-calls', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId: event?.id,
          to: toPayload,
          promptSource: promptPayload,
        }),
      });
      const payload = (await response.json()) as { testCall?: TestCall; error?: string };
      if (!response.ok || !payload.testCall) {
        throw new Error(payload.error ?? 'could not place the test call');
      }
      setCalls((current) => [payload.testCall!, ...current.filter((item) => item.id !== payload.testCall!.id)]);
    } catch (sendError) {
      setError((sendError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function hangUp(id: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/test-calls/${id}/stop`, { method: 'POST' });
      const payload = (await response.json()) as { testCall?: TestCall; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'could not hang up');
      await refreshList();
    } catch (stopError) {
      setError((stopError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const destination = to.trim()
    ? 'the number you entered'
    : settings.testNumber
      ? formatIndianPhone(settings.testNumber)
      : null;

  return (
    <div className="stack">
      <section className="card stack">
        <div>
          <h2>Place a test call</h2>
          <p className="small muted">
            Uses the same telephony, speech, and model path as a guest call. It does not dial the
            guest list or write to results.
            {event
              ? ' One click uses this event\'s prompt and a stand-in attendee.'
              : ' One click uses the built-in pipeline-test script, with no guest and no event.'}
          </p>
        </div>

        {!settings.testNumber ? (
          <p className="notice small">
            <Icon name="alert" /> Set a fixed test number in{' '}
            <Link href="/settings">Settings</Link>, or type a number below for this call only.
          </p>
        ) : null}

        <div>
          <label htmlFor="test-to">Number (optional)</label>
          <input
            id="test-to"
            type="tel"
            inputMode="tel"
            placeholder={
              settings.testNumber
                ? `Blank uses ${formatIndianPhone(settings.testNumber)}`
                : '+91 98765 43210'
            }
            value={to}
            onChange={(changeEvent) => setTo(changeEvent.target.value)}
          />
        </div>

        <div>
          <label htmlFor="test-prompt">Prompt</label>
          <select
            id="test-prompt"
            value={choice}
            onChange={(changeEvent) => setChoice(changeEvent.target.value as PromptChoice)}
          >
            <option value="default">
              {event
                ? `This event's default (${defaultCampaign(campaigns, event, new Date())?.name ?? 'pre-event master'})`
                : 'Built-in pipeline test'}
            </option>
            {MASTER_TYPES.map((type) => (
              <option key={type} value={`master:${type}`}>
                Master: {type}
              </option>
            ))}
            {event
              ? campaigns.map((item) => (
                  <option key={item.id} value={`campaign:${item.id}`}>
                    {item.name}
                  </option>
                ))
              : null}
            <option value="custom">New prompt for this test only</option>
          </select>
        </div>

        {choice === 'custom' ? (
          <div>
            <label htmlFor="test-custom-prompt">New prompt</label>
            <textarea
              id="test-custom-prompt"
              value={customPrompt}
              required
              onChange={(changeEvent) => setCustomPrompt(changeEvent.target.value)}
            />
            <p className="small muted">
              Saved on this test only. It does not change the master prompt or any campaign.
            </p>
          </div>
        ) : null}

        <div>
          <h3>
            <Icon name="speech" /> Prompt the call will use
          </h3>
          <pre className="transcript notice">{preview}</pre>
        </div>

        {error ? (
          <p className="notice error small">
            <Icon name="alert" /> {error}
          </p>
        ) : null}

        <div className="toolbar">
          <button
            type="button"
            disabled={busy || live || (choice === 'custom' && customPrompt.trim() === '')}
            onClick={() => void placeCall()}
          >
            <Icon name="phone" />{' '}
            {live
              ? 'A call is in progress'
              : destination
                ? `Call ${destination}`
                : 'Place test call'}
          </button>
        </div>
      </section>

      <section className="card stack">
        <h2>Test calls</h2>
        {calls.length === 0 ? (
          <p className="empty">No tests yet on this page. The button above places the first one.</p>
        ) : (
          <div className="card-grid">
            {calls.map((call) => {
              const captured = Object.entries(call.capturedFields);
              const callLive = isLive(call);
              return (
                <article key={call.id} className="entity-card">
                  <div className="entity-card-head">
                    <div>
                      <h3>{formatIndianPhone(call.to)}</h3>
                      {callLive ? (
                        <span className="chip strong">
                          <span className="live-dot" /> {ATTEMPT_STATUS_LABELS[call.status]}
                        </span>
                      ) : (
                        <span className="chip strong">
                          <Icon name={CALL_OUTCOME_ICONS[call.outcome ?? 'failed']} />
                          {call.outcome
                            ? CALL_OUTCOME_LABELS[call.outcome]
                            : 'No outcome recorded'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="meta">
                    <span className="meta-row">
                      <Icon name="speech" />
                      <span className="truncate">
                        {promptSourceLabel(call, campaigns)}
                      </span>
                    </span>
                    <span className="meta-row">
                      <Icon name="stack" />
                      <span>
                        {call.voiceBackend ?? 'no backend recorded'}
                        {call.fallbackUsed ? ' (fallback)' : ''}
                      </span>
                    </span>
                  </div>

                  {captured.length > 0 ? (
                    <div className="toolbar">
                      {captured.map(([key, value]) => (
                        <span key={key} className="chip">
                          <Icon name="check" /> {key}: {value}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {call.error ? (
                    <p className="status-line blocked">
                      <Icon name="alert" />
                      <span>{call.error}</span>
                    </p>
                  ) : null}

                  {callLive ? (
                    <div>
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy}
                        onClick={() => void hangUp(call.id)}
                      >
                        <Icon name="ban" /> Hang up
                      </button>
                    </div>
                  ) : null}

                  {call.timeline.length > 0 ? (
                    <details open={callLive}>
                      <summary className="small">
                        <Icon name="clock" /> Call timeline ({call.timeline.length} steps)
                      </summary>
                      <AttemptTimeline timeline={call.timeline} timezone={timezone} />
                    </details>
                  ) : null}

                  {call.transcript.length > 0 ? (
                    <details>
                      <summary className="small">
                        <Icon name="speech" /> Transcript ({call.transcript.length} turns)
                      </summary>
                      <pre className="transcript">
                        {call.transcript
                          .map((turn) => `${turn.role}: ${turn.text}`)
                          .join('\n')}
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
}
