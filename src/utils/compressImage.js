// Shrinks a photo in the browser before it goes to Supabase storage: scales
// it so the longest side is at most `maxSide` px and re-encodes it as WebP.
// Phone photos and PNG exports were landing at 400-750 KB each and slowing
// every page that shows the menu; this brings them to roughly 40-120 KB.
// Returns the original file when it can't help (GIF/SVG, unsupported
// browser, or the result isn't smaller).
export async function compressImage(file, { maxSide = 1000, quality = 0.82 } = {}) {
  if (!file || !/^image\/(png|jpe?g|webp|heic|heif)$/i.test(file.type || '')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    // Safari before 16 can't encode WebP and silently returns PNG: keep
    // whichever is smaller.
    if (!blob || blob.size >= file.size) return file;
    const ext = blob.type === 'image/webp' ? 'webp' : (blob.type.split('/')[1] || 'png');
    const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.${ext}`, { type: blob.type });
  } catch {
    return file;
  }
}
