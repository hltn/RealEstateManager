import { describe, expect, it } from 'vitest';
import { isValidEmail } from './email';

describe('isValidEmail', () => {
  it.each(['', '   ', 'an@example.com', ' bich.tran@investor.vn ', 'a+b@sub.domain.vn'])('chấp nhận %j', (value) => {
    expect(isValidEmail(value)).toBe(true);
  });
  it.each(['abc', 'a@b', 'a@@b.com', 'a b@c.com', '@c.com', 'a@.com', 'a@c..com', `${'x'.repeat(250)}@a.vn`])('từ chối %j', (value) => {
    expect(isValidEmail(value)).toBe(false);
  });
});
