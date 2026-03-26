export function registerSarabunNormal(jsPDF) {
  jsPDF.API.addFileToVFS("Sarabun-Regular.ttf", "BASE64_FONT_DATA");
  jsPDF.API.addFont("Sarabun-Regular.ttf", "Sarabun", "normal");
}