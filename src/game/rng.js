// Seeded pseudo-random numbers so that a game can be replayed exactly.

// mulberry32: small, fast 32-bit generator with good statistical quality for games.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard normal draw from two uniforms (Box-Muller). Always consumes exactly two
// uniforms, which keeps the sequence of draws aligned between games.
export function gaussian(rand) {
  const u1 = 1 - rand(); // (0, 1]
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Seeds are positive integers; anything else is hashed into one.
export function normalizeSeed(seed) {
  const n = Number(seed);
  if (Number.isInteger(n) && n > 0 && n < 2 ** 32) return n;
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h || 1;
}
