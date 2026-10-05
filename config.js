// ─── Configuración del Control de baños ───────────────────────────────────────
// Si supabaseUrl está vacío, la web funciona en MODO PRUEBA: guarda los datos solo
// en este navegador y usa las listas de data/demo-data.js.
window.APP_CONFIG = {
  supabaseUrl: "https://hblayjaknhfxieqbzrlq.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhibGF5amFrbmhmeGllcWJ6cmxxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMjg0ODEsImV4cCI6MjEwNjgwNDQ4MX0.K2iWyQAt9upNBXUhdZuV-Nle9fkCMYgQ6jTBBO0MluE",

  dominio: "salesianas.org",   // solo pueden entrar cuentas de este dominio
  margenMin: 10,               // minutos no permitidos al principio y al final de cada clase
  avisoMin: 10,                // en "Fuera ahora" se marca en rojo si lleva más de estos minutos
  inicioCurso: "09-01",        // mes-día en que empieza el curso (para el filtro "Todo el curso")

  // Horario de tramos (según aSc Horarios del 1/9/2026). Si cambia, basta con editar estas horas.
  horario: [
    { nombre: "1ª hora", inicio: "08:00", fin: "09:00" },
    { nombre: "2ª hora", inicio: "09:00", fin: "10:00" },
    { nombre: "3ª hora", inicio: "10:00", fin: "11:00" },
    { nombre: "Recreo",  inicio: "11:00", fin: "11:30", recreo: true },
    { nombre: "4ª hora", inicio: "11:30", fin: "12:30" },
    { nombre: "5ª hora", inicio: "12:30", fin: "13:30" },
    { nombre: "6ª hora", inicio: "13:30", fin: "14:30" },
  ],
};
