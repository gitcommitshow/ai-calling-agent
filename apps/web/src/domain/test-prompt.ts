/**
 * Pipeline-test prompt preview. Mirrors apps/server/src/runner/test-prompt.ts
 * so the organizer sees the text the call will use (DESIGN D5).
 */
import type { OrgSettings } from './settings';
import type {
  Campaign,
  CampaignType,
  CaptureField,
  Event,
  Guest,
  Language,
  TestCallPromptSource,
} from './types';
import { assemblePrompt } from './prompt';

/** Global one-click script: no guest and no event, so placeholders stay unused. */
export const PIPELINE_TEST_PROMPT = `You are placing a pipeline test call. There is no guest and no event.

Introduce yourself as a test of the calling system. Confirm the person can hear you, then ask them to say a short sentence so speech recognition can be checked.
Keep the call under one minute. If they want to end it, thank them and hang up. Do not invent event details.`;

/** In-memory stand-in so an event test fills placeholders without a real guest. */
export function standInGuest(): Pick<
  Guest,
  'name' | 'ticketName' | 'approvalStatus' | 'email' | 'phone' | 'attributes'
> {
  return {
    name: 'Test attendee',
    ticketName: null,
    approvalStatus: 'unknown',
    email: null,
    phone: '',
    attributes: {},
  };
}

/** Campaign-shaped record used only to preview assemblePrompt for a test. */
function syntheticCampaign(
  event: Event,
  prompt: string,
  useMasterPrompt: boolean,
  type: CampaignType,
  language: Language,
  fields: CaptureField[],
): Campaign {
  return {
    id: 'pipeline-test',
    eventId: event.id,
    type,
    name: 'Pipeline test',
    prompt,
    useMasterPrompt,
    language,
    fields,
    callingWindow: { start: '00:00', end: '23:59', timezone: event.timezone },
    retryCap: 1,
    voiceBackendOrder: ['elevenlabs'],
    queue: [],
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

/** The exact text a pipeline test hands the voice backend. */
export function assembleTestPrompt(ctx: {
  promptSource: TestCallPromptSource;
  event: Event | null;
  campaign: Campaign | null;
  settings: OrgSettings;
  language: Language;
  fields: CaptureField[];
}): string {
  const { promptSource, event, campaign, settings, language, fields } = ctx;

  if (promptSource.kind === 'builtin') return PIPELINE_TEST_PROMPT;

  if (event) {
    let resolved: Campaign;
    if (promptSource.kind === 'campaign' && campaign) {
      resolved = { ...campaign, language, fields };
    } else if (promptSource.kind === 'master') {
      resolved = syntheticCampaign(event, '', true, promptSource.campaignType, language, fields);
    } else if (promptSource.kind === 'custom') {
      resolved = syntheticCampaign(
        event,
        promptSource.prompt,
        false,
        'pre-event',
        language,
        fields,
      );
    } else {
      resolved = syntheticCampaign(event, '', true, 'pre-event', language, fields);
    }
    return assemblePrompt({ event, campaign: resolved, guest: standInGuest(), settings });
  }

  if (promptSource.kind === 'custom') return promptSource.prompt.trim();
  if (promptSource.kind === 'master') {
    return settings.masterPrompts[promptSource.campaignType].trim();
  }
  return PIPELINE_TEST_PROMPT;
}
