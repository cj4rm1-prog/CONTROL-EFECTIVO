const state = {
  range: "mes",
  filtroTipo: "",
  filtroMedio: "",
  filtroCategoria: "",
  modoTiempo: "dia",
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
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { ...apiHeaders(), ...(options.headers || {}) },
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error(`Error ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
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

function labelRange(range) {
  return { hoy: "Hoy", semana: "Últimos 7 días", mes: "Este mes", todo: "Histórico completo" }[range];
}

// ---------- Carga y render ----------
async function cargarTodo() {
  const { desde, hasta } = rangoFechas(state.range);
  const params = new URLSearchParams();
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  if (state.filtroTipo) params.set("tipo", state.filtroTipo);
  if (state.filtroMedio) params.set("medio_pago", state.filtroMedio);
  if (state.filtroCategoria) params.set("categoria", state.filtroCategoria);

  const [resumen, movimientos] = await Promise.all([
    apiFetch(`/resumen?${params.toString()}`),
    apiFetch(`/movimientos?${params.toString()}`),
  ]);

  document.getElementById("receipt-period").textContent = labelRange(state.range);
  document.getElementById("kpi-saldo").textContent = money(resumen.saldoTotal);
  document.getElementById("saldo-efectivo").textContent = money(resumen.saldoPorMedio.efectivo);
  document.getElementById("saldo-tarjeta").textContent = money(resumen.saldoPorMedio.tarjeta);
  document.getElementById("saldo-transferencia").textContent = money(resumen.saldoPorMedio.transferencia);
  document.getElementById("kpi-ingresado").textContent = money(resumen.ingresosRango);
  document.getElementById("kpi-gastado").textContent = money(resumen.gastosRango);

  renderChartCategoria(resumen.porCategoria);
  renderChartTiempo(resumen);
  renderTabla(movimientos);
}

function renderChartCategoria(porCategoria) {
  const filas = [...porCategoria].sort((a, b) => b.total - a.total);
  const ctx = document.getElementById("chart-categoria");
  if (charts.categoria) charts.categoria.destroy();

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

function renderChartTiempo(resumen) {
  const filas = state.modoTiempo === "dia" ? resumen.porDia : resumen.porSemana;
  const clave = state.modoTiempo === "dia" ? "fecha" : "semana";
  const etiquetas = [...new Set(filas.map((r) => r[clave]))].sort();

  const ingresos = etiquetas.map((e) => {
    const row = filas.find((r) => r[clave] === e && r.tipo === "ingreso");
    return row ? row.total : 0;
  });
  const gastos = etiquetas.map((e) => {
    const row = filas.find((r) => r[clave] === e && r.tipo === "gasto");
    return row ? row.total : 0;
  });

  const ctx = document.getElementById("chart-tiempo");
  if (charts.tiempo) charts.tiempo.destroy();
  charts.tiempo = new Chart(ctx, {
    type: state.modoTiempo === "dia" ? "line" : "bar",
    data: {
      labels: etiquetas,
      datasets: [
        { label: "Gasto", data: gastos, borderColor: "#d9553c", backgroundColor: state.modoTiempo === "dia" ? "#d9553c33" : "#d9553c", tension: 0.3, fill: state.modoTiempo === "dia" },
        { label: "Saldo ingresado", data: ingresos, borderColor: "#2f9e6e", backgroundColor: state.modoTiempo === "dia" ? "#2f9e6e33" : "#2f9e6e", tension: 0.3, fill: state.modoTiempo === "dia" },
      ],
    },
    options: chartOptions({}),
  });
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
  if (!movimientos.length) {
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
      await apiFetch(`/movimientos/${btn.dataset.id}`, { method: "DELETE" });
      cargarTodo();
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

document.getElementById("tiempo-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  document.querySelectorAll("#tiempo-tabs button").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  state.modoTiempo = btn.dataset.modo;
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
    errorEl.textContent = "No se pudo guardar. Revisa los datos e intenta de nuevo.";
  }
});

// ---------- Gate de acceso ----------
async function intentarEntrar(key) {
  state.apiKey = key;
  try {
    const categorias = await apiFetch("/categorias");
    state.categorias = categorias;
    poblarSelectCategoria();
    localStorage.setItem("dashboard_key", key);
    document.getElementById("gate").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
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
