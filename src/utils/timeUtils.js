/**
 * Utility functions for 12-hour time formatting and dynamic operating hour slot generation
 */

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
