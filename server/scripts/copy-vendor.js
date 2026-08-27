// Se ejecuta automáticamente después de "npm install" (ver postinstall en package.json).
// Copia el archivo UMD de Chart.js desde node_modules hacia client/vendor, para que el
// dashboard NO dependa de ningún CDN externo (algunos operadores/redes lo bloquean).
const fs = require("fs");
const path = require("path");

const candidatos = [
  path.join(__dirname, "..", "node_modules", "chart.js", "dist", "chart.umd.js"),
  path.join(__dirname, "..", "node_modules", "chart.js", "dist", "chart.umd.min.js"),
];

const destDir = path.join(__dirname, "..", "..", "client", "vendor");
const dest = path.join(destDir, "chart.umd.js");

const origen = candidatos.find((p) => fs.existsSync(p));

if (!origen) {
  console.error(
    "[postinstall] No se encontró el build UMD de chart.js en node_modules. " +
      "El dashboard no tendrá gráficos hasta que se resuelva esto."
  );
  process.exit(0); // no rompemos el deploy por esto
}

try {
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(origen, dest);
  console.log(`[postinstall] Chart.js copiado a ${dest} (self-hosted, sin CDN externo).`);
} catch (err) {
  console.error("[postinstall] Error copiando Chart.js:", err.message);
}
