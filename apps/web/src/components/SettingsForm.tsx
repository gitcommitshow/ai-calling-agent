'use client';

/**
 * Org settings editor: master prompts per campaign type, and the allowlist of
 * guest/event fields that may reach a voice backend. Campaigns can still opt
 * out of the master prompt and write their own.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import {
  CONTEXT_FIELD_IDS,
  CONTEXT_FIELD_META,
  type ContextFieldId,
  type OrgSettings,
} from '../domain/settings';
import type { CampaignType } from '../domain/types';
import { normalizeIndianPhone } from '../domain/phone';

interface Props {
  initial: OrgSettings;
}

export function SettingsForm({ initial }: Props) {
  const router = useRouter();
  const [preEvent, setPreEvent] = useState(initial.masterPrompts['pre-event']);
  const [postEvent, setPostEvent] = useState(initial.masterPrompts['post-event']);
  const [testNumber, setTestNumber] = useState(initial.testNumber ?? '');
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
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'could not save settings');
      setMessage('Settings saved. Campaigns using the master prompt pick this up on the next call.');
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
          <h2>Master prompts</h2>
          <p className="small muted">
            Used by every campaign that has &quot;use master prompt&quot; on. Edit once here instead of
            per event. Campaigns can still override with a custom prompt.
          </p>
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
          <p className="small muted">
            Only checked fields are substituted into placeholders or appended as call context.
            Unchecked fields never leave this app for the voice backend. Phone is off by default.
          </p>
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
