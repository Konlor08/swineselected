export function registerSarabunBold(jsPDF) {
  jsPDF.API.addFileToVFS("Sarabun-Bold.ttf", "BASE64_FONT_DATA");
  jsPDF.API.addFont("Sarabun-Bold.ttf", "Sarabun", "bold");
}