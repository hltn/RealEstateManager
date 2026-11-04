/**
 * Sinh bộ icon PWA từ MỘT file logo nguồn.
 *
 * Cách dùng (chạy trong RealEstateAdminApp/):
 *   node scripts/generate-pwa-icons.mjs
 *   node scripts/generate-pwa-icons.mjs --source=src/images/logo/logo.png --bg=#101828 --kernel=lanczos3
 *
 * Đổi logo: thay file nguồn (mặc định src/images/logo/logo.png) rồi chạy lại script, sau đó commit các PNG trong public/.
 * Build KHÔNG phụ thuộc script này: các PNG đã nằm sẵn trong public/.
 *
 * Tuỳ chọn:
 *   --source=<đường dẫn>   logo nguồn (PNG nền trong suốt; không cần vuông)
 *   --bg=<#rrggbb>         màu nền icon (mặc định #101828, trùng nền tối của app)
 *   --kernel=<tên>         thuật toán phóng: lanczos3 (mặc định, mượt) | nearest (giữ pixel vuông, hợp pixel-art)
 *
 * Đầu ra (public/):
 *   pwa-192x192.png, pwa-512x512.png        icon "any": logo ~72% chiều cao, nền đặc
 *   pwa-maskable-512x512.png                icon "maskable": logo ~60% chiều cao (vùng an toàn của Android, lề ~20%)
 *   apple-touch-icon.png                    180x180, NỀN ĐẶC KHÔNG TRONG SUỐT (iOS tự tô đen phần trong suốt)
 *   favicon-32x32.png, favicon-48x48.png    favicon: logo nền trong suốt, lề nhỏ
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicDir = resolve(appRoot, 'public')

/** Đọc cờ dạng --ten=giatri; trả về mặc định nếu không truyền. */
const readFlag = (name, fallback) => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const sourcePath = resolve(appRoot, readFlag('source', 'src/images/logo/logo.png'))
const background = readFlag('bg', '#101828')
const kernel = readFlag('kernel', 'lanczos3')

if (!/^#[0-9a-fA-F]{6}$/.test(background)) {
  throw new Error(`--bg phải có dạng #rrggbb, nhận được: ${background}`)
}
if (!Object.keys(sharp.kernel).includes(kernel)) {
  throw new Error(`--kernel không hợp lệ: ${kernel}. Hợp lệ: ${Object.keys(sharp.kernel).join(', ')}`)
}

/**
 * Dựng icon vuông `size`x`size`: logo căn giữa, cao `logoRatio` * size (giữ tỉ lệ gốc, không bị tràn ngang).
 * `solid` = true: nền đặc `background`; false: nền trong suốt (dùng cho favicon).
 */
const buildIcon = async ({ size, logoRatio, solid }) => {
  const meta = await sharp(sourcePath).metadata()
  const maxHeight = Math.round(size * logoRatio)
  // Logo cao hơn rộng nên giới hạn theo chiều cao; kiểm tra thêm chiều rộng để logo ngang vẫn nằm trong lề.
  const scale = Math.min(maxHeight / meta.height, (size * logoRatio) / meta.width)
  const logoBuffer = await sharp(sourcePath)
    .resize({
      width: Math.round(meta.width * scale),
      height: Math.round(meta.height * scale),
      kernel,
    })
    .png()
    .toBuffer()

  const canvas = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: solid ? background : { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: logoBuffer, gravity: 'center' }])
  // Icon nền đặc: bỏ kênh alpha để iOS/Android không coi là trong suốt. Favicon giữ alpha.
  return solid ? canvas.removeAlpha() : canvas
}

const targets = [
  { file: 'pwa-192x192.png', size: 192, logoRatio: 0.72, solid: true },
  { file: 'pwa-512x512.png', size: 512, logoRatio: 0.72, solid: true },
  { file: 'pwa-maskable-512x512.png', size: 512, logoRatio: 0.6, solid: true },
  { file: 'apple-touch-icon.png', size: 180, logoRatio: 0.72, solid: true },
  { file: 'favicon-32x32.png', size: 32, logoRatio: 0.94, solid: false },
  { file: 'favicon-48x48.png', size: 48, logoRatio: 0.94, solid: false },
]

await mkdir(publicDir, { recursive: true })
for (const target of targets) {
  const icon = await buildIcon(target)
  await icon.png({ compressionLevel: 9 }).toFile(resolve(publicDir, target.file))
  console.log(`Đã tạo public/${target.file} (${target.size}x${target.size})`)
}
console.log(`Xong. Nguồn: ${sourcePath}, nền: ${background}, kernel: ${kernel}`)
