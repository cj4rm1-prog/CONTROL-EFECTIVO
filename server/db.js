const { createClient } = require("@libsql/client");

if (!process.env.TURSO_DATABASE_URL) {
  console.error(
    "[db] Falta TURSO_DATABASE_URL. Configura las variables de entorno (ver README)."
  );
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Categorías de consumo (solo aplican a movimientos tipo "gasto")
const CATEGORIAS_GASTO = [
  "Alimentación",
  "Salud",
  "Transporte",
  "Servicios",
  "Entretenimiento",
  "Educación",
  "Hogar",
  "Otros",
];

const MEDIOS_PAGO = ["efectivo", "tarjeta", "transferencia"];

async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS movimientos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL CHECK (tipo IN ('ingreso','gasto')),
      monto REAL NOT NULL CHECK (monto > 0),
      medio_pago TEXT NOT NULL CHECK (medio_pago IN ('efectivo','tarjeta','transferencia')),
      categoria TEXT NOT NULL,
      descripcion TEXT,
      fecha TEXT NOT NULL,
      usuario TEXT,
      origen TEXT DEFAULT 'web',
      creado_en TEXT DEFAULT (datetime('now'))
    );
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos(fecha);`
  );
  console.log("[db] Esquema listo.");
}

module.exports = { db, initDb, CATEGORIAS_GASTO, MEDIOS_PAGO };
