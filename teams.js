/*
  ENTRAR DESDE TEAMS SIN VOLVER A INICIAR SESIÓN
  -----------------------------------------------
  La app de Teams abre esta web con «?teams=1» en la dirección. Solo en ese caso,
  la web entra sola con la cuenta de Microsoft 365 con la que se ha abierto Teams
  (sin pulsar «Entrar con Microsoft 365»). En el navegador no hace nada.

  Necesita que la app «Acceso a Microsoft 365» de Entra ID tenga expuesta la API
  para esta dirección (ver «0 - Apps de Teams/README.md»). Si no, la web muestra
  el botón de siempre.
*/
(() => {
  const CLAVE = "abierta-en-teams";
  let enTeams = false;
  try {
    if (new URLSearchParams(location.search).has("teams")) sessionStorage.setItem(CLAVE, "1");
    enTeams = sessionStorage.getItem(CLAVE) === "1";
  } catch { enTeams = new URLSearchParams(location.search).has("teams"); }

  const SDK = "https://cdn.jsdelivr.net/npm/@microsoft/teams-js@2.57.0/dist/umd/MicrosoftTeams.min.js";
  const cargarSdk = () => window.microsoftTeams ? Promise.resolve() : new Promise((ok, mal) => {
    const s = document.createElement("script");
    s.src = SDK; s.onload = ok; s.onerror = () => mal(new Error("No se pudo cargar Teams"));
    document.head.appendChild(s);
  });
  const conLimite = (p, ms) => Promise.race([p, new Promise((_, mal) => setTimeout(() => mal(new Error("Teams no responde")), ms))]);

  let intento = null;
  window.TeamsSSO = {
    enTeams,
    // Inicia la sesión de Supabase con la cuenta de Teams. Devuelve true si lo consigue.
    entrar(sb) {
      if (!enTeams || !sb) return Promise.resolve(false);
      return intento ||= (async () => {
        try {
          await cargarSdk();
          await conLimite(window.microsoftTeams.app.initialize(), 5000);
          const token = await conLimite(window.microsoftTeams.authentication.getAuthToken(), 15000);
          const { error } = await sb.auth.signInWithIdToken({ provider: "azure", token });
          if (error) throw error;
          return true;
        } catch (e) {
          console.warn("No se pudo entrar automáticamente desde Teams:", e);
          intento = null;
          return false;
        }
      })();
    },
  };
})();
