/**
 * Record id generation. Guest ids are derived from the source row so that
 * re-importing the same CSV keeps campaign queues pointing at the same guests.
 */
import { createHash, randomUUID } from 'node:crypto';

/** Reduce arbitrary text to a safe, readable path segment. */
export function slugify(text: string, maxLength = 40): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
  return slug.replace(/-+$/g, '');
}

function shortHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 10);
}

/** `event.name` plus entropy, so folders are recognizable but never collide. */
export function newEventId(name: string): string {
  const slug = slugify(name) || 'event';
  return `${slug}-${randomUUID().slice(0, 8)}`;
}

export function newCampaignId(type: string): string {
  return `${slugify(type) || 'campaign'}-${randomUUID().slice(0, 8)}`;
}

export function newAttemptId(startedAt: string): string {
  return timestampedId(startedAt);
}

export function newRunId(startedAt: string): string {
  return `run-${timestampedId(startedAt)}`;
}

/** Sortable id for a pipeline test call, stored outside event folders. */
export function newTestCallId(startedAt: string): string {
  return `test-${timestampedId(startedAt)}`;
}

/** Sortable id: the instant, then entropy, so folder listings read in order. */
function timestampedId(iso: string): string {
  return `${iso.replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

/** Stable id for an imported guest, preferring the platform's own id. */
export function guestIdFor(input: {
  sourceId?: string | null;
  email?: string | null;
  phone: string;
}): string {
  const key = input.sourceId?.trim() || input.email?.trim().toLowerCase() || input.phone;
  const slug = slugify(key, 24);
  return slug ? `${slug}-${shortHash(key)}` : shortHash(key);
}
