/**
 * Create one more campaign for an event from the queue page. The two campaigns
 * that arrive with the event are the usual case; this is the extra one.
 */
import { NextResponse } from 'next/server';
import { campaignTemplates } from '../../../../../domain/campaign-templates';
import type { CampaignType } from '../../../../../domain/types';
import { createCampaign, ServerApiError } from '../../../../../lib/server-api';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { name?: unknown; type?: unknown; purpose?: unknown };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Give the campaign a name.' }, { status: 400 });
    }
    const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';
    if (!purpose) {
      return NextResponse.json({ error: 'Say what this call is for.' }, { status: 400 });
    }
    if (purpose.length > 500) {
      return NextResponse.json({ error: 'Keep the purpose to a sentence or two.' }, { status: 400 });
    }
    const type = body.type === 'post-event' ? 'post-event' : body.type === 'pre-event' ? 'pre-event' : null;
    if (!type) {
      return NextResponse.json({ error: 'Choose before the event or after it.' }, { status: 400 });
    }

    const template = campaignTemplates().find((item) => item.type === (type as CampaignType));
    if (!template) {
      return NextResponse.json({ error: 'That campaign type is not available.' }, { status: 400 });
    }

    const campaign = await createCampaign(id, { ...template, name, purpose, queue: [] });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
