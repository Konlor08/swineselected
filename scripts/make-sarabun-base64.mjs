import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function firstExistingPath(candidates) {
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function resolveFontPath(fileName) {
  const candidates = [
    path.join(projectRoot, "fonts", fileName),
    path.join(projectRoot, "src", "assets", "fonts", fileName),
    path.join(projectRoot, "src", "lib", "pdfFonts", fileName),
  ];

  const found = firstExistingPath(candidates);

  if (!found) {
    throw new Error(
      `Font file not found: ${fileName}\n` +
        `Please place it in one of these folders:\n` +
        candidates.map((x) => `- ${x}`).join("\n")
    );
  }

  return found;
}

function writeBase64Module(inputTtfPath, outputJsPath, exportName) {
  const absOutput = path.resolve(projectRoot, outputJsPath);
  const base64 = fs.readFileSync(inputTtfPath).toString("base64");

  const content = `export const ${exportName} = \`
${base64}
\`;
`;

  fs.mkdirSync(path.dirname(absOutput), { recursive: true });
  fs.writeFileSync(absOutput, content, "utf8");
  console.log(`written: ${absOutput}`);
}

const regularFontPath = resolveFontPath("Sarabun-Regular.ttf");
const boldFontPath = resolveFontPath("Sarabun-Bold.ttf");

writeBase64Module(
  regularFontPath,
  "src/lib/pdfFonts/sarabun-regular-base64.js",
  "SARABUN_REGULAR_BASE64"
);

writeBase64Module(
  boldFontPath,
  "src/lib/pdfFonts/sarabun-bold-base64.js",
  "SARABUN_BOLD_BASE64"
);

console.log("Done.");