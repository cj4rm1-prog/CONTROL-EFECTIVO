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

async function ensureColumn(table, column, definition) {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  const existe = info.rows.some((r) => r.name === column);
  if (!existe) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[db] Columna agregada: ${table}.${column}`);
  }
}

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
      caja_id INTEGER,
      creado_en TEXT DEFAULT (datetime('now'))
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS cajas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      estado TEXT NOT NULL CHECK (estado IN ('abierta','cerrada')) DEFAULT 'abierta',
      saldo_inicial REAL NOT NULL DEFAULT 0,
      medio_apertura TEXT,
      saldo_final REAL,
      fecha_apertura TEXT NOT NULL,
      fecha_cierre TEXT,
      usuario_apertura TEXT,
      usuario_cierre TEXT,
      nota TEXT,
      creado_en TEXT DEFAULT (datetime('now'))
    );
  `);

  // Por si la tabla movimientos ya existía de una versión anterior sin caja_id
  await ensureColumn("movimientos", "caja_id", "INTEGER");

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos(fecha);`
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_movimientos_caja ON movimientos(caja_id);`
  );
  // Garantiza a nivel de base de datos que solo pueda existir UNA caja abierta a la vez
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_una_caja_abierta ON cajas(estado) WHERE estado = 'abierta';`
  );

  console.log("[db] Esquema listo.");
}

module.exports = { db, initDb, CATEGORIAS_GASTO, MEDIOS_PAGO };
