/**
 * Re-read the event's Luma page and replace the name, time, and description.
 */
import { NextResponse } from 'next/server';
import { refreshLumaEvent, ServerApiError } from '../../../../../lib/server-api';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const event = await refreshLumaEvent(id);
    return NextResponse.json({ event });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
