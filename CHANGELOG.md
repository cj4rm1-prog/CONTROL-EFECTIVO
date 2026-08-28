# Historial de versiones — Caja Chica

Este archivo lleva el control de qué cambió en cada versión. El número de
versión actual también aparece al pie del dashboard web, así siempre puedes
confirmar qué versión está corriendo en Render sin adivinar.

## v1.3.1 — Corrección de formato en Excel
- Se cambió la librería de exportación (de SheetJS a ExcelJS), porque la
  anterior no podía escribir colores ni estilos desde el navegador, solo
  datos en crudo. Ahora el `.xlsx` sí sale con encabezado turquesa, texto
  en negrita para los totales, formato de moneda y bordes.

## v1.3.0 — Exportar a Excel
- Botón "Exportar a Excel" en la lista de movimientos: descarga un `.xlsx`
  con los movimientos filtrados actuales (respeta rango de fechas, caja y
  filtros), más una fila de total ingresado y total gastado.
- SheetJS (librería para generar el Excel) se instala como dependencia y se
  auto-hospeda igual que Chart.js, sin depender de un CDN externo.
- Número de versión visible al pie del dashboard.

## v1.2.0 — Rediseño visual
- Paleta de colores clara y minimalista (antes: tema oscuro tipo "recibo").
- Layout responsive real: 2 columnas en escritorio, 1 columna en móvil.
- Tabla de movimientos con columnas de ancho fijo (ya no se desborda).
- En móvil, los movimientos se muestran como tarjetas en vez de tabla.
- Paginación de 10 en 10 movimientos (antes se mostraban todos de golpe).
- Chart.js se empezó a auto-hospedar (dejó de depender de un CDN externo
  que algunas redes/operadores bloqueaban).

## v1.1.0 — Sistema de caja chica y corrección de zona horaria
- Comandos de Telegram `/abrircaja` y `/cerrarcaja`: solo puede existir una
  caja abierta a la vez, y el saldo actual del dashboard refleja solo esa
  caja (no se mezcla con cajas ya cerradas).
- El dashboard permite elegir entre ver la caja abierta, el histórico
  completo, o una caja cerrada específica.
- Corrección de zona horaria: todas las fechas se anclan a America/Guayaquil
  en vez de UTC (antes, movimientos registrados de noche podían quedar
  fechados "al día siguiente").
- Tabla "Resumen por categoría" agrupada (sin repetir filas, sumando montos).

## v1.0.0 — Versión inicial
- Bot de Telegram para registrar ingresos de saldo y gastos, eligiendo tipo
  de dinero (efectivo/tarjeta/transferencia) y categoría de consumo.
- Dashboard web con saldo, gráfico de gasto por categoría, y tabla de
  movimientos con filtros.
- Base de datos en Turso (SQLite en la nube, gratis), servidor único en
  Render que corre el bot y sirve el dashboard.
