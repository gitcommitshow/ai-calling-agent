/**
 * Builds the exact text a call runs on: the campaign's prompt body or the org
 * master prompt, with only the context fields settings allow. The runner works
 * long after the organizer's request returned, so it assembles the prompt
 * itself instead of being handed one.
 *
 * This mirrors apps/web/src/domain/prompt.ts, which renders the organizer's
 * preview. The README promises the preview is what a call uses, so any change
 * to one belongs in the other in the same commit. There is no shared package
 * for it yet, by DESIGN D5.
 */
import type { ContextFieldId, OrgSettings } from '../storage/settings.ts';
import type { CampaignRecord, CaptureField, EventRecord, GuestRecord } from '../storage/types.ts';

export interface PromptContext {
  event: EventRecord;
  campaign: CampaignRecord;
  guest: GuestRecord;
  settings: OrgSettings;
}

const LANGUAGE_NAMES: Record<CampaignRecord['language'], string> = {
  en: 'English',
  hi: 'Hindi',
};

function formatEventTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function describeField(field: CaptureField): string {
  if (field.kind === 'enum') {
    return `- ${field.key}: ${field.label} (one of: ${(field.options ?? []).join(', ')}, or unknown)`;
  }
  if (field.kind === 'boolean') {
    return `- ${field.key}: ${field.label} (yes, no, or unknown)`;
  }
  return `- ${field.key}: ${field.label} (short text, or unknown)`;
}

function allowed(settings: OrgSettings, id: ContextFieldId): boolean {
  return settings.contextFields.includes(id);
}

/** Resolve which prompt body a campaign runs with. */
export function effectivePrompt(campaign: CampaignRecord, settings: OrgSettings): string {
  return campaign.useMasterPrompt ? settings.masterPrompts[campaign.type] : campaign.prompt;
}

/** Replace placeholders, skipping any whose context field is gated off. */
function fillPlaceholders(prompt: string, ctx: PromptContext): string {
  const { event, guest, settings } = ctx;
  const values: Record<string, string> = {};

  if (allowed(settings, 'event.name')) values['event.name'] = event.name;
  if (allowed(settings, 'event.startsAt')) {
    values['event.startsAt'] = formatEventTime(event.startsAt, event.timezone);
  }
  if (allowed(settings, 'event.endsAt')) {
    values['event.endsAt'] = formatEventTime(event.endsAt, event.timezone);
  }
  if (allowed(settings, 'guest.name')) values['guest.name'] = guest.name;
  if (allowed(settings, 'guest.firstName')) {
    values['guest.firstName'] = guest.name.split(' ')[0] ?? guest.name;
  }
  if (allowed(settings, 'guest.ticketName')) {
    values['guest.ticketName'] = guest.ticketName ?? 'guest';
  }
  if (allowed(settings, 'guest.email') && guest.email) values['guest.email'] = guest.email;
  if (allowed(settings, 'guest.phone') && guest.phone) values['guest.phone'] = guest.phone;

  return prompt.replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (match, key: string) =>
    key in values ? values[key]! : match,
  );
}

function buildContextLines(ctx: PromptContext): string[] {
  const { event, campaign, guest, settings } = ctx;
  const lines: string[] = [];

  if (allowed(settings, 'event.name')) lines.push(`- Event: ${event.name}`);
  if (allowed(settings, 'event.startsAt')) {
    lines.push(`- Starts: ${formatEventTime(event.startsAt, event.timezone)}`);
  }
  if (allowed(settings, 'event.endsAt')) {
    lines.push(`- Ends: ${formatEventTime(event.endsAt, event.timezone)}`);
  }
  if (allowed(settings, 'guest.name')) lines.push(`- Guest: ${guest.name}`);
  if (allowed(settings, 'guest.ticketName')) {
    lines.push(`- Ticket: ${guest.ticketName ?? 'not recorded'}`);
  }
  if (allowed(settings, 'guest.email') && guest.email) lines.push(`- Email: ${guest.email}`);
  if (allowed(settings, 'guest.approvalStatus')) {
    lines.push(`- Approval status: ${guest.approvalStatus}`);
  }
  if (allowed(settings, 'guest.phone') && guest.phone) lines.push(`- Phone: ${guest.phone}`);
  if (allowed(settings, 'guest.attributes')) {
    for (const [key, value] of Object.entries(guest.attributes)) {
      lines.push(`- ${key}: ${value}`);
    }
  }
  if (allowed(settings, 'campaign.language')) {
    lines.push(`- Speak in ${LANGUAGE_NAMES[campaign.language]}.`);
  }

  return lines;
}

/** The full prompt handed to a voice backend for one call. */
export function assemblePrompt(ctx: PromptContext): string {
  const { campaign, settings } = ctx;
  const sections = [fillPlaceholders(effectivePrompt(campaign, settings).trim(), ctx)];

  const contextLines = buildContextLines(ctx);
  if (contextLines.length > 0) {
    sections.push(['Call context:', ...contextLines].join('\n'));
  }

  if (allowed(settings, 'capture.fields') && campaign.fields.length > 0) {
    sections.push(
      ['Collect these answers before ending the call:', ...campaign.fields.map(describeField)].join(
        '\n',
      ),
    );
  }

  sections.push(
    'If the guest is busy or asks to end the call, thank them and hang up. Never invent event details.',
  );

  return sections.join('\n\n');
}
