'use client';

/**
 * Org settings editor: agent personality, master prompts, context allowlist, dialing defaults,
 * runtime call limits, and the models and providers every live call uses.
 */
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AgentHangupSettings } from './AgentHangupSettings';
import { Icon } from './Icon';
import { SettingHint } from './SettingHint';
import {
  AGENT_PERSONALITY_MAX,
  CONTEXT_FIELD_IDS,
  CONTEXT_FIELD_META,
  EXTRACTION_PROVIDERS,
  TELEPHONY_PROVIDERS,
  VOICE_PROVIDERS,
  type CallingHoursMode,
  type ContextFieldId,
  type OrgSettings,
  type ProviderAvailability,
  type TelephonyProviderId,
  type VoiceHangupStatus,
  type VoiceProviderId,
} from '../domain/settings';
import type { CampaignType } from '../domain/types';
import { normalizeIndianPhone } from '../domain/phone';
import { clampGuestAttempts, MAX_GUEST_ATTEMPTS } from '../domain/retry-cap';

interface Props {
  initial: OrgSettings;
  /** Read from the server environment. The organizer cannot change it here. */
  callingHoursMode: CallingHoursMode;
  /** Which providers already have a key. Null when the server did not report it. */
  providerAvailability: ProviderAvailability | null;
  /** End call tool on the ElevenLabs agent. Saved apart from the rest of this form. */
  voiceHangup: VoiceHangupStatus;
}

/** Suggested model for a provider, used when the current model is still a default. */
function suggestedModel(provider: string): string | null {
  return EXTRACTION_PROVIDERS.find((option) => option.id === provider)?.suggestedModel ?? null;
}

