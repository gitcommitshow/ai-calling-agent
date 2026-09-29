/**
 * Guest import for the browser. The CSV is parsed and mapped in the client, so
 * this handler only forwards the normalized payload; the server validates again
 * before anything is persisted.
 */
import { NextResponse } from 'next/server';
import type { GuestPayload } from '../../../../../../domain/types';
import { importGuests, ServerApiError } from '../../../../../../lib/server-api';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as {
      guests?: GuestPayload[];
      skippedWithoutPhone?: number;
    };

    const result = await importGuests(id, {
      guests: body.guests ?? [],
      skippedWithoutPhone: body.skippedWithoutPhone ?? 0,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
