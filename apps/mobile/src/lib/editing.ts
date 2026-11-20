/**
 * What the calendar's editor sheets open on. Entries are objects, which
 * route params cannot carry, so the calendar leaves them here first.
 */
import type { CalendarEntry } from "@studypal/core/calendar/store";
import type { StudyBlock } from "@studypal/core/routes/study";

export type EventTarget =
  { kind: "new"; start: Date } | { kind: "edit"; entry: CalendarEntry };

let eventTarget: EventTarget | undefined;
let blockTarget: StudyBlock | undefined;

export function editEvent(target: EventTarget): void {
  eventTarget = target;
}

export function eventToEdit(): EventTarget | undefined {
  return eventTarget;
}

export function editBlock(block: StudyBlock): void {
  blockTarget = block;
}

export function blockToEdit(): StudyBlock | undefined {
  return blockTarget;
}
