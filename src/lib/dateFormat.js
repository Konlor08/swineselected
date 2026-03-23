// src/lib/dateFormat.js

function clean(v) {
  return String(v ?? "").trim();
}

function pad2(v) {
  return String(v).padStart(2, "0");
}

function toDateSafe(v) {
  const s = clean(v);
  if (!s) return null;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;

  return d;
}

export function formatDateDisplay(v) {
  const s = clean(v);
  if (!s) return "-";

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  const d = toDateSafe(s);
  if (!d) return s;

  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export function formatDateTimeDisplay(v) {
  const s = clean(v);
  if (!s) return "-";

  const d = toDateSafe(s);
  if (!d) return s;

  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}