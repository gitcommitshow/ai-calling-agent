/**
 * Event creation for the browser. Creates the event on the server, then adds the
 * app's default pre-event and post-event campaigns: the templates are product
 * policy and belong to this app, not to the server.
 */
import { NextResponse } from 'next/server';
import { campaignTemplates } from '../../../domain/campaign-templates';
import { createCampaign, createEvent, ServerApiError } from '../../../lib/server-api';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      startsAt?: string;
      endsAt?: string;
      timezone?: string;
      brief?: { about?: string; where?: string; notes?: string };
    };

    const event = await createEvent({
      name: body.name ?? '',
      startsAt: body.startsAt ?? '',
      endsAt: body.endsAt ?? '',
      timezone: body.timezone ?? 'Asia/Kolkata',
      brief: {
        about: body.brief?.about ?? '',
        where: body.brief?.where ?? '',
        notes: body.brief?.notes ?? '',
      },
    });

    for (const template of campaignTemplates()) {
      await createCampaign(event.id, template);
    }

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
