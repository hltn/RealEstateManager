/**
 * Logo store dạng inline SVG (không tải ảnh ngoài: PWA chạy offline, CSP chặn nguồn lạ) dùng cho 2 nút cài app (FR-27).
 * Chỉ là biểu tượng nhận diện nền tảng, KHÔNG phải badge chính thức "GET IT ON Google Play"/"Download on the App Store"
 * vì app là PWA, không có trên store thật.
 */

interface StoreIconProps {
  /** Cạnh ô vuông của logo (px). */
  size?: number;
}

/** Logo Google Play: tam giác 4 màu đặc trưng. */
export const GooglePlayIcon = ({ size = 18 }: StoreIconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" data-testid="google-play-icon">
    <path fill="#00A0FF" d="M3.6 1.8 13.2 12 3.6 22.2c-.4-.3-.6-.8-.6-1.4V3.2c0-.6.2-1.1.6-1.4Z" />
    <path fill="#00E176" d="M3.6 1.8c.4-.2.9-.2 1.4.1l11.5 6.6-3.3 3.5L3.6 1.8Z" />
    <path fill="#FFD500" d="m16.5 8.5 3.9 2.2c.8.5.8 2.1 0 2.6l-3.9 2.2-3.3-3.5 3.3-3.5Z" />
    <path fill="#FF3A44" d="m13.2 12 3.3 3.5L5 22.1c-.5.3-1 .3-1.4.1l9.6-10.2Z" />
  </svg>
);

/** Logo Apple: quả táo đơn sắc theo `currentColor` để hợp chế độ sáng/tối. */
export const AppleIcon = ({ size = 18 }: StoreIconProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true" focusable="false" data-testid="apple-icon">
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09ZM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701Z" />
  </svg>
);
