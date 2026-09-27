/**
 * Campaign updates for the browser: prompt, fields, language, window, retry cap,
 * and the queue order. Forwards to the server, which owns validation.
 */
import { NextResponse } from 'next/server';
import type { Campaign } from '../../../../domain/types';
import { ServerApiError, updateCampaign } from '../../../../lib/server-api';

type CampaignPatch = Partial<Omit<Campaign, 'id' | 'eventId' | 'type' | 'createdAt' | 'updatedAt'>>;

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ campaignId: string }> },
) {
  const { campaignId } = await params;
  try {
    const patch = (await request.json()) as CampaignPatch;
    const campaign = await updateCampaign(campaignId, patch);
    return NextResponse.json({ campaign });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
