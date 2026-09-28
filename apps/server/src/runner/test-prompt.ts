/**
 * Pipeline-test prompt assembly. Mirrors apps/web/src/domain/test-prompt.ts:
 * the preview and the live call must show the same text (DESIGN D5).
 */
import type { OrgSettings } from '../storage/settings.ts';
import type {
  CampaignRecord,
  CampaignType,
  CaptureField,
  EventRecord,
  GuestRecord,
  Language,
  TestCallPromptSource,
} from '../storage/types.ts';
import { assemblePrompt } from './prompt.ts';

/** Global one-click script: no guest and no event, so placeholders stay unused. */
export const PIPELINE_TEST_PROMPT = `You are placing a pipeline test call. There is no guest and no event.

Introduce yourself as a test of the calling system. Confirm the person can hear you, then ask them to say a short sentence so speech recognition can be checked.
Keep the call under one minute. If they want to end it, thank them and hang up. Do not invent event details.`;

/** In-memory stand-in so an event test fills placeholders without a real guest. */
export function standInGuest(): GuestRecord {
  return {
    id: 'test-attendee',
    sourceId: null,
    name: 'Test attendee',
    email: null,
    phone: '',
    approvalStatus: 'unknown',
    ticketName: null,
    checkedInAt: null,
    registeredAt: null,
    attributes: {},
  };
}

export interface TestPromptContext {
  promptSource: TestCallPromptSource;
  event: EventRecord | null;
  campaign: CampaignRecord | null;
  settings: OrgSettings;
  language: Language;
  fields: CaptureField[];
}

/** Campaign-shaped record used only to run assemblePrompt for a test. */
function syntheticCampaign(
  event: EventRecord,
  prompt: string,
  useMasterPrompt: boolean,
  type: CampaignType,
  language: Language,
  fields: CaptureField[],
): CampaignRecord {
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
export function assembleTestPrompt(ctx: TestPromptContext): string {
  const { promptSource, event, campaign, settings, language, fields } = ctx;

  if (promptSource.kind === 'builtin') return PIPELINE_TEST_PROMPT;

  if (event) {
    let resolved: CampaignRecord;
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
