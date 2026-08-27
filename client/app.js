const state = {
  range: "mes",
  filtroTipo: "",
  filtroMedio: "",
  filtroCategoria: "",
  modoTiempo: "dia",
  vistaCaja: "abierta", // "abierta" | "todas" | id numérico de una caja cerrada
  apiKey: localStorage.getItem("dashboard_key") || "",
  categorias: { gasto: [] },
};

const charts = {};

function apiHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (state.apiKey) headers["x-api-key"] = state.apiKey;
  return headers;
}

async function apiFetch(path, options = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      ...options,
      headers: { ...apiHeaders(), ...(options.headers || {}) },
    });
  } catch (networkErr) {
    throw new Error("No se pudo conectar con el servidor. Revisa tu conexión.");
  }
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    let detalle = "";
    try {
      const body = await res.json();
      detalle = body.error || "";
    } catch (_) {}
    throw new Error(detalle || `Error ${res.status} al consultar ${path}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function mostrarError(mensaje) {
  const banner = document.getElementById("error-banner");
  banner.textContent = "⚠️ " + mensaje;
  banner.classList.remove("hidden");
}
function ocultarError() {
  document.getElementById("error-banner").classList.add("hidden");
}

function rangoFechas(range) {
  const hoy = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (range === "hoy") return { desde: iso(hoy), hasta: iso(hoy) };
  if (range === "semana") {
    const hace7 = new Date(hoy);
    hace7.setDate(hoy.getDate() - 6);
    return { desde: iso(hace7), hasta: iso(hoy) };
  }
  if (range === "mes") {
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    return { desde: iso(inicioMes), hasta: iso(hoy) };
  }
  return { desde: "", hasta: "" }; // todo
}

function money(n) {
  return "$" + Number(n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaCorta(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" });
}

function labelRange(range) {
  return { hoy: "Hoy", semana: "Últimos 7 días", mes: "Este mes", todo: "Histórico completo" }[range];
}

// ---------- Carga y render ----------
async function cargarTodo() {
  ocultarError();
  try {
    const { desde, hasta } = rangoFechas(state.range);
    const params = new URLSearchParams();
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    if (state.filtroTipo) params.set("tipo", state.filtroTipo);
    if (state.filtroMedio) params.set("medio_pago", state.filtroMedio);
    if (state.filtroCategoria) params.set("categoria", state.filtroCategoria);
    params.set("caja", state.vistaCaja);

    const [resumen, movimientosResp] = await Promise.all([
      apiFetch(`/resumen?${params.toString()}`),
      apiFetch(`/movimientos?${params.toString()}`),
    ]);

    renderCajaBar(resumen.caja);

    document.getElementById("receipt-period").textContent = labelRange(state.range);
    document.getElementById("receipt-title").textContent =
      state.vistaCaja === "todas" ? "SALDO — TODAS LAS CAJAS" : "SALDO DE LA CAJA";
    document.getElementById("kpi-saldo").textContent = money(resumen.saldoTotal);
    document.getElementById("saldo-efectivo").textContent = money(resumen.saldoPorMedio.efectivo);
    document.getElementById("saldo-tarjeta").textContent = money(resumen.saldoPorMedio.tarjeta);
    document.getElementById("saldo-transferencia").textContent = money(resumen.saldoPorMedio.transferencia);
    document.getElementById("kpi-ingresado").textContent = money(resumen.ingresosRango);
    document.getElementById("kpi-gastado").textContent = money(resumen.gastosRango);

    renderChartCategoria(resumen.porCategoria);
    renderTablaCategorias(movimientosResp.movimientos);
    renderTabla(movimientosResp.movimientos);
  } catch (err) {
    if (err.message === "UNAUTHORIZED") {
      volverAlGate();
      return;
    }
    console.error("[dashboard] Error cargando datos:", err);
    mostrarError(err.message || "Ocurrió un error inesperado cargando el dashboard.");
    document.getElementById("tabla-body").innerHTML =
      `<tr><td colspan="8" class="empty">No se pudieron cargar los movimientos.</td></tr>`;
  }
}

function renderCajaBar(caja) {
  const info = document.getElementById("caja-info");
  if (state.vistaCaja === "todas") {
    info.textContent = "Viendo el histórico completo de todas las cajas.";
    return;
  }
  if (!caja) {
    info.innerHTML = `🔒 No hay ninguna caja abierta. Ábrela desde Telegram con <code>/abrircaja</code>.`;
    return;
  }
  const estadoTxt = caja.estado === "abierta" ? "🔓 Caja abierta" : "🔒 Caja cerrada";
  info.textContent = `${estadoTxt} · desde ${fechaCorta(caja.fecha_apertura)}` +
    (caja.fecha_cierre ? ` hasta ${fechaCorta(caja.fecha_cierre)}` : "") +
    ` · saldo inicial ${money(caja.saldo_inicial)}`;
}

async function cargarSelectorCajas() {
  try {
    const cajas = await apiFetch("/cajas");
    const select = document.getElementById("selector-caja");
    const cerradas = cajas.filter((c) => c.estado === "cerrada");
    select.innerHTML =
      `<option value="abierta">Caja abierta actual</option>` +
      `<option value="todas">Todas las cajas (histórico)</option>` +
      cerradas
        .map(
          (c) =>
            `<option value="${c.id}">Caja #${c.id} · ${fechaCorta(c.fecha_apertura)} (cerrada)</option>`
        )
        .join("");
    select.value = state.vistaCaja;
  } catch (err) {
    console.error("[dashboard] Error cargando lista de cajas:", err);
  }
}

