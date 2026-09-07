import { FIELD_NOTES } from './FieldNotes.js';

const PREFIX = 'abyssal-field-photo-v1:';
export const PHOTO_LIMIT = 48000;
export function validPhoto(value) {
  return typeof value === 'string' && value.length <= PHOTO_LIMIT && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
export function readPhoto(storage, type) {
  if (!Object.hasOwn(FIELD_NOTES, type)) return null;
  try { const value = storage?.getItem(PREFIX + type); return validPhoto(value) ? value : null; } catch { return null; }
}
export function savePhoto(storage, type, photo) {
  if (!Object.hasOwn(FIELD_NOTES, type) || !validPhoto(photo)) return false;
  try { if (!storage) return false; storage.setItem(PREFIX + type, photo); return true; } catch { return false; }
}

// Frame an identified animal with some of its habitat. Projection coordinates
// and canvas pixels share an aspect ratio, regardless of internal render scale.
export function photoFrame(width, height, candidate) {
  if (!(width > 0 && height > 0) || ![width, height, candidate?.x, candidate?.y, candidate?.apparent].every(Number.isFinite)) return null;
  const h = Math.min(height, width * .75, Math.max(height * .12, candidate.apparent * height * 1.8));
  const w = h * 4 / 3;
  return { x: Math.max(0, Math.min(width - w, (candidate.x + 1) * width / 2 - w / 2)),
    y: Math.max(0, Math.min(height - h, (1 - candidate.y) * height / 2 - h / 2)), width: w, height: h };
}

export function photograph(canvas, candidate) {
  const r = photoFrame(canvas.width, canvas.height, candidate);
  if (!r) return null;
  try {
    const photo = document.createElement('canvas'); photo.width = 480; photo.height = 360;
    photo.getContext('2d').drawImage(canvas, r.x, r.y, r.width, r.height, 0, 0, 480, 360);
    for (const quality of [.72, .52, .36]) {
      const value = photo.toDataURL('image/jpeg', quality);
      if (validPhoto(value)) return value;
    }
  } catch { /* A failed capture must leave an existing photograph intact. */ }
  return null;
}

export function appendPhoto(article, type, value) {
  if (!Object.hasOwn(FIELD_NOTES, type) || !validPhoto(value)) return;
  const figure = document.createElement('figure'); figure.className = 'journal-photo';
  const img = document.createElement('img'); img.src = value; img.alt = `Your field photograph of ${FIELD_NOTES[type][0].toLowerCase()}`;
  img.width = 480; img.height = 360; img.loading = 'lazy'; img.decoding = 'async';
  img.onerror = () => figure.remove();
  const caption = document.createElement('figcaption'), label = document.createElement('span'), download = document.createElement('a');
  label.textContent = 'FIELD PHOTOGRAPH'; download.textContent = 'Save photo'; download.download = `kestrel-${type}.jpg`; download.href = value;
  caption.append(label, download); figure.append(img, caption); article.prepend(figure);
}
