import { describe, expect, it } from 'vitest';
import { capabilitiesOf, withinReplyWindow } from './capabilities.js';
describe('capabilitiesOf', () => {
  it('gives Meta kinds a 24 h window', () => {
    expect(capabilitiesOf('facebook').replyWindowHours).toBe(24);
    expect(capabilitiesOf('instagram').replyWindowHours).toBe(24);
  });
  it('lets Meta kinds and the website show quick replies', () => {
    expect(capabilitiesOf('facebook').quickReplies).toBe(true);
    expect(capabilitiesOf('instagram').quickReplies).toBe(true);
    expect(capabilitiesOf('website').quickReplies).toBe(true);
  });
  it('gives the website no window', () =>
    expect(capabilitiesOf('website').replyWindowHours).toBeNull());
  it('treats unknown kinds as 24 h', () =>
    expect(capabilitiesOf('nope').replyWindowHours).toBe(24));
});
describe('withinReplyWindow', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  it('closes Meta after 24 h', () => {
    expect(withinReplyWindow('facebook', new Date('2026-10-26T12:00:01Z'), now)).toBe(true);
    expect(withinReplyWindow('facebook', new Date('2026-10-26T12:00:00Z'), now)).toBe(false);
  });
  it('never closes the website', () =>
    expect(withinReplyWindow('website', new Date('2020-01-01T00:00:00Z'), now)).toBe(true));
});
