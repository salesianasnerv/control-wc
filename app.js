(() => {
  "use strict";
  const CFG = window.APP_CONFIG;
  const DEMO = !CFG.supabaseUrl;

  // ─── Utilidades ────────────────────────────────────────────────────────────
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const hora = (d) => pad(d.getHours()) + ":" + pad(d.getMinutes());
  const fecha = (d) => pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear();
  const diaSemana = (d) => d.toLocaleDateString("es-ES", { weekday: "short" });
  const isoDia = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const deIso = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const minDe = (d) => d.getHours() * 60 + d.getMinutes();
  const inicioDia = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const masDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const lunes = (d) => masDias(inicioDia(d), -((d.getDay() + 6) % 7));
  const inicioCurso = (d) => {
    const [m, dd] = CFG.inicioCurso.split("-").map(Number);
    const ini = new Date(d.getFullYear(), m - 1, dd);
    return d < ini ? new Date(d.getFullYear() - 1, m - 1, dd) : ini;
  };
  const partes = (n) => { const [ap, no] = n.split(","); return no ? { nom: no.trim(), ape: ap.trim() } : { nom: n, ape: "" }; };
  const nombreLargo = (n) => { const p = partes(n); return (p.nom + " " + p.ape).trim(); };
  const durMin = (r) => (r.vuelta ? Math.round((new Date(r.vuelta) - new Date(r.salida)) / 60000) : null);

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
  }
  function fallo(e) { console.error(e); toast("Error: " + (e.message || e)); }

  // ─── Horario y franjas ───────────────────────────────────────────────────
  const CLASES_HORARIO = CFG.horario.filter((t) => !t.recreo);
  const tramoDeMin = (m) => CFG.horario.find((t) => m >= toMin(t.inicio) && m < toMin(t.fin));

  function estadoAhora(d = new Date()) {
    const m = minDe(d) + d.getSeconds() / 60;
    const t = tramoDeMin(Math.floor(m));
    if (!t) return { estado: "fuera", texto: "Fuera del horario lectivo" };
    if (t.recreo) return { estado: "recreo", t, texto: "Recreo" };
    const a = toMin(t.inicio), b = toMin(t.fin), M = CFG.margenMin;
    const lim = (x) => pad(Math.floor(x / 60)) + ":" + pad(x % 60);
    if (m - a < M) return { estado: "restringido", t, texto: `Primeros ${M} min de clase`, detalle: `Se puede salir a partir de las ${lim(a + M)}` };
    if (b - m <= M) return { estado: "restringido", t, texto: `Últimos ${M} min de clase`, detalle: `Franja no permitida hasta el final (${t.fin})` };
    return { estado: "permitido", t, texto: "Se puede salir", detalle: `Hasta las ${lim(b - M)}` };
  }

  // ─── Estado ──────────────────────────────────────────────────────────────
  const S = { hoy: [], user: null, clases: [], alumnos: [], alumno: new Map(), clase: new Map(), claseId: null, fuera: [], ultimo: [] };

  // ─── Acceso a datos: modo prueba (navegador) ─────────────────────────────
  const CLAVE = "cb_demo_salidas";
  const demoApi = {
    _get() { try { return JSON.parse(localStorage.getItem(CLAVE) || "[]"); } catch { return []; } },
    _set(v) { try { localStorage.setItem(CLAVE, JSON.stringify(v)); } catch (e) { fallo(e); } },
    async sesion() { return { email: "profesorado.prueba@" + CFG.dominio, nombre: "Profesor/a de prueba" }; },
    async login() {},
    async logout() { location.reload(); },
    async datos() {
      if (!window.DEMO_DATA) throw new Error("Falta data/demo-data.js (listas de clase).");
      return {
        clases: DEMO_DATA.map((c, i) => ({ id: c.id, nombre: c.nombre, tutor: c.tutor, orden: i })),
        alumnos: DEMO_DATA.flatMap((c) => c.alumnos.map((a, i) => ({ id: a.id, clase_id: c.id, nombre: a.nombre, orden: i + 1 }))),
      };
    },
    async registrar(al, urgencia) {
      const v = this._get();
      const r = { id: Date.now(), alumno_id: al.id, clase_id: al.clase_id, salida: new Date().toISOString(), vuelta: null, urgencia, profesor_email: S.user.email, profesor_nombre: S.user.nombre };
      v.push(r); this._set(v); return r;
    },
    async vuelta(id) { const v = this._get(); const r = v.find((x) => x.id === id); if (r) r.vuelta = new Date().toISOString(); this._set(v); },
    async borrar(id) { this._set(this._get().filter((x) => x.id !== id)); },
    async hoy() { const h = inicioDia(new Date()).toISOString(); return this._get().filter((x) => x.salida >= h); },
    async salidas({ desde, hasta, claseId, alumnoId }) {
      return this._get()
        .filter((x) => x.salida >= desde && x.salida < hasta && (!claseId || x.clase_id == claseId) && (!alumnoId || x.alumno_id == alumnoId))
        .sort((a, b) => b.salida.localeCompare(a.salida));
    },
  };

  // ─── Acceso a datos: Supabase + Microsoft 365 ─────────────────────────────
  const sb = DEMO ? null : supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
  const ok = (r) => { if (r.error) throw r.error; return r.data; };
  const sbApi = {
    async sesion() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return null;
      const u = session.user, email = (u.email || "").toLowerCase();
      if (!email.endsWith("@" + CFG.dominio)) {
        await sb.auth.signOut();
        throw new Error(`Solo se permite el acceso con cuentas @${CFG.dominio}.`);
      }
      return { email, nombre: u.user_metadata?.full_name || u.user_metadata?.name || email };
    },
    async login() {
      ok(await sb.auth.signInWithOAuth({ provider: "azure", options: { scopes: "email profile", redirectTo: location.origin + location.pathname } }));
    },
    async logout() { await sb.auth.signOut(); location.reload(); },
    async datos() {
      const [c, a] = await Promise.all([
        sb.from("clases").select("id,nombre,tutor,orden").order("orden"),
        sb.from("alumnos").select("id,clase_id,nombre,orden").eq("activo", true).order("clase_id").order("orden").range(0, 4999),
      ]);
      return { clases: ok(c), alumnos: ok(a) };
    },
    async registrar(al, urgencia) {
      return ok(await sb.from("salidas").insert({ alumno_id: al.id, clase_id: al.clase_id, urgencia, profesor_nombre: S.user.nombre }).select().single());
    },
    async vuelta(id) { ok(await sb.from("salidas").update({ vuelta: new Date().toISOString() }).eq("id", id)); },
    async borrar(id) { ok(await sb.from("salidas").delete().eq("id", id)); },
    async hoy() {
      return ok(await sb.from("salidas").select("*").gte("salida", inicioDia(new Date()).toISOString()).order("salida").range(0, 4999));
    },
    async salidas({ desde, hasta, claseId, alumnoId }) {
      const todo = [];
      for (let i = 0; ; i += 1000) {
        let q = sb.from("salidas").select("*").gte("salida", desde).lt("salida", hasta).order("salida", { ascending: false }).range(i, i + 999);
        if (claseId) q = q.eq("clase_id", claseId);
        if (alumnoId) q = q.eq("alumno_id", alumnoId);
        const d = ok(await q);
        todo.push(...d);
        if (d.length < 1000) return todo;
      }
    },
  };
  const api = DEMO ? demoApi : sbApi;

  // ─── Diálogo genérico ─────────────────────────────────────────────────────
  function dialogo(html, alAbrir) {
    const dlg = $("#dlg"), f = $("#dlgForm");
    f.innerHTML = html;
    return new Promise((res) => {
      dlg.onclose = () => res(dlg.returnValue);
      dlg.returnValue = "";
      f.onsubmit = () => (S.dlgDatos = Object.fromEntries(new FormData(f)));
      dlg.showModal();
      alAbrir?.(f, dlg);
    });
  }

  // ─── Inicio ───────────────────────────────────────────────────────────────
  async function iniciar() {
    $("#demoAviso").hidden = !DEMO;
    $("#btnLogin").onclick = () => api.login().catch((e) => ($("#loginError").textContent = e.message));
    try {
      S.user = await api.sesion();
    } catch (e) {
      $("#loginError").textContent = e.message;
    }
    if (!S.user) { $("#vLogin").hidden = false; return; }

    $("#usuario").innerHTML = `<span>${esc(S.user.nombre)}</span>` + (DEMO ? "" : `<button class="btn mini" id="btnSalir">Salir</button>`);
    $("#btnSalir")?.addEventListener("click", () => api.logout());
    $("#tabs").hidden = false;

    try {
      const d = await api.datos();
      S.clases = d.clases; S.alumnos = d.alumnos;
      S.clases.forEach((c) => S.clase.set(c.id, c));
      S.alumnos.forEach((a) => S.alumno.set(a.id, a));
    } catch (e) { fallo(e); return; }

    $$("#tabs button").forEach((b) => (b.onclick = () => mostrar(b.dataset.vista)));
    prepararRegistro();
    prepararInformes();
    mostrar("registrar");

    $("#btnEjemplo").onclick = generarEjemplo;
    $("#btnVaciar").onclick = () => { if (confirm("¿Borrar todas las salidas de prueba?")) { demoApi._set([]); refrescarFuera(); toast("Datos de prueba borrados"); } };
  }

  function mostrar(vista) {
    $$("#tabs button").forEach((b) => b.classList.toggle("activa", b.dataset.vista === vista));
    $("#vRegistrar").hidden = vista !== "registrar";
    $("#vInformes").hidden = vista !== "informes";
    if (vista === "informes") cargarInforme();
    else refrescarFuera();
  }

  // ─── Registrar ───────────────────────────────────────────────────────────
  function prepararRegistro() {
    const sel = $("#selClase");
    sel.innerHTML = S.clases.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
    let guardada = null;
    try { guardada = localStorage.getItem("cb_clase"); } catch {}
    if (guardada && S.clase.has(+guardada)) sel.value = guardada;
    S.claseId = +sel.value;
    sel.onchange = () => { S.claseId = +sel.value; try { localStorage.setItem("cb_clase", sel.value); } catch {} $("#buscar").value = ""; pintarRejilla(); pintarFuera(); };
    $("#buscar").oninput = pintarRejilla;

    $("#rejilla").onclick = (e) => {
      const card = e.target.closest(".alumno"); if (!card) return;
      const al = S.alumno.get(+card.dataset.id);
      if (e.target.closest(".hist")) return historial(al);
      const abierta = S.fuera.find((r) => r.alumno_id === al.id);
      abierta ? confirmarVuelta(abierta) : confirmarSalida(al);
    };
    $("#fuera").onclick = (e) => {
      const b = e.target.closest("[data-vuelta]");
      if (b) confirmarVuelta(S.fuera.find((r) => r.id == b.dataset.vuelta));
    };

    pintarTramo();
    setInterval(() => { pintarTramo(); pintarFuera(); }, 15000);
    setInterval(() => { if (!$("#vRegistrar").hidden) refrescarFuera(); }, 30000);
  }

  function pintarTramo() {
    const e = estadoAhora(), el = $("#tramo");
    el.className = "tramo " + e.estado;
    const icono = { permitido: "✅", restringido: "⚠️", recreo: "☕", fuera: "🕒" }[e.estado];
    el.innerHTML = `<span>${icono} ${e.t ? esc(e.t.nombre) + " (" + e.t.inicio + "–" + e.t.fin + ") · " : ""}${esc(e.texto)}</span>` +
      (e.detalle ? `<small>${esc(e.detalle)}</small>` : "");
  }

  function pintarRejilla() {
    const q = $("#buscar").value.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const norm = (s) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const lista = q ? S.alumnos.filter((a) => norm(a.nombre).includes(q)) : S.alumnos.filter((a) => a.clase_id === S.claseId);
    const fueraIds = new Set(S.fuera.map((r) => r.alumno_id));
    const vecesHoy = new Map();
    S.hoy.forEach((r) => vecesHoy.set(r.alumno_id, (vecesHoy.get(r.alumno_id) || 0) + 1));
    $("#rejilla").innerHTML = lista.length ? lista.map((a) => {
      const p = partes(a.nombre);
      return `<div class="alumno${fueraIds.has(a.id) ? " esta-fuera" : ""}" data-id="${a.id}" role="button" tabindex="0">
        <span class="nom">${esc(p.nom)}</span><span class="ape">${esc(p.ape)}</span>
        ${vecesHoy.get(a.id) ? `<span class="hoy">${vecesHoy.get(a.id)}× hoy</span>` : ""}
        <span class="n">${q ? esc(S.clase.get(a.clase_id)?.nombre) : a.orden}</span>
        <button class="hist" title="Ver historial" aria-label="Ver historial de ${esc(p.nom)}">🕘</button>
      </div>`;
    }).join("") : `<div class="vacio">No hay alumnos que coincidan.</div>`;
  }

  async function refrescarFuera() {
    try { S.hoy = await api.hoy(); } catch (e) { fallo(e); }
    S.fuera = S.hoy.filter((r) => !r.vuelta);
    pintarFuera(); pintarRejilla();
  }

  function pintarFuera() {
    const ahora = Date.now();
    const propias = S.fuera.filter((r) => r.clase_id === S.claseId).sort((a, b) => a.salida.localeCompare(b.salida));
    const otras = S.fuera.length - propias.length;
    $("#fuera").innerHTML = propias.length || otras ? `
      <h3>Fuera ahora${otras ? ` <small style="text-transform:none;font-weight:400">· ${otras} de otras clases</small>` : ""}</h3>
      <div class="fuera-lista">${propias.map((r) => {
        const min = Math.floor((ahora - new Date(r.salida)) / 60000);
        return `<div class="chip${min >= CFG.avisoMin ? " tarde" : ""}">
          <div><strong>${esc(nombreLargo(S.alumno.get(r.alumno_id)?.nombre || "?"))}</strong><br>
          <small>salió ${hora(new Date(r.salida))} · ${min} min${r.urgencia ? ' · <span class="tag">urgencia</span>' : ""}</small></div>
          <button class="btn mini" data-vuelta="${r.id}">Ha vuelto</button></div>`;
      }).join("")}</div>` : "";
  }

  async function confirmarSalida(al) {
    const e = estadoAhora(), ahora = new Date(), cl = S.clase.get(al.clase_id);
    const restringido = e.estado === "restringido";
    const misma = S.fuera.filter((r) => r.clase_id === al.clase_id);
    const previas = S.hoy.filter((r) => r.alumno_id === al.id).sort((a, b) => a.salida.localeCompare(b.salida));
    const r = await dialogo(`
      <h2>${esc(nombreLargo(al.nombre))}</h2>
      <p class="dlg-sub">${esc(cl?.nombre)} · salida a las <strong>${hora(ahora)}</strong></p>
      ${previas.length ? `<div class="previas"><strong>Ya ha salido ${previas.length === 1 ? "1 vez" : previas.length + " veces"} hoy:</strong>
        <ul>${previas.map((r) => { const d = new Date(r.salida), t = tramoDeMin(minDe(d)), m = durMin(r);
          return `<li><b>${hora(d)}</b>${t ? ` (${esc(t.nombre)})` : ""} · ${m != null ? `volvió a las ${hora(new Date(r.vuelta))}, tardó <b>${m} min</b>` : "sin vuelta registrada"}${r.urgencia ? ' · <span class="tag">urgencia</span>' : ""}<br><small>registró ${esc(r.profesor_nombre || r.profesor_email)}</small></li>`; }).join("")}</ul></div>`
        : `<p class="sin-previas">No ha salido ninguna vez hoy.</p>`}
      ${restringido ? `<div class="alerta">⚠️ Franja no permitida: ${esc(e.texto.toLowerCase())}. Solo debe salir si es una urgencia; quedará registrado como tal.</div>` : ""}
      ${misma.length ? `<p>Ya hay ${misma.length} alumno/a de esta clase fuera: ${misma.map((m) => esc(nombreLargo(S.alumno.get(m.alumno_id)?.nombre || ""))).join(", ")}.</p>` : ""}
      <div class="dlg-botones">
        <button class="btn" value="">Cancelar</button>
        ${restringido ? `<button class="btn aviso" value="urgencia">Registrar como urgencia</button>`
                      : `<button class="btn primario" value="si" autofocus>Registrar salida</button>`}
      </div>`);
    if (!r) return;
    try {
      const nueva = await api.registrar(al, r === "urgencia");
      S.hoy.push(nueva); S.fuera.push(nueva); pintarFuera(); pintarRejilla();
      toast(`Salida registrada: ${partes(al.nombre).nom} (${hora(new Date(nueva.salida))})`);
    } catch (err) { fallo(err); }
  }

  async function confirmarVuelta(reg) {
    const al = S.alumno.get(reg.alumno_id);
    const min = Math.round((Date.now() - new Date(reg.salida)) / 60000);
    const propia = reg.profesor_email === S.user.email;
    const r = await dialogo(`
      <h2>${esc(nombreLargo(al?.nombre || ""))}</h2>
      <p class="dlg-sub">Salió a las ${hora(new Date(reg.salida))} (hace ${min} min)${reg.profesor_nombre ? " · registró " + esc(reg.profesor_nombre) : ""}</p>
      <div class="dlg-botones">
        ${propia ? `<button class="btn peligro" value="borrar" style="margin-right:auto">Borrar (fue un error)</button>` : ""}
        <button class="btn" value="">Cancelar</button>
        <button class="btn primario" value="vuelta" autofocus>Ha vuelto ahora</button>
      </div>`);
    try {
      if (r === "vuelta") { await api.vuelta(reg.id); toast("Vuelta registrada"); }
      else if (r === "borrar") { await api.borrar(reg.id); toast("Registro borrado"); }
      else return;
      await refrescarFuera();
    } catch (err) { fallo(err); }
  }

  // ─── Historial de un alumno ───────────────────────────────────────────────
  async function historial(al) {
    const ahora = new Date(), cl = S.clase.get(al.clase_id);
    let regs = [];
    try {
      regs = await api.salidas({ desde: inicioCurso(ahora).toISOString(), hasta: masDias(inicioDia(ahora), 1).toISOString(), alumnoId: al.id });
    } catch (e) { return fallo(e); }
    const desde = (d) => regs.filter((r) => new Date(r.salida) >= d).length;
    const durs = regs.map(durMin).filter((x) => x != null);
    const r = await dialogo(`
      <h2>${esc(nombreLargo(al.nombre))}</h2>
      <p class="dlg-sub">${esc(cl?.nombre)} · tutor/a: ${esc(cl?.tutor || "—")}</p>
      <div class="mini-kpis">
        <div><b>${desde(inicioDia(ahora))}</b>hoy</div>
        <div><b>${desde(lunes(ahora))}</b>esta semana</div>
        <div><b>${desde(new Date(ahora.getFullYear(), ahora.getMonth(), 1))}</b>este mes</div>
        <div><b>${regs.length}</b>en el curso</div>
        <div><b>${regs.filter((r) => r.urgencia).length}</b>urgencias</div>
        ${durs.length ? `<div><b>${Math.round(durs.reduce((a, b) => a + b, 0) / durs.length)}</b>min de media</div>` : ""}
      </div>
      <div class="scroll">${regs.length ? tablaDetalle(regs, false) : `<div class="vacio">Sin salidas registradas este curso.</div>`}</div>
      <div class="dlg-botones">
        <button class="btn" value="pdf">Informe PDF</button>
        <button class="btn primario" value="" autofocus>Cerrar</button>
      </div>`);
    if (r === "pdf") {
      mostrar("informes");
      const f = $("#filtros");
      f.alcance.value = "alumno"; f.clase.value = al.clase_id; rellenarAlumnosFiltro(); f.alumno.value = al.id;
      f.periodo.value = "curso"; actualizarFiltros(); await cargarInforme();
      opcionesPdf();
    }
  }

  // ─── Informes ─────────────────────────────────────────────────────────────
  function prepararInformes() {
    const f = $("#filtros");
    f.clase.innerHTML = S.clases.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
    f.franja.innerHTML = `<option value="todas">Todas</option>` +
      CLASES_HORARIO.map((t, i) => `<option value="tramo${i}">${esc(t.nombre)} (${t.inicio}–${t.fin})</option>`).join("") +
      `<option value="restringidas">Solo primeros/últimos ${CFG.margenMin} min</option><option value="horas">Entre horas…</option>`;
    f.desde.value = f.hasta.value = isoDia(new Date());
    rellenarAlumnosFiltro();
    f.addEventListener("change", (e) => {
      if (e.target.name === "clase") rellenarAlumnosFiltro();
      actualizarFiltros(); cargarInforme();
    });
    actualizarFiltros();
    $("#btnPdf").onclick = opcionesPdf;
    $("#btnCsv").onclick = descargarCsv;
    $("#resultado").onclick = (e) => {
      const b = e.target.closest("[data-borrar]");
      if (b) { if (confirm("¿Borrar este registro?")) api.borrar(+b.dataset.borrar).then(cargarInforme, fallo); return; }
      const tramo = e.target.closest("[data-tramo]");
      if (tramo) { f.franja.value = tramo.dataset.tramo; actualizarFiltros(); cargarInforme(); $("#filtros").scrollIntoView({ behavior: "smooth" }); return; }
      if (e.target.closest("[data-quitar-franja]")) { f.franja.value = "todas"; actualizarFiltros(); cargarInforme(); return; }
      const tr = e.target.closest("[data-alumno]");
      if (tr) historial(S.alumno.get(+tr.dataset.alumno));
    };
  }

  function rellenarAlumnosFiltro() {
    const f = $("#filtros");
    f.alumno.innerHTML = S.alumnos.filter((a) => a.clase_id == f.clase.value)
      .map((a) => `<option value="${a.id}">${esc(a.nombre)}</option>`).join("");
  }

  function actualizarFiltros() {
    const f = $("#filtros");
    $$("[data-si]", f).forEach((el) => (el.hidden = !el.dataset.si.split(" ").includes(f.alcance.value)));
    $$("[data-p]", f).forEach((el) => (el.hidden = !el.dataset.p.split(" ").includes(f.periodo.value)));
    $$("[data-f]", f).forEach((el) => (el.hidden = f.franja.value !== "horas"));
    $("[data-p='dia rango']", f).firstChild.textContent = f.periodo.value === "dia" ? "Día " : "Desde ";
  }

  function leerFiltros() {
    const f = $("#filtros"), hoy = inicioDia(new Date());
    let desde, hasta, periodoTxt;
    switch (f.periodo.value) {
      case "hoy": desde = hoy; hasta = masDias(hoy, 1); periodoTxt = "Hoy, " + fecha(hoy); break;
      case "semana": desde = lunes(hoy); hasta = masDias(desde, 7); periodoTxt = `Semana del ${fecha(desde)} al ${fecha(masDias(desde, 6))}`; break;
      case "mes": desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1); hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
        periodoTxt = desde.toLocaleDateString("es-ES", { month: "long", year: "numeric" }); periodoTxt = periodoTxt[0].toUpperCase() + periodoTxt.slice(1); break;
      case "curso": desde = inicioCurso(hoy); hasta = masDias(hoy, 1); periodoTxt = `Curso ${desde.getFullYear()}/${desde.getFullYear() + 1} (hasta hoy)`; break;
      case "dia": desde = deIso(f.desde.value || isoDia(hoy)); hasta = masDias(desde, 1); periodoTxt = fecha(desde); break;
      default: {
        desde = deIso(f.desde.value || isoDia(hoy)); const h = deIso(f.hasta.value || isoDia(hoy));
        hasta = masDias(h, 1); periodoTxt = `Del ${fecha(desde)} al ${fecha(h)}`;
      }
    }
    const alcance = f.alcance.value;
    const claseId = alcance !== "centro" ? +f.clase.value : null;
    const alumnoId = alcance === "alumno" ? +f.alumno.value : null;
    const alcanceTxt = alumnoId ? `${nombreLargo(S.alumno.get(alumnoId)?.nombre || "")} (${S.clase.get(claseId)?.nombre})`
      : claseId ? S.clase.get(claseId)?.nombre : "Todo el centro";

    const fr = f.franja.value;
    let enFranja = () => true, franjaTxt = "Todas las horas";
    if (fr.startsWith("tramo")) {
      const t = CLASES_HORARIO[+fr.slice(5)];
      enFranja = (m) => m >= toMin(t.inicio) && m < toMin(t.fin); franjaTxt = `${t.nombre} (${t.inicio}-${t.fin})`;
    } else if (fr === "restringidas") {
      enFranja = (m) => { const t = tramoDeMin(m); return t && !t.recreo && (m - toMin(t.inicio) < CFG.margenMin || toMin(t.fin) - m <= CFG.margenMin); };
      franjaTxt = `Primeros/últimos ${CFG.margenMin} min de cada clase`;
    } else if (fr === "horas") {
      const a = toMin(f.hDesde.value || "00:00"), b = toMin(f.hHasta.value || "23:59");
      enFranja = (m) => m >= a && m <= b; franjaTxt = `De ${f.hDesde.value} a ${f.hHasta.value}`;
    }
    const soloUrg = f.urgencias.checked;
    return { desde, hasta, claseId, alumnoId, enFranja, franja: fr, soloUrg, alcance, txt: { periodo: periodoTxt, alcance: alcanceTxt, franja: franjaTxt + (soloUrg ? " · solo urgencias" : "") } };
  }

  let cargaN = 0;
  async function cargarInforme() {
    const n = ++cargaN, F = leerFiltros();
    $("#resultado").innerHTML = `<div class="vacio">Cargando…</div>`;
    let regs;
    try {
      regs = await api.salidas({ desde: F.desde.toISOString(), hasta: F.hasta.toISOString(), claseId: F.claseId, alumnoId: F.alumnoId });
    } catch (e) { $("#resultado").innerHTML = ""; return fallo(e); }
    if (n !== cargaN) return;
    regs = regs.filter((r) => F.enFranja(minDe(new Date(r.salida))) && (!F.soloUrg || r.urgencia));
    S.ultimo = { F, regs, res: resumir(regs) };
    pintarInforme(S.ultimo);
  }

  function resumir(regs) {
    const porAlumno = new Map(), porTramo = new Map(), porClase = new Map(), porDia = new Map();
    CLASES_HORARIO.forEach((t) => porTramo.set(t.nombre, { n: 0, u: 0 }));
    for (const r of regs) {
      const d = new Date(r.salida), dur = durMin(r);
      const a = porAlumno.get(r.alumno_id) || { id: r.alumno_id, n: 0, u: 0, durs: [] };
      a.n++; if (r.urgencia) a.u++; if (dur != null) a.durs.push(dur); porAlumno.set(r.alumno_id, a);
      const t = tramoDeMin(minDe(d)); const k = t ? t.nombre : "Fuera de horario";
      const tt = porTramo.get(k) || { n: 0, u: 0 }; tt.n++; if (r.urgencia) tt.u++; porTramo.set(k, tt);
      const c = porClase.get(r.clase_id) || { id: r.clase_id, n: 0, u: 0, alumnos: new Set() };
      c.n++; if (r.urgencia) c.u++; c.alumnos.add(r.alumno_id); porClase.set(r.clase_id, c);
      const dk = isoDia(d); porDia.set(dk, (porDia.get(dk) || 0) + 1);
    }
    const media = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
    const alumnos = [...porAlumno.values()].map((a) => ({ ...a, media: media(a.durs), al: S.alumno.get(a.id) }))
      .sort((x, y) => y.n - x.n || (x.al?.nombre || "").localeCompare(y.al?.nombre || ""));
    const clases = [...porClase.values()].map((c) => ({ ...c, nAl: c.alumnos.size, cl: S.clase.get(c.id) })).sort((a, b) => (a.cl?.orden ?? 0) - (b.cl?.orden ?? 0));
    const tramos = [...porTramo.entries()].map(([nombre, v]) => ({ nombre, ...v })).filter((t) => t.n || CLASES_HORARIO.some((h) => h.nombre === t.nombre));
    const dias = [...porDia.entries()].sort().map(([d, n]) => ({ d: deIso(d), n }));
    const durs = regs.map(durMin).filter((x) => x != null);
    return { total: regs.length, urg: regs.filter((r) => r.urgencia).length, nAlumnos: porAlumno.size, media: media(durs), alumnos, clases, tramos, dias };
  }

  function tablaDetalle(regs, conAlumno = true) {
    return `<table><thead><tr><th>Fecha</th><th>Salida</th><th>Vuelta</th><th class="num">Min</th>
      ${conAlumno ? "<th>Alumno/a</th><th>Clase</th>" : ""}<th>Registró</th><th></th></tr></thead><tbody>
      ${regs.map((r) => {
        const d = new Date(r.salida), al = S.alumno.get(r.alumno_id);
        return `<tr${conAlumno ? ` class="click" data-alumno="${r.alumno_id}"` : ""}><td>${diaSemana(d)} ${fecha(d)}</td><td>${hora(d)}</td><td>${r.vuelta ? hora(new Date(r.vuelta)) : "—"}</td>
          <td class="num">${durMin(r) ?? ""}</td>
          ${conAlumno ? `<td>${esc(al?.nombre)}</td><td>${esc(S.clase.get(r.clase_id)?.nombre)}</td>` : ""}
          <td>${esc(r.profesor_nombre || r.profesor_email)}</td>
          <td>${r.urgencia ? '<span class="tag">urgencia</span>' : ""}
          ${conAlumno && r.profesor_email === S.user.email ? ` <button class="btn mini peligro" data-borrar="${r.id}" title="Borrar">✕</button>` : ""}</td></tr>`;
      }).join("")}</tbody></table>`;
  }

  function pintarInforme({ F, regs, res }) {
    const max = Math.max(1, ...res.tramos.map((t) => t.n));
    $("#resultado").innerHTML = `
      <p class="dlg-sub"><strong>${esc(F.txt.alcance)}</strong> · ${esc(F.txt.periodo)} · ${esc(F.txt.franja)}</p>
      <div class="kpis">
        <div class="kpi"><b>${res.total}</b><span>salidas</span></div>
        <div class="kpi"><b>${res.urg}</b><span>urgencias (franja no permitida)</span></div>
        <div class="kpi"><b>${res.nAlumnos}</b><span>alumnos distintos</span></div>
        <div class="kpi"><b>${res.media ?? "—"}</b><span>min de media fuera</span></div>
      </div>
      ${res.total && F.franja !== "todas" ? `
      <div class="caja destacada"><h3>Quién salió · ${esc(F.txt.franja)} (${regs.length}) <button class="enlace" data-quitar-franja style="margin-left:8px;text-transform:none">ver todas las horas</button></h3>
        ${tablaDetalle(regs)}</div>` : ""}
      ${res.total ? `
      <div class="bloques">
        ${F.alumnoId ? "" : `<div class="caja"><h3>Por alumno/a <small style="text-transform:none;font-weight:400">· pulsa para ver su historial</small></h3>
          <table><thead><tr><th>Alumno/a</th>${F.claseId ? "" : "<th>Clase</th>"}<th class="num">Salidas</th><th class="num">Urg.</th><th class="num">Media</th></tr></thead><tbody>
          ${res.alumnos.map((a) => `<tr class="click" data-alumno="${a.id}"><td>${esc(a.al?.nombre)}</td>${F.claseId ? "" : `<td>${esc(S.clase.get(a.al?.clase_id)?.nombre)}</td>`}
            <td class="num">${a.n}</td><td class="num">${a.u || ""}</td><td class="num">${a.media ?? ""}</td></tr>`).join("")}
          </tbody></table></div>`}
        <div class="caja"><h3>Por tramo horario</h3>
          ${res.tramos.map((t) => { const i = CLASES_HORARIO.findIndex((h) => h.nombre === t.nombre);
            return `<div class="barra${i >= 0 ? " click" : ""}"${i >= 0 ? ` data-tramo="tramo${i}" title="Ver quién salió en ${esc(t.nombre)}"` : ""}><span>${esc(t.nombre)}</span><i style="width:${(t.n / max) * 100}%"></i><span class="num">${t.n}</span></div>`; }).join("")}
          <small class="nota">Pulsa un tramo para ver quién salió en él.</small>
          ${!F.claseId && res.clases.length ? `<h3 style="margin-top:16px">Por clase</h3><table><thead><tr><th>Clase</th><th class="num">Salidas</th><th class="num">Alumnos</th><th class="num">Urg.</th></tr></thead><tbody>
            ${res.clases.map((c) => `<tr><td>${esc(c.cl?.nombre)}</td><td class="num">${c.n}</td><td class="num">${c.nAl}</td><td class="num">${c.u || ""}</td></tr>`).join("")}</tbody></table>` : ""}
        </div>
      </div>
      ${F.franja === "todas" ? `<div class="caja"><h3>Detalle (${regs.length}) <small style="text-transform:none;font-weight:400">· pulsa una fila para ver el historial</small></h3>${tablaDetalle(regs)}</div>` : ""}`
      : `<div class="vacio">No hay salidas con estos filtros.</div>`}`;
  }

  // ─── PDF ──────────────────────────────────────────────────────────────────
  async function opcionesPdf() {
    if (!S.ultimo?.F) await cargarInforme();
    const { F } = S.ultimo;
    const r = await dialogo(`
      <h2>Descargar informe PDF</h2>
      <p class="dlg-sub">${esc(F.txt.alcance)} · ${esc(F.txt.periodo)} · ${esc(F.txt.franja)}<br>
      <small>Para cambiar clase, alumno, periodo u horas, usa los filtros de la página.</small></p>
      <div class="opciones">
        <label class="check"><input type="radio" name="tipo" value="resumen"> Solo resumen (totales, por alumno, por tramo y por clase)</label>
        <label class="check"><input type="radio" name="tipo" value="detalle"> Solo listado detallado de salidas</label>
        <label class="check"><input type="radio" name="tipo" value="ambos" checked> Resumen + listado detallado</label>
      </div>
      <div class="dlg-botones"><button class="btn" value="">Cancelar</button><button class="btn primario" value="ok">Descargar</button></div>`);
    if (r === "ok") generarPdf(S.dlgDatos?.tipo || "ambos");
  }

  function generarPdf(tipo) {
    if (!window.jspdf) return toast("No se pudo cargar el generador de PDF (¿sin conexión?)");
    const { F, regs, res } = S.ultimo;
    const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), AZUL = [31, 95, 191];
    const est = { styles: { fontSize: 8.5, cellPadding: 1.6 }, headStyles: { fillColor: AZUL }, margin: { left: 14, right: 14 }, alternateRowStyles: { fillColor: [244, 246, 249] } };
    const titulo = (t, y) => { doc.setFontSize(11.5); doc.setFont(undefined, "bold"); doc.text(t, 14, y); doc.setFont(undefined, "normal"); return y + 2.5; };
    const sitio = (y, h = 30) => (y + h > 280 ? (doc.addPage(), 18) : y);

    doc.setFontSize(16); doc.setFont(undefined, "bold"); doc.text("Control de baños - Informe", 14, 18);
    doc.setFont(undefined, "normal"); doc.setFontSize(10);
    doc.text([`Alcance: ${F.txt.alcance}`, `Periodo: ${F.txt.periodo}`, `Horas: ${F.txt.franja}`], 14, 26);
    let y = 42;

    if (tipo !== "detalle") {
      doc.autoTable({ ...est, startY: y, theme: "grid", head: [["Salidas", "Urgencias", "Alumnos distintos", "Media fuera (min)"]],
        body: [[res.total, res.urg, res.nAlumnos, res.media ?? "-"]], styles: { fontSize: 11, halign: "center" } });
      y = doc.lastAutoTable.finalY + 9;
      if (!F.alumnoId && res.alumnos.length) {
        y = titulo("Por alumno/a", sitio(y));
        doc.autoTable({ ...est, startY: y, head: [["Alumno/a", ...(F.claseId ? [] : ["Clase"]), "Salidas", "Urgencias", "Media (min)"]],
          body: res.alumnos.map((a) => [a.al?.nombre || "?", ...(F.claseId ? [] : [S.clase.get(a.al?.clase_id)?.nombre || ""]), a.n, a.u || "", a.media ?? ""]),
          columnStyles: { [F.claseId ? 1 : 2]: { halign: "right" } } });
        y = doc.lastAutoTable.finalY + 9;
      }
      y = titulo("Por tramo horario", sitio(y));
      doc.autoTable({ ...est, startY: y, head: [["Tramo", "Salidas", "Urgencias"]], body: res.tramos.map((t) => [t.nombre, t.n, t.u || ""]), tableWidth: 100 });
      y = doc.lastAutoTable.finalY + 9;
      if (!F.claseId && res.clases.length) {
        y = titulo("Por clase", sitio(y));
        doc.autoTable({ ...est, startY: y, head: [["Clase", "Salidas", "Alumnos", "Urgencias"]], body: res.clases.map((c) => [c.cl?.nombre || "", c.n, c.nAl, c.u || ""]), tableWidth: 120 });
        y = doc.lastAutoTable.finalY + 9;
      }
      if (res.dias.length > 1) {
        y = titulo("Por día", sitio(y));
        doc.autoTable({ ...est, startY: y, head: [["Día", "Salidas"]], body: res.dias.map((d) => [diaSemana(d.d) + " " + fecha(d.d), d.n]), tableWidth: 70 });
        y = doc.lastAutoTable.finalY + 9;
      }
    }
    if (tipo !== "resumen") {
      y = titulo(`Detalle de salidas (${regs.length})`, sitio(y));
      doc.autoTable({ ...est, startY: y,
        head: [["Fecha", "Salida", "Vuelta", "Min", ...(F.alumnoId ? [] : ["Alumno/a", "Clase"]), "Registró", "Urg."]],
        body: [...regs].reverse().map((r) => { const d = new Date(r.salida); return [diaSemana(d) + " " + fecha(d), hora(d), r.vuelta ? hora(new Date(r.vuelta)) : "-", durMin(r) ?? "",
          ...(F.alumnoId ? [] : [S.alumno.get(r.alumno_id)?.nombre || "?", S.clase.get(r.clase_id)?.nombre || ""]), r.profesor_nombre || r.profesor_email, r.urgencia ? "Sí" : ""]; }) });
    }

    const n = doc.getNumberOfPages(), gen = `Generado por ${S.user.nombre} el ${fecha(new Date())} a las ${hora(new Date())}`;
    for (let i = 1; i <= n; i++) {
      doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
      doc.text(gen, 14, 290); doc.text(`Página ${i} de ${n}`, W - 14, 290, { align: "right" });
    }
    const slug = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
    doc.save(`banos_${slug(F.txt.alcance)}_${isoDia(F.desde)}.pdf`);
  }

  function descargarCsv() {
    const { F, regs } = S.ultimo || {}; if (!regs) return;
    const c = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = [["Fecha", "Hora salida", "Hora vuelta", "Minutos", "Alumno/a", "Clase", "Tramo", "Urgencia", "Registró"]]
      .concat([...regs].reverse().map((r) => { const d = new Date(r.salida);
        return [fecha(d), hora(d), r.vuelta ? hora(new Date(r.vuelta)) : "", durMin(r) ?? "", S.alumno.get(r.alumno_id)?.nombre, S.clase.get(r.clase_id)?.nombre,
          tramoDeMin(minDe(d))?.nombre || "", r.urgencia ? "Sí" : "No", r.profesor_nombre || r.profesor_email]; }));
    const blob = new Blob(["﻿" + filas.map((f) => f.map(c).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `banos_${isoDia(F.desde)}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  // ─── Datos de ejemplo (solo modo prueba) ─────────────────────────────────
  function generarEjemplo() {
    const v = demoApi._get(), hoy = inicioDia(new Date()), rnd = (n) => Math.floor(Math.random() * n);
    const frecuentes = Array.from({ length: 25 }, () => S.alumnos[rnd(S.alumnos.length)]);
    const profes = ["Ana Felipe", "Mario Espejo", "Elena Martínez", "Isabel Cortés", "Laura García"];
    for (let i = 0; i < 220; i++) {
      const dia = masDias(hoy, -rnd(30)); if (dia.getDay() === 0 || dia.getDay() === 6) continue;
      const t = CLASES_HORARIO[rnd(CLASES_HORARIO.length)], ini = toMin(t.inicio) + rnd(toMin(t.fin) - toMin(t.inicio));
      const s = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), Math.floor(ini / 60), ini % 60);
      if (s > new Date()) continue;
      const al = Math.random() < 0.5 ? frecuentes[rnd(frecuentes.length)] : S.alumnos[rnd(S.alumnos.length)];
      const m = ini - toMin(t.inicio), urg = m < CFG.margenMin || toMin(t.fin) - ini <= CFG.margenMin;
      v.push({ id: Date.now() + i, alumno_id: al.id, clase_id: al.clase_id, salida: s.toISOString(),
        vuelta: Math.random() < 0.85 ? new Date(s.getTime() + (3 + rnd(12)) * 60000).toISOString() : null,
        urgencia: urg, profesor_email: "demo@" + CFG.dominio, profesor_nombre: profes[rnd(profes.length)] });
    }
    demoApi._set(v.map((r) => (r.vuelta === null && r.salida < hoy.toISOString() ? { ...r, vuelta: r.salida } : r)));
    toast("Salidas de ejemplo generadas");
    $("#vInformes").hidden ? refrescarFuera() : cargarInforme();
  }

  iniciar();
})();
