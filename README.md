# Libro Mayor — Control de gastos con registro por Telegram

Panel de control de gastos personal/familiar: registras **saldo** (dinero que
ingresa) y **gastos** por tipo de dinero (efectivo / tarjeta / transferencia)
y categoría de consumo (Alimentación, Salud, Transporte, etc.), alimentado
desde un bot de Telegram. El dashboard muestra el **saldo actual** disponible
(total y por tipo de dinero), todos los movimientos por día y por semana, y
el gasto por categoría. Un solo servicio en Render sirve el dashboard web
**y** corre el bot; los datos viven en una base de datos SQLite gratuita en
la nube (Turso).

## Cómo funciona el saldo

- **Ingresar saldo**: registra dinero que entra (ej. tu sueldo, una recarga)
  eligiendo el tipo de dinero (efectivo/tarjeta/transferencia).
- **Registrar gasto**: registra dinero que sale, eligiendo tipo de dinero y
  categoría de consumo.
- El **saldo actual** = total de saldo ingresado − total gastado (siempre
  histórico, sin importar el filtro de fechas que estés viendo). También se
  muestra el saldo desglosado por cada tipo de dinero.

## Arquitectura

```
Telegram  ──►  Bot (Node, dentro del mismo server)  ──►  Turso (SQLite en la nube)
                                                              ▲
Navegador ──►  Dashboard estático (Chart.js)  ──►  API REST ─┘
```

Todo corre en **un solo servicio web de Render** (gratis): el bot usa
"long polling" (no necesita webhook ni URL pública especial), y Express sirve
tanto la API como los archivos del dashboard.

## 1. Crear la base de datos gratis (Turso)

1. Ve a https://turso.tech y crea una cuenta gratis.
2. Instala la CLI o usa el dashboard web de Turso para crear una base:
   ```
   turso db create gasto-dashboard
   turso db show gasto-dashboard --url
   turso db tokens create gasto-dashboard
   ```
3. Guarda la URL (`libsql://...`) y el token — los usarás como
   `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`.

El esquema de la tabla se crea solo la primera vez que arranca el servidor.

## 2. Crear el bot de Telegram

1. En Telegram, habla con **@BotFather**.
2. `/newbot` → sigue las instrucciones → te da un **token** (`TELEGRAM_BOT_TOKEN`).
3. (Opcional pero recomendado) Escríbele a tu bot un mensaje y visita
   `https://api.telegram.org/bot<token>/getUpdates` para ver tu `chat.id`.
   Guarda esos IDs en `TELEGRAM_ALLOWED_IDS` (separados por coma) para que
   solo tu equipo pueda registrar movimientos.

## 3. Desplegar en Render

**Opción rápida (blueprint):**
1. Sube este proyecto a un repo de GitHub.
2. En Render → New → Blueprint → selecciona el repo (usa `render.yaml`).
3. Render te pedirá las variables marcadas `sync: false`: pega los valores
   de Turso, el token de Telegram y define un `DASHBOARD_KEY` (una clave
   larga que tú elijas para proteger el panel).

**Opción manual:**
1. Render → New → Web Service → conecta el repo.
2. Root directory: `server`
3. Build command: `npm install`
4. Start command: `npm start`
5. Agrega las variables de entorno de `server/.env.example`.
6. Plan: Free.

Cuando termine el deploy, Render te da una URL pública (algo como
`https://gasto-dashboard.onrender.com`). Ábrela, ingresa el `DASHBOARD_KEY`
que configuraste y ya tienes el dashboard.

> Nota sobre el plan free de Render: el servicio "duerme" tras ~15 min sin
> tráfico y tarda unos segundos en despertar con la siguiente visita/mensaje.
> Si necesitas que el bot responda al instante siempre, considera el plan
> pago más económico de Render.

## 4. Probar

- En Telegram, escríbele a tu bot `/nuevo` y sigue los botones:
  💰 Ingresar saldo o 🧾 Registrar gasto → tipo de dinero → (si es gasto,
  categoría) → monto → descripción.
- Usa `/saldo` para ver el saldo actual al instante, o `/resumen` para un
  resumen del mes.
- Abre el dashboard web: verás el movimiento reflejado al refrescar
  (filtra por Hoy / 7 días / Este mes / Todo, y por tipo de dinero o
  categoría). El gráfico de "Gasto en el tiempo" se puede alternar entre
  vista por día y por semana.
- Desde el dashboard también puedes pulsar **"+ Nuevo movimiento"** para
  cargar algo manualmente (por ejemplo, movimientos históricos o el saldo
  inicial con el que arrancas).

## 5. Desarrollo local

```bash
cd server
cp .env.example .env   # rellena tus credenciales
npm install
npm start
```

Abre `http://localhost:3000`.

## Estructura del proyecto

```
gasto-dashboard/
├── render.yaml              # blueprint de despliegue en Render
├── server/
│   ├── server.js            # Express: API + estáticos + arranque del bot
│   ├── db.js                # cliente Turso + esquema + catálogos
│   ├── bot.js                # flujo conversacional del bot de Telegram
│   ├── routes/api.js        # endpoints REST (movimientos, resumen, categorías)
│   └── .env.example
└── client/
    ├── index.html
    ├── style.css
    └── app.js                # fetch + Chart.js + tabla + modal de alta manual
```

## Personalizar categorías

Edita la lista `CATEGORIAS_GASTO` en `server/db.js` (por defecto:
Alimentación, Salud, Transporte, Servicios, Entretenimiento, Educación,
Hogar, Otros). Se usa tanto en el bot de Telegram como en el formulario web.

## Seguridad

- `DASHBOARD_KEY` protege tanto la API como el dashboard con una clave
  compartida simple (suficiente para un equipo pequeño interno). Si necesitas
  login por usuario/contraseña real, se puede añadir después.
- `TELEGRAM_ALLOWED_IDS` evita que cualquier persona que encuentre tu bot
  registre movimientos falsos.
