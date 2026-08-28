// Ecuador (America/Guayaquil) no tiene horario de verano y siempre está en
// UTC-5. Usamos Intl.DateTimeFormat con esa zona explícita para que la fecha
// de cada movimiento sea siempre la fecha "real" en Ecuador, sin importar en
// qué zona horaria esté corriendo el servidor (Render corre en UTC).
function fechaEcuador(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guayaquil" }).format(date);
}

module.exports = { fechaEcuador };
