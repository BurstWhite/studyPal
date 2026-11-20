/**
 * Writes studyPal's schedule into the iOS calendar with expo-calendar. This is
 * the phone's counterpart of the desktop's Swift helper
 * (`src-tauri/eventkit/main.swift`) and answers the same requests.
 */
import type {
  CalendarItem,
  HelperRequest,
  HelperResponse,
  HelperRunner,
} from "@studypal/core/calendar/system";
import * as Calendar from "expo-calendar";

/**
 * The Mac app already mirrors into a calendar named "studyPal", usually in
 * iCloud, so the phone keeps its own and the two can be told apart.
 */
const PHONE_CALENDAR_TITLE = "studyPal（iPhone）";

class Failure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function findCalendar(id: string): Promise<Calendar.ExpoCalendar | null> {
  try {
    const calendar = await Calendar.ExpoCalendar.get(id);
    return calendar.allowsModifications ? calendar : null;
  } catch {
    return null;
  }
}

async function findEvent(
  id: string,
): Promise<Calendar.ExpoCalendarEvent | null> {
  try {
    return await Calendar.ExpoCalendarEvent.get(id);
  } catch {
    return null;
  }
}

/** The dedicated calendar, created on first use in the default account. */
async function resolveCalendar(
  id: string | null,
): Promise<{ calendar: Calendar.ExpoCalendar; recreated: boolean }> {
  if (id) {
    const known = await findCalendar(id);
    if (known) return { calendar: known, recreated: false };
  } else {
    const sameTitle = (
      await Calendar.getCalendars(Calendar.EntityTypes.EVENT)
    ).find(
      (calendar) =>
        calendar.title === PHONE_CALENDAR_TITLE && calendar.allowsModifications,
    );
    if (sameTitle) return { calendar: sameTitle, recreated: false };
  }

  let source: Calendar.ExpoCalendar["source"] | undefined;
  try {
    source = Calendar.getDefaultCalendarSync().source;
  } catch {
    source = undefined;
  }
  if (!source) throw new Failure("failed", "没有可以新建日历的账户");
  const calendar = await Calendar.createCalendar({
    title: PHONE_CALENDAR_TITLE,
    color: "#1b6e5a",
    entityType: Calendar.EntityTypes.EVENT,
    sourceId: source.id,
    source,
    name: PHONE_CALENDAR_TITLE,
    ownerAccount: "studyPal",
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
  return { calendar, recreated: id !== null };
}

/** `YYYY-MM-DD` as local midnight. */
function localDay(text: string): Date {
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year!, month! - 1, day!);
}

function eventDetails(item: CalendarItem) {
  let startDate: Date;
  let endDate: Date;
  if (item.allDay) {
    startDate = localDay(item.start);
    // The calendar's all-day end is inclusive: the last covered day.
    endDate = new Date(
      Math.max(startDate.getTime(), localDay(item.end).getTime() - 1000),
    );
  } else {
    startDate = new Date(item.start);
    endDate = new Date(item.end);
  }
  return {
    title: item.title,
    allDay: item.allDay,
    startDate,
    endDate,
    location: item.location ?? undefined,
    notes: item.notes ?? undefined,
    url: item.url ?? undefined,
    alarms: item.alarms.map((minutes) => ({ relativeOffset: -minutes })),
    recurrenceRule: item.rule
      ? {
          frequency:
            item.rule.freq === "DAILY"
              ? Calendar.Frequency.DAILY
              : Calendar.Frequency.WEEKLY,
          interval: Math.max(1, item.rule.interval),
          ...(item.rule.until
            ? { endDate: new Date(item.rule.until) }
            : item.rule.count
              ? { occurrence: item.rule.count }
              : {}),
        }
      : null,
  };
}

async function run(request: HelperRequest): Promise<HelperResponse> {
  const response: HelperResponse = {
    ok: true,
    calendarRecreated: false,
    eventIds: {},
  };

  if (request.action === "clear") {
    if (request.calendarId) {
      const calendar = await findCalendar(request.calendarId);
      if (calendar) {
        await calendar.delete();
        response.removed = true;
      }
    }
    return response;
  }

  const { calendar, recreated } = await resolveCalendar(request.calendarId);
  response.calendarId = calendar.id;
  response.calendarRecreated = recreated;
  // The caller's identifiers point into the lost calendar; it will resend.
  if (recreated) return response;

  const ours = async (id: string) => {
    const event = await findEvent(id);
    return event && event.calendarId === calendar.id ? event : null;
  };

  if (request.verify) {
    response.missing = [];
    for (const id of request.verify) {
      if (!(await ours(id))) response.missing.push(id);
    }
  }

  for (const id of request.deletes) await (await ours(id))?.delete();

  for (const item of request.upserts) {
    const details = eventDetails(item);
    // Never touch an event the user moved to another calendar.
    const existing = item.eventId ? await ours(item.eventId) : null;
    if (existing) {
      // The documented way to clear a field is to set it to null, which
      // the type declarations do not allow for.
      await existing.update({
        ...details,
        location: item.location,
        notes: item.notes,
        url: item.url,
      } as unknown as typeof details);
      response.eventIds[item.key] = existing.id;
    } else {
      const created = await calendar.createEvent(details);
      response.eventIds[item.key] = created.id;
    }
  }
  return response;
}

export const runCalendar: HelperRunner = async (request) => {
  try {
    const permission = await Calendar.requestCalendarPermissions();
    if (!permission.granted) {
      return {
        ok: false,
        code: "denied",
        error: "没有日历访问权限",
        calendarRecreated: false,
        eventIds: {},
      };
    }
    return await run(request);
  } catch (error) {
    return {
      ok: false,
      code: error instanceof Failure ? error.code : "failed",
      error: error instanceof Error ? error.message : String(error),
      calendarRecreated: false,
      eventIds: {},
    };
  }
};
