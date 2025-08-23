import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const { date, summary, staff, startTime, endTime } = body as {
      date?: string;          // "YYYY-MM-DD"
      summary?: string;
      staff?: string;
      startTime?: string;     // "HH:MM"
      endTime?: string;       // "HH:MM"
    };

    const visitDate = date ? new Date(date) : new Date();

    let start: Date | undefined;
    let finish: Date | undefined;
    let durationMinutes: number | undefined;

    if (startTime && endTime) {
      const base = new Date(
        Date.UTC(
          visitDate.getUTCFullYear(),
          visitDate.getUTCMonth(),
          visitDate.getUTCDate()
        )
      );

      const [sh, sm] = startTime.split(":").map(Number);
      const [eh, em] = endTime.split(":").map(Number);

      start = new Date(base);
      start.setUTCHours(sh ?? 0, sm ?? 0, 0, 0);

      finish = new Date(base);
      finish.setUTCHours(eh ?? 0, em ?? 0, 0, 0);

      // If finish earlier than start, assume it crossed midnight
      if (finish < start) finish.setUTCDate(finish.getUTCDate() + 1);

      durationMinutes = Math.round((finish.getTime() - start.getTime()) / 60000);
    }

    const created = await prisma.visit.create({
      data: {
        customerId: params.id,
        date: visitDate,
        summary: summary ?? null,
        staff: staff ?? null,
        startTime: start,
        endTime: finish,
        durationMinutes,
      },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
}
