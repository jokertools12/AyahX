import { URL } from 'url';
import path from 'path';
import fs from 'fs';
import { RenderManifest } from '../models/renderManifest';

export interface SecurityCheckResult {
  safe: boolean;
  reason?: string;
}

// Inline images are intentionally supported for premium AI/custom
// backgrounds. Do not accept arbitrary data: URLs: the render harness should
// only ever receive a base64-encoded raster image, never HTML/SVG/script data.
const SAFE_INLINE_IMAGE_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i;

function validateBackgroundAssetUrl(url: string, label: string): SecurityCheckResult {
  if (!url || url.startsWith('#')) {
    return { safe: true };
  }

  if (url.startsWith('data:')) {
    return SAFE_INLINE_IMAGE_URL.test(url)
      ? { safe: true }
      : { safe: false, reason: `${label} بصيغة data URL غير مسموحة` };
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const result = validateUrlForSsrf(url);
    return result.safe
      ? result
      : { safe: false, reason: `${label} غير آمن: ${result.reason}` };
  }

  return { safe: false, reason: `${label} يجب أن يكون رابط HTTPS أو صورة data:image آمنة` };
}

// Trusted domain allowlist for audio and visual CDN assets
const TRUSTED_DOMAINS = [
  'audio.qurancdn.com',
  'verses.quran.com',
  'download.quranicaudio.com',
  'everyayah.com',
  'www.everyayah.com',
  'api.quran.com',
  'images.unsplash.com',
  // Premium Pexels selections contain an image thumbnail and a direct video
  // file URL on these first-party CDN hosts. They must remain accepted when
  // STRICT_ASSET_DOMAINS is enabled, otherwise the advertised feature would
  // work in the browser but be rejected by the cloud renderer.
  'images.pexels.com',
  'videos.pexels.com',
  'assets.mixkit.co',
  'cdn.pixabay.com',
  'commondatastorage.googleapis.com',
  'localhost',
  '127.0.0.1',
];

/**
 * Validates whether a given URL is safe against SSRF attacks (private IPs, loopback, cloud metadata)
 */
export function validateUrlForSsrf(urlStr: string): SecurityCheckResult {
  try {
    const parsed = new URL(urlStr);

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { safe: false, reason: `بروتوكول غير مسموح به: ${parsed.protocol}` };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Check link-local and cloud metadata address
    if (hostname === '169.254.169.254' || hostname.startsWith('169.254.')) {
      return { safe: false, reason: 'محاولة وصول غير مصرح بها لعنوان تعريف السحابة (Metadata SSRF blocked)' };
    }

    // Check localhost / loopback
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0'
    ) {
      // Allow localhost ONLY in test/development if explicitly needed, otherwise block
      if (process.env.NODE_ENV === 'production') {
        return { safe: false, reason: 'الوصول لعناوين Loopback محظور في بيئة الإنتاج' };
      }
    }

    // Check private RFC1918 IPv4 ranges
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = hostname.match(ipv4Regex);
    if (ipMatch) {
      const octet1 = parseInt(ipMatch[1], 10);
      const octet2 = parseInt(ipMatch[2], 10);

      // 10.0.0.0/8
      if (octet1 === 10) {
        return { safe: false, reason: 'الوصول للشبكات الداخلية 10.0.0.0/8 محظور (Private IP blocked)' };
      }
      // 172.16.0.0/12
      if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) {
        return { safe: false, reason: 'الوصول للشبكات الداخلية 172.16.0.0/12 محظور (Private IP blocked)' };
      }
      // 192.168.0.0/16
      if (octet1 === 192 && octet2 === 168) {
        return { safe: false, reason: 'الوصول للشبكات الداخلية 192.168.0.0/16 محظور (Private IP blocked)' };
      }
    }

    // Check trusted domain allowlist or trusted suffix
    const isDomainTrusted = TRUSTED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );

    if (!isDomainTrusted && process.env.STRICT_ASSET_DOMAINS === 'true') {
      return { safe: false, reason: `النطاق ${hostname} غير مدرج في قائمة النطاقات الموثوقة` };
    }

    return { safe: true };
  } catch (err: any) {
    return { safe: false, reason: `رابط غير صالح: ${err.message}` };
  }
}

