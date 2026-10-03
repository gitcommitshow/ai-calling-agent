'use client';

/**
 * Agent hangup controls. The status is the ElevenLabs agent's End call tool,
 * and saving writes that agent. The rest of the settings form does not.
 */
import { useState } from 'react';
import { Icon } from './Icon';
import { SettingHint } from './SettingHint';
import {
  DEFAULT_HANGUP_DESCRIPTION,
  HANGUP_DESCRIPTION_MAX,
  type VoiceHangupStatus,
} from '../domain/settings';

interface Props {
  initial: VoiceHangupStatus;
}

/** Show the default sentence when the agent has no custom instruction yet. */
function displayDescription(description: string): string {
  return description.trim() ? description : DEFAULT_HANGUP_DESCRIPTION;
}

/** What the agent is allowed to do right now, plus a note when the form differs. */
function statusText(enabled: boolean, description: string, dirty: boolean): string {
  const trimmed = description.trim();
  const base = enabled
    ? !trimmed || trimmed === DEFAULT_HANGUP_DESCRIPTION
      ? 'On. The agent hangs up after goodbye.'
      : 'On. The agent can hang up, using the custom instructions saved on it.'
    : 'Off. The agent cannot hang up. The line stays up until the guest is quiet or the call hits its maximum length.';
  return dirty ? `${base} You have unsaved changes.` : base;
}

export function AgentHangupSettings({ initial }: Props) {
  const [savedEnabled, setSavedEnabled] = useState(initial.available && initial.enabled);
  const [savedDescription, setSavedDescription] = useState(displayDescription(initial.description));
  const [enabled, setEnabled] = useState(initial.available && initial.enabled);
  const [description, setDescription] = useState(displayDescription(initial.description));
  const [needsDefaultWrite, setNeedsDefaultWrite] = useState(
    initial.available && initial.enabled && !initial.description.trim(),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initial.available ? null : initial.error);
  const [busy, setBusy] = useState(false);

  const dirty = enabled !== savedEnabled || description !== savedDescription || needsDefaultWrite;
  const locked = !initial.available || busy;

  async function save() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch('/api/settings/voice-hangup', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled, description }),
      });
      const payload = (await response.json()) as {
        error?: string;
        voiceHangup?: VoiceHangupStatus;
      };
      if (!response.ok || !payload.voiceHangup?.available) {
        throw new Error(payload.error ?? payload.voiceHangup?.error ?? 'could not save agent hangup');
      }
      const saved = payload.voiceHangup;
      setSavedEnabled(saved.enabled);
      setSavedDescription(displayDescription(saved.description));
      setEnabled(saved.enabled);
      setDescription(displayDescription(saved.description));
      setNeedsDefaultWrite(false);
      setMessage('Agent hangup saved. The next ElevenLabs call uses it.');
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <div>
        <h2>Agent hangup</h2>
        <SettingHint detail="Stored on the ElevenLabs agent, not with the other settings on this page. Save it with the button in this card. A call already connected keeps the tool it started with. Fake voice never uses it.">
          Whether the agent may hang up, and the instructions for when it should.
        </SettingHint>
      </div>

      {initial.available ? (
        <p className="small" id="agent-hangup-status">
          {statusText(savedEnabled, savedDescription, dirty)}
        </p>
      ) : null}
      {initial.agentId ? (
        <p className="small muted">ElevenLabs agent {initial.agentId}</p>
      ) : null}

      <label
        className="meta-row"
        style={{
          cursor: locked ? 'default' : 'pointer',
          color: 'inherit',
          alignItems: 'flex-start',
        }}
      >
        <input
          id="agent-can-hang-up"
          type="checkbox"
          checked={enabled}
          disabled={locked}
          aria-describedby={initial.available ? 'agent-hangup-status' : undefined}
          onChange={(changeEvent) => setEnabled(changeEvent.target.checked)}
        />
        <span>
          <strong>Let the agent end the call</strong>
          <br />
          <span className="small muted">
            After it says goodbye, the agent hangs up by using this tool.
          </span>
        </span>
      </label>

      <div>
        <label htmlFor="hangup-description">When the agent should hang up</label>
        <textarea
          id="hangup-description"
          className="compact"
          value={description}
          maxLength={HANGUP_DESCRIPTION_MAX}
          disabled={locked || !enabled}
          placeholder={DEFAULT_HANGUP_DESCRIPTION}
          onChange={(changeEvent) => setDescription(changeEvent.target.value)}
        />
        <SettingHint detail="The default tells the agent to hang up after it says goodbye. Your own text replaces that. Turning the tool off removes the instructions from the agent. A blank save is stored as the default.">
          The default is: the agent hangs up after goodbye. Your own text replaces that, and is
          saved only while the tool is on.
        </SettingHint>
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
        <button type="button" onClick={save} disabled={locked || !dirty}>
          <Icon name="check" /> {busy ? 'Saving...' : 'Save agent hangup'}
        </button>
      </div>
    </section>
  );
}
