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
9. ✓ Let the organizer hear the full pipeline, and try a prompt, before any guest is dialed.
10. When a call cannot answer a guest's question, save it and let the organizer call that guest back.

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
- The organizer can add a guest by hand, with a name and a phone number. The country code is shown and starts at +91, and they can change it. Hand-added guests are listed apart from imported guests. A phone number can appear only once on an event. If that number is already on the list, the guest is not added and the organizer is told who already has it. Re-importing a CSV replaces imported guests and leaves hand-added guests in place. A guest from another country is kept. Calling that guest is not available yet.
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
- ✓ Phase 1 places calls to Indian numbers only. Guests with another country code stay on the list and are not dialed. The default window is 10:00-20:00 IST, editable per campaign.
- ✓ Phase 1 places calls one at a time, not in parallel.
- ✓ Each campaign has one conversation language (for example English or Hindi), chosen by the organizer.
- The organizer can add another campaign of either type from the queue, with its own name, its own guest list, and one line for what that call is for. It keeps that type's master prompt, and that line is the only addition. The timing rules for that type still apply.

### Voice approaches and fallback

- The organizer picks a preferred voice approach per campaign.
- Before a run, show whether each voice provider in use has enough credits.
- If the preferred approach runs out of credits or quota, calls continue with the next available approach without organizer action.
- ✓ Every attempt records which voice approach handled it and whether a fallback happened, so approaches can be compared.

### Outbound calling

- ✓ Place an outbound phone call to each selected guest (telephony, STT, TTS, and LLM).
- Guests may speak English, Hindi, or other local Indian languages.
- ✓ Run the conversation with the organizer's campaign prompt plus synced event and guest context.
- ✓ End the call when the guest asks to stop, after a short goodbye.
- ✓ End the call when the conversation is finished and neither side has more to add, after a short goodbye.
- ✓ Keep silence and the maximum call length as safety limits for a call that never reaches either close.
- ✓ Record call outcome: answered, no answer, voicemail, declined, hung up, or failed.
- ✓ Do not leave voicemail messages in phase 1.
- ✓ Extract the configured structured fields from the conversation. Use unknown when an answer is unclear.

### Unanswered questions

A call may answer only from the event description, the call context, and the organizer's notes when those are set. The notes win when they disagree with the description. When the guest asks for something that is not there, the agent says the team will check and someone will call them back. The question is saved so the organizer can place that call.

- The event brief is one description the agent may say, including where the event is when that is known. Pasting a Luma event link on the home page reads that page and fills the name, times, and description, and creates the event when that link is not already saved. Checking the link again updates those details and leaves the notes. Entering an event without a link is a secondary path, and its start defaults to five hours from now. A guest CSV does not supply the brief. The campaign editor shows the brief and the notes inside the exact prompt the call will use.
- The organizer can add one notes field for that event. It stays empty most of the time. It holds facts that are newer than the description, or that should not be on the public page, such as a change of plan, a logistical detail, or a note for one kind of guest. When the notes disagree with the description or other event details, the agent follows the notes.
- The agent answers a guest's question from that description and, when set, from the notes. It does not invent details.
- When the guest asks for something the brief does not contain, the agent says, once, that the team will check and someone will call them back later.
- Each such question is stored on that attempt, in the guest's words, and linked to that guest. A question the brief answered is not stored. A question that is unclear is not stored.
- Open questions are highlighted on the event and at the top of the results page, separate from ordinary captured fields. Each one links to the attempt and to placing a call to that guest.
- The organizer places that call. The product does not dial it on its own. The call is allowed even when that guest has already used the campaign's retry cap. The calling window and the pre-event or post-event timing rules still apply, and the number still comes from the guest list.
- The organizer marks a question resolved once it has been answered. It stays on the attempt and leaves the highlight. Placing the call does not resolve it.
- A pipeline test does not create an open question. It does not call a guest.

### Pipeline test calls

Before a campaign dials guests, the organizer can place one test call through the same pipeline a guest would get (telephony, speech, and the model) and hear what an attendee would hear.

- ✓ The deployment has one fixed test number, set by the organizer.
- ✓ A global test link places one call to that number with one click. It uses a default prompt and no guest.
- ✓ Each event has its own test link. One click calls the same fixed number with that event's prompt, language, voice, and event details, using a stand-in guest so the call matches what that event's attendees would receive.
- ✓ From either link, the organizer can dial a number they enter instead of the fixed test number.
- ✓ From either link, the organizer can use an existing prompt (a master prompt or a campaign prompt) or a new prompt written for this test. A new prompt applies to this test only and does not change the saved campaign prompt.
- ✓ A test call does not dial the guest list, does not count as a guest attempt, and does not write back to the event platform. It is allowed outside the calling window and outside the pre-event and post-event timing rules.
- ✓ The organizer can review that test attempt (outcome and transcript) apart from guest results and the event summary.

### Results and review

- ✓ Store a structured result per attempt: call outcome and the campaign's captured fields.
- ✓ Keep the call transcript per attempt. Do not store call audio.
- ✓ Each attempt keeps a timeline of the call.
- ✓ Organizer can list results per guest and as an event summary.
- Organizer can see which open questions still need a callback, and open the guest's attempt from each one.
- Organizer can see which platform write-backs succeeded or failed.

## Non-goals

- Selling, recruiting, or any call that is not for a specific event the organizer named. Pipeline test calls are in scope: they check this product, and they are not a general dialer.
- Registering people, selling tickets, or deciding the agenda. We integrate with the event platform; we do not replace it.
- Prescribing call scripts, tone, or nudge wording in product requirements. The organizer owns that via the campaign prompt. The shared rule in Unanswered questions is the exception: answer only from the event brief, and promise a team callback when a fact is missing.
- Inbound support, live help during the event, or a multi-day drip of reminder calls. A callback the organizer places from a recorded question is in scope. An inbound call is not.
- Shipping every event platform or voice vendor in phase 1.
- Choosing concrete architecture, repo layout, or UI. Those stay open until [DESIGN.md](DESIGN.md).

## Constraints

- Call only guests on the loaded list who have a usable phone number and whom the organizer selected. A pipeline test call is the exception: it dials the fixed test number or a number the organizer entered for that test, and never the guest list.
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
- ✓ A pipeline test hangs up after the answerer asks to cut the call, and hangs up on its own once both sides are done, without waiting out the silence limit or the maximum length.
- ✓ The organizer can list per-guest results and an event summary without listening to the calls.
- When a guest asks for a fact the brief does not contain, the call says the team will check and call back, and that question is highlighted and linked to calling that guest.
- When a guest asks for a fact the brief does contain, the call answers with it, and no open question is stored.
- The organizer can call that guest from the highlighted question after the retry cap is used, and can mark the question resolved so it leaves the highlight.
- A pipeline test never adds an open question.
- ✓ A guest call never dials a number that was not on the loaded list.
- ✓ One click on the global test link calls the fixed test number through the same pipeline as a guest call.
- ✓ One click on an event's test link calls that fixed number with the event's prompt and event details, so the answerer hears what that event's attendees would hear.
- ✓ The organizer can send that test to a number they enter, using an existing prompt or a new prompt, without changing the saved campaign prompt or creating a guest attempt.
- When the preferred voice provider has no credits, the next call still completes on another approach, and the attempt shows which approach was used.
