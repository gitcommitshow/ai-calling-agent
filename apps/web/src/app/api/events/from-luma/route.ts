/**
 * Create an event from a Luma page, or return the one already saved for that
 * link. A JSON call gets JSON. A normal form submit is sent to the event page,
 * because that submit is what the browser does before the click handler attaches.
 */
import { NextResponse } from 'next/server';
import { campaignTemplates } from '../../../../domain/campaign-templates';
import { createCampaign, importLumaEvent, ServerApiError } from '../../../../lib/server-api';

export async function POST(request: Request) {
  const wantsJson = (request.headers.get('content-type') ?? '').includes('application/json');
  try {
    const url = await readSubmittedUrl(request);
    const result = await importLumaEvent(url);

    if (result.created) {
      for (const template of campaignTemplates()) {
        await createCampaign(result.event.id, template);
      }
    }

    if (wantsJson) {
      return NextResponse.json(result, { status: result.created ? 201 : 200 });
    }
    return NextResponse.redirect(new URL(`/events/${result.event.id}`, request.url), 303);
  } catch (error) {
    const message =
      error instanceof ServerApiError ? error.message : (error as Error).message || 'could not read that Luma page';
    const status = error instanceof ServerApiError ? error.status : 400;
    if (wantsJson) {
      return NextResponse.json({ error: message }, { status });
    }
    const back = new URL('/', request.url);
    back.searchParams.set('lumaError', message);
    return NextResponse.redirect(back, 303);
  }
}

/** The click handler sends JSON. The form itself sends a url field. */
async function readSubmittedUrl(request: Request): Promise<string> {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = (await request.json()) as { url?: unknown };
    return typeof body.url === 'string' ? body.url : '';
  }
  const form = await request.formData();
  const url = form.get('url');
  return typeof url === 'string' ? url : '';
}