export function SettingsForm({
  initial,
  callingHoursMode,
  providerAvailability,
  voiceHangup,
}: Props) {
  const router = useRouter();
  const [personality, setPersonality] = useState(initial.agentPersonality);
  const [preEvent, setPreEvent] = useState(initial.masterPrompts['pre-event']);
  const [postEvent, setPostEvent] = useState(initial.masterPrompts['post-event']);
  const [testNumber, setTestNumber] = useState(initial.testNumber ?? '');
  const [windowStart, setWindowStart] = useState(initial.callingWindow.start);
  const [windowEnd, setWindowEnd] = useState(initial.callingWindow.end);
  const [retryCap, setRetryCap] = useState(clampGuestAttempts(initial.retryCap));
  const [silenceSeconds, setSilenceSeconds] = useState(initial.silenceSeconds);
  const [maxCallSeconds, setMaxCallSeconds] = useState(initial.maxCallSeconds);
  const [dialTimeoutSeconds, setDialTimeoutSeconds] = useState(initial.dialTimeoutSeconds);
  const [openingWaitSeconds, setOpeningWaitSeconds] = useState(initial.openingWaitSeconds);
  const [noResponseSeconds, setNoResponseSeconds] = useState(initial.noResponseSeconds);
  const [telephonyProvider, setTelephonyProvider] = useState<TelephonyProviderId>(
    initial.telephonyProvider,
  );
  const [voiceProvider, setVoiceProvider] = useState<VoiceProviderId>(initial.voiceProvider);
  const [extractionProvider, setExtractionProvider] = useState(initial.extraction.provider);
  const [extractionModel, setExtractionModel] = useState(initial.extraction.model);
  const [contextFields, setContextFields] = useState<ContextFieldId[]>(initial.contextFields);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function changeExtractionProvider(next: string) {
    const previousSuggestion = suggestedModel(extractionProvider);
    const nextSuggestion = suggestedModel(next);
    setExtractionProvider(next);
    if (nextSuggestion && (extractionModel.trim() === '' || extractionModel === previousSuggestion)) {
      setExtractionModel(nextSuggestion);
    }
  }

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
      if (openingWaitSeconds >= noResponseSeconds) {
        throw new Error(
          'The wait before the agent speaks must be shorter than the hangup if the guest never speaks.',
        );
      }
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentPersonality: personality,
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
          openingWaitSeconds,
          noResponseSeconds,
          extraction: { provider: extractionProvider, model: extractionModel.trim() },
          voiceProvider,
          telephonyProvider,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'could not save settings');
      setMessage(
        'Settings saved. New campaigns pick up dialing defaults. The personality, call limits, and model choices apply on the next dial.',
      );
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
          <h2>Models and providers</h2>
          <SettingHint detail="API keys stay in the server environment and are never saved here. A choice saved on this page is what the next call uses, even when the environment still names a different model. A call already connected keeps its carrier and voice. The transcript is read with the model saved when the call ends.">
            Used on the next call. Keys stay on the server.
          </SettingHint>
        </div>
        <div className="grid">
          <div>
            <label htmlFor="telephony-provider">Telephony</label>
            <select
              id="telephony-provider"
              value={telephonyProvider}
              onChange={(changeEvent) =>
                setTelephonyProvider(changeEvent.target.value as TelephonyProviderId)
              }
            >
              {TELEPHONY_PROVIDERS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="voice-provider">Voice</label>
            <select
              id="voice-provider"
              value={voiceProvider}
              onChange={(changeEvent) =>
                setVoiceProvider(changeEvent.target.value as VoiceProviderId)
              }
            >
              {VOICE_PROVIDERS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="extraction-provider">Transcript model provider</label>
            <select
              id="extraction-provider"
              value={extractionProvider}
              onChange={(changeEvent) => changeExtractionProvider(changeEvent.target.value)}
            >
              {extractionOptions(extractionProvider, extractionModel).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="extraction-model">Transcript model</label>
            <input
              id="extraction-model"
              value={extractionModel}
              required
              list="extraction-model-suggestions"
              spellCheck={false}
              onChange={(changeEvent) => setExtractionModel(changeEvent.target.value)}
            />
            <datalist id="extraction-model-suggestions">
              {EXTRACTION_PROVIDERS.map((option) => (
                <option key={option.id} value={option.suggestedModel} />
              ))}
            </datalist>
            <p className="small muted">
              {suggestedModel(extractionProvider)
                ? `The id ${extractionProvider} expects, such as ${suggestedModel(extractionProvider)}.`
                : `The id ${extractionProvider} expects.`}
            </p>
          </div>
        </div>
        <ProviderNotices
          telephonyProvider={telephonyProvider}
          voiceProvider={voiceProvider}
          extractionProvider={extractionProvider}
          providerAvailability={providerAvailability}
        />
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
            <div className="attempt-slider">
              <input
                id="org-retry-cap"
                type="range"
                min={1}
                max={MAX_GUEST_ATTEMPTS}
                step={1}
                value={retryCap}
                onChange={(changeEvent) =>
                  setRetryCap(clampGuestAttempts(Number(changeEvent.target.value)))
                }
              />
              <span className="attempt-slider-value">{retryCap}</span>
            </div>
            <SettingHint detail={`New campaigns copy this number. At most ${MAX_GUEST_ATTEMPTS}. Each campaign can raise or lower its own retry cap afterward. The campaign value is what the runner checks.`}>
              Seed for new campaigns. The campaign&apos;s own retry cap is enforced at dial time.
            </SettingHint>
          </div>
        </div>
      </section>

      <section className="card stack">
        <div>
          <h2>Live call limits</h2>
          <SettingHint detail="These apply to every guest call and pipeline test. Campaigns cannot override them. Changing a value affects the next dial, not a call already on the line. The opening wait must be shorter than the hangup for a guest who never speaks. After the guest has spoken, the silence limit hangs up a quiet line. When the agent hangup tool is off, or the agent never uses it, these limits are what drops the line.">
            Enforced on every live call. Campaign settings cannot override these.
          </SettingHint>
        </div>
        <div className="grid">
          <div>
            <label htmlFor="opening-wait-seconds">Wait before the agent speaks (seconds)</label>
            <input
              id="opening-wait-seconds"
              type="number"
              min={1}
              max={30}
              value={openingWaitSeconds}
              required
              onChange={(changeEvent) => setOpeningWaitSeconds(Number(changeEvent.target.value))}
            />
            <SettingHint detail="From the moment the guest answers. If they speak sooner, the agent replies to them and does not also start its own greeting.">
              If the guest is still quiet, the agent starts the call.
            </SettingHint>
          </div>
          <div>
            <label htmlFor="no-response-seconds">Hang up if the guest never speaks (seconds)</label>
            <input
              id="no-response-seconds"
              type="number"
              min={5}
              max={120}
              value={noResponseSeconds}
              required
              onChange={(changeEvent) => setNoResponseSeconds(Number(changeEvent.target.value))}
            />
            <SettingHint detail="Also measured from the answer. This must be longer than the wait before the agent speaks. After the guest has spoken, Silence before hangup takes over.">
              A pickup with no guest speech ends at this time.
            </SettingHint>
          </div>
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

      <AgentHangupSettings initial={voiceHangup} />

      <section className="card stack">
        <div>
          <h2>Agent personality</h2>
          <SettingHint detail="Added to every guest call and every event test, including a campaign that uses its own prompt. Leave it blank to add no extra style. Event facts, timing, and place belong in the master prompts and the event brief, not here.">
            How the agent talks on every call. Tone and length only. Event facts stay in the prompts
            below.
          </SettingHint>
        </div>

        <div>
          <label htmlFor="agent-personality">Personality</label>
          <textarea
            id="agent-personality"
            value={personality}
            maxLength={AGENT_PERSONALITY_MAX}
            onChange={(changeEvent) => setPersonality(changeEvent.target.value)}
          />
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

/** Catalog plus the saved provider when it is a custom slug. */
function extractionOptions(provider: string, model: string) {
  if (EXTRACTION_PROVIDERS.some((option) => option.id === provider)) return EXTRACTION_PROVIDERS;
  return [
    { id: provider, label: provider, suggestedModel: model, keyVariable: 'EXTRACTION_API_KEY' },
    ...EXTRACTION_PROVIDERS,
  ];
}

/**
 * Warnings for the current choice: a fake provider will not place a real call,
 * and a real provider with no key on this server will fail the next dial.
 */
function ProviderNotices({
  telephonyProvider,
  voiceProvider,
  extractionProvider,
  providerAvailability,
}: {
  telephonyProvider: TelephonyProviderId;
  voiceProvider: VoiceProviderId;
  extractionProvider: string;
  providerAvailability: ProviderAvailability | null;
}) {
  const extraction = EXTRACTION_PROVIDERS.find((option) => option.id === extractionProvider);
  const keyReady = providerAvailability
    ? providerAvailability.extraction[extractionProvider] === true
    : null;
  const keyVariable = extraction?.keyVariable;

  return (
    <div className="stack">
      {telephonyProvider === 'fake' ? (
        <p className="notice">
          <Icon name="alert" /> Fake telephony does not dial a phone. Use it to try the app on this
          machine.
        </p>
      ) : null}
      {telephonyProvider === 'plivo' && providerAvailability && !providerAvailability.telephony.plivo ? (
        <p className="notice error">
          <Icon name="alert" /> Plivo needs PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, PLIVO_CALLER_ID, and an
          https PUBLIC_BASE_URL. Restart the server after setting them.
        </p>
      ) : null}
      {voiceProvider === 'fake' ? (
        <p className="notice">
          <Icon name="alert" /> Fake voice does not call ElevenLabs. It speaks a short script on this
          machine.
        </p>
      ) : null}
      {voiceProvider === 'elevenlabs' &&
      providerAvailability &&
      !providerAvailability.voice.elevenlabs ? (
        <p className="notice error">
          <Icon name="alert" /> ElevenLabs needs ELEVENLABS_API_KEY and ELEVENLABS_AGENT_ID. Restart
          the server after setting them.
        </p>
      ) : null}
      {extractionProvider === 'ollama' ? (
        <p className="small muted">Ollama runs on this machine and does not need an API key.</p>
      ) : null}
      {extractionProvider !== 'ollama' && keyReady === false ? (
        <p className="notice error">
          <Icon name="alert" />{' '}
          {keyVariable
            ? `${extraction?.label ?? extractionProvider} needs ${keyVariable} or EXTRACTION_API_KEY in the server environment. Restart after adding it.`
            : `${extractionProvider} needs EXTRACTION_API_KEY in the server environment. Restart after adding it.`}
        </p>
      ) : null}
    </div>
  );
}
