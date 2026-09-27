/**
 * Default campaign templates. These are product decisions, so they live in the
 * web app: the server only stores whatever campaign it is handed. Field sets are
 * a starting point and stay editable per campaign.
 */
import type { CampaignType, CaptureField, Language, VoiceBackend } from './types';

export interface CampaignTemplate {
  type: CampaignType;
  name: string;
  prompt: string;
  useMasterPrompt: boolean;
  language: Language;
  fields: CaptureField[];
  callingWindow: { start: string; end: string; timezone: string };
  retryCap: number;
  voiceBackendOrder: VoiceBackend[];
  queue: string[];
}

const DEFAULT_WINDOW = { start: '10:00', end: '20:00', timezone: 'Asia/Kolkata' };
const DEFAULT_BACKEND_ORDER: VoiceBackend[] = ['elevenlabs', 'cascaded'];

const PRE_EVENT_PROMPT = `You are calling {{guest.firstName}} on behalf of the organizer of {{event.name}}.

Introduce yourself as an assistant calling about the event, and say it starts on {{event.startsAt}}.
Ask whether they plan to attend. If they are unsure, ask what would help them decide.
Keep the call under two minutes and stay polite if they want to end it.`;

const POST_EVENT_PROMPT = `You are calling {{guest.firstName}} on behalf of the organizer of {{event.name}}, which ended on {{event.endsAt}}.

Thank them for their interest, confirm whether they made it to the event, and ask for one piece of feedback.
Keep the call under two minutes and stay polite if they want to end it.`;

export function campaignTemplates(): CampaignTemplate[] {
  return [
    {
      type: 'pre-event',
      name: 'Pre-event reminder',
      prompt: PRE_EVENT_PROMPT,
      useMasterPrompt: true,
      language: 'en',
      fields: [
        {
          key: 'will_attend',
          label: 'Will the guest attend?',
          kind: 'enum',
          options: ['yes', 'no', 'maybe'],
        },
      ],
      callingWindow: { ...DEFAULT_WINDOW },
      retryCap: 1,
      voiceBackendOrder: [...DEFAULT_BACKEND_ORDER],
      queue: [],
    },
    {
      type: 'post-event',
      name: 'Post-event follow-up',
      prompt: POST_EVENT_PROMPT,
      useMasterPrompt: true,
      language: 'en',
      fields: [
        { key: 'attended', label: 'Did the guest attend?', kind: 'boolean' },
        { key: 'feedback', label: 'Feedback in the guest\'s words', kind: 'text' },
      ],
      callingWindow: { ...DEFAULT_WINDOW },
      retryCap: 1,
      voiceBackendOrder: [...DEFAULT_BACKEND_ORDER],
      queue: [],
    },
  ];
}
