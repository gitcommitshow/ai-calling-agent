# Requirements

Draft this first. Keep it short and keep it current. This file is the product source of truth. Design and implementation follow it. When behavior changes, update this file in the same change.

## Problem

Before and after an event, organizers need to reach their guests:

- Before the event, remind them, confirm whether they will attend, and nudge them to come.
- Before the event, tell them about plan or agenda changes.
- Before the event, learn preferences that affect logistics.
- After the event, confirm they attended and collect feedback.

Guest lists already live on event platforms (or as CSV exports from them). Calling everyone by hand does not scale. Answers stay incomplete and inconsistent. The organizer still needs to choose who gets called, in what order, and when.

## Users

- **Organizer (primary).** Owns an event. Imports or syncs the guest list, filters and prioritizes who to call, configures campaigns and prompts, starts calls (including one person at a time), and reads results.
- **Guest (secondary).** Someone on the event's guest list who has a phone number. May receive one call before the event and one call after it.
- **Out of scope for v1.** Inbound calls to the organizer number. Handling that comes later.
- **Phase 1 tenancy.** One organizer runs their own deployment, which may hold many events. Access control is provided by the host environment, not by the product. Multiple organizers come later.

## Goals

1. ✓ Load a guest list from an event platform or a CSV upload so the organizer does not rebuild the list by hand.
2. ✓ Let the organizer filter, prioritize, and choose who to call, including calling one person at a time.
3. ✓ Run pre-event and post-event outbound call campaigns against that chosen set.
4. ✓ Let the organizer control what the agent says and asks by editing the campaign prompt.
5. ✓ Record a structured result for every attempt, and let the organizer review it without listening to every call.
6. Write clear RSVP or attendance answers back to the event platform when supported.
7. Compare the quality of different voice approaches (all-in-one voice agent, separate speech-to-text + LLM + text-to-speech, speech-to-speech models) on real calls.
8. Keep reaching guests when one voice provider runs out of credits.

## Features

### Guest list sources

- ✓ Load guests by connecting an event platform, or by uploading a CSV.
- ✓ Sync or import: name, phone number when present, registration or approval status, email, and a stable guest id when the source provides one.
- ✓ Skip guests with no usable phone number. Surface how many were skipped.
- ✓ Custom question columns from the CSV are kept on the guest.
- **Luma first** for platform sync. Other platforms (Eventbrite, etc.) come later.
- ✓ **Phase 1 ships CSV import only.** Luma API sync and write-back follow in a later milestone.
- ✓ A CSV has no event details, so the organizer enters the event name, start time, and end time when creating an event.
- ✓ **Luma CSV:** accept Luma's guest-list CSV export ([download guest CSV](https://help.luma.com/p/download-guest-csv)). It includes name, email, phone (when provided), approval status, ticket type, check-in or join status, registration date, payment fields, and custom question columns. Preserve approval status on import. Luma statuses include at least: `approved` (Going), `pending_approval` (Pending), `invited` (Invited), `waitlist` (Waitlist), `declined` (Not Going). Check-in is separate from approval status.
- ✓ Refresh from the platform or re-upload CSV before a campaign so the call set can match the latest list.
- Write RSVP or attendance updates back when the guest's answer is clear and the platform supports it. If write-back fails, keep the local result and mark the sync as failed. CSV-only lists have no write-back target unless a platform is also connected.

### Organizer call control

- ✓ Filter the guest list before calling (for example by approval status, phone present, ticket type, or prior call outcome).
- ✓ Prioritize or reorder who is dialed next.
- ✓ Select a subset to call, or call a single guest at a time.
- ✓ The system does not auto-dial the full list without the organizer choosing the set and starting the run.
- ✓ Each guest shows the reason they cannot be called yet.
- ✓ The organizer can stop a run while it is going, and see who is being called and who was skipped.

### Call campaigns

