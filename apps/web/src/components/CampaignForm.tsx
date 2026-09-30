'use client';

/**
 * Campaign editor: prompt source (master vs custom), language, capture fields,
 * calling window, retry cap. The preview respects org context gates so it
 * matches what the voice backend will actually see.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { Icon } from './Icon';
import { SettingHint } from './SettingHint';
import { assemblePrompt, PROMPT_PLACEHOLDERS } from '../domain/prompt';
import { sameCallingWindow, type CallingHoursMode, type OrgSettings } from '../domain/settings';
import type { Campaign, CaptureField, Event, Guest, Language } from '../domain/types';

interface Props {
  event: Event;
  campaign: Campaign;
  settings: OrgSettings;
  /** Server env. Strict refuses outside-hours dials; soft allows a confirmed override. */
  callingHoursMode?: CallingHoursMode;
  /** A real queued guest when there is one, so the preview is representative. */
  sampleGuest: Guest | Pick<Guest, 'name' | 'ticketName' | 'approvalStatus' | 'email' | 'phone' | 'attributes'>;
}

const KINDS: CaptureField['kind'][] = ['text', 'boolean', 'enum'];

export function CampaignForm({
  event,
  campaign,
  settings,
  callingHoursMode = 'soft',
  sampleGuest,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(campaign.name);
  const [useMasterPrompt, setUseMasterPrompt] = useState(campaign.useMasterPrompt);
  const [purpose, setPurpose] = useState(campaign.purpose ?? '');
  const [prompt, setPrompt] = useState(campaign.prompt);
  const [language, setLanguage] = useState<Language>(campaign.language);
  const [fields, setFields] = useState<CaptureField[]>(campaign.fields);
  const [windowStart, setWindowStart] = useState(campaign.callingWindow.start);
  const [windowEnd, setWindowEnd] = useState(campaign.callingWindow.end);
  const [retryCap, setRetryCap] = useState(campaign.retryCap);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useMemo(
    () =>
      assemblePrompt({
        event,
        campaign: { ...campaign, prompt, purpose, useMasterPrompt, language, fields },
        guest: sampleGuest,
        settings,
      }),
    [campaign, event, fields, language, prompt, purpose, sampleGuest, settings, useMasterPrompt],
  );

  const usesOrgWindow = sameCallingWindow(
    { start: windowStart, end: windowEnd, timezone: campaign.callingWindow.timezone },
    settings.callingWindow,
  );
  const usesOrgRetry = retryCap === settings.retryCap;

  function updateField(index: number, patch: Partial<CaptureField>) {
    setFields((current) =>
      current.map((field, fieldIndex) =>
        fieldIndex === index ? { ...field, ...patch } : field,
      ),
    );
  }

  async function save(formEvent: FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaign.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          prompt,
          purpose: purpose.trim(),
          useMasterPrompt,
          language,
          fields: fields.map((field) =>
            field.kind === 'enum'
              ? { ...field, options: field.options?.filter(Boolean) ?? [] }
              : { key: field.key, label: field.label, kind: field.kind },
          ),
          callingWindow: {
            start: windowStart,
            end: windowEnd,
            timezone: campaign.callingWindow.timezone,
          },
          retryCap,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'could not save the campaign');

      setMessage('Campaign saved.');
      router.refresh();
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={save}>
      <div className="grid">
        <div>
          <label htmlFor="campaign-name">Campaign name</label>
          <input
            id="campaign-name"
            value={name}
            required
            onChange={(changeEvent) => setName(changeEvent.target.value)}
          />
        </div>
        <div>
          <label htmlFor="language">Conversation language</label>
          <select
            id="language"
            value={language}
            onChange={(changeEvent) => setLanguage(changeEvent.target.value as Language)}
          >
            <option value="en">English</option>
            <option value="hi">Hindi</option>
          </select>
        </div>
        <div>
          <label htmlFor="window-start">
            Calling window start ({campaign.callingWindow.timezone})
          </label>
          <input
            id="window-start"
            type="time"
            value={windowStart}
            required
            onChange={(changeEvent) => setWindowStart(changeEvent.target.value)}
          />
          <SettingHint
            detail={
              (usesOrgWindow
                ? 'Matches the org default in Settings. The runner enforces this campaign window. Changing it here overrides the org default for this queue only. New campaigns still copy the org value.'
                : `Overrides the org default (${settings.callingWindow.start}-${settings.callingWindow.end} ${settings.callingWindow.timezone}). The runner enforces this campaign window, not the org default. Silence hangup and max call length stay org-wide.`) +
              (callingHoursMode === 'strict'
                ? ' STRICT_CALLING_HOURS is set, so a call outside this window is refused. Unset that variable and restart the server to allow an override.'
                : ' Outside this window, a call continues only after two confirmations.')
            }
          >
            {usesOrgWindow
              ? 'Matches org default. The runner uses this campaign window.'
              : `Overrides org default (${settings.callingWindow.start}-${settings.callingWindow.end}). This campaign window wins at dial time.`}
            {callingHoursMode === 'strict'
              ? ' Strict calling hours are on.'
              : ' Outside hours needs two confirmations.'}
          </SettingHint>
        </div>
        <div>
          <label htmlFor="window-end">Calling window end</label>
          <input
            id="window-end"
            type="time"
            value={windowEnd}
            required
            onChange={(changeEvent) => setWindowEnd(changeEvent.target.value)}
          />
          <button
            type="button"
            className="secondary tiny"
            onClick={() => {
              setWindowStart(settings.callingWindow.start);
              setWindowEnd(settings.callingWindow.end);
            }}
          >
            Use org hours
          </button>
        </div>
        <div>
          <label htmlFor="retry-cap">Attempts allowed per guest</label>
          <input
            id="retry-cap"
            type="number"
            min={1}
            max={10}
            value={retryCap}
            onChange={(changeEvent) => setRetryCap(Number(changeEvent.target.value))}
          />
          <SettingHint
            detail={
              usesOrgRetry
                ? 'Matches the org default. The runner checks this campaign value before each dial.'
                : `Overrides the org default of ${settings.retryCap}. The campaign value is enforced; the org default only seeds new campaigns.`
            }
          >
            {usesOrgRetry
              ? 'Matches org default. Enforced from this campaign.'
              : `Overrides org default (${settings.retryCap}). This campaign value is enforced.`}
          </SettingHint>
        </div>
      </div>

      <div>
        <label htmlFor="campaign-purpose">Purpose of this call</label>
        <p className="small muted">
          One line added after the agent prompt. Leave it empty when the usual prompt is enough.
        </p>
        <textarea
          id="campaign-purpose"
          value={purpose}
          maxLength={500}
          rows={2}
          placeholder="Ask speakers to arrive 20 minutes early"
          onChange={(changeEvent) => setPurpose(changeEvent.target.value)}
        />
      </div>

      <div className="stack">
        <label className="meta-row" style={{ cursor: 'pointer', color: 'inherit' }}>
          <input
            type="checkbox"
            checked={useMasterPrompt}
            onChange={(changeEvent) => setUseMasterPrompt(changeEvent.target.checked)}
          />
          <span>
            Use the org master prompt for {campaign.type} campaigns
            <br />
            <span className="small muted" title="When on, the wording in Settings is what the call runs. When off, the custom prompt below replaces it for this campaign only. Context field gates in Settings still apply either way.">
              Edit the shared wording in <Link href="/settings">Settings</Link>. Turn this off to
              write a custom prompt for this event only. Context gates in Settings still apply.
            </span>
          </span>
        </label>

        {useMasterPrompt ? (
          <div>
            <label>Master prompt (read-only here)</label>
            <textarea
              value={settings.masterPrompts[campaign.type]}
              readOnly
              aria-readonly="true"
            />
          </div>
        ) : (
          <div>
            <label htmlFor="prompt">Custom prompt</label>
            <textarea
              id="prompt"
              value={prompt}
              required
              onChange={(changeEvent) => setPrompt(changeEvent.target.value)}
            />
            <p className="small muted">
              Placeholders (only filled when allowed in Settings): {PROMPT_PLACEHOLDERS.join(' ')}
            </p>
          </div>
        )}
      </div>

      <div className="stack">
        <h3>Fields to capture</h3>
        {fields.length === 0 ? <p className="empty small">No fields yet.</p> : null}
        {fields.map((field, index) => (
          <div className="row" key={`${field.key}-${index}`}>
            <div>
              <label htmlFor={`field-key-${index}`}>Key</label>
              <input
                id={`field-key-${index}`}
                value={field.key}
                onChange={(changeEvent) => updateField(index, { key: changeEvent.target.value })}
              />
            </div>
            <div>
              <label htmlFor={`field-label-${index}`}>Question</label>
              <input
                id={`field-label-${index}`}
                value={field.label}
                onChange={(changeEvent) => updateField(index, { label: changeEvent.target.value })}
              />
            </div>
            <div>
              <label htmlFor={`field-kind-${index}`}>Answer type</label>
              <select
                id={`field-kind-${index}`}
                value={field.kind}
                onChange={(changeEvent) =>
                  updateField(index, {
                    kind: changeEvent.target.value as CaptureField['kind'],
                    options:
                      changeEvent.target.value === 'enum' ? (field.options ?? ['yes', 'no']) : undefined,
                  })
                }
              >
                {KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </div>
            {field.kind === 'enum' ? (
              <div>
                <label htmlFor={`field-options-${index}`}>Options (comma separated)</label>
                <input
                  id={`field-options-${index}`}
                  value={(field.options ?? []).join(', ')}
                  onChange={(changeEvent) =>
                    updateField(index, {
                      options: changeEvent.target.value.split(',').map((option) => option.trim()),
                    })
                  }
                />
              </div>
            ) : null}
            <button
              type="button"
              className="secondary"
              onClick={() => setFields((current) => current.filter((_, i) => i !== index))}
            >
              <Icon name="xCircle" /> Remove
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              setFields((current) => [
                ...current,
                { key: `field_${current.length + 1}`, label: 'New question', kind: 'text' },
              ])
            }
          >
            <Icon name="check" /> Add field
          </button>
        </div>
      </div>

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
          <Icon name="check" /> {busy ? 'Saving...' : 'Save campaign'}
        </button>
      </div>

      <div>
        <h3>
          <Icon name="speech" /> Prompt preview for {sampleGuest.name}
        </h3>
        <p className="small muted">
          Reflects the context allowlist in Settings. Gated-off placeholders stay as{' '}
          <code>{'{{…}}'}</code>.
        </p>
        <pre className="transcript notice">{preview}</pre>
      </div>
    </form>
  );
}
