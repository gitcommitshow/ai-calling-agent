/**
 * Prompt assembly policy. The organizer owns the wording; this module only
 * substitutes event and guest context (when settings allow) and appends the
 * machine-readable parts that every voice backend receives.
 *
 * This renders the organizer's preview. The runner assembles the same text in
 * apps/server/src/runner/prompt.ts, because it works long after the request
 * returned, so a change here belongs in both.
 */
import type { OrgSettings, ContextFieldId } from './settings';
import type { Campaign, CaptureField, Event, Guest } from './types';

export interface PromptContext {
  event: Event;
  campaign: Campaign;
  guest: Guest | Pick<Guest, 'name' | 'ticketName' | 'approvalStatus' | 'email' | 'phone' | 'attributes'>;
  settings: OrgSettings;
}

const LANGUAGE_NAMES: Record<Campaign['language'], string> = {
  en: 'English',
  hi: 'Hindi',
};

/** Placeholders the organizer can use. Gated ones stay unsubstituted when off. */
export const PROMPT_PLACEHOLDERS = [
  '{{event.name}}',
  '{{event.startsAt}}',
  '{{event.endsAt}}',
  '{{guest.name}}',
  '{{guest.firstName}}',
  '{{guest.ticketName}}',
  '{{guest.email}}',
  '{{guest.phone}}',
] as const;

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
export function effectivePrompt(campaign: Campaign, settings: OrgSettings): string {
  if (campaign.useMasterPrompt) {
    return settings.masterPrompts[campaign.type];
  }
  return campaign.prompt;
}

/** Replace placeholders, skipping any whose context field is gated off. */
export function fillPlaceholders(prompt: string, ctx: PromptContext): string {
  const { event, guest, settings } = ctx;
  const values: Partial<Record<string, string>> = {};
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
  if (allowed(settings, 'guest.email') && 'email' in guest && guest.email) {
    values['guest.email'] = guest.email;
  }
  if (allowed(settings, 'guest.phone') && 'phone' in guest && guest.phone) {
    values['guest.phone'] = guest.phone;
  }

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
  if (allowed(settings, 'guest.email') && 'email' in guest && guest.email) {
    lines.push(`- Email: ${guest.email}`);
  }
  if (allowed(settings, 'guest.approvalStatus') && 'approvalStatus' in guest) {
    lines.push(`- Approval status: ${guest.approvalStatus}`);
  }
  if (allowed(settings, 'guest.phone') && 'phone' in guest && guest.phone) {
    lines.push(`- Phone: ${guest.phone}`);
  }
  if (allowed(settings, 'guest.attributes') && 'attributes' in guest && guest.attributes) {
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
