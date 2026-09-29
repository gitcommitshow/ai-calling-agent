/**
 * Which icon stands next to which status or outcome word. Kept in one place so
 * the guest list and the results page never disagree.
 */
import type { IconName } from './Icon';
import type { ApprovalStatus, CallOutcome } from '../domain/types';

export const APPROVAL_STATUS_ICONS: Record<ApprovalStatus, IconName> = {
  approved: 'checkCircle',
  pending_approval: 'clock',
  invited: 'mail',
  waitlist: 'list',
  declined: 'xCircle',
  unknown: 'minusCircle',
};

export const CALL_OUTCOME_ICONS: Record<CallOutcome, IconName> = {
  answered: 'phone',
  no_answer: 'phoneOff',
  voicemail: 'voicemail',
  declined: 'xCircle',
  hung_up: 'phoneOff',
  failed: 'alert',
};
