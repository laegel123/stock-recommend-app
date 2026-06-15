import { describe, it, expect } from 'vitest';
import { Lane, Market, Source, EventType, InvestorType } from '../src/index';

describe('domain enums', () => {
  it('Lane accepts fast/slow, rejects others', () => {
    expect(Lane.parse('fast')).toBe('fast');
    expect(Lane.parse('slow')).toBe('slow');
    expect(Lane.safeParse('medium').success).toBe(false);
  });

  it('Lane.options is exactly [fast, slow]', () => {
    expect(Lane.options).toEqual(['fast', 'slow']);
  });

  it('EventType accepts BUY, rejects HOLD', () => {
    expect(EventType.parse('BUY')).toBe('BUY');
    expect(EventType.safeParse('HOLD').success).toBe(false);
  });

  it('Market / Source / InvestorType round-trip valid members', () => {
    expect(Market.parse('US')).toBe('US');
    expect(Market.parse('KR')).toBe('KR');
    expect(Source.parse('edgar')).toBe('edgar');
    expect(InvestorType.parse('us_13f_manager')).toBe('us_13f_manager');
    expect(InvestorType.safeParse('retail').success).toBe(false);
  });
});
