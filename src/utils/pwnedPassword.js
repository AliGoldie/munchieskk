// Checks a password against the Have I Been Pwned "Pwned Passwords" API using
// k-anonymity: only the first 5 hex characters of the password's SHA-1 hash
// are sent, never the password itself. Free, no API key required -- this is
// what Supabase's own "Leaked Password Protection" uses under the hood,
// which is gated to the Pro plan; this replicates it for the Free plan.
export async function isPasswordPwned(password) {
  try {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-1', encoder.encode(password));
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    const prefix = hashHex.slice(0, 5);
    const suffix = hashHex.slice(5);

    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!res.ok) return false; // fail open: never block signup/reset over an API hiccup

    const text = await res.text();
    return text.split('\n').some((line) => line.split(':')[0].trim() === suffix);
  } catch (e) {
    console.warn('Pwned password check failed, allowing (fail open):', e);
    return false;
  }
}
