import { describe, expect, it } from 'vitest';
import { capabilitiesOf, replyWindow, withinReplyWindow } from './capabilities.js';
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
describe('replyWindow', () => {
  const now = new Date('2026-10-27T12:00:00Z');
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const member = { member: true, humanAgentTag: true };
  it('is open inside 24 h for everyone', () => {
    expect(replyWindow('facebook', ago(23), now)).toBe('open');
    expect(replyWindow('instagram', ago(23), now, member)).toBe('open');
  });
  it('lets a member answer with HUMAN_AGENT between 24 h and 7 days when the flag is on', () => {
    expect(replyWindow('facebook', ago(25), now, member)).toBe('human_agent');
    expect(replyWindow('instagram', ago(167), now, member)).toBe('human_agent');
    expect(replyWindow('facebook', ago(168), now, member)).toBe('closed');
  });
  it('never tags a bot or the care agent, nor a member while the flag is off', () => {
    expect(replyWindow('facebook', ago(25), now, { member: false, humanAgentTag: true })).toBe(
      'closed',
    );
    expect(replyWindow('facebook', ago(25), now, { member: true, humanAgentTag: false })).toBe(
      'closed',
    );
    expect(replyWindow('facebook', ago(25), now)).toBe('closed');
  });
  it('keeps the website open and other channels at 24 h without a tag', () => {
    expect(replyWindow('website', ago(500), now, member)).toBe('open');
    expect(replyWindow('zalo_oa', ago(25), now, member)).toBe('closed');
  });
});
