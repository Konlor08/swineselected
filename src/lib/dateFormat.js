export function formatDateDisplay(v) {
  const s = String(v ?? "").trim();
  if (!s) return "-";

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;

  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}