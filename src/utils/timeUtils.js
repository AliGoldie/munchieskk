/**
 * Utility functions for 12-hour time formatting and dynamic operating hour slot generation
 */

// Converts 24h string ("17:00") to 12h AM/PM string ("5:00 PM")
export function formatTime12Hour(timeStr) {
  if (!timeStr) return '';
  const [hStr, mStr] = timeStr.split(':');
  let hours = parseInt(hStr, 10);
  const minutes = parseInt(mStr || '0', 10);

  if (isNaN(hours)) return timeStr;

  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;

  const formattedMinutes = minutes.toString().padStart(2, '0');
  return `${hours}:${formattedMinutes} ${ampm}`;
}

// Generates time slots strictly within the configured business hours
export function generateOperatingTimeSlots(openingTime = '10:00', closingTime = '22:00') {
  const [openH, openM] = (openingTime || '10:00').split(':').map(n => parseInt(n, 10) || 0);
  const [closeH, closeM] = (closingTime || '22:00').split(':').map(n => parseInt(n, 10) || 0);

  const startMins = openH * 60 + openM;
  let endMins = closeH * 60 + closeM;

  // Handle overnight hours (e.g. 5:00 PM to 2:00 AM)
  if (endMins <= startMins) {
    endMins += 24 * 60;
  }

  const slots = [];
  // Step by 30-minute intervals starting 30 mins after opening up to 30 mins before closing
  let current = startMins + 30;
  while (current <= endMins - 15) {
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

    current += 30;
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
