const express = require("express");
const { db, CATEGORIAS_GASTO, MEDIOS_PAGO } = require("../db");
const { cajaAbierta, saldoDeCaja, abrirCaja, cerrarCaja } = require("../cajas");
const { fechaEcuador } = require("../fecha");

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

function buildWhere(query, cajaId) {
  const clauses = [];
  const args = {};
  if (cajaId !== null && cajaId !== undefined) {
    clauses.push("caja_id = :caja_id");
    args.caja_id = cajaId;
  }
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

// Resuelve qué caja_id usar según el query param `caja`:
//  - sin parámetro o "abierta" -> la caja abierta actual (o ninguna)
//  - "todas" -> null (sin filtrar por caja, ve todo el histórico)
//  - un número -> esa caja específica (cerrada o no)
async function resolverCaja(query) {
  if (query.caja === "todas") return { cajaId: null, caja: null };
  if (query.caja && query.caja !== "abierta") {
    const idNum = parseInt(query.caja, 10);
    const r = await db.execute({ sql: `SELECT * FROM cajas WHERE id = :id`, args: { id: idNum } });
    return { cajaId: idNum, caja: r.rows[0] || null };
  }
  const abierta = await cajaAbierta();
  return { cajaId: abierta ? abierta.id : -1, caja: abierta }; // -1 = ninguna caja coincide nunca
}

// ---------- Cajas ----------

// GET /api/cajas  -> historial completo (abierta primero, luego cerradas por fecha desc)
router.get("/cajas", async (req, res) => {
  try {
    const result = await db.execute(
      `SELECT * FROM cajas ORDER BY (estado = 'abierta') DESC, fecha_apertura DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al listar cajas" });
  }
});

// GET /api/cajas/abierta -> la caja abierta actual con su saldo, o null
router.get("/cajas/abierta", async (req, res) => {
  try {
    const abierta = await cajaAbierta();
    if (!abierta) return res.json(null);
    const info = await saldoDeCaja(abierta.id);
    res.json({ ...abierta, ingresos: info.ingresos, gastos: info.gastos, saldo: info.saldo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar la caja abierta" });
  }
});

// POST /api/cajas/abrir
router.post("/cajas/abrir", async (req, res) => {
  try {
    const { saldo_inicial, medio_pago, usuario, nota } = req.body;
    if (medio_pago && !MEDIOS_PAGO.includes(medio_pago)) {
      return res.status(400).json({ error: "medio_pago inválido" });
    }
    const id = await abrirCaja({ saldo_inicial, medio_pago, usuario: usuario || "web", nota });
    res.status(201).json({ id });
  } catch (err) {
    if (err.code === "CAJA_YA_ABIERTA") {
      return res.status(409).json({ error: "Ya hay una caja abierta", caja: err.caja });
    }
    console.error(err);
    res.status(500).json({ error: "Error al abrir la caja" });
  }
});

// POST /api/cajas/:id/cerrar
router.post("/cajas/:id/cerrar", async (req, res) => {
  try {
    const resultado = await cerrarCaja(parseInt(req.params.id, 10), {
      usuario: req.body.usuario || "web",
    });
    res.json(resultado);
  } catch (err) {
    if (err.code === "CAJA_NO_ENCONTRADA") return res.status(404).json({ error: err.message });
    if (err.code === "CAJA_YA_CERRADA") return res.status(409).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Error al cerrar la caja" });
  }
});

// ---------- Movimientos ----------

// GET /api/movimientos
router.get("/movimientos", async (req, res) => {
  try {
    const { cajaId, caja } = await resolverCaja(req.query);
    const { where, args } = buildWhere(req.query, cajaId);
    const limit = Math.min(parseInt(req.query.limit) || 300, 1000);
    const result = await db.execute({
      sql: `SELECT * FROM movimientos ${where} ORDER BY fecha DESC, id DESC LIMIT :limit`,
      args: { ...args, limit },
    });
    res.json({ movimientos: result.rows, caja });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al consultar movimientos" });
  }
});

// GET /api/resumen  -> saldo, gasto por categoría, por día y por semana,
// SIEMPRE acotado a una sola caja (abierta por defecto) salvo que se pida "todas"
router.get("/resumen", async (req, res) => {
  try {
    const { cajaId, caja } = await resolverCaja(req.query);
    const { where, args } = buildWhere(req.query, cajaId);

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

    const saldoInicial = caja ? caja.saldo_inicial || 0 : 0;
    const saldoTotal = caja ? saldoInicial + ingresosRango - gastosRango : ingresosRango - gastosRango;

    const saldoPorMedioResult = await db.execute({
      sql: `SELECT tipo, medio_pago, SUM(monto) as total FROM movimientos ${where} GROUP BY tipo, medio_pago`,
      args,
    });
    const saldoPorMedio = { efectivo: 0, tarjeta: 0, transferencia: 0 };
    if (caja && caja.medio_apertura) {
      saldoPorMedio[caja.medio_apertura] += saldoInicial;
    }
    for (const row of saldoPorMedioResult.rows) {
      const signo = row.tipo === "ingreso" ? 1 : -1;
      saldoPorMedio[row.medio_pago] = (saldoPorMedio[row.medio_pago] || 0) + signo * (row.total || 0);
    }

    const porCategoria = await db.execute({
      sql: `SELECT categoria, SUM(monto) as total FROM movimientos ${where ? where + " AND" : "WHERE"} tipo = 'gasto' GROUP BY categoria ORDER BY total DESC`,
      args,
    });

    const porDia = await db.execute({
      sql: `SELECT fecha, tipo, SUM(monto) as total FROM movimientos ${where} GROUP BY fecha, tipo ORDER BY fecha ASC`,
      args,
    });

    const porSemana = await db.execute({
      sql: `SELECT strftime('%Y-W%W', fecha) as semana, tipo, SUM(monto) as total
            FROM movimientos ${where} GROUP BY semana, tipo ORDER BY semana ASC`,
      args,
    });

    res.json({
      caja,
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
  res.json({ gasto: CATEGORIAS_GASTO, medios_pago: MEDIOS_PAGO });
});

// POST /api/movimientos  (alta manual desde la web, siempre va a la caja abierta)
router.post("/movimientos", async (req, res) => {
  try {
    const { tipo, monto, medio_pago, categoria, descripcion, fecha, usuario } = req.body;

    const abierta = await cajaAbierta();
    if (!abierta) {
      return res.status(409).json({ error: "No hay ninguna caja abierta. Ábrela primero (desde Telegram con /abrircaja)." });
    }

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

    const fechaFinal = fecha || fechaEcuador();

    const result = await db.execute({
      sql: `INSERT INTO movimientos (tipo, monto, medio_pago, categoria, descripcion, fecha, usuario, origen, caja_id)
            VALUES (:tipo, :monto, :medio_pago, :categoria, :descripcion, :fecha, :usuario, 'web', :caja_id)`,
      args: {
        tipo,
        monto: montoNum,
        medio_pago,
        categoria: categoriaFinal,
        descripcion: descripcion || null,
        fecha: fechaFinal,
        usuario: usuario || "web",
        caja_id: abierta.id,
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
    await db.execute({ sql: `DELETE FROM movimientos WHERE id = :id`, args: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar movimiento" });
  }
});

module.exports = router;
