'use client';

/**
 * Org settings editor: master prompts, context allowlist, dialing defaults for
 * new campaigns, and runtime call limits that every live call must honor.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { SettingHint } from './SettingHint';
import {
  CONTEXT_FIELD_IDS,
  CONTEXT_FIELD_META,
  type CallingHoursMode,
  type ContextFieldId,
  type OrgSettings,
} from '../domain/settings';
import type { CampaignType } from '../domain/types';
import { normalizeIndianPhone } from '../domain/phone';

interface Props {
  initial: OrgSettings;
  /** Read from the server environment. The organizer cannot change it here. */
  callingHoursMode: CallingHoursMode;
}

export function SettingsForm({ initial, callingHoursMode }: Props) {
  const router = useRouter();
  const [preEvent, setPreEvent] = useState(initial.masterPrompts['pre-event']);
  const [postEvent, setPostEvent] = useState(initial.masterPrompts['post-event']);
  const [testNumber, setTestNumber] = useState(initial.testNumber ?? '');
  const [windowStart, setWindowStart] = useState(initial.callingWindow.start);
  const [windowEnd, setWindowEnd] = useState(initial.callingWindow.end);
  const [retryCap, setRetryCap] = useState(initial.retryCap);
  const [silenceSeconds, setSilenceSeconds] = useState(initial.silenceSeconds);
  const [maxCallSeconds, setMaxCallSeconds] = useState(initial.maxCallSeconds);
  const [dialTimeoutSeconds, setDialTimeoutSeconds] = useState(initial.dialTimeoutSeconds);
  const [contextFields, setContextFields] = useState<ContextFieldId[]>(initial.contextFields);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleField(id: ContextFieldId) {
    setContextFields((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function save(formEvent: FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      let normalizedTestNumber: string | null = null;
      if (testNumber.trim()) {
        const parsed = normalizeIndianPhone(testNumber);
        if (!parsed.phone) throw new Error(parsed.reason ?? 'invalid test number');
        normalizedTestNumber = parsed.phone;
      }
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          masterPrompts: {
            'pre-event': preEvent,
            'post-event': postEvent,
          } satisfies Record<CampaignType, string>,
          contextFields,
          testNumber: normalizedTestNumber,
          callingWindow: {
            start: windowStart,
            end: windowEnd,
            timezone: initial.callingWindow.timezone,
          },
          retryCap,
          silenceSeconds,
          maxCallSeconds,
          dialTimeoutSeconds,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'could not save settings');
      setMessage('Settings saved. New campaigns pick up dialing defaults. Live call limits apply on the next dial.');
      router.refresh();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={save}>
      <section className="card stack">
        <div>
          <h2>Pipeline test number</h2>
          <p className="small muted">
            One-click tests on the global test page and on each event dial this Indian mobile.
            You can still type a different number on those pages for a single test.
          </p>
        </div>
        <div>
          <label htmlFor="test-number">Test number</label>
          <input
            id="test-number"
            type="tel"
            inputMode="tel"
            placeholder="+91 98765 43210"
            value={testNumber}
            onChange={(changeEvent) => setTestNumber(changeEvent.target.value)}
          />
        </div>
      </section>

      <section className="card stack">
        <div>
          <h2>Default calling hours</h2>
          <SettingHint
            detail={
              callingHoursMode === 'strict'
                ? 'Copied onto each new campaign. Existing campaigns keep their own window until you edit them. STRICT_CALLING_HOURS is set, so a call outside the window is refused even after a confirmation. Unset that variable and restart the server to allow an override.'
                : 'Copied onto each new campaign. Existing campaigns keep their own window until you edit them. The runner enforces the campaign window, not this org default. Outside hours, an organizer can continue only after confirming the risk twice.'
            }
          >
            Seed for new campaigns only. A campaign that sets different hours wins for that queue.
          </SettingHint>
          <p className={callingHoursMode === 'strict' ? 'notice error' : 'notice'}>
            <Icon name="alert" />{' '}
            {callingHoursMode === 'strict'
              ? 'Strict calling hours are on (STRICT_CALLING_HOURS). Calls outside the window are refused. Unset that variable and restart the server if you really need to call outside those hours.'
              : 'Calling hours are soft. Outside the window, you can continue only after confirming the risk twice. Set STRICT_CALLING_HOURS=true and restart the server to refuse those calls.'}
          </p>
        </div>
        <div className="grid">
          <div>
            <label htmlFor="org-window-start">
              Calling window start ({initial.callingWindow.timezone})
            </label>
            <input
              id="org-window-start"
              type="time"
              value={windowStart}
              required
              onChange={(changeEvent) => setWindowStart(changeEvent.target.value)}
            />
          </div>
          <div>
            <label htmlFor="org-window-end">Calling window end</label>
            <input
              id="org-window-end"
              type="time"
              value={windowEnd}
              required
              onChange={(changeEvent) => setWindowEnd(changeEvent.target.value)}
            />
          </div>
          <div>
            <label htmlFor="org-retry-cap">Default attempts per guest</label>
            <input
              id="org-retry-cap"
              type="number"
              min={1}
              max={10}
              value={retryCap}
              onChange={(changeEvent) => setRetryCap(Number(changeEvent.target.value))}
            />
            <SettingHint detail="New campaigns copy this number. Each campaign can raise or lower its own retry cap afterward. The campaign value is what the runner checks.">
              Seed for new campaigns. The campaign&apos;s own retry cap is enforced at dial time.
            </SettingHint>
          </div>
        </div>
      </section>

      <section className="card stack">
        <div>
          <h2>Live call limits</h2>
          <SettingHint detail="These apply to every guest call and pipeline test. Campaigns cannot override them. Changing a value affects the next dial, not a call already on the line.">
            Enforced on every live call. Campaign settings cannot override these.
          </SettingHint>
        </div>
        <div className="grid">
          <div>
            <label htmlFor="silence-seconds">Silence before hangup (seconds)</label>
            <input
              id="silence-seconds"
              type="number"
              min={5}
              max={600}
              value={silenceSeconds}
              required
              onChange={(changeEvent) => setSilenceSeconds(Number(changeEvent.target.value))}
            />
          </div>
          <div>
            <label htmlFor="max-call-seconds">Maximum call length (seconds)</label>
            <input
              id="max-call-seconds"
              type="number"
              min={30}
              max={3600}
              value={maxCallSeconds}
              required
              onChange={(changeEvent) => setMaxCallSeconds(Number(changeEvent.target.value))}
            />
          </div>
          <div>
            <label htmlFor="dial-timeout-seconds">Ring timeout (seconds)</label>
            <input
              id="dial-timeout-seconds"
              type="number"
              min={10}
              max={180}
              value={dialTimeoutSeconds}
              required
              onChange={(changeEvent) => setDialTimeoutSeconds(Number(changeEvent.target.value))}
            />
          </div>
        </div>
      </section>

      <section className="card stack">
        <div>
          <h2>Master prompts</h2>
          <SettingHint detail="Used when a campaign has &quot;use master prompt&quot; on. A campaign custom prompt replaces this for that campaign only. Context field gates below still apply to both.">
            Used by every campaign that keeps &quot;use master prompt&quot; on. A custom campaign prompt
            overrides this for that campaign only.
          </SettingHint>
        </div>

        <div>
          <label htmlFor="master-pre">Pre-event</label>
          <textarea
            id="master-pre"
            value={preEvent}
            required
            onChange={(changeEvent) => setPreEvent(changeEvent.target.value)}
          />
        </div>

        <div>
          <label htmlFor="master-post">Post-event</label>
          <textarea
            id="master-post"
            value={postEvent}
            required
            onChange={(changeEvent) => setPostEvent(changeEvent.target.value)}
          />
        </div>
      </section>

      <section className="card stack">
        <div>
          <h2>Context sent to the AI caller</h2>
          <SettingHint detail="Org-wide gate. Unchecked fields never reach the voice backend, even if a campaign prompt mentions their placeholder. Campaigns cannot re-enable a field turned off here.">
            Only checked fields may reach the voice backend. Campaigns cannot turn a gated-off field
            back on.
          </SettingHint>
        </div>

        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {CONTEXT_FIELD_IDS.map((id) => {
            const meta = CONTEXT_FIELD_META[id];
            const checked = contextFields.includes(id);
            return (
              <li key={id} className="entity-card" style={{ padding: 'var(--space-3)' }}>
                <label className="meta-row" style={{ cursor: 'pointer', color: 'inherit' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleField(id)}
                    aria-describedby={`hint-${id}`}
                  />
                  <span>
                    <strong>{meta.label}</strong>
                    <br />
                    <span id={`hint-${id}`} className="small muted">
                      {meta.hint}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {message ? (
        <p className="notice small">
          <Icon name="checkCircle" /> {message}
        </p>
      ) : null}
      {error ? (
        <p className="notice error small">
          <Icon name="alert" /> {error}
        </p>
      ) : null}

      <div>
        <button type="submit" disabled={busy}>
          <Icon name="check" /> {busy ? 'Saving...' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}
