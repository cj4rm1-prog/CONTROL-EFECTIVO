# Caja Chica — Control de gastos con registro por Telegram

Panel de control de caja chica: **abres una caja** con un saldo inicial,
registras **ingresos de saldo** y **gastos** por tipo de dinero (efectivo /
tarjeta / transferencia) y categoría de consumo, y **cierras la caja** cuando
terminas — todo desde Telegram. El dashboard muestra el saldo de la caja
abierta (sin mezclarse con cajas ya cerradas), los movimientos por día y por
semana, y el gasto por categoría. También puedes revisar el histórico de
cajas cerradas por separado. Un solo servicio en Render sirve el dashboard
web **y** corre el bot; los datos viven en una base de datos SQLite gratuita
en la nube (Turso).

## Cómo funciona el sistema de cajas

- **`/abrircaja`**: abre una caja nueva con un saldo inicial y un tipo de
  dinero. Solo puede haber **una caja abierta a la vez** (la base de datos lo
  garantiza).
- **`/nuevo`**: registra un ingreso de saldo o un gasto, siempre dentro de la
  caja que esté abierta en ese momento. Si no hay ninguna caja abierta, el
  bot te lo avisa y no deja registrar nada hasta que abras una.
- **`/cerrarcaja`**: calcula el saldo final (saldo inicial + ingresos −
  gastos) y cierra la caja. Sus movimientos quedan guardados en el
  histórico, pero **dejan de contar** para el saldo actual.
- El **dashboard**, por defecto, muestra solo la caja abierta — así el saldo
  actual nunca se mezcla con dinero ya cerrado/contabilizado. Arriba a la
  derecha puedes cambiar a "Todas las cajas" para ver el histórico completo,
  o elegir una caja cerrada específica del listado.

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

- En Telegram, escríbele a tu bot `/abrircaja` primero: dale un monto
  inicial y elige el tipo de dinero. Sin una caja abierta, no se pueden
  registrar movimientos.
- Luego usa `/nuevo` para registrar 💰 Ingresar saldo o 🧾 Registrar gasto:
  tipo de dinero → (si es gasto, categoría) → monto → descripción.
- Usa `/saldo` para ver el saldo de la caja abierta al instante, `/resumen`
  para un resumen completo, y `/cerrarcaja` cuando termines para cerrarla
  (te muestra el saldo final calculado y pide confirmación).
- Abre el dashboard web: por defecto muestra la caja abierta actual (filtra
  por Hoy / 7 días / Este mes / Todo, por tipo de dinero o categoría). Arriba
  puedes cambiar a "Todas las cajas" o a una caja cerrada específica del
  histórico. El gráfico de "Gasto en el tiempo" se puede alternar entre
  vista por día y por semana.
- Desde el dashboard también puedes pulsar **"+ Nuevo movimiento"** para
  cargar algo manualmente (requiere que haya una caja abierta).

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
