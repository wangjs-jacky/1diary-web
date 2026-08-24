import { describe, expect, it } from 'vitest';
import { localJournalTime } from './time';

describe('journal time fields', () => {
  it('uses the Gregorian local date and millisecond time required by the backend', () => {
    const result = localJournalTime(new Date(2026, 7, 24, 15, 9, 7, 6));
    expect(result.journalDate).toBe('2026-08-24');
    expect(result.journalTime).toBe('15:09:07.006');
    expect(result.timezoneId).toBeTruthy();
  });
});
