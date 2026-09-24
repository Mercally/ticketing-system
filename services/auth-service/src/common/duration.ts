const UNIT_TO_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses a Go/JWT-style duration shorthand ("15m", "7d", "30s") into whole
 * seconds. Falls back to treating the value as a plain number of seconds if
 * it isn't in that shorthand form.
 */
export function parseDurationToSeconds(value: string): number {
  const match = /^(\d+)\s*([smhd])$/i.exec(value.trim());
  if (match) {
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    return Math.floor((amount * UNIT_TO_MS[unit]) / 1000);
  }

  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) {
    return Math.floor(asNumber);
  }

  throw new Error(`Invalid duration string: "${value}"`);
}