- ✓ Support two campaign types for an event: **pre-event** and **post-event**.
- ✓ Pre-event campaign purpose: remind, confirm will-attend, nudge to attend, share changes, collect preferences.
- ✓ Post-event campaign purpose: confirm attendance, collect feedback.
- ✓ A new pre-event campaign starts with will-attend (yes, no, or maybe), and a new post-event campaign starts with attended and feedback. Both stay editable.
- ✓ Organizer configures per campaign: editable LLM prompt, and structured fields to capture from the call.
- ✓ The organizer sets one master prompt per campaign type, and a campaign can use its own prompt instead.
- ✓ The organizer chooses which event and guest details a call may include. The phone number is excluded unless they allow it.
- ✓ The campaign editor shows the exact prompt the call will use.
- ✓ One pre-event attempt and one post-event attempt per guest in the initial pass, unless the organizer explicitly retries. Do not start a post-event campaign before the event ends, or a pre-event campaign after it starts.
- ✓ Place calls only in a reasonable local window. Cap retries.
- ✓ Phase 1 calls guests in India only. The default window is 10:00-20:00 IST, editable per campaign.
- ✓ Phase 1 places calls one at a time, not in parallel.
- ✓ Each campaign has one conversation language (for example English or Hindi), chosen by the organizer.

### Voice approaches and fallback

- The organizer picks a preferred voice approach per campaign.
- Before a run, show whether each voice provider in use has enough credits.
- If the preferred approach runs out of credits or quota, calls continue with the next available approach without organizer action.
- ✓ Every attempt records which voice approach handled it and whether a fallback happened, so approaches can be compared.

### Outbound calling

- ✓ Place an outbound phone call to each selected guest (telephony, STT, TTS, and LLM).
- Guests may speak English, Hindi, or other local Indian languages.
- ✓ Run the conversation with the organizer's campaign prompt plus synced event and guest context.
- ✓ Record call outcome: answered, no answer, voicemail, declined, hung up, or failed.
- ✓ Do not leave voicemail messages in phase 1.
- ✓ Extract the configured structured fields from the conversation. Use unknown when an answer is unclear.

### Results and review

- ✓ Store a structured result per attempt: call outcome and the campaign's captured fields.
- ✓ Keep the call transcript per attempt. Do not store call audio.
- ✓ Each attempt keeps a timeline of the call.
- ✓ Organizer can list results per guest and as an event summary.
- Organizer can see which platform write-backs succeeded or failed.

## Non-goals

- Selling, recruiting, or any call that is not for a specific event the organizer named.
- Registering people, selling tickets, or deciding the agenda. We integrate with the event platform; we do not replace it.
- Prescribing call scripts, tone, or nudge wording in product requirements. The organizer owns that via the campaign prompt.
- Inbound support, live help during the event, or a multi-day drip of reminder calls.
- Shipping every event platform or voice vendor in phase 1.
- Choosing concrete architecture, repo layout, or UI. Those stay open until [DESIGN.md](DESIGN.md).

## Constraints

- Call only guests on the loaded list who have a usable phone number and whom the organizer selected.
- Pre-event calls happen only before the event. Post-event calls happen only after it.
- **Phase 1 resources:** use existing subscriptions where we have them. Telephony anchors on **Plivo**. TTS anchors on **ElevenLabs**. Event platform anchors on **Luma**. STT and LLM use whatever we already have access to that covers English, Hindi, and local Indian languages; pick specifics in design.
- Treat phone numbers, call audio or transcripts, prompts, and platform or provider tokens as private to that organizer and event.
- Platform credentials, provider credentials, and guest data must not leak across organizers or events.

## Acceptance checks

- ✓ An organizer can connect Luma or upload a Luma guest CSV, and see a guest list with phone numbers, approval status, and skip counts for guests without phones.
- ✓ Uploading a Luma CSV preserves approval statuses such as approved, pending_approval, invited, waitlist, and declined.
- ✓ An organizer can filter by status (and similar fields), reorder or prioritize, select a subset, and place a call to one guest without dialing the rest.
- ✓ An organizer can edit a campaign prompt and the outbound call uses that prompt with event and guest context.
- ✓ A pre-event campaign stores will-attend (or unknown) per attempted guest.
- ✓ A post-event campaign stores attendance and feedback (or unknown) for reached guests.
- ✓ No answer, voicemail, decline, and hang-up are stored as call outcomes, with captured fields left unknown when not obtained.
- When a guest's answer is clear and a connected platform supports it, RSVP or attendance is written back, or a sync failure is visible if write-back fails.
- Phase 1 can complete an outbound call using the phase-1 resources above, including guest speech in English or Hindi.
- ✓ The organizer can list per-guest results and an event summary without listening to the calls.
- ✓ A number that was not on the loaded list is never called.
- When the preferred voice provider has no credits, the next call still completes on another approach, and the attempt shows which approach was used.
