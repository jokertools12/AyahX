import { api } from './api';

/**
 * Downloads a saved server render with the same authenticated API path used
 * by the preview page. A plain <a> cannot attach the JWT kept in localStorage
 * and would otherwise receive a 401 response from the protected download
 * route.
 */
export async function downloadSavedVideo(videoUrl: string, filename: string): Promise<void> {
  const url = new URL(videoUrl, window.location.origin);
  if (url.origin !== window.location.origin) {
    throw new Error('رابط الفيديو الخارجي انتهت صلاحيته، يرجى إعادة إنتاج الفيديو.');
  }

  const match = url.pathname.match(/^\/api\/render-jobs\/([^/]+)\/download$/);
  if (!match) {
    throw new Error('رابط الفيديو غير صالح، يرجى إعادة إنتاج الفيديو من المعاينة.');
  }

  const blob = await api.renderJobs.downloadVideo(decodeURIComponent(match[1]));
  if (blob.size === 0) {
    throw new Error('ملف الفيديو فارغ، يرجى إعادة إنتاجه.');
  }

  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
