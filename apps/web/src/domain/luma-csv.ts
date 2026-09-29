/**
 * Luma guest CSV import: header mapping, status preservation, and the skip
 * report the organizer sees. Unknown columns (custom registration questions)
 * are kept as guest attributes so nothing from the export is lost.
 */
import Papa from 'papaparse';
import { normalizeIndianPhone } from './phone';
import type { ApprovalStatus, GuestPayload } from './types';

/** Canonical fields we read out of a Luma export. */
type KnownField =
  | 'sourceId'
  | 'name'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'approvalStatus'
  | 'ticketName'
  | 'checkedInAt'
  | 'registeredAt';

const HEADER_MAP: Record<string, KnownField> = {
  api_id: 'sourceId',
  guest_api_id: 'sourceId',
  guest_id: 'sourceId',
  name: 'name',
  full_name: 'name',
  first_name: 'firstName',
  last_name: 'lastName',
  email: 'email',
  email_address: 'email',
  phone_number: 'phone',
  phone: 'phone',
  approval_status: 'approvalStatus',
  status: 'approvalStatus',
  ticket_name: 'ticketName',
  ticket_type: 'ticketName',
  checked_in_at: 'checkedInAt',
  check_in_at: 'checkedInAt',
  created_at: 'registeredAt',
  registered_at: 'registeredAt',
  registration_date: 'registeredAt',
};

const STATUS_MAP: Record<string, ApprovalStatus> = {
  approved: 'approved',
  going: 'approved',
  pending_approval: 'pending_approval',
  pending: 'pending_approval',
  invited: 'invited',
  waitlist: 'waitlist',
  waitlisted: 'waitlist',
  declined: 'declined',
  not_going: 'declined',
};

export interface SkippedRow {
  row: number;
  name: string;
  reason: string;
}

export interface LumaImportResult {
  guests: GuestPayload[];
  totalRows: number;
  skippedWithoutPhone: number;
  skipped: SkippedRow[];
  duplicateRows: number;
  parseErrors: string[];
}

/** Headers differ in case and punctuation between exports, so normalize first. */
function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Accept both the API values (`pending_approval`) and the UI labels (`Pending`). */
export function mapApprovalStatus(raw: string | undefined): ApprovalStatus {
  if (!raw) return 'unknown';
  return STATUS_MAP[normalizeHeader(raw)] ?? 'unknown';
}

function toIsoOrNull(raw: string | undefined): string | null {
  if (!raw || raw.trim() === '') return null;
  const date = new Date(raw.trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function blankToNull(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/** A ragged CSV row can hand us a non-string cell, so coerce before mapping. */
function cellText(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (Array.isArray(raw)) return raw.join(' ').trim();
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return '';
}

/** Map already-parsed CSV rows to guest payloads plus the skip report. */
export function mapLumaRows(rows: Record<string, unknown>[]): LumaImportResult {
  const guests: GuestPayload[] = [];
  const skipped: SkippedRow[] = [];
  const seen = new Set<string>();
  let skippedWithoutPhone = 0;
  let duplicateRows = 0;

  rows.forEach((row, index) => {
    const known: Partial<Record<KnownField, string>> = {};
    const attributes: Record<string, string> = {};

    for (const [header, raw] of Object.entries(row)) {
      const value = cellText(raw);
      if (!value) continue;

      const field = HEADER_MAP[normalizeHeader(header)];
      if (field) {
        known[field] = value;
      } else {
        attributes[header.trim()] = value;
      }
    }

    const name =
      known.name ?? [known.firstName, known.lastName].filter(Boolean).join(' ').trim();
    const displayName = name || known.email || 'Unknown guest';

    const { phone, reason } = normalizeIndianPhone(known.phone);
    if (!phone) {
      skippedWithoutPhone += 1;
      skipped.push({ row: index + 2, name: displayName, reason: reason ?? 'no phone number' });
      return;
    }

    const dedupeKey = known.sourceId ?? known.email?.toLowerCase() ?? phone;
    if (seen.has(dedupeKey)) {
      duplicateRows += 1;
      return;
    }
    seen.add(dedupeKey);

    guests.push({
      sourceId: blankToNull(known.sourceId),
      name: displayName,
      email: blankToNull(known.email),
      phone,
      approvalStatus: mapApprovalStatus(known.approvalStatus),
      ticketName: blankToNull(known.ticketName),
      checkedInAt: toIsoOrNull(known.checkedInAt),
      registeredAt: toIsoOrNull(known.registeredAt),
      attributes,
    });
  });

  return {
    guests,
    totalRows: rows.length,
    skippedWithoutPhone,
    skipped,
    duplicateRows,
    parseErrors: [],
  };
}

/**
 * Parse a Luma CSV export. Papa Parse handles the quoted commas and line breaks
 * that show up in custom question answers.
 */
export function parseLumaCsv(text: string): LumaImportResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  const result = mapLumaRows(parsed.data.filter((row) => row && typeof row === 'object'));
  return {
    ...result,
    parseErrors: parsed.errors.slice(0, 5).map((error) => `row ${error.row ?? '?'}: ${error.message}`),
  };
}