/**
 * Validates that local file paths stay within the allowed boundaries (prevents path traversal)
 */
export function validateLocalFilePath(baseDir: string, relativeOrAbsoluteTarget: string): SecurityCheckResult {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, relativeOrAbsoluteTarget);

  if (!resolvedTarget.startsWith(resolvedBase)) {
    return { safe: false, reason: 'محاولة اختراق المسار (Path traversal attempt detected)' };
  }

  // Prevent null-byte injection
  if (relativeOrAbsoluteTarget.includes('\0')) {
    return { safe: false, reason: 'حقن بايت صفري في المسار (Null-byte detected)' };
  }

  return { safe: true };
}

/**
 * Validates all asset URLs and bounds in a RenderManifest
 */
export function validateManifestAssets(manifest: RenderManifest): SecurityCheckResult {
  // If audioUrl is somehow still a blob URL, heal if everyAyahUrls is present
  if (manifest.audio.audioUrl.startsWith('blob:') && manifest.audio.everyAyahUrls && manifest.audio.everyAyahUrls.length > 0) {
    manifest.audio.audioUrl = manifest.audio.everyAyahUrls[0];
  }

  // 1. Validate Audio URL
  const audioCheck = validateUrlForSsrf(manifest.audio.audioUrl);
  if (!audioCheck.safe) {
    return { safe: false, reason: `رابط الصوت غير آمن: ${audioCheck.reason}` };
  }

  // 2. Validate EveryAyah URLs if provided
  if (manifest.audio.everyAyahUrls) {
    for (const url of manifest.audio.everyAyahUrls) {
      const eaCheck = validateUrlForSsrf(url);
      if (!eaCheck.safe) {
        return { safe: false, reason: `رابط تلاوة EveryAyah غير آمن: ${eaCheck.reason}` };
      }
    }
  }

  // 3. Validate the selected background. Premium custom/AI images may be
  // data:image URLs, while all other external media must pass SSRF checks.
  const bgCheck = validateBackgroundAssetUrl(manifest.background.url, 'رابط الخلفية');
  if (!bgCheck.safe) {
    return bgCheck;
  }

  // 3b. Validate thumbnail by the same policy.
  if (manifest.background.thumbnail) {
    const thumbCheck = validateBackgroundAssetUrl(manifest.background.thumbnail, 'رابط صورة الخلفية المصغرة');
    if (!thumbCheck.safe) {
      return thumbCheck;
    }
  }

  // 4. Validate Slide Images if present
  if (manifest.background.slideImages) {
    for (const slideUrl of manifest.background.slideImages) {
      const slideCheck = validateBackgroundAssetUrl(slideUrl, 'رابط صورة العرض');
      if (!slideCheck.safe) {
        return slideCheck;
      }
    }
  }

  // 5. Bounds verification
  const maxDurationSec = parseInt(process.env.MAX_RENDER_DURATION_SEC || '600', 10);
  if (manifest.audio.durationSeconds > maxDurationSec) {
    return {
      safe: false,
      reason: `مدة الفيديو (${manifest.audio.durationSeconds} ثانية) تتجاوز الحد المسموح به (${maxDurationSec} ثانية)`,
    };
  }

  const totalFrames = Math.ceil(manifest.audio.durationSeconds * manifest.fps);
  const maxFrames = maxDurationSec * 60;
  if (totalFrames > maxFrames) {
    return { safe: false, reason: `عدد الإطارات المطلوب (${totalFrames}) يتجاوز الحد الأقصى (${maxFrames})` };
  }

  return { safe: true };
}
