// Se ejecuta automáticamente después de "npm install" (ver postinstall en package.json).
// Copia los archivos UMD de las librerías del lado del cliente (Chart.js, SheetJS) desde
// node_modules hacia client/vendor, para que el dashboard NO dependa de ningún CDN externo
// (algunos operadores/redes lo bloquean).
const fs = require("fs");
const path = require("path");

const destDir = path.join(__dirname, "..", "..", "client", "vendor");
fs.mkdirSync(destDir, { recursive: true });

const librerias = [
  {
    nombre: "Chart.js",
    candidatos: [
      path.join(__dirname, "..", "node_modules", "chart.js", "dist", "chart.umd.js"),
      path.join(__dirname, "..", "node_modules", "chart.js", "dist", "chart.umd.min.js"),
    ],
    destino: path.join(destDir, "chart.umd.js"),
  },
  {
    nombre: "SheetJS (xlsx)",
    candidatos: [
      path.join(__dirname, "..", "node_modules", "xlsx", "dist", "xlsx.full.min.js"),
      path.join(__dirname, "..", "node_modules", "xlsx", "dist", "xlsx.js"),
    ],
    destino: path.join(destDir, "xlsx.full.min.js"),
  },
];

for (const lib of librerias) {
  const origen = lib.candidatos.find((p) => fs.existsSync(p));
  if (!origen) {
    console.error(`[postinstall] No se encontró el build de ${lib.nombre} en node_modules.`);
    continue;
  }
  try {
    fs.copyFileSync(origen, lib.destino);
    console.log(`[postinstall] ${lib.nombre} copiado a ${lib.destino} (self-hosted, sin CDN externo).`);
  } catch (err) {
    console.error(`[postinstall] Error copiando ${lib.nombre}:`, err.message);
  }
}
