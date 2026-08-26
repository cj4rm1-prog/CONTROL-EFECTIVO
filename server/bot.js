const TelegramBot = require("node-telegram-bot-api");
const { db, CATEGORIAS_GASTO } = require("./db");
const { cajaAbierta, saldoDeCaja, abrirCaja, cerrarCaja } = require("./cajas");

// Estado en memoria por chat (suficiente para un equipo pequeño; si el
// proceso se reinicia, el registro a medias se pierde y hay que empezar de nuevo)
const sesiones = new Map();

function emojiMedio(m) {
  return { efectivo: "💵", tarjeta: "💳", transferencia: "🏦" }[m] || "";
}

function fmt(n) {
  return Number(n).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtFecha(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" });
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

  bot.on("polling_error", (err) => {
    console.error("[bot] polling_error:", err.code, err.message);
  });
  bot.on("webhook_error", (err) => {
    console.error("[bot] webhook_error:", err.code, err.message);
  });
  bot.on("error", (err) => {
    console.error("[bot] error:", err.code, err.message);
  });

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

  function nombreUsuario(msg) {
    return msg.from.username || msg.from.first_name || String(msg.chat.id);
  }

  // ---------- /abrircaja ----------
  bot.onText(/\/abrircaja/, async (msg) => {
    const chatId = msg.chat.id;
    if (!autorizado(chatId)) return;
    const abierta = await cajaAbierta();
    if (abierta) {
      return bot.sendMessage(
        chatId,
        `⚠️ Ya hay una caja abierta desde ${fmtFecha(abierta.fecha_apertura)} con saldo inicial $${fmt(
          abierta.saldo_inicial
        )}.\n\nCiérrala primero con /cerrarcaja si quieres abrir una nueva.`
      );
    }
    sesiones.set(chatId, { flujo: "abrircaja", paso: "monto" });
    bot.sendMessage(chatId, "🔓 Vamos a abrir una nueva caja.\n¿Con qué monto inicial? (solo número, ej: 50.00)");
  });

  // ---------- /cerrarcaja ----------
  bot.onText(/\/cerrarcaja/, async (msg) => {
    const chatId = msg.chat.id;
    if (!autorizado(chatId)) return;
    const abierta = await cajaAbierta();
    if (!abierta) {
      return bot.sendMessage(chatId, "No hay ninguna caja abierta actualmente. Ábrela con /abrircaja.");
    }
    const info = await saldoDeCaja(abierta.id);
    sesiones.set(chatId, { flujo: "cerrarcaja", cajaId: abierta.id });
    bot.sendMessage(
      chatId,
      `🔒 Vas a cerrar la caja abierta el ${fmtFecha(abierta.fecha_apertura)}.\n\n` +
        `Saldo inicial: $${fmt(abierta.saldo_inicial)}\n` +
        `Ingresos: $${fmt(info.ingresos)}\n` +
        `Gastos: $${fmt(info.gastos)}\n` +
        `Saldo final calculado: $${fmt(info.saldo)}\n\n¿Confirmas el cierre?`,
      teclado([
        [
          { text: "✅ Sí, cerrar caja", callback_data: "cerrar:si" },
          { text: "❌ Cancelar", callback_data: "cerrar:no" },
        ],
      ])
    );
  });

  // ---------- /nuevo (registrar gasto o ingresar saldo dentro de la caja abierta) ----------
  bot.onText(/\/start|\/nuevo/, async (msg) => {
    const chatId = msg.chat.id;
    if (!autorizado(chatId)) {
      return bot.sendMessage(chatId, "No tienes autorización para usar este bot.");
    }
    const abierta = await cajaAbierta();
    if (!abierta) {
      return bot.sendMessage(
        chatId,
        "🔒 No hay ninguna caja abierta. Abre una caja primero con /abrircaja para poder registrar movimientos."
      );
    }
    sesiones.set(chatId, { flujo: "movimiento", paso: "tipo", cajaId: abierta.id });
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

  // ---------- /saldo y /resumen (siempre sobre la caja abierta) ----------
  bot.onText(/\/saldo/, async (msg) => {
    const chatId = msg.chat.id;
    if (!autorizado(chatId)) return;
    const abierta = await cajaAbierta();
    if (!abierta) return bot.sendMessage(chatId, "No hay ninguna caja abierta actualmente.");
    const info = await saldoDeCaja(abierta.id);
    bot.sendMessage(chatId, `💰 Saldo actual de la caja abierta: $${fmt(info.saldo)}`);
  });

  bot.onText(/\/resumen/, async (msg) => {
    const chatId = msg.chat.id;
    if (!autorizado(chatId)) return;
    const abierta = await cajaAbierta();
    if (!abierta) return bot.sendMessage(chatId, "No hay ninguna caja abierta actualmente.");
    const info = await saldoDeCaja(abierta.id);
    bot.sendMessage(
      chatId,
      `📊 Resumen de la caja abierta (desde ${fmtFecha(abierta.fecha_apertura)}):\n` +
        `💰 Saldo actual: $${fmt(info.saldo)}\n` +
        `⬆️ Saldo ingresado: $${fmt(info.ingresos)}\n` +
        `🧾 Gastado: $${fmt(info.gastos)}`
    );
  });

  // ---------- Botones ----------
  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    if (!autorizado(chatId)) return;
    const data = query.data;
    const sesion = sesiones.get(chatId) || {};

    // Confirmación de cierre de caja
    if (data.startsWith("cerrar:")) {
      await bot.answerCallbackQuery(query.id);
      if (data === "cerrar:no" || !sesion.cajaId) {
        sesiones.delete(chatId);
        return bot.sendMessage(chatId, "Cierre cancelado.");
      }
      try {
        const usuario = query.from.username || query.from.first_name || String(chatId);
        const resultado = await cerrarCaja(sesion.cajaId, { usuario });
        bot.sendMessage(
          chatId,
          `✅ Caja cerrada.\nSaldo final: $${fmt(resultado.saldo_final)}\n\nPuedes abrir una nueva con /abrircaja.`
        );
      } catch (err) {
        console.error(err);
        bot.sendMessage(chatId, "Ocurrió un error cerrando la caja. Intenta de nuevo.");
      } finally {
        sesiones.delete(chatId);
      }
      return;
    }

    if (sesion.flujo !== "movimiento") return; // botón viejo o de otro flujo, ignorar

    if (data.startsWith("tipo:")) {
      sesion.tipo = data.split(":")[1];
      sesion.paso = "medio_pago";
      sesiones.set(chatId, sesion);
      await bot.answerCallbackQuery(query.id);
      return bot.sendMessage(
        chatId,
        "¿Con qué tipo de dinero?",
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

  // ---------- Mensajes de texto (montos, descripciones, aperturas) ----------
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    if (!autorizado(chatId)) return;
    if (!msg.text || msg.text.startsWith("/")) return; // los comandos ya se manejan arriba

    const sesion = sesiones.get(chatId);
    if (!sesion) return; // no hay flujo activo, ignorar

    // --- Flujo: abrir caja ---
    if (sesion.flujo === "abrircaja" && sesion.paso === "monto") {
      const monto = Number(msg.text.replace(",", "."));
      if (isNaN(monto) || monto < 0) {
        return bot.sendMessage(chatId, "Monto inválido, escribe solo el número (ej: 50.00):");
      }
      sesion.monto = monto;
      sesion.paso = "medio_pago";
      sesiones.set(chatId, sesion);
      return bot.sendMessage(
        chatId,
        "¿Con qué tipo de dinero abres la caja?",
        teclado([
          [
            { text: "💵 Efectivo", callback_data: "abrirmedio:efectivo" },
            { text: "💳 Tarjeta", callback_data: "abrirmedio:tarjeta" },
            { text: "🏦 Transferencia", callback_data: "abrirmedio:transferencia" },
          ],
        ])
      );
    }

    // --- Flujo: registrar movimiento ---
    if (sesion.flujo === "movimiento" && sesion.paso === "monto") {
      const monto = Number(msg.text.replace(",", "."));
      if (!monto || monto <= 0) {
        return bot.sendMessage(chatId, "Monto inválido, escribe solo el número (ej: 45.50):");
      }
      sesion.monto = monto;
      sesion.paso = "descripcion";
      sesiones.set(chatId, sesion);
      return bot.sendMessage(chatId, "¿Descripción? (opcional, envía - para omitir)");
    }

    if (sesion.flujo === "movimiento" && sesion.paso === "descripcion") {
      const descripcion = msg.text === "-" ? null : msg.text;
      const fecha = new Date().toISOString().slice(0, 10);
      const usuario = nombreUsuario(msg);
      const categoria = sesion.tipo === "ingreso" ? "Saldo" : sesion.categoria;

      try {
        await db.execute({
          sql: `INSERT INTO movimientos (tipo, monto, medio_pago, categoria, descripcion, fecha, usuario, origen, caja_id)
                VALUES (:tipo, :monto, :medio_pago, :categoria, :descripcion, :fecha, :usuario, 'telegram', :caja_id)`,
          args: {
            tipo: sesion.tipo,
            monto: sesion.monto,
            medio_pago: sesion.medio_pago,
            categoria,
            descripcion,
            fecha,
            usuario,
            caja_id: sesion.cajaId,
          },
        });

        const info = await saldoDeCaja(sesion.cajaId);
        const emoji = sesion.tipo === "ingreso" ? "💰" : "🧾";
        const etiqueta = sesion.tipo === "ingreso" ? "Saldo ingresado" : "Gasto registrado";
        bot.sendMessage(
          chatId,
          `${emoji} ${etiqueta}: $${fmt(sesion.monto)} ${emojiMedio(sesion.medio_pago)} ${sesion.medio_pago}` +
            (sesion.tipo === "gasto" ? ` · ${categoria}` : "") +
            (descripcion ? `\n📝 ${descripcion}` : "") +
            `\n\n💰 Saldo de la caja: $${fmt(info.saldo)}` +
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

  // Callback de tipo de dinero al ABRIR caja (separado porque no pertenece al flujo "movimiento")
  bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    if (!autorizado(chatId)) return;
    const data = query.data;
    if (!data.startsWith("abrirmedio:")) return;
    const sesion = sesiones.get(chatId);
    if (!sesion || sesion.flujo !== "abrircaja") return;

    await bot.answerCallbackQuery(query.id);
    const medio_pago = data.split(":")[1];
    const usuario = query.from.username || query.from.first_name || String(chatId);

    try {
      const id = await abrirCaja({ saldo_inicial: sesion.monto, medio_pago, usuario });
      bot.sendMessage(
        chatId,
        `✅ Caja abierta (#${id}) con saldo inicial $${fmt(sesion.monto)} ${emojiMedio(medio_pago)} ${medio_pago}.\n\n` +
          `Ya puedes registrar movimientos con /nuevo.`
      );
    } catch (err) {
      if (err.code === "CAJA_YA_ABIERTA") {
        bot.sendMessage(chatId, "⚠️ Ya se abrió una caja mientras completabas este flujo. Usa /saldo para verla.");
      } else {
        console.error(err);
        bot.sendMessage(chatId, "Ocurrió un error abriendo la caja. Intenta /abrircaja otra vez.");
      }
    } finally {
      sesiones.delete(chatId);
    }
  });

  return bot;
}

module.exports = { iniciarBot };
