// studypal-eventkit: writes studyPal's schedule into the system calendar.
//
// The Bun server runs this helper with a JSON request on stdin and reads a
// JSON response from stdout. Everything goes into one dedicated calendar, so
// the system (and iCloud) delivers the alarms even when studyPal is not
// running.
//
//   studypal-eventkit            apply the request on stdin
//   studypal-eventkit --status   report calendar permission without prompting

import EventKit
import Foundation

struct Rule: Decodable {
  let freq: String  // DAILY | WEEKLY
  let interval: Int
  let until: String?  // ISO 8601 instant
  let count: Int?
}

struct Item: Decodable {
  let key: String
  /// Identifier returned by an earlier run, when the item was written before.
  let eventId: String?
  let title: String
  /// ISO 8601 instants, or `YYYY-MM-DD` local dates (end exclusive) when `allDay`.
  let start: String
  let end: String
  let allDay: Bool
  let location: String?
  let notes: String?
  let url: String?
  /// Reminders, as minutes before the start.
  let alarms: [Int]
  let rule: Rule?
}

struct Request: Decodable {
  let calendarId: String?
  let calendarTitle: String
  let upserts: [Item]
  /// Event identifiers to remove.
  let deletes: [String]
}

struct Response: Encodable {
  var ok = true
  /// Machine-readable failure kind: denied | invalid | failed.
  var code: String?
  var error: String?
  var calendarId: String?
  /// True when the calendar the caller knew is gone and a new one was made;
  /// identifiers from earlier runs are then void.
  var calendarRecreated = false
  var eventIds: [String: String] = [:]
}

struct Failure: Error {
  let code: String
  let message: String
}

let store = EKEventStore()

func emit(_ response: Response) -> Never {
  let data = try! JSONEncoder().encode(response)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
  exit(response.ok ? 0 : 1)
}

func fail(_ code: String, _ message: String) -> Never {
  emit(Response(ok: false, code: code, error: message))
}

func statusName() -> String {
  switch EKEventStore.authorizationStatus(for: .event) {
  case .notDetermined: return "notDetermined"
  case .restricted: return "restricted"
  case .denied: return "denied"
  case .fullAccess: return "fullAccess"
  case .writeOnly: return "writeOnly"
  case .authorized: return "fullAccess"
  @unknown default: return "unknown"
  }
}

/// Asks for calendar access, showing the system prompt the first time.
func requestAccess() -> Bool {
  let done = DispatchSemaphore(value: 0)
  var granted = false
  store.requestFullAccessToEvents { result, _ in
    granted = result
    done.signal()
  }
  done.wait()
  return granted
}

/// The dedicated calendar, created on first use in the account new events
/// normally go to (iCloud when the user has it, so alarms reach their phone).
func resolveCalendar(id: String?, title: String) throws -> (EKCalendar, Bool) {
  if let id, let known = store.calendar(withIdentifier: id), known.allowsContentModifications {
    return (known, false)
  }
  if id == nil,
    let sameTitle = store.calendars(for: .event).first(where: {
      $0.title == title && $0.allowsContentModifications
    })
  {
    return (sameTitle, false)
  }

  let calendar = EKCalendar(for: .event, eventStore: store)
  calendar.title = title
  guard
    let source = store.defaultCalendarForNewEvents?.source
      ?? store.sources.first(where: { $0.sourceType == .calDAV })
      ?? store.sources.first(where: { $0.sourceType == .local })
  else {
    throw Failure(code: "failed", message: "没有可以新建日历的账户")
  }
  calendar.source = source
  try store.saveCalendar(calendar, commit: true)
  return (calendar, id != nil)
}

let instantParser: ISO8601DateFormatter = {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime]
  return formatter
}()

let dayParser: DateFormatter = {
  let formatter = DateFormatter()
  formatter.calendar = Calendar(identifier: .gregorian)
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = TimeZone.current
  formatter.dateFormat = "yyyy-MM-dd"
  return formatter
}()

func parseInstant(_ text: String) throws -> Date {
  guard let date = instantParser.date(from: text) else {
    throw Failure(code: "invalid", message: "无效的时间：\(text)")
  }
  return date
}

func parseDay(_ text: String) throws -> Date {
  guard let date = dayParser.date(from: text) else {
    throw Failure(code: "invalid", message: "无效的日期：\(text)")
  }
  return date
}

func recurrence(_ rule: Rule) throws -> EKRecurrenceRule {
  let frequency: EKRecurrenceFrequency
  switch rule.freq {
  case "DAILY": frequency = .daily
  case "WEEKLY": frequency = .weekly
  default: throw Failure(code: "invalid", message: "不支持的重复规则：\(rule.freq)")
  }
  var end: EKRecurrenceEnd?
  if let until = rule.until {
    end = EKRecurrenceEnd(end: try parseInstant(until))
  } else if let count = rule.count {
    end = EKRecurrenceEnd(occurrenceCount: count)
  }
  return EKRecurrenceRule(recurrenceWith: frequency, interval: max(1, rule.interval), end: end)
}

func apply(_ item: Item, to event: EKEvent) throws {
  event.title = item.title
  event.isAllDay = item.allDay
  if item.allDay {
    let start = try parseDay(item.start)
    let endExclusive = try parseDay(item.end)
    event.startDate = start
    // EventKit's all-day end is inclusive: the last covered day.
    event.endDate = max(start, endExclusive.addingTimeInterval(-1))
  } else {
    event.startDate = try parseInstant(item.start)
    event.endDate = try parseInstant(item.end)
  }
  event.location = item.location
  event.notes = item.notes
  event.url = item.url.flatMap { URL(string: $0) }
  event.alarms =
    item.alarms.isEmpty
    ? nil : item.alarms.map { EKAlarm(relativeOffset: TimeInterval(-$0 * 60)) }
  event.recurrenceRules = try item.rule.map { [try recurrence($0)] }
}

func run(_ request: Request) throws -> Response {
  var response = Response()
  let (calendar, recreated) = try resolveCalendar(
    id: request.calendarId, title: request.calendarTitle)
  response.calendarId = calendar.calendarIdentifier
  response.calendarRecreated = recreated
  // The caller's identifiers point into the lost calendar; it will resend.
  if recreated { return response }

  for id in request.deletes {
    guard let event = store.event(withIdentifier: id),
      event.calendar?.calendarIdentifier == calendar.calendarIdentifier
    else { continue }
    try store.remove(event, span: .futureEvents, commit: false)
  }

  var written: [(String, EKEvent)] = []
  for item in request.upserts {
    var event = item.eventId.flatMap { store.event(withIdentifier: $0) }
    // Never touch an event the user moved to another calendar.
    if event?.calendar?.calendarIdentifier != calendar.calendarIdentifier { event = nil }
    let target = event ?? EKEvent(eventStore: store)
    target.calendar = calendar
    try apply(item, to: target)
    try store.save(target, span: .futureEvents, commit: false)
    written.append((item.key, target))
  }

  try store.commit()
  for (key, event) in written {
    if let id = event.eventIdentifier { response.eventIds[key] = id }
  }
  return response
}

if CommandLine.arguments.contains("--status") {
  var response = Response()
  response.code = statusName()
  emit(response)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
let request: Request
do {
  request = try JSONDecoder().decode(Request.self, from: input)
} catch {
  fail("invalid", "请求格式无效：\(error)")
}

guard requestAccess() else {
  fail("denied", "没有日历访问权限")
}

do {
  emit(try run(request))
} catch let failure as Failure {
  fail(failure.code, failure.message)
} catch {
  fail("failed", error.localizedDescription)
}
