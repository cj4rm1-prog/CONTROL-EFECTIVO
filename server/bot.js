const TelegramBot = require("node-telegram-bot-api");
const { db, CATEGORIAS_GASTO } = require("./db");

// Estado en memoria por chat (suficiente para un equipo pequeño; si el
// proceso se reinicia, el registro a medias se pierde y hay que empezar de nuevo)
const sesiones = new Map();

function emojiMedio(m) {
  return { efectivo: "💵", tarjeta: "💳", transferencia: "🏦" }[m] || "";
}

function fmt(n) {
  return Number(n).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function iniciarBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn(
      "[bot] TELEGRAM_BOT_TOKEN no configurado: el bot de Telegram no se iniciará."
    );
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });
  console.log("[bot] Telegram bot iniciado (long polling).");

  const idsPermitidos = (process.env.TELEGRAM_ALLOWED_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  function autorizado(chatId) {
    if (idsPermitidos.length === 0) return true; // sin restricción configurada
    return idsPermitidos.includes(String(chatId));
  }

  function teclado(botones) {
    return { reply_markup: { inline_keyboard: botones } };
  }

  async function saldoActual() {
    const result = await db.execute(
      `SELECT tipo, SUM(monto) as total FROM movimientos GROUP BY tipo`
    );
    let ingresos = 0,
      gastos = 0;
    for (const r of result.rows) {
      if (r.tipo === "ingreso") ingresos = r.total || 0;
      if (r.tipo === "gasto") gastos = r.total || 0;
    }
    return ingresos - gastos;
  }

  bot.onText(/\/start|\/nuevo/, (msg) => {
    const chatId = msg.chat.id;
    if (!autorizado(chatId)) {
      return bot.sendMessage(chatId, "No tienes autorización para usar este bot.");
    }
    sesiones.set(chatId, { paso: "tipo" });
    bot.sendMessage(
      chatId,
      "¿Qué quieres registrar?",
      teclado([
        [
          { text: "💰 Ingresar saldo", callback_data: "tipo:ingreso" },
          { text: "🧾 Registrar gasto", callback_data: "tipo:gasto" },
        ],
      ])
    );
  });

  bot.onText(/\/saldo/, async (msg) => {
    const chatId = msg.chat.id;
    if (!autorizado(chatId)) return;
    try {
      const saldo = await saldoActual();
      bot.sendMessage(chatId, `💰 Saldo actual: $${fmt(saldo)}`);
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "No pude calcular el saldo, intenta de nuevo.");
    }
  });

  bot.onText(/\/resumen/, async (msg) => {
    const chatId = msg.chat.id;
    if (!autorizado(chatId)) return;
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      const inicioMes = hoy.slice(0, 7) + "-01";
      const [totalesMes, saldo] = await Promise.all([
        db.execute({
          sql: `SELECT tipo, SUM(monto) as total FROM movimientos WHERE fecha >= :inicio GROUP BY tipo`,
          args: { inicio: inicioMes },
        }),
        saldoActual(),
      ]);
      let ingresosMes = 0,
        gastosMes = 0;
      for (const r of totalesMes.rows) {
        if (r.tipo === "ingreso") ingresosMes = r.total || 0;
        if (r.tipo === "gasto") gastosMes = r.total || 0;
      }
      bot.sendMessage(
        chatId,
        `📊 Resumen del mes:\n` +
          `💰 Saldo actual: $${fmt(saldo)}\n` +
          `⬆️ Saldo ingresado: $${fmt(ingresosMes)}\n` +
          `🧾 Gastado: $${fmt(gastosMes)}`
      );
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "No pude calcular el resumen, intenta de nuevo.");
    }
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    if (!autorizado(chatId)) return;
    const data = query.data;
    const sesion = sesiones.get(chatId) || {};

    if (data.startsWith("tipo:")) {
      sesion.tipo = data.split(":")[1];
      sesion.paso = "medio_pago";
      sesiones.set(chatId, sesion);
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(
        chatId,
        "¿Con qué medio de pago?",
        teclado([
          [
            { text: "💵 Efectivo", callback_data: "medio:efectivo" },
            { text: "💳 Tarjeta", callback_data: "medio:tarjeta" },
            { text: "🏦 Transferencia", callback_data: "medio:transferencia" },
          ],
        ])
      );
    }

    if (data.startsWith("medio:")) {
      sesion.medio_pago = data.split(":")[1];
      sesiones.set(chatId, sesion);
      await bot.answerCallbackQuery(query.id);

      if (sesion.tipo === "gasto") {
        sesion.paso = "categoria";
        sesiones.set(chatId, sesion);
        const filas = [];
        for (let i = 0; i < CATEGORIAS_GASTO.length; i += 2) {
          filas.push(
            CATEGORIAS_GASTO.slice(i, i + 2).map((c) => ({ text: c, callback_data: `cat:${c}` }))
          );
        }
        return bot.sendMessage(chatId, "¿Categoría del gasto?", teclado(filas));
      }

      sesion.paso = "monto";
      sesiones.set(chatId, sesion);
      return bot.sendMessage(chatId, "Escribe el monto (solo número, ej: 45.50):");
    }

    if (data.startsWith("cat:")) {
      sesion.categoria = data.split(":")[1];
      sesion.paso = "monto";
      sesiones.set(chatId, sesion);
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(chatId, "Escribe el monto (solo número, ej: 45.50):");
    }
  });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    if (!autorizado(chatId)) return;
    if (!msg.text || msg.text.startsWith("/")) return; // los comandos ya se manejan arriba

    const sesion = sesiones.get(chatId);
    if (!sesion) return; // no hay flujo activo, ignorar

    if (sesion.paso === "monto") {
      const monto = Number(msg.text.replace(",", "."));
      if (!monto || monto <= 0) {
        return bot.sendMessage(chatId, "Monto inválido, escribe solo el número (ej: 45.50):");
      }
      sesion.monto = monto;
      sesion.paso = "descripcion";
      sesiones.set(chatId, sesion);
      return bot.sendMessage(chatId, "¿Descripción? (opcional, envía - para omitir)");
    }

    if (sesion.paso === "descripcion") {
      const descripcion = msg.text === "-" ? null : msg.text;
      const fecha = new Date().toISOString().slice(0, 10);
      const usuario = msg.from.username || msg.from.first_name || String(chatId);
      const categoria = sesion.tipo === "ingreso" ? "Saldo" : sesion.categoria;

      try {
        await db.execute({
          sql: `INSERT INTO movimientos (tipo, monto, medio_pago, categoria, descripcion, fecha, usuario, origen)
                VALUES (:tipo, :monto, :medio_pago, :categoria, :descripcion, :fecha, :usuario, 'telegram')`,
          args: {
            tipo: sesion.tipo,
            monto: sesion.monto,
            medio_pago: sesion.medio_pago,
            categoria,
            descripcion,
            fecha,
            usuario,
          },
        });

        const saldo = await saldoActual();
        const emoji = sesion.tipo === "ingreso" ? "💰" : "🧾";
        const etiqueta = sesion.tipo === "ingreso" ? "Saldo ingresado" : "Gasto registrado";
        bot.sendMessage(
          chatId,
          `${emoji} ${etiqueta}: $${fmt(sesion.monto)} ${emojiMedio(sesion.medio_pago)} ${sesion.medio_pago}` +
            (sesion.tipo === "gasto" ? ` · ${categoria}` : "") +
            (descripcion ? `\n📝 ${descripcion}` : "") +
            `\n\n💰 Saldo actual: $${fmt(saldo)}` +
            `\n\nEscribe /nuevo para registrar otro movimiento.`
        );
      } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "Ocurrió un error guardando el movimiento. Intenta /nuevo otra vez.");
      } finally {
        sesiones.delete(chatId);
      }
    }
  });

  return bot;
}

module.exports = { iniciarBot };