function renderChartCategoria(porCategoria) {
  if (typeof Chart === "undefined") {
    console.error("[dashboard] Chart.js no está disponible (vendor/chart.umd.js no cargó).");
    return;
  }
  const filas = [...porCategoria].sort((a, b) => b.total - a.total);
  const ctx = document.getElementById("chart-categoria");
  if (charts.categoria) charts.categoria.destroy();

  if (!filas.length) {
    charts.categoria = null;
    ctx.getContext("2d").clearRect(0, 0, ctx.width, ctx.height);
    return;
  }

  const paletaCategorias = ["#d9553c", "#c9a227", "#3f8fd1", "#8a6fd1", "#2f9e6e", "#e08a3c", "#5aa8a0", "#b06fa0"];

  charts.categoria = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: filas.map((f) => f.categoria),
      datasets: [
        {
          data: filas.map((f) => f.total),
          backgroundColor: filas.map((_, i) => paletaCategorias[i % paletaCategorias.length]),
          borderColor: "#163025",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "right", labels: { color: "#f6f3ea", boxWidth: 12, font: { size: 11 } } },
      },
    },
  });
}

// Agrupa los movimientos de tipo "gasto" por categoría: suma montos y no
// repite filas (una fila por categoría, con el total sumado).
function agruparPorCategoria(movimientos) {
  const grupos = {};
  for (const m of movimientos) {
    if (m.tipo !== "gasto") continue;
    if (!grupos[m.categoria]) {
      grupos[m.categoria] = { categoria: m.categoria, monto: 0 };
    }
    grupos[m.categoria].monto += Number(m.monto) || 0;
  }
  return Object.values(grupos).sort((a, b) => b.monto - a.monto);
}

function renderTablaCategorias(movimientos) {
  const tbody = document.getElementById("tabla-categorias-body");
  const grupos = agruparPorCategoria(movimientos || []);

  if (!grupos.length) {
    tbody.innerHTML = `<tr><td colspan="2" class="empty">No hay gastos en este periodo.</td></tr>`;
    document.getElementById("total-categorias").textContent = money(0);
    return;
  }

  let total = 0;
  tbody.innerHTML = grupos
    .map((g) => {
      total += g.monto;
      return `
        <tr>
          <td>${g.categoria}</td>
          <td class="ta-right">${money(g.monto)}</td>
        </tr>`;
    })
    .join("");

  document.getElementById("total-categorias").textContent = money(total);
}

function chartOptions({ horizontal = false, legend = true } = {}) {
  return {
    indexAxis: horizontal ? "y" : "x",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: legend, labels: { color: "#f6f3ea" } },
    },
    scales: {
      x: { ticks: { color: "#9fb0a7" }, grid: { color: "rgba(255,255,255,0.06)" } },
      y: { ticks: { color: "#9fb0a7" }, grid: { color: "rgba(255,255,255,0.06)" } },
    },
  };
}

function renderTabla(movimientos) {
  const tbody = document.getElementById("tabla-body");
  if (!movimientos || !movimientos.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">No hay movimientos en este periodo.</td></tr>`;
    return;
  }
  tbody.innerHTML = movimientos
    .map(
      (m) => `
    <tr>
      <td>${m.fecha}</td>
      <td><span class="tag tag-${m.tipo}">${m.tipo === "gasto" ? "Gasto" : "Saldo"}</span></td>
      <td>${m.categoria}</td>
      <td>${m.medio_pago}</td>
      <td>${m.descripcion || "—"}</td>
      <td>${m.origen}</td>
      <td class="ta-right">${money(m.monto)}</td>
      <td><button class="row-delete" data-id="${m.id}" title="Eliminar">✕</button></td>
    </tr>`
    )
    .join("");

  tbody.querySelectorAll(".row-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("¿Eliminar este movimiento?")) return;
      try {
        await apiFetch(`/movimientos/${btn.dataset.id}`, { method: "DELETE" });
        cargarTodo();
      } catch (err) {
        mostrarError(err.message);
      }
    });
  });
}

// ---------- Interacciones ----------
document.getElementById("range-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  document.querySelectorAll("#range-tabs button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  state.range = btn.dataset.range;
  cargarTodo();
});

document.getElementById("selector-caja").addEventListener("change", (e) => {
  state.vistaCaja = e.target.value;
  cargarTodo();
});

document.getElementById("filtro-tipo").addEventListener("change", (e) => {
  state.filtroTipo = e.target.value;
  cargarTodo();
});
document.getElementById("filtro-medio").addEventListener("change", (e) => {
  state.filtroMedio = e.target.value;
  cargarTodo();
});
document.getElementById("filtro-categoria").addEventListener("change", (e) => {
  state.filtroCategoria = e.target.value;
  cargarTodo();
});

// Modal alta manual
const modal = document.getElementById("modal");
const form = document.getElementById("form-nuevo");
const campoCategoria = document.getElementById("campo-categoria");
let tipoSeleccionado = "gasto";

document.getElementById("btn-nuevo").addEventListener("click", () => {
  modal.classList.remove("hidden");
  actualizarVisibilidadCategoria();
});
document.getElementById("modal-close").addEventListener("click", () => modal.classList.add("hidden"));
modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.add("hidden"); });

document.querySelectorAll(".seg-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    tipoSeleccionado = btn.dataset.tipo;
    actualizarVisibilidadCategoria();
  });
});

function actualizarVisibilidadCategoria() {
  if (tipoSeleccionado === "ingreso") {
    campoCategoria.classList.add("hidden");
    document.getElementById("select-categoria").required = false;
  } else {
    campoCategoria.classList.remove("hidden");
    document.getElementById("select-categoria").required = true;
  }
}

function poblarSelectCategoria() {
  const select = document.getElementById("select-categoria");
  select.innerHTML = state.categorias.gasto.map((c) => `<option value="${c}">${c}</option>`).join("");

  const filtro = document.getElementById("filtro-categoria");
  filtro.innerHTML =
    `<option value="">Cualquier categoría</option>` +
    state.categorias.gasto.map((c) => `<option value="${c}">${c}</option>`).join("");
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = new FormData(form);
  const errorEl = document.getElementById("form-error");
  errorEl.textContent = "";
  try {
    await apiFetch("/movimientos", {
      method: "POST",
      body: JSON.stringify({
        tipo: tipoSeleccionado,
        monto: data.get("monto"),
        medio_pago: data.get("medio_pago"),
        categoria: tipoSeleccionado === "gasto" ? data.get("categoria") : undefined,
        descripcion: data.get("descripcion"),
        fecha: data.get("fecha") || undefined,
        usuario: "web",
      }),
    });
    modal.classList.add("hidden");
    form.reset();
    cargarTodo();
  } catch (err) {
    errorEl.textContent = err.message || "No se pudo guardar. Revisa los datos e intenta de nuevo.";
  }
});

// ---------- Gate de acceso ----------
function volverAlGate() {
  localStorage.removeItem("dashboard_key");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("gate").classList.remove("hidden");
  document.getElementById("gate-error").textContent = "Tu clave ya no es válida, intenta de nuevo.";
}

async function intentarEntrar(key) {
  state.apiKey = key;
  try {
    const categorias = await apiFetch("/categorias");
    state.categorias = categorias;
    poblarSelectCategoria();
    localStorage.setItem("dashboard_key", key);
    document.getElementById("gate").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    await cargarSelectorCajas();
    cargarTodo();
  } catch (err) {
    document.getElementById("gate-error").textContent = "Clave incorrecta, intenta de nuevo.";
  }
}

document.getElementById("gate-btn").addEventListener("click", () => {
  intentarEntrar(document.getElementById("gate-input").value.trim());
});
document.getElementById("gate-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") intentarEntrar(e.target.value.trim());
});

// Si ya había una clave guardada, intenta entrar automáticamente
if (state.apiKey) {
  intentarEntrar(state.apiKey);
} else {
  // Si el backend no exige clave, entra directo
  intentarEntrar("");
}
