// Malaysian numbers are usually typed with a leading 0 (012-345 6789);
// wa.me needs the country code (60123456789).
export function toWhatsAppNumber(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('60')) return digits;
  if (digits.startsWith('0')) return `6${digits}`;
  return digits;
}

// Message a winner sends to the shop to confirm their contest prize. The code
// lets staff match the chat to the winner at the counter.
export function contestWinMessage(place, contest, code) {
  return `Hi MunchiesKK! I won ${place} place in ${contest}. My claim code: ${code}`;
}

export function whatsAppLink(phone, text) {
  return `https://wa.me/${toWhatsAppNumber(phone)}?text=${encodeURIComponent(text)}`;
}
