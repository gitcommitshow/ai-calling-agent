/**
 * Event updates for the browser. Forwards the brief and schedule to the server,
 * which owns validation.
 */
import { NextResponse } from 'next/server';
import { ServerApiError, updateEvent } from '../../../../lib/server-api';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as {
      name?: string;
      startsAt?: string;
      endsAt?: string;
      timezone?: string;
      brief?: { about?: string; where?: string; notes?: string };
    };
    const event = await updateEvent(id, {
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
    return NextResponse.json({ event });
  } catch (error) {
    if (error instanceof ServerApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
