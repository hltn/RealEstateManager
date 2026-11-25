/** v1.0.5: luồng xin tham gia đã bỏ. Mã nguồn FE (trừ test) không còn tham chiếu hook/view/dialog cũ. */
import { describe, expect, it } from 'vitest';

const BANNED = ['useCareTeamRequests', 'CareTeamRequestView', 'CareTeamRequestsDialog', 'ApproveRequestDialog', 'approveCareTeamRequest', 'rejectCareTeamRequest', 'requestCareTeamJoin', 'care-team-requests/'];

const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../test/**'], { query: '?raw', import: 'default', eager: true });

describe('không còn UI xin tham gia nhóm chăm sóc', () => {
  it('quét được mã nguồn module CRM (không quét rỗng)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it.each(BANNED)('mã nguồn không tham chiếu "%s"', (token) => {
    const offenders = Object.entries(sources)
      .filter(([, content]) => content.includes(token))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
