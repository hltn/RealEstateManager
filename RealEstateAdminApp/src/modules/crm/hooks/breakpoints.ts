/** Khớp breakpoint Tailwind `md` = 768px: dưới mức này dùng biến thể mobile của màn CRM. */
export const MOBILE_MAX_WIDTH_PX = 767;

export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_MAX_WIDTH_PX}px)`;

/** Khớp breakpoint Tailwind `lg` = 1024px: dưới mức này `lg:translate-x-0` của sidebar chưa áp dụng (sidebar là ngăn kéo). */
export const BELOW_LG_MAX_WIDTH_PX = 1023;

export const BELOW_LG_MEDIA_QUERY = `(max-width: ${BELOW_LG_MAX_WIDTH_PX}px)`;
