import { SARABUN_REGULAR_BASE64 } from "./sarabun-regular-base64";

function resolveFontTarget(target) {
  if (
    target &&
    typeof target.addFileToVFS === "function" &&
    typeof target.addFont === "function"
  ) {
    return target;
  }

  const api =
    target?.API ||
    target?.constructor?.API ||
    target?.__proto__?.constructor?.API ||
    null;

  if (
    api &&
    typeof api.addFileToVFS === "function" &&
    typeof api.addFont === "function"
  ) {
    return api;
  }

  return null;
}

export function registerSarabunNormal(target) {
  const fontTarget = resolveFontTarget(target);

  if (!fontTarget) {
    throw new Error("jsPDF font API is not available");
  }

  const fontData = String(SARABUN_REGULAR_BASE64 || "")
    .replace(/\s+/g, "")
    .trim();

  if (!fontData || fontData === "__PUT_SARABUN_REGULAR_BASE64_HERE__") {
    throw new Error(
      "Sarabun-Regular base64 is missing. Please generate or paste real base64 into sarabun-regular-base64.js"
    );
  }

  const fontList =
    typeof target?.getFontList === "function" ? target.getFontList() : {};

  const alreadyRegistered =
    fontList?.Sarabun &&
    Array.isArray(fontList.Sarabun) &&
    fontList.Sarabun.includes("normal");

  if (alreadyRegistered) return;

  fontTarget.addFileToVFS("Sarabun-Regular.ttf", fontData);
  fontTarget.addFont("Sarabun-Regular.ttf", "Sarabun", "normal");
}