/**
 * Utility functions for 12-hour time formatting and dynamic operating hour slot generation
 */

// The store operates in one place -- Sabah, Malaysia (MYT, UTC+8, no DST) --
// but `new Date().getDay()/getHours()/getMinutes()` reads the *visitor's*
// (or server's) local clock. A customer browsing from a different timezone,
// or this app simply being previewed/built on a machine set to another zone,
// would get the wrong weekday/hour and so the wrong open/closed status and
// hours text. Intl.DateTimeFormat with an explicit timeZone sidesteps that
// by asking for Malaysia's wall-clock fields regardless of the runtime's own
// timezone -- no date library needed for this one fixed zone.
const MALAYSIA_TZ = 'Asia/Kuala_Lumpur';
const malaysiaPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: MALAYSIA_TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
  weekday: 'short'
});

const DAY_KEY_TO_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Same Malaysia wall-clock fields as getMalaysiaNow, but for an arbitrary
// instant -- e.g. "what weekday was this stored order timestamp, in
// Malaysia" rather than only "what's the date/time right now."
export function getMalaysiaParts(date = new Date()) {
  const map = {};
  malaysiaPartsFormatter.formatToParts(date).forEach(p => { map[p.type] = p.value; });
  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    // formatToParts gives 'Sun'/'Mon'/... in en-US, matching the DAY_KEYS
    // arrays already used across the app -- no remapping needed.
    dayKey: map.weekday,
    dayIndex: DAY_KEY_TO_INDEX[map.weekday],
    // hour12:false renders midnight as "24" in some engines instead of "00".
    hour: Number(map.hour) % 24,
    minute: Number(map.minute)
  };
}

export function getMalaysiaNow() {
  return getMalaysiaParts(new Date());
}

// Parses a "YYYY-MM-DD" Malaysia-calendar date string into the real UTC
// instant of that day's Malaysia midnight (or its last millisecond, with
// endOfDay). JS interprets a bare date-only ISO string ("2026-09-19") as
// *UTC* midnight, not Malaysia midnight -- an 8-hour-wrong instant if used
// directly as a cutoff -- so this is the one correct way to turn a
// Malaysia calendar date back into a comparable timestamp.
export function malaysiaDateStrToUTC(dateStr, endOfDay = false) {
  return new Date(`${dateStr}T${endOfDay ? '23:59:59.999' : '00:00:00'}+08:00`);
}

// Real UTC instant of Malaysia midnight for the day containing `date`.
export function getMalaysiaStartOfDayUTC(date = new Date()) {
  return malaysiaDateStrToUTC(getMalaysiaParts(date).dateStr);
}

// Adds (or subtracts, with a negative count) whole calendar days to a
// Malaysia "YYYY-MM-DD" date string. Malaysia has no DST, so exact
// millisecond arithmetic on its own midnight instant is always exactly
// 24h/day -- no calendar edge cases to handle.
export function addMalaysiaDays(dateStr, days) {
  const start = malaysiaDateStrToUTC(dateStr);
  return getMalaysiaParts(new Date(start.getTime() + days * 86400000)).dateStr;
}

// Adds (or subtracts) whole months, clamping the day to the target month's
// real length (e.g. Jan 31 - 1 month -> Dec 31, not an overflowed Mar 3).
// Pure calendar-integer math -- deliberately not routed through a Date
// object's own month arithmetic, which would reintroduce a runtime-
// timezone dependency for no benefit here.
export function addMalaysiaMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const newY = Math.floor(total / 12);
  const newM = ((total % 12) + 12) % 12 + 1;
  const daysInNewMonth = new Date(newY, newM, 0).getDate();
  const newD = Math.min(d, daysInNewMonth);
  return `${newY}-${String(newM).padStart(2, '0')}-${String(newD).padStart(2, '0')}`;
}

// Adds (or subtracts) whole years, same day-clamping as addMalaysiaMonths
// (matters for Feb 29 on a non-leap target year).
export function addMalaysiaYears(dateStr, years) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const newY = y + years;
  const daysInMonth = new Date(newY, m, 0).getDate();
  const newD = Math.min(d, daysInMonth);
  return `${newY}-${String(m).padStart(2, '0')}-${String(newD).padStart(2, '0')}`;
}

// Robust helper to parse time strings ("17:00", "05:00 pm", "5:00 PM", "05:00") into minutes from midnight
export function parseTimeToMinutes(timeStr, defaultStr = '17:00') {
  const target = timeStr || defaultStr;
  if (!target) return 1020;

  const str = target.toString().trim().toLowerCase();
  const isPM = str.includes('pm');
  const isAM = str.includes('am');

  const parts = str.replace(/[^\d:]/g, '').split(':').map(Number);
  let h = isNaN(parts[0]) ? 17 : parts[0];
  let m = isNaN(parts[1]) ? 0 : parts[1];

  if (isPM && h < 12) h += 12;
  else if (!isAM && !isPM && h >= 1 && h <= 6) h += 12; // e.g. "05:00" -> 17:00 (5:00 PM)
  else if (isAM && h === 12) h = 0;

  return h * 60 + m;
}

// Converts time string ("17:00" or "05:00 pm") to 12h AM/PM string ("5:00 PM")
export function formatTime12Hour(timeStr) {
  if (!timeStr) return '';
  const totalMins = parseTimeToMinutes(timeStr);
  let hours = Math.floor(totalMins / 60);
  const minutes = totalMins % 60;

  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;

  const formattedMinutes = minutes.toString().padStart(2, '0');
  return `${hours}:${formattedMinutes} ${ampm}`;
}

// Generates time slots strictly within the configured business hours every 10 minutes
export function generateOperatingTimeSlots(openingTime = '10:00', closingTime = '22:00') {
  const startMins = parseTimeToMinutes(openingTime, '10:00');
  let endMins = parseTimeToMinutes(closingTime, '22:00');

  // Handle overnight hours (e.g. 5:00 PM to 2:00 AM)
  if (endMins <= startMins) {
    endMins += 24 * 60;
  }

  const slots = [];
  // Step by 10-minute intervals starting from opening time up to closing time
  let current = startMins;
  while (current <= endMins) {
    const minsNormalized = current % (24 * 60);
    const h = Math.floor(minsNormalized / 60);
    const m = minsNormalized % 60;

    const time24 = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    const time12 = formatTime12Hour(time24);
    const dayPrefix = current >= 24 * 60 ? 'Tomorrow' : 'Today';

    slots.push({
      value: time24,
      label: `${dayPrefix} at ${time12}`
    });

    current += 10;
  }

  // If no slots generated, provide at least the opening slot
  if (slots.length === 0) {
    slots.push({
      value: openingTime,
      label: `Today at ${formatTime12Hour(openingTime)}`
    });
  }

  return slots;
}
