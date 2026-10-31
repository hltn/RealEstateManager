/** Hàm thuần về danh tính người dùng (avatar chữ). */

/** "Trần Mỹ Hạnh" -> "TH" (chữ cái đầu của từ đầu và từ cuối) — avatar chữ của nhân viên / khách. */
export const getInitials = (fullName: string): string => {
  const words = fullName
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0].charAt(0);
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : '';
  return `${first}${last}`.toUpperCase();
};
