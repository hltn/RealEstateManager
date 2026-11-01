import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { formatIsoDateVi } from '@crm/lib/dateTime';
import { PEAK_DAY_MIN_APPOINTMENTS } from '../appointmentSchedule';
import { MiniMonthCalendar } from './MiniMonthCalendar';

const SELECTED = '2026-10-15';
const TODAY = '2026-10-20';
const PLAIN = '2026-10-10';
const BUSY = '2026-10-12';
const BELOW_PEAK = '2026-10-13';
const PEAK = '2026-10-14';
const TODAY_PEAK = '2026-10-21';
const OUT_OF_MONTH_PEAK = '2026-11-01';

const renderCalendar = (counts: Record<string, number> = {}) =>
  render(
    <MiniMonthCalendar
      selectedDate={SELECTED}
      todayIso={TODAY}
      countsByDate={{
        [BUSY]: 1,
        [BELOW_PEAK]: PEAK_DAY_MIN_APPOINTMENTS - 1,
        [PEAK]: PEAK_DAY_MIN_APPOINTMENTS,
        [TODAY_PEAK]: PEAK_DAY_MIN_APPOINTMENTS,
        [OUT_OF_MONTH_PEAK]: PEAK_DAY_MIN_APPOINTMENTS,
        ...counts,
      }}
      onSelectDate={() => {}}
    />,
  );

// Nút ngày: tên bắt đầu "Chọn ngày <dd/mm/yyyy>", có thể kèm ", có N lịch hẹn".
const dayButton = (iso: string) => screen.getByRole('button', { name: new RegExp(`^Chọn ngày ${formatIsoDateVi(iso)}(,|$)`) });
const dayClass = (iso: string) => dayButton(iso).className;
const hasOrange = (cls: string) => cls.includes('warning-');
const hasToken = (cls: string, token: string) => cls.split(/\s+/).includes(token);
const tokens = (cls: string, prefix: string) => cls.split(/\s+/).filter((token) => token.startsWith(prefix));
const legendDotClass = (label: string) => (screen.getByText(label).firstElementChild as HTMLElement).className;

describe('MiniMonthCalendar - màu ngày', () => {
  it('ngày có lịch hẹn: nền + chữ cam, hover đủ tương phản, có biến thể dark', () => {
    renderCalendar();
    const cls = dayClass(BUSY);
    expect(cls).toContain('bg-warning-100');
    expect(cls).toContain('text-warning-700');
    expect(cls).toContain('hover:bg-warning-200');
    expect(cls).toContain('hover:text-warning-800');
    expect(cls).toContain('dark:bg-warning-500/20');
    expect(cls).toContain('dark:text-warning-300');
    expect(cls).toContain('dark:hover:bg-warning-500/30');
  });

  it('ngày 0 lịch: không cam', () => {
    renderCalendar();
    expect(hasOrange(dayClass(PLAIN))).toBe(false);
  });

  it('ngày ngay dưới ngưỡng cao điểm vẫn là ngày thường có lịch', () => {
    renderCalendar();
    expect(dayClass(BELOW_PEAK)).toBe(dayClass(BUSY));
    expect(hasToken(dayClass(BELOW_PEAK), 'bg-warning-500')).toBe(false);
  });

  it('ngày cao điểm: nền cam đậm + chữ gray-900 (không phải text-white), khác ngày thường có lịch', () => {
    renderCalendar();
    const cls = dayClass(PEAK);
    expect(hasToken(cls, 'bg-warning-500')).toBe(true);
    expect(hasToken(cls, 'text-gray-900')).toBe(true);
    expect(cls).not.toContain('text-white');
    expect(cls).not.toBe(dayClass(BUSY));
  });

  it('ngày chọn thắng cam, kể cả cao điểm', () => {
    renderCalendar({ [SELECTED]: PEAK_DAY_MIN_APPOINTMENTS });
    expect(dayClass(SELECTED)).toContain('bg-brand-500');
    expect(hasOrange(dayClass(SELECTED))).toBe(false);
  });

  it('ngày ngoài tháng không cam; bấm Tháng sau thì 1/11 thành ngày cao điểm cam', () => {
    renderCalendar();
    expect(hasOrange(dayClass(OUT_OF_MONTH_PEAK))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Tháng sau' }));
    expect(screen.getByText('Lịch tháng 11/2026')).toBeInTheDocument();
    expect(hasToken(dayClass(OUT_OF_MONTH_PEAK), 'bg-warning-500')).toBe(true);
  });

  it('vòng hôm nay: có ở hôm nay (kể cả cao điểm), không có ở ngày khác', () => {
    renderCalendar({ [TODAY]: PEAK_DAY_MIN_APPOINTMENTS });
    expect(dayClass(TODAY)).toContain('ring-brand-300');
    expect(hasToken(dayClass(TODAY), 'bg-warning-500')).toBe(true);
    expect(dayClass(TODAY_PEAK)).not.toContain('ring-brand-300');
    expect(dayClass(BUSY)).not.toContain('ring-brand-300');
    expect(dayClass(PLAIN)).not.toContain('ring-brand-300');
  });
});

describe('MiniMonthCalendar - aria-label, chấm, chú giải', () => {
  it('aria-label nêu số lịch hẹn khi có lịch, giữ nguyên khi 0 lịch', () => {
    renderCalendar();
    expect(dayButton(BUSY)).toHaveAccessibleName(`Chọn ngày ${formatIsoDateVi(BUSY)}, có 1 lịch hẹn`);
    expect(dayButton(PEAK)).toHaveAccessibleName(`Chọn ngày ${formatIsoDateVi(PEAK)}, có ${PEAK_DAY_MIN_APPOINTMENTS} lịch hẹn`);
    expect(dayButton(PLAIN)).toHaveAccessibleName(`Chọn ngày ${formatIsoDateVi(PLAIN)}`);
  });

  it('ngày chọn có lịch hiện chấm cam; không có lịch thì không', () => {
    const { unmount } = renderCalendar({ [SELECTED]: 2 });
    expect(screen.getByTestId('selected-has-appointments')).toBeInTheDocument();
    unmount();
    renderCalendar();
    expect(screen.queryByTestId('selected-has-appointments')).not.toBeInTheDocument();
  });

  it('chú giải có đủ 3 mục', () => {
    renderCalendar();
    for (const label of ['Ngày chọn', 'Có lịch hẹn', 'Ngày cao điểm']) expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('màu chấm chú giải khớp lớp màu nền của ô tương ứng (light + dark)', () => {
    renderCalendar({ [SELECTED]: 1 });
    const pairs: Array<[string, string]> = [
      ['Ngày chọn', 'bg-brand-500'],
      ['Có lịch hẹn', dayClass(BUSY)],
      ['Ngày cao điểm', dayClass(PEAK)],
    ];
    for (const [label, tile] of pairs) {
      const dot = legendDotClass(label);
      const tileBg = tile.startsWith('bg-') && !tile.includes(' ') ? [tile] : [...tokens(tile, 'bg-'), ...tokens(tile, 'dark:bg-')];
      expect(tileBg.length).toBeGreaterThan(0);
      for (const bg of tileBg) expect(dot).toContain(bg);
    }
  });
});
