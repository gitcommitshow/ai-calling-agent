/**
 * Default campaign templates. These are product decisions, so they live in the
 * web app: the server only stores whatever campaign it is handed. Field sets are
 * a starting point and stay editable per campaign. Calling hours and retry cap
 * come from org settings when those are passed in.
 */
import type { OrgSettings } from './settings';
import type { CallingWindow, CampaignType, CaptureField, Language, VoiceBackend } from './types';

export interface CampaignTemplate {
  type: CampaignType;
  name: string;
  prompt: string;
  useMasterPrompt: boolean;
  /** Empty for the two campaigns an event starts with. */
  purpose: string;
  language: Language;
  fields: CaptureField[];
  callingWindow: CallingWindow;
  retryCap: number;
  voiceBackendOrder: VoiceBackend[];
  queue: string[];
}

export interface CampaignTemplateDefaults {
  callingWindow: CallingWindow;
  retryCap: number;
}

const FALLBACK_DEFAULTS: CampaignTemplateDefaults = {
  callingWindow: { start: '10:00', end: '20:00', timezone: 'Asia/Kolkata' },
  retryCap: 1,
};

const DEFAULT_BACKEND_ORDER: VoiceBackend[] = ['elevenlabs', 'cascaded'];

const PRE_EVENT_PROMPT = `You are calling {{guest.firstName}} on behalf of the organizer of {{event.name}}.

Introduce yourself in one sentence and say it starts on {{event.startsAt}}. Share the facts from the event brief when they help.
Ask once whether they plan to attend. If they ask a question, answer it from that brief.
Keep the call under two minutes and stay polite if they want to end it.`;

const POST_EVENT_PROMPT = `You are calling {{guest.firstName}} on behalf of the organizer of {{event.name}}, which ended on {{event.endsAt}}.

Thank them, confirm whether they made it, and ask for one piece of feedback. If they ask about the event, answer from the event brief.
Keep the call under two minutes and stay polite if they want to end it.`;

/** Defaults new campaigns copy from org settings, with a safe fallback. */
export function templateDefaultsFromSettings(
  settings?: Pick<OrgSettings, 'callingWindow' | 'retryCap'> | null,
): CampaignTemplateDefaults {
  if (!settings) return { ...FALLBACK_DEFAULTS, callingWindow: { ...FALLBACK_DEFAULTS.callingWindow } };
  return {
    callingWindow: { ...settings.callingWindow },
    retryCap: settings.retryCap,
  };
}

export function campaignTemplates(
  settings?: Pick<OrgSettings, 'callingWindow' | 'retryCap'> | null,
): CampaignTemplate[] {
  const defaults = templateDefaultsFromSettings(settings);
  return [
    {
      type: 'pre-event',
      name: 'Pre-event reminder',
      prompt: PRE_EVENT_PROMPT,
      useMasterPrompt: true,
      purpose: '',
      language: 'en',
      fields: [
        {
          key: 'will_attend',
          label: 'Will the guest attend?',
          kind: 'enum',
          options: ['yes', 'no', 'maybe'],
        },
      ],
      callingWindow: { ...defaults.callingWindow },
      retryCap: defaults.retryCap,
      voiceBackendOrder: [...DEFAULT_BACKEND_ORDER],
      queue: [],
    },
    {
      type: 'post-event',
      name: 'Post-event follow-up',
      prompt: POST_EVENT_PROMPT,
      useMasterPrompt: true,
      purpose: '',
      language: 'en',
      fields: [
        { key: 'attended', label: 'Did the guest attend?', kind: 'boolean' },
        { key: 'feedback', label: 'Feedback in the guest\'s words', kind: 'text' },
      ],
      callingWindow: { ...defaults.callingWindow },
      retryCap: defaults.retryCap,
      voiceBackendOrder: [...DEFAULT_BACKEND_ORDER],
      queue: [],
    },
  ];
}
