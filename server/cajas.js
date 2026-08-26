const { db } = require("./db");

async function cajaAbierta() {
  const r = await db.execute(`SELECT * FROM cajas WHERE estado = 'abierta' LIMIT 1`);
  return r.rows[0] || null;
}

async function saldoDeCaja(cajaId) {
  const cajaRes = await db.execute({
    sql: `SELECT * FROM cajas WHERE id = :id`,
    args: { id: cajaId },
  });
  const caja = cajaRes.rows[0];
  if (!caja) return null;

  const movs = await db.execute({
    sql: `SELECT tipo, SUM(monto) as total FROM movimientos WHERE caja_id = :id GROUP BY tipo`,
    args: { id: cajaId },
  });
  let ingresos = 0,
    gastos = 0;
  for (const r of movs.rows) {
    if (r.tipo === "ingreso") ingresos = r.total || 0;
    if (r.tipo === "gasto") gastos = r.total || 0;
  }
  return {
    caja,
    ingresos,
    gastos,
    saldo: (caja.saldo_inicial || 0) + ingresos - gastos,
  };
}

async function abrirCaja({ saldo_inicial, medio_pago, usuario, nota }) {
  const existente = await cajaAbierta();
  if (existente) {
    const err = new Error("Ya hay una caja abierta");
    err.code = "CAJA_YA_ABIERTA";
    err.caja = existente;
    throw err;
  }
  const fecha = new Date().toISOString();
  const result = await db.execute({
    sql: `INSERT INTO cajas (estado, saldo_inicial, medio_apertura, fecha_apertura, usuario_apertura, nota)
          VALUES ('abierta', :saldo_inicial, :medio_pago, :fecha, :usuario, :nota)`,
    args: {
      saldo_inicial: Number(saldo_inicial) || 0,
      medio_pago: medio_pago || null,
      fecha,
      usuario: usuario || null,
      nota: nota || null,
    },
  });
  return Number(result.lastInsertRowid);
}

async function cerrarCaja(cajaId, { usuario } = {}) {
  const info = await saldoDeCaja(cajaId);
  if (!info) {
    const err = new Error("Caja no encontrada");
    err.code = "CAJA_NO_ENCONTRADA";
    throw err;
  }
  if (info.caja.estado === "cerrada") {
    const err = new Error("La caja ya estaba cerrada");
    err.code = "CAJA_YA_CERRADA";
    throw err;
  }
  const fecha = new Date().toISOString();
  await db.execute({
    sql: `UPDATE cajas SET estado = 'cerrada', saldo_final = :saldo_final, fecha_cierre = :fecha, usuario_cierre = :usuario WHERE id = :id`,
    args: { saldo_final: info.saldo, fecha, usuario: usuario || null, id: cajaId },
  });
  return { ...info, saldo_final: info.saldo, fecha_cierre: fecha };
}

module.exports = { cajaAbierta, saldoDeCaja, abrirCaja, cerrarCaja };
