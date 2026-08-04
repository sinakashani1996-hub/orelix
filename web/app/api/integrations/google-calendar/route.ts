import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { integrations } from "../../../../db/schema";
import { getAppContext } from "../../../../lib/context";
import {
  calendarIntegrationForOrganization,
  createGoogleCalendarEvent,
  listUpcomingCalendarEvents,
} from "../../../../lib/google-calendar";

export async function GET(request: Request) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }
  const integration = await calendarIntegrationForOrganization(context.organization.id);
  if (!integration) return Response.json({ connected: false, events: [] });

  try {
    const wantsEvents = new URL(request.url).searchParams.get("events") === "upcoming";
    const events = wantsEvents ? await listUpcomingCalendarEvents(integration) : [];
    return Response.json({
      connected: true,
      accountEmail: integration.accountEmail,
      events,
    });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Google Agenda kon niet worden bereikt";
    console.error("Google Calendar request failed:", message);
    return Response.json(
      { connected: true, accountEmail: integration.accountEmail, events: [], error: "Agenda synchroniseren lukt niet. Koppel Google Agenda opnieuw." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }
  const integration = await calendarIntegrationForOrganization(context.organization.id);
  if (!integration) {
    return Response.json({ error: "Koppel eerst Google Agenda" }, { status: 409 });
  }
  const body = (await request.json()) as {
    title?: string;
    description?: string;
    location?: string;
    startDateTime?: string;
    endDateTime?: string;
  };
  if (!body.title || !body.startDateTime || !body.endDateTime) {
    return Response.json({ error: "Titel, start en einde zijn verplicht" }, { status: 400 });
  }
  try {
    const event = await createGoogleCalendarEvent(integration, {
      title: body.title,
      description: body.description,
      location: body.location,
      startDateTime: body.startDateTime,
      endDateTime: body.endDateTime,
    });
    return Response.json({ event }, { status: 201 });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Afspraak kon niet naar Google Agenda";
    return Response.json({ error: message }, { status: 502 });
  }
}

export async function DELETE() {
  const context = await getAppContext();
  if (!context?.organization) {
    return Response.json({ error: "Niet aangemeld" }, { status: 401 });
  }
  await getDb()
    .delete(integrations)
    .where(
      and(
        eq(integrations.organizationId, context.organization.id),
        eq(integrations.provider, "google_calendar"),
      ),
    );
  return Response.json({ ok: true });
}
