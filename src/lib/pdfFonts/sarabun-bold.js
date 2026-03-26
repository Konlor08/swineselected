import { SARABUN_BOLD_BASE64 } from "./sarabun-bold-base64";

const REGISTRY_KEY = "__sarabun_bold_registered__";

export function registerSarabunBold(jsPDF) {
  if (!jsPDF?.API?.addFileToVFS || !jsPDF?.API?.addFont) {
    throw new Error("jsPDF font API is not available");
  }

  if (globalThis[REGISTRY_KEY]) return;

  const fontData = String(SARABUN_BOLD_BASE64 || "").trim();

  if (!fontData || fontData === "__PUT_SARABUN_BOLD_BASE64_HERE__") {
    throw new Error(
      "Sarabun-Bold base64 is missing. Please paste real base64 into sarabun-bold-base64.js"
    );
  }

  jsPDF.API.addFileToVFS("Sarabun-Bold.ttf", fontData);
  jsPDF.API.addFont("Sarabun-Bold.ttf", "Sarabun", "bold");

  globalThis[REGISTRY_KEY] = true;
}