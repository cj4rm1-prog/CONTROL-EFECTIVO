const POR_PAGINA = 10;

const PALETA_CATEGORIAS = ["#0EA5A4", "#F59E0B", "#F97362", "#3B82F6", "#8B5CF6", "#EC4899", "#10B981", "#9CA3AF"];
const ICONO_CATEGORIA = {
  "Alimentación": "🍽️",
  "Salud": "💊",
  "Transporte": "🚌",
  "Servicios": "🧾",
  "Entretenimiento": "🎬",
  "Educación": "🎓",
  "Hogar": "🏠",
  "Otros": "📦",
};

const state = {
  range: "todo",
  filtroTipo: "",
  filtroMedio: "",
  filtroCategoria: "",
  vistaCaja: "abierta",
  apiKey: localStorage.getItem("dashboard_key") || "",
  categorias: { gasto: [] },
  categoriaColor: {},
  movimientosActuales: [],
  paginaActual: 1,
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
  const iso = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(d);
  const hoyIso = iso(hoy);
  if (range === "hoy") return { desde: hoyIso, hasta: hoyIso };
  if (range === "semana") {
    const hace7 = new Date(hoy.getTime() - 6 * 24 * 60 * 60 * 1000);
    return { desde: iso(hace7), hasta: hoyIso };
  }
  if (range === "mes") {
    const [year, month] = hoyIso.split("-");
    return { desde: `${year}-${month}-01`, hasta: hoyIso };
  }
  return { desde: "", hasta: "" };
}

function money(n) {
  return "$" + Number(n || 0).toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaCorta(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-EC", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "America/Guayaquil",
  });
}

function labelRange(range) {
  return {
    hoy: "Saldo — hoy",
    semana: "Saldo — últimos 7 días",
    mes: "Saldo — este mes",
    todo: "Saldo — histórico completo",
  }[range];
}

function colorCategoria(categoria) {
  if (!state.categoriaColor[categoria]) {
    const idx = Object.keys(state.categoriaColor).length % PALETA_CATEGORIAS.length;
    state.categoriaColor[categoria] = PALETA_CATEGORIAS[idx];
  }
  return state.categoriaColor[categoria];
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
    document.getElementById("kpi-saldo").textContent = money(resumen.saldoTotal);
    document.getElementById("saldo-efectivo").textContent = money(resumen.saldoPorMedio.efectivo);
    document.getElementById("saldo-tarjeta").textContent = money(resumen.saldoPorMedio.tarjeta);
    document.getElementById("saldo-transferencia").textContent = money(resumen.saldoPorMedio.transferencia);
    document.getElementById("kpi-ingresado").textContent = money(resumen.ingresosRango);
    document.getElementById("kpi-gastado").textContent = money(resumen.gastosRango);

    renderChartCategoria(resumen.porCategoria);
    renderTablaCategorias(resumen.porCategoria);

    state.movimientosActuales = movimientosResp.movimientos || [];
    state.paginaActual = 1;
    renderMovimientos();
  } catch (err) {
    if (err.message === "UNAUTHORIZED") {
      volverAlGate();
      return;
    }
    console.error("[dashboard] Error cargando datos:", err);
    mostrarError(err.message || "Ocurrió un error inesperado cargando el dashboard.");
    document.getElementById("tabla-body").innerHTML = `<tr><td colspan="8" class="empty">No se pudieron cargar los movimientos.</td></tr>`;
    document.getElementById("tabla-cards").innerHTML = `<div class="empty">No se pudieron cargar los movimientos.</div>`;
  }
}

function renderCajaBar(caja) {
  const info = document.getElementById("caja-info");
  if (state.vistaCaja === "todas") {
    info.textContent = "Viendo el histórico completo de todas las cajas.";
    return;
  }
  if (!caja) {
    info.innerHTML = `No hay ninguna caja abierta. Ábrela desde Telegram con <code>/abrircaja</code>.`;
    return;
  }
  const estadoTxt = caja.estado === "abierta" ? "Caja abierta" : "Caja cerrada";
  info.textContent =
    `${estadoTxt} · desde ${fechaCorta(caja.fecha_apertura)}` +
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
        .map((c) => `<option value="${c.id}">Caja #${c.id} · ${fechaCorta(c.fecha_apertura)} (cerrada)</option>`)
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

  charts.categoria = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: filas.map((f) => f.categoria),
      datasets: [
        {
          data: filas.map((f) => f.total),
          backgroundColor: filas.map((f) => colorCategoria(f.categoria)),
          borderColor: "#FFFFFF",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "65%",
      plugins: { legend: { display: false } },
    },
  });
}

function renderTablaCategorias(porCategoria) {
  const cont = document.getElementById("tabla-categorias-body");
  const filas = [...porCategoria].sort((a, b) => b.total - a.total);

  if (!filas.length) {
    cont.innerHTML = `<div class="empty">No hay gastos en este periodo.</div>`;
    document.getElementById("total-categorias").textContent = money(0);
    return;
  }

  let total = 0;
  cont.innerHTML = filas
    .map((f) => {
      total += f.total;
      const color = colorCategoria(f.categoria);
      return `
        <div class="resumen-categoria-row">
          <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:8px;"></span>${f.categoria}</span>
          <span>${money(f.total)}</span>
        </div>`;
    })
    .join("");

  document.getElementById("total-categorias").textContent = money(total);
}

function renderMovimientos() {
  const total = state.movimientosActuales.length;
  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  if (state.paginaActual > totalPaginas) state.paginaActual = totalPaginas;
  const inicio = (state.paginaActual - 1) * POR_PAGINA;
  const pagina = state.movimientosActuales.slice(inicio, inicio + POR_PAGINA);

  renderTablaEscritorio(pagina);
  renderTarjetasMovil(pagina);
  renderPaginacion(total, inicio, pagina.length, totalPaginas);
}

function renderTablaEscritorio(pagina) {
  const tbody = document.getElementById("tabla-body");
  if (!pagina.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">No hay movimientos en este periodo.</td></tr>`;
    return;
  }
  tbody.innerHTML = pagina
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
    btn.addEventListener("click", () => eliminarMovimiento(btn.dataset.id));
  });
}

function renderTarjetasMovil(pagina) {
  const cont = document.getElementById("tabla-cards");
  if (!pagina.length) {
    cont.innerHTML = `<div class="empty">No hay movimientos en este periodo.</div>`;
    return;
  }
  cont.innerHTML = pagina
    .map((m) => {
      const esGasto = m.tipo === "gasto";
      const color = esGasto ? colorCategoria(m.categoria) : "#0EA5A4";
      const icono = esGasto ? ICONO_CATEGORIA[m.categoria] || "•" : "💰";
      return `
      <div class="mov-card">
        <div class="mov-icon" style="background:${color}22;">${icono}</div>
        <div class="mov-info">
          <div class="mov-titulo">${esGasto ? m.categoria : "Saldo ingresado"}</div>
          <div class="mov-sub">${fechaCorta(m.fecha)} · ${m.medio_pago}${m.descripcion ? " · " + m.descripcion : ""}</div>
        </div>
        <div class="mov-monto" style="color:${esGasto ? "#F97362" : "#0EA5A4"};">${esGasto ? "-" : "+"}${money(m.monto)}</div>
        <button class="mov-delete" data-id="${m.id}" title="Eliminar" aria-label="Eliminar movimiento">✕</button>
      </div>`;
    })
    .join("");

  cont.querySelectorAll(".mov-delete").forEach((btn) => {
    btn.addEventListener("click", () => eliminarMovimiento(btn.dataset.id));
  });
}

async function eliminarMovimiento(id) {
  if (!confirm("¿Eliminar este movimiento?")) return;
  try {
    await apiFetch(`/movimientos/${id}`, { method: "DELETE" });
    cargarTodo();
  } catch (err) {
    mostrarError(err.message);
  }
}

function renderPaginacion(total, inicio, cantidadMostrada, totalPaginas) {
  const infoEl = document.getElementById("pag-info");
  const numerosEl = document.getElementById("pag-numbers");
  const simpleEl = document.getElementById("pag-simple");

  if (!total) {
    infoEl.textContent = "";
    numerosEl.innerHTML = "";
    simpleEl.innerHTML = "";
    return;
  }

  infoEl.textContent = `Mostrando ${inicio + 1}–${inicio + cantidadMostrada} de ${total}`;

  const pag = state.paginaActual;
  let botonesNumeros = `<button ${pag === 1 ? "disabled" : ""} data-pag="${pag - 1}" aria-label="Página anterior">‹</button>`;
  for (let p = 1; p <= totalPaginas; p++) {
    botonesNumeros += `<button class="${p === pag ? "active" : ""}" data-pag="${p}">${p}</button>`;
  }
  botonesNumeros += `<button ${pag === totalPaginas ? "disabled" : ""} data-pag="${pag + 1}" aria-label="Página siguiente">›</button>`;
  numerosEl.innerHTML = botonesNumeros;
  numerosEl.querySelectorAll("button[data-pag]").forEach((btn) => {
    btn.addEventListener("click", () => irAPagina(parseInt(btn.dataset.pag, 10)));
  });

  simpleEl.innerHTML = `
    <button class="pag-prev" ${pag === 1 ? "disabled" : ""} aria-label="Página anterior">‹</button>
    <span>Página ${pag} de ${totalPaginas}</span>
    <button class="pag-next" ${pag === totalPaginas ? "disabled" : ""} aria-label="Página siguiente">›</button>`;
  simpleEl.querySelector(".pag-prev").addEventListener("click", () => irAPagina(pag - 1));
  simpleEl.querySelector(".pag-next").addEventListener("click", () => irAPagina(pag + 1));
}

function irAPagina(n) {
  const totalPaginas = Math.max(1, Math.ceil(state.movimientosActuales.length / POR_PAGINA));
  if (n < 1 || n > totalPaginas) return;
  state.paginaActual = n;
  renderMovimientos();
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

  state.categorias.gasto.forEach((c) => colorCategoria(c));
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

if (state.apiKey) {
  intentarEntrar(state.apiKey);
} else {
  intentarEntrar("");
}
