const express = require("express");
const {
  db,
  CATEGORIAS_GASTO,
  MEDIOS_PAGO,
} = require("../db");

const router = express.Router();

// --- Auth simple por API key compartida (opcional pero recomendado) ---
router.use((req, res, next) => {
  const required = process.env.DASHBOARD_KEY;
  if (!required) return next(); // si no se configuró, no exige clave
  const provided = req.header("x-api-key");
  if (provided !== required) {
    return res.status(401).json({ error: "Clave inválida" });
  }
  next();
});

function buildWhere(query) {
  const clauses = [];
  const args = {};
  if (query.desde) {
    clauses.push("fecha >= :desde");
    args.desde = query.desde;
  }
  if (query.hasta) {
    clauses.push("fecha <= :hasta");
    args.hasta = query.hasta;
  }
  if (query.tipo && ["ingreso", "gasto"].includes(query.tipo)) {
    clauses.push("tipo = :tipo");
    args.tipo = query.tipo;
  }
  if (query.medio_pago && MEDIOS_PAGO.includes(query.medio_pago)) {
    clauses.push("medio_pago = :medio_pago");
    args.medio_pago = query.medio_pago;
  }
  if (query.categoria) {
    clauses.push("categoria = :categoria");
    args.categoria = query.categoria;
  }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  return { where, args };
}

// GET /api/movimientos
router.get("/movimientos", async (req, res) => {
  try {
    const { where, args } = buildWhere(req.query);
    const limit = Math.min(parseInt(req.query.limit) || 300, 1000);
    const result = await db.execute({
      sql: `SELECT * FROM movimientos ${where} ORDER BY fecha DESC, id DESC LIMIT :limit`,
      args: { ...args, limit },
    });
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar movimientos" });
  }
});

// GET /api/resumen  -> saldo actual, saldo por medio, gasto por categoría,
// gasto por día y por semana (siempre dentro del rango/filtros pedidos)
router.get("/resumen", async (req, res) => {
  try {
    const { where, args } = buildWhere(req.query);

    // Saldo actual y acumulados SIEMPRE son históricos totales (no se limitan
    // al rango de fechas elegido en el dashboard), para que el saldo sea real.
    const totalesGlobales = await db.execute(
      `SELECT tipo, medio_pago, SUM(monto) as total FROM movimientos GROUP BY tipo, medio_pago`
    );

    const saldoPorMedio = {};
    for (const m of MEDIOS_PAGO) saldoPorMedio[m] = 0;
    let saldoTotal = 0;
    for (const row of totalesGlobales.rows) {
      const signo = row.tipo === "ingreso" ? 1 : -1;
      saldoPorMedio[row.medio_pago] = (saldoPorMedio[row.medio_pago] || 0) + signo * (row.total || 0);
      saldoTotal += signo * (row.total || 0);
    }

    // Lo demás sí respeta el rango de fechas / filtros elegidos
    const totalesRango = await db.execute({
      sql: `SELECT tipo, SUM(monto) as total FROM movimientos ${where} GROUP BY tipo`,
      args,
    });
    let ingresosRango = 0;
    let gastosRango = 0;
    for (const row of totalesRango.rows) {
      if (row.tipo === "ingreso") ingresosRango = row.total || 0;
      if (row.tipo === "gasto") gastosRango = row.total || 0;
    }

    const porCategoria = await db.execute({
      sql: `SELECT categoria, SUM(monto) as total FROM movimientos ${where ? where + " AND" : "WHERE"} tipo = 'gasto' GROUP BY categoria ORDER BY total DESC`,
      args,
    });

    const porDia = await db.execute({
      sql: `SELECT fecha, tipo, SUM(monto) as total FROM movimientos ${where} GROUP BY fecha, tipo ORDER BY fecha ASC`,
      args,
    });

    // Agrupar por semana ISO (año-semana) usando strftime de SQLite
    const porSemana = await db.execute({
      sql: `SELECT strftime('%Y-W%W', fecha) as semana, tipo, SUM(monto) as total
            FROM movimientos ${where} GROUP BY semana, tipo ORDER BY semana ASC`,
      args,
    });

    res.json({
      saldoTotal,
      saldoPorMedio,
      ingresosRango,
      gastosRango,
      porCategoria: porCategoria.rows,
      porDia: porDia.rows,
      porSemana: porSemana.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al calcular resumen" });
  }
});

// GET /api/categorias
router.get("/categorias", (req, res) => {
  res.json({
    gasto: CATEGORIAS_GASTO,
    medios_pago: MEDIOS_PAGO,
  });
});

// POST /api/movimientos  (alta manual desde la web)
router.post("/movimientos", async (req, res) => {
  try {
    const { tipo, monto, medio_pago, categoria, descripcion, fecha, usuario } =
      req.body;

    if (!["ingreso", "gasto"].includes(tipo)) {
      return res.status(400).json({ error: "tipo inválido" });
    }
    if (!MEDIOS_PAGO.includes(medio_pago)) {
      return res.status(400).json({ error: "medio_pago inválido" });
    }
    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) {
      return res.status(400).json({ error: "monto inválido" });
    }
    const categoriaFinal = tipo === "ingreso" ? "Saldo" : categoria;
    if (!categoriaFinal) {
      return res.status(400).json({ error: "categoria requerida" });
    }

    const fechaFinal = fecha || new Date().toISOString().slice(0, 10);

    const result = await db.execute({
      sql: `INSERT INTO movimientos (tipo, monto, medio_pago, categoria, descripcion, fecha, usuario, origen)
            VALUES (:tipo, :monto, :medio_pago, :categoria, :descripcion, :fecha, :usuario, 'web')`,
      args: {
        tipo,
        monto: montoNum,
        medio_pago,
        categoria: categoriaFinal,
        descripcion: descripcion || null,
        fecha: fechaFinal,
        usuario: usuario || "web",
      },
    });

    res.status(201).json({ id: Number(result.lastInsertRowid) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear movimiento" });
  }
});

// DELETE /api/movimientos/:id
router.delete("/movimientos/:id", async (req, res) => {
  try {
    await db.execute({
      sql: `DELETE FROM movimientos WHERE id = :id`,
      args: { id: req.params.id },
    });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar movimiento" });
  }
});

module.exports = router;
