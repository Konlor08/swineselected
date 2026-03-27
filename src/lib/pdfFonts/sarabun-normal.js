import { SARABUN_REGULAR_BASE64 } from "./sarabun-regular-base64";

const REGISTRY_KEY = "__sarabun_normal_registered__";

function getFontApi(target) {
  return (
    target?.API ||
    target?.constructor?.API ||
    target?.__proto__?.constructor?.API ||
    null
  );
}

export function registerSarabunNormal(target) {
  const api = getFontApi(target);

  if (!api?.addFileToVFS || !api?.addFont) {
    throw new Error("jsPDF font API is not available");
  }

  if (globalThis[REGISTRY_KEY]) return;

  const fontData = String(SARABUN_REGULAR_BASE64 || "").trim();

  if (!fontData || fontData === "__PUT_SARABUN_REGULAR_BASE64_HERE__") {
    throw new Error(
      "Sarabun-Regular base64 is missing. Please generate or paste real base64 into sarabun-regular-base64.js"
    );
  }

  api.addFileToVFS("Sarabun-Regular.ttf", fontData);
  api.addFont("Sarabun-Regular.ttf", "Sarabun", "normal");

  globalThis[REGISTRY_KEY] = true;
}