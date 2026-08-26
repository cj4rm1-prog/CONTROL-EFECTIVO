require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const { initDb } = require("./db");
const apiRouter = require("./routes/api");
const { iniciarBot } = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use("/api", apiRouter);

// Sirve el dashboard estático (carpeta ../client)
const clientDir = path.join(__dirname, "..", "client");
app.use(express.static(clientDir));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

async function main() {
  await initDb();
  iniciarBot();
  app.listen(PORT, () => {
    console.log(`[server] Escuchando en puerto ${PORT}`);
  });
}

main().catch((err) => {
  console.error("Error fatal al iniciar el servidor:", err);
  process.exit(1);
});
