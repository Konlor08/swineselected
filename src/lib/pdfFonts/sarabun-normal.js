import { SARABUN_REGULAR_BASE64 } from "./sarabun-regular-base64";

const REGISTRY_KEY = "__sarabun_normal_registered__";

export function registerSarabunNormal(jsPDF) {
  if (!jsPDF?.API?.addFileToVFS || !jsPDF?.API?.addFont) {
    throw new Error("jsPDF font API is not available");
  }

  if (globalThis[REGISTRY_KEY]) return;

  const fontData = String(SARABUN_REGULAR_BASE64 || "").trim();

  if (!fontData || fontData === "__PUT_SARABUN_REGULAR_BASE64_HERE__") {
    throw new Error(
      "Sarabun-Regular base64 is missing. Please paste real base64 into sarabun-regular-base64.js"
    );
  }

  jsPDF.API.addFileToVFS("Sarabun-Regular.ttf", fontData);
  jsPDF.API.addFont("Sarabun-Regular.ttf", "Sarabun", "normal");

  globalThis[REGISTRY_KEY] = true;
}