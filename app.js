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
  const S = { hoy: [], user: null, cursos: [], curso: null, clases: [], alumnos: [], clasesActivas: [], alumnosActivos: [],
    alumno: new Map(), clase: new Map(), claseId: null, fuera: [], ultimo: [] };

  // Curso "2026-2027" → del 1 de septiembre de 2026 al 1 de septiembre de 2027
  function rangoCurso(curso) {
    const y = parseInt(curso?.nombre, 10), [m, dd] = CFG.inicioCurso.split("-").map(Number);
    if (!y) { const d = inicioCurso(new Date()); return { desde: d, hasta: new Date(d.getFullYear() + 1, m - 1, dd) }; }
    return { desde: new Date(y, m - 1, dd), hasta: new Date(y + 1, m - 1, dd) };
  }
  const clasesDe = (cursoId) => S.clases.filter((c) => c.curso_id == cursoId);

  // ─── Acceso a datos: modo prueba (navegador) ─────────────────────────────
  const CLAVE = "cb_demo_salidas";
  const demoApi = {
    _get() { try { return JSON.parse(localStorage.getItem(CLAVE) || "[]"); } catch { return []; } },
    _set(v) { try { localStorage.setItem(CLAVE, JSON.stringify(v)); } catch (e) { fallo(e); } },
    _db() {
      try { const d = JSON.parse(localStorage.getItem("cb_demo_db")); if (d) return d; } catch {}
      if (!window.DEMO_DATA) throw new Error("Falta data/demo-data.js (listas de clase).");
      const d = {
        cursos: [{ id: 1, nombre: "2026-2027", activo: true }],
        clases: DEMO_DATA.map((c, i) => ({ id: c.id, curso_id: 1, nombre: c.nombre, tutor: c.tutor, orden: i + 1 })),
        alumnos: DEMO_DATA.flatMap((c) => c.alumnos.map((a, i) => ({ id: a.id, clase_id: c.id, nombre: a.nombre, orden: i + 1, activo: true }))),
      };
      this._dbSet(d); return d;
    },
    _dbSet(d) { try { localStorage.setItem("cb_demo_db", JSON.stringify(d)); } catch (e) { fallo(e); } },
    async sesion() { return { email: "profesorado.prueba@" + CFG.dominio, nombre: "Profesor/a de prueba", admin: true }; },
    async login() {},
    async logout() { location.reload(); },
    async datos() { return this._db(); },
    async crearCurso(nombre, clases) {
      const d = this._db();
      if (d.cursos.some((c) => c.nombre === nombre)) throw new Error(`Ya existe el curso ${nombre}`);
      d.cursos.forEach((c) => (c.activo = false));
      const cid = Math.max(0, ...d.cursos.map((c) => c.id)) + 1;
      d.cursos.push({ id: cid, nombre, activo: true });
      let clid = Math.max(0, ...d.clases.map((c) => c.id)), aid = Math.max(0, ...d.alumnos.map((a) => a.id));
      clases.forEach((c, i) => {
        d.clases.push({ id: ++clid, curso_id: cid, nombre: c.nombre, tutor: c.tutor, orden: i + 1 });
        c.alumnos.forEach((n, j) => d.alumnos.push({ id: ++aid, clase_id: clid, nombre: n, orden: j + 1, activo: true }));
      });
      this._dbSet(d);
    },
    async activarCurso(id) { const d = this._db(); d.cursos.forEach((c) => (c.activo = c.id === id)); this._dbSet(d); },
    async altaAlumno(claseId, nombre) {
      const d = this._db(), orden = Math.max(0, ...d.alumnos.filter((a) => a.clase_id === claseId).map((a) => a.orden)) + 1;
      d.alumnos.push({ id: Math.max(0, ...d.alumnos.map((a) => a.id)) + 1, clase_id: claseId, nombre, orden, activo: true }); this._dbSet(d);
    },
    async actualizarAlumno(id, cambios) { const d = this._db(); Object.assign(d.alumnos.find((a) => a.id === id), cambios); this._dbSet(d); },
    async editarClase(id, cambios) {
      const d = this._db(), c = d.clases.find((x) => x.id === id);
      if (cambios.nombre && d.clases.some((x) => x.id !== id && x.curso_id === c.curso_id && x.nombre === cambios.nombre)) throw new Error("Ya hay una clase con ese nombre en este curso");
      Object.assign(c, cambios); this._dbSet(d);
    },
    async admins() { const d = this._db(); return (d.admins ||= [S.user.email]).map((email) => ({ email })); },
    async addAdmin(email) { const d = this._db(); d.admins ||= [S.user.email]; if (!d.admins.includes(email)) d.admins.push(email); this._dbSet(d); },
    async delAdmin(email) { const d = this._db(); d.admins = (d.admins || []).filter((e) => e !== email); this._dbSet(d); },
    async registrar(al, urgencia) {
      const v = this._get();
      const r = { id: Date.now(), alumno_id: al.id, clase_id: al.clase_id, salida: new Date().toISOString(), vuelta: null, urgencia, profesor_email: S.user.email, profesor_nombre: S.user.nombre };
      v.push(r); this._set(v); return r;
    },
    async vuelta(id) { const v = this._get(); const r = v.find((x) => x.id === id); if (r) r.vuelta = new Date().toISOString(); this._set(v); },
    async borrar(id) { this._set(this._get().filter((x) => x.id !== id)); },
    async hoy() { const h = inicioDia(new Date()).toISOString(); return this._get().filter((x) => x.salida >= h); },
    async salidas({ desde, hasta, claseId, claseIds, alumnoId }) {
      return this._get()
        .filter((x) => x.salida >= desde && x.salida < hasta && (!claseId || x.clase_id == claseId) && (!claseIds || claseIds.includes(x.clase_id)) && (!alumnoId || x.alumno_id == alumnoId))
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
      // Solo devuelve fila si esta cuenta está en la tabla de administración (lo impone la base de datos)
      const adm = await sb.from("administradores").select("email").limit(1);
      return { email, nombre: u.user_metadata?.full_name || u.user_metadata?.name || email, admin: !adm.error && adm.data.length > 0 };
    },
    async login() {
      ok(await sb.auth.signInWithOAuth({ provider: "azure", options: { scopes: "email profile", redirectTo: location.origin + location.pathname } }));
    },
    async logout() { await sb.auth.signOut(); location.reload(); },
    async datos() {
      const [cu, cl] = await Promise.all([
        sb.from("cursos").select("id,nombre,activo").order("nombre"),
        sb.from("clases").select("id,curso_id,nombre,tutor,orden").order("orden").range(0, 4999),
      ]);
      const alumnos = [];
      for (let i = 0; ; i += 1000) {
        const d = ok(await sb.from("alumnos").select("id,clase_id,nombre,orden,activo").order("id").range(i, i + 999));
        alumnos.push(...d);
        if (d.length < 1000) break;
      }
      return { cursos: ok(cu), clases: ok(cl), alumnos };
    },
    async crearCurso(nombre, clases) { ok(await sb.rpc("crear_curso", { p_nombre: nombre, p_clases: clases })); },
    async activarCurso(id) { ok(await sb.rpc("activar_curso", { p_id: id })); },
    async altaAlumno(claseId, nombre) {
      const orden = Math.max(0, ...S.alumnos.filter((a) => a.clase_id === claseId).map((a) => a.orden)) + 1;
      ok(await sb.from("alumnos").insert({ clase_id: claseId, nombre, orden }));
    },
    async actualizarAlumno(id, cambios) { ok(await sb.from("alumnos").update(cambios).eq("id", id)); },
    async editarClase(id, cambios) {
      const r = await sb.from("clases").update(cambios).eq("id", id);
      if (r.error?.code === "23505") throw new Error("Ya hay una clase con ese nombre en este curso");
      ok(r);
    },
    async admins() { return ok(await sb.from("administradores").select("email").order("email")); },
    async addAdmin(email) {
      const r = await sb.from("administradores").insert({ email });
      if (r.error?.code === "23505") throw new Error("Esa cuenta ya tiene acceso");
      ok(r);
    },
    async delAdmin(email) { ok(await sb.from("administradores").delete().eq("email", email)); },
    async registrar(al, urgencia) {
      return ok(await sb.from("salidas").insert({ alumno_id: al.id, clase_id: al.clase_id, urgencia, profesor_nombre: S.user.nombre }).select().single());
    },
    async vuelta(id) { ok(await sb.from("salidas").update({ vuelta: new Date().toISOString() }).eq("id", id)); },
    async borrar(id) { ok(await sb.from("salidas").delete().eq("id", id)); },
    async hoy() {
      return ok(await sb.from("salidas").select("*").gte("salida", inicioDia(new Date()).toISOString()).order("salida").range(0, 4999));
    },
    async salidas({ desde, hasta, claseId, claseIds, alumnoId }) {
      const todo = [];
      for (let i = 0; ; i += 1000) {
        let q = sb.from("salidas").select("*").gte("salida", desde).lt("salida", hasta).order("salida", { ascending: false }).range(i, i + 999);
        if (claseId) q = q.eq("clase_id", claseId);
        else if (claseIds) q = q.in("clase_id", claseIds.length ? claseIds : [-1]);
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
    $("#btnAdminFranja").onclick = $("#btnLogin").onclick;
    try {
      S.user = await api.sesion();
    } catch (e) {
      $("#loginError").textContent = e.message;
    }
    if (!S.user) { document.body.classList.add("sin-sesion"); $("#vLogin").hidden = false; return; }

    $("#usuario").textContent = ` · ${S.user.nombre}`;
    $("#btnSalir").hidden = DEMO;
    $("#btnSalir").onclick = () => api.logout();
    pintarInstalar();
    $("#tabs").hidden = false;

    try { aplicarDatos(await api.datos()); } catch (e) { fallo(e); return; }

    $("#tabAdmin").hidden = !S.user.admin;
    // Botón «Administración» de la franja: solo para cuentas autorizadas
    $("#btnAdminFranja").hidden = !S.user.admin;
    $("#btnAdminFranja").onclick = () => mostrar("admin");
    $$("#tabs > button[data-vista]").forEach((b) => (b.onclick = () => mostrar(b.dataset.vista)));
    // Menú desplegable «Administración» (como en la Biblioteca)
    const menu = $("#tabAdmin");
    $("[data-menu]", menu).onclick = () => menu.classList.toggle("abierto");
    $$("[data-admin]", menu).forEach((b) => (b.onclick = () => { menu.classList.remove("abierto"); mostrar("admin", b.dataset.admin); }));
    document.addEventListener("click", (e) => { if (!e.target.closest("#tabAdmin")) menu.classList.remove("abierto"); });
    prepararRegistro();
    prepararInformes();
    if (S.user.admin) prepararAdmin();
    mostrar("registrar");

    $("#btnEjemplo").onclick = generarEjemplo;
    $("#btnVaciar").onclick = () => { if (confirm("¿Borrar todas las salidas de prueba?")) { demoApi._set([]); refrescarFuera(); toast("Datos de prueba borrados"); } };
  }

  function aplicarDatos(d) {
    S.cursos = d.cursos;
    S.clases = [...d.clases].sort((a, b) => a.orden - b.orden);
    S.alumnos = [...d.alumnos].sort((a, b) => a.clase_id - b.clase_id || a.orden - b.orden);
    S.clase = new Map(S.clases.map((c) => [c.id, c]));
    S.alumno = new Map(S.alumnos.map((a) => [a.id, a]));
    S.curso = S.cursos.find((c) => c.activo) || S.cursos[S.cursos.length - 1] || null;
    S.clasesActivas = S.curso ? clasesDe(S.curso.id) : S.clases;
    const ids = new Set(S.clasesActivas.map((c) => c.id));
    S.alumnosActivos = S.alumnos.filter((a) => a.activo !== false && ids.has(a.clase_id));
  }

  // Tras crear un curso o cambiar alumnado: recargar y repintar todo
  async function recargarDatos() {
    aplicarDatos(await api.datos());
    rellenarRegistro(); rellenarFiltrosCurso();
    if (S.user.admin) pintarAdmin();
  }

  function mostrar(vista, apartado) {
    $$("#tabs > button[data-vista]").forEach((b) => b.classList.toggle("activa", b.dataset.vista === vista));
    $("#tabAdmin [data-menu]").classList.toggle("activa", vista === "admin");
    if (vista === "admin") {
      S.admSec = apartado || S.admSec || "cursos";
      $$("#vAdmin [data-sec]").forEach((el) => (el.hidden = el.dataset.sec !== S.admSec));
      $$("#tabAdmin [data-admin]").forEach((b) => b.classList.toggle("activo", b.dataset.admin === S.admSec));
    }
    $("#vRegistrar").hidden = vista !== "registrar";
    $("#vInformes").hidden = vista !== "informes";
    $("#vAdmin").hidden = vista !== "admin";
    if (vista === "informes") cargarInforme();
    else if (vista === "admin") pintarAdmin();
    else refrescarFuera();
  }

  // ─── Registrar ───────────────────────────────────────────────────────────
  // Primero se elige la clase (botones por etapa); después aparece su alumnado.
  const ETAPAS = [["ESO", (c) => /\bESO\b/i.test(c.nombre)], ["Bachillerato", (c) => /bach/i.test(c.nombre)]];

  function rellenarRegistro() {
    if (!S.clasesActivas.some((c) => c.id === S.claseId)) S.claseId = null;
    pintarRegistro();
  }

  function abrirClase(id) {
    S.claseId = id; $("#buscar").value = "";
    history.pushState({ clase: id }, "");
    pintarRegistro(); window.scrollTo(0, 0);
  }
  function volverAClases() {
    if (history.state?.clase) history.back();
    else { S.claseId = null; pintarRegistro(); }
  }

  function prepararRegistro() {
    $("#buscar").oninput = pintarRegistro;
    $("#elegirClase").onclick = (e) => { const b = e.target.closest("[data-clase]"); if (b) abrirClase(+b.dataset.clase); };
    $("#btnVolver").onclick = volverAClases;
    // Botón «atrás» del móvil: vuelve a la lista de clases en vez de salir de la app
    window.addEventListener("popstate", (e) => { S.claseId = e.state?.clase ?? null; pintarRegistro(); });

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

    rellenarRegistro();
    pintarTramo();
    setInterval(() => { pintarTramo(); pintarFuera(); }, 15000);
    setInterval(() => { if (!$("#vRegistrar").hidden) refrescarFuera(); }, 30000);
  }

  function pintarRegistro() {
    const buscando = !!$("#buscar").value.trim(), enClase = !buscando && S.claseId != null;
    $("#elegirClase").hidden = buscando || enClase;
    $("#claseCab").hidden = !enClase;
    if (enClase) {
      const c = S.clase.get(S.claseId);
      $("#claseTitulo").innerHTML = `${esc(c?.nombre)}${c?.tutor ? `<small>Tutor/a: ${esc(nombreLargo(c.tutor))}</small>` : ""}`;
      $("#claseCab").after($("#fuera"));
    } else {
      $("#elegirClase").before($("#fuera"));
    }
    pintarSelector(); pintarFuera(); pintarRejilla();
  }

  function pintarSelector() {
    if ($("#elegirClase").hidden) return;
    const fueraPor = new Map(), hoyPor = new Map();
    S.fuera.forEach((r) => fueraPor.set(r.clase_id, (fueraPor.get(r.clase_id) || 0) + 1));
    S.hoy.forEach((r) => hoyPor.set(r.clase_id, (hoyPor.get(r.clase_id) || 0) + 1));
    const grupos = ETAPAS.map(([t, f]) => [t, S.clasesActivas.filter(f)]);
    const resto = S.clasesActivas.filter((c) => !ETAPAS.some(([, f]) => f(c)));
    if (resto.length) grupos.push(["Otros grupos", resto]);
    $("#elegirClase").innerHTML = grupos.filter(([, cl]) => cl.length).map(([t, cl]) => `
      <h2 class="etapa">${esc(t)}</h2>
      <div class="clases-grid">${cl.map((c) => `
        <button class="clase-btn" data-clase="${c.id}" type="button">
          <span class="cn">${esc(c.nombre)}</span>
          ${c.tutor ? `<span class="ct">${esc(nombreLargo(c.tutor))}</span>` : ""}
          ${fueraPor.get(c.id) ? `<span class="cb fuera-b">${fueraPor.get(c.id)} fuera</span>`
            : hoyPor.get(c.id) ? `<span class="cb">${hoyPor.get(c.id)} hoy</span>` : ""}
        </button>`).join("")}</div>`).join("") || `<div class="vacio">No hay clases en el curso actual.</div>`;
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
    if (!q && S.claseId == null) { $("#rejilla").innerHTML = ""; return; }
    const lista = q ? S.alumnosActivos.filter((a) => norm(a.nombre).includes(q)) : S.alumnosActivos.filter((a) => a.clase_id === S.claseId);
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
    pintarRegistro();
  }

  function pintarFuera() {
    const ahora = Date.now();
    const enClase = S.claseId != null && !$("#buscar").value.trim();
    const propias = S.fuera.filter((r) => !enClase || r.clase_id === S.claseId).sort((a, b) => a.salida.localeCompare(b.salida));
    const otras = S.fuera.length - propias.length;
    $("#fuera").innerHTML = propias.length || otras ? `
      <h3>Fuera ahora${otras ? ` <small style="text-transform:none;font-weight:400">· ${otras} de otras clases</small>` : ""}</h3>
      <div class="fuera-lista">${propias.map((r) => {
        const min = Math.floor((ahora - new Date(r.salida)) / 60000);
        return `<div class="chip${min >= CFG.avisoMin ? " tarde" : ""}">
          <div><strong>${esc(nombreLargo(S.alumno.get(r.alumno_id)?.nombre || "?"))}</strong>${enClase ? "" : ` <span class="chip-clase">${esc(S.clase.get(r.clase_id)?.nombre)}</span>`}<br>
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
      S.hoy.push(nueva); S.fuera.push(nueva); pintarRegistro();
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
    const ahora = new Date(), cl = S.clase.get(al.clase_id), rc = rangoCurso(S.cursos.find((c) => c.id === cl?.curso_id));
    let regs = [];
    try {
      regs = await api.salidas({ desde: rc.desde.toISOString(), hasta: rc.hasta.toISOString(), alumnoId: al.id });
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
      f.curso.value = cl.curso_id; rellenarClasesFiltro();
      f.alcance.value = "alumno"; f.clase.value = al.clase_id; rellenarAlumnosFiltro(); f.alumno.value = al.id;
      f.periodo.value = "curso"; actualizarFiltros(); await cargarInforme();
      opcionesPdf();
    }
  }

  // ─── Informes ─────────────────────────────────────────────────────────────
  function prepararInformes() {
    const f = $("#filtros");
    rellenarFiltrosCurso();
    f.franja.innerHTML = `<option value="todas">Todas</option>` +
      CLASES_HORARIO.map((t, i) => `<option value="tramo${i}">${esc(t.nombre)} (${t.inicio}–${t.fin})</option>`).join("") +
      `<option value="restringidas">Solo primeros/últimos ${CFG.margenMin} min</option><option value="horas">Entre horas…</option>`;
    f.desde.value = f.hasta.value = isoDia(new Date());
    f.addEventListener("change", (e) => {
      if (e.target.name === "curso") rellenarClasesFiltro();
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

  function rellenarFiltrosCurso() {
    const f = $("#filtros");
    f.curso.innerHTML = [...S.cursos].reverse()
      .map((c) => `<option value="${c.id}">${esc(c.nombre)}${c.activo ? " (actual)" : ""}</option>`).join("");
    if (S.curso) f.curso.value = S.curso.id;
    $("[data-curso]", f).hidden = S.cursos.length < 2;
    rellenarClasesFiltro();
  }

  function rellenarClasesFiltro() {
    const f = $("#filtros");
    f.clase.innerHTML = clasesDe(f.curso.value).map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
    rellenarAlumnosFiltro();
  }

  function rellenarAlumnosFiltro() {
    const f = $("#filtros");
    f.alumno.innerHTML = S.alumnos.filter((a) => a.clase_id == f.clase.value)
      .map((a) => `<option value="${a.id}">${esc(a.nombre)}${a.activo === false ? " (baja)" : ""}</option>`).join("");
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
    const cursoSel = S.cursos.find((c) => c.id == f.curso.value);
    let desde, hasta, periodoTxt;
    switch (f.periodo.value) {
      case "hoy": desde = hoy; hasta = masDias(hoy, 1); periodoTxt = "Hoy, " + fecha(hoy); break;
      case "semana": desde = lunes(hoy); hasta = masDias(desde, 7); periodoTxt = `Semana del ${fecha(desde)} al ${fecha(masDias(desde, 6))}`; break;
      case "mes": desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1); hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);
        periodoTxt = desde.toLocaleDateString("es-ES", { month: "long", year: "numeric" }); periodoTxt = periodoTxt[0].toUpperCase() + periodoTxt.slice(1); break;
      case "curso": { const rc = rangoCurso(cursoSel); desde = rc.desde; hasta = rc.hasta; periodoTxt = `Curso ${cursoSel?.nombre || desde.getFullYear() + "-" + (desde.getFullYear() + 1)}`; break; }
      case "dia": desde = deIso(f.desde.value || isoDia(hoy)); hasta = masDias(desde, 1); periodoTxt = fecha(desde); break;
      default: {
        desde = deIso(f.desde.value || isoDia(hoy)); const h = deIso(f.hasta.value || isoDia(hoy));
        hasta = masDias(h, 1); periodoTxt = `Del ${fecha(desde)} al ${fecha(h)}`;
      }
    }
    const alcance = f.alcance.value;
    const claseId = alcance !== "centro" ? +f.clase.value : null;
    const alumnoId = alcance === "alumno" ? +f.alumno.value : null;
    const claseIds = clasesDe(f.curso.value).map((c) => c.id);
    const deOtroCurso = cursoSel && !cursoSel.activo && f.periodo.value !== "curso" ? ` · curso ${cursoSel.nombre}` : "";
    const alcanceTxt = (alumnoId ? `${nombreLargo(S.alumno.get(alumnoId)?.nombre || "")} (${S.clase.get(claseId)?.nombre})`
      : claseId ? S.clase.get(claseId)?.nombre : "Todo el centro") + deOtroCurso;

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
    return { desde, hasta, claseId, claseIds, alumnoId, enFranja, franja: fr, soloUrg, alcance, txt: { periodo: periodoTxt, alcance: alcanceTxt, franja: franjaTxt + (soloUrg ? " · solo urgencias" : "") } };
  }

  let cargaN = 0;
  async function cargarInforme() {
    const n = ++cargaN, F = leerFiltros();
    $("#resultado").innerHTML = `<div class="vacio">Cargando…</div>`;
    let regs;
    try {
      regs = await api.salidas({ desde: F.desde.toISOString(), hasta: F.hasta.toISOString(), claseId: F.claseId, claseIds: F.claseIds, alumnoId: F.alumnoId });
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

  // El logo se pasa a PNG una vez para poder incrustarlo en el PDF
  let logoPng = null;
  async function cargarLogo() {
    if (logoPng !== null) return logoPng;
    try {
      const img = new Image(); img.src = "logo.svg";
      await img.decode();
      const c = document.createElement("canvas"); c.width = 1340; c.height = 430;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      logoPng = c.toDataURL("image/png");
    } catch { logoPng = ""; }
    return logoPng;
  }

  async function generarPdf(tipo) {
    if (!window.jspdf) return toast("No se pudo cargar el generador de PDF (¿sin conexión?)");
    const { F, regs, res } = S.ultimo;
    const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
    const W = doc.internal.pageSize.getWidth(), AZUL = [0, 154, 187];
    const est = { styles: { fontSize: 8.5, cellPadding: 1.6 }, headStyles: { fillColor: AZUL }, margin: { left: 14, right: 14 }, alternateRowStyles: { fillColor: [244, 246, 249] } };
    const titulo = (t, y) => { doc.setFontSize(11.5); doc.setFont(undefined, "bold"); doc.text(t, 14, y); doc.setFont(undefined, "normal"); return y + 2.5; };
    const sitio = (y, h = 30) => (y + h > 280 ? (doc.addPage(), 18) : y);

    const logo = await cargarLogo();
    if (logo) doc.addImage(logo, "PNG", W - 14 - 45, 10, 45, 14.4);
    doc.setTextColor(...AZUL); doc.setFontSize(16); doc.setFont(undefined, "bold"); doc.text("Control de baños - Informe", 14, 18);
    doc.setTextColor(30, 41, 59); doc.setFont(undefined, "normal"); doc.setFontSize(10);
    doc.text([`Alcance: ${F.txt.alcance}`, `Periodo: ${F.txt.periodo}`, `Horas: ${F.txt.franja}`], 14, 26);
    doc.setDrawColor(...AZUL); doc.setLineWidth(0.6); doc.line(14, 38, W - 14, 38);
    let y = 44;

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
    const frecuentes = Array.from({ length: 25 }, () => S.alumnosActivos[rnd(S.alumnosActivos.length)]);
    const profes = ["Ana Felipe", "Mario Espejo", "Elena Martínez", "Isabel Cortés", "Laura García"];
    for (let i = 0; i < 220; i++) {
      const dia = masDias(hoy, -rnd(30)); if (dia.getDay() === 0 || dia.getDay() === 6) continue;
      const t = CLASES_HORARIO[rnd(CLASES_HORARIO.length)], ini = toMin(t.inicio) + rnd(toMin(t.fin) - toMin(t.inicio));
      const s = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), Math.floor(ini / 60), ini % 60);
      if (s > new Date()) continue;
      const al = Math.random() < 0.5 ? frecuentes[rnd(frecuentes.length)] : S.alumnosActivos[rnd(S.alumnosActivos.length)];
      const m = ini - toMin(t.inicio), urg = m < CFG.margenMin || toMin(t.fin) - ini <= CFG.margenMin;
      v.push({ id: Date.now() + i, alumno_id: al.id, clase_id: al.clase_id, salida: s.toISOString(),
        vuelta: Math.random() < 0.85 ? new Date(s.getTime() + (3 + rnd(12)) * 60000).toISOString() : null,
        urgencia: urg, profesor_email: "demo@" + CFG.dominio, profesor_nombre: profes[rnd(profes.length)] });
    }
    demoApi._set(v.map((r) => (r.vuelta === null && r.salida < hoy.toISOString() ? { ...r, vuelta: r.salida } : r)));
    toast("Salidas de ejemplo generadas");
    $("#vInformes").hidden ? refrescarFuera() : cargarInforme();
  }

  // ─── Administración: cursos y alumnado ──────────────────────────────────
  // Lector de PDF (solo se descarga cuando alguien de administración lo usa)
  let pdfjsPromesa = null;
  function cargarPdfJs() {
    return (pdfjsPromesa ||= new Promise((res, rej) => {
      const base = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
      const sc = Object.assign(document.createElement("script"), { src: base + "pdf.min.js" });
      sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js"; res(window.pdfjsLib); };
      sc.onerror = () => { pdfjsPromesa = null; rej(new Error("No se pudo cargar el lector de PDF (¿sin conexión?)")); };
      document.head.appendChild(sc);
    }));
  }

  // Nombres de Séneca → nombres más claros (se pueden corregir en la vista previa)
  const NOMBRES_SENECA = { "1ºABachSoc": "1º Bach A", "1ºBBachCi": "1º Bach B", "2º Bach HS": "2º Bach A", "2º BACH CyT": "2º Bach B" };
  const limpiarClase = (s) => NOMBRES_SENECA[s] ||
    s.replace(/º\s*/, "º ").replace(/\bESO\s*([A-Z])$/i, "ESO $1").replace(/\bBACH\b/i, "Bach").replace(/\s+/g, " ").trim();

  // Lee los PDF «Lista de clase» de Séneca: una clase por página
  async function leerListasSeneca(file) {
    const lib = await cargarPdfJs();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const clases = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      const filas = [];
      for (const it of tc.items) {
        if (!it.str.trim() || it.transform[1] || it.transform[2]) continue;   // vacío o texto girado del margen
        const y = it.transform[5];
        let f = filas.find((f) => Math.abs(f.y - y) <= 2);
        if (!f) filas.push((f = { y, items: [] }));
        f.items.push({ x: it.transform[4], s: it.str });
      }
      const lineas = filas.sort((a, b) => b.y - a.y)
        .map((f) => f.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(" ").replace(/\s+/g, " ").trim());
      const texto = lineas.join("\n");
      const m = texto.match(/LISTA DE CLASE DE\s+(.+?)\s*\(/);
      if (!m) continue;
      const tutor = (texto.match(/TUTOR\/A\s*:\s*(.+)/) || [])[1]?.trim() || "";
      const alumnos = [];
      let dentro = false;
      for (const l of lineas) {
        if (/N[º°o]\s*orden/i.test(l)) { dentro = true; continue; }
        if (!dentro) continue;
        if (/^\S+,\s*\d{2}\/\d{2}\/\d{4}$|^P[áa]g\./.test(l)) break;   // "Sevilla, 13/09/2026" o "Pág. 1 de 4"
        const mm = l.match(/^(\d{1,2})\s*(.+,.+)$/) || l.match(/^(.+,.+?)\s*(\d{1,2})$/);
        if (mm) alumnos.push((/^\d/.test(mm[1]) ? mm[2] : mm[1]).trim());
      }
      const previa = clases.find((c) => c.original === m[1].trim());   // clase que sigue en otra página
      if (previa) previa.alumnos.push(...alumnos);
      else clases.push({ original: m[1].trim(), nombre: limpiarClase(m[1].trim()), tutor, alumnos });
    }
    return clases;
  }

  const A = { importadas: null };   // estado de la importación en curso

  function prepararAdmin() {
    // ── Cursos académicos
    const zona = $("#admSoltar"), input = $("#admPdf");
    const procesar = async (files) => {
      const pdfs = [...files].filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
      if (!pdfs.length) return toast("Elige los PDF de «Lista de clase» de Séneca");
      $("#admVista").innerHTML = `<div class="vacio">Leyendo ${pdfs.length} PDF…</div>`;
      try {
        A.importadas = [];
        for (const f of pdfs) A.importadas.push(...(await leerListasSeneca(f)));
        pintarVistaPrevia();
      } catch (e) { $("#admVista").innerHTML = ""; fallo(e); }
    };
    input.onchange = () => { procesar(input.files); input.value = ""; };
    zona.ondragover = (e) => { e.preventDefault(); zona.classList.add("encima"); };
    zona.ondragleave = () => zona.classList.remove("encima");
    zona.ondrop = (e) => { e.preventDefault(); zona.classList.remove("encima"); procesar(e.dataTransfer.files); };
    $("#btnNuevoCurso").onclick = () => { $("#admNuevo").hidden = false; $("#btnNuevoCurso").hidden = true; $("#admNuevo").scrollIntoView({ behavior: "smooth" }); };
    $("#btnCerrarNuevo").onclick = cerrarNuevoCurso;

    $("#admVista").addEventListener("input", (e) => {
      const i = e.target.dataset.nombreClase;
      if (i != null) { A.importadas[+i].nombre = e.target.value; avisosVistaPrevia(); }
    });
    $("#admVista").addEventListener("click", async (e) => {
      const quitar = e.target.closest("[data-quitar-clase]");
      if (quitar) { A.importadas.splice(+quitar.dataset.quitarClase, 1); pintarVistaPrevia(); return; }
      if (e.target.closest("#admCancelar")) { A.importadas = null; $("#admVista").innerHTML = ""; return; }
      if (e.target.closest("#admCrear")) crearCursoNuevo();
    });

    $("#admCursos").onclick = async (e) => {
      const ver = e.target.closest("[data-ver-curso]");
      if (ver) { $("#admCursoSel").value = ver.dataset.verCurso; rellenarClasesAdmin(); mostrar("admin", "alumnado"); return; }
      const b = e.target.closest("[data-activar]"); if (!b) return;
      const c = S.cursos.find((x) => x.id == b.dataset.activar);
      if (!confirm(`¿Volver a poner ${c.nombre} como curso actual?\n\nEn Registrar aparecerá el alumnado de ${c.nombre}.`)) return;
      try { await api.activarCurso(c.id); await recargarDatos(); toast(`Curso actual: ${c.nombre}`); } catch (err) { fallo(err); }
    };

    // ── Alumnado
    $("#admCursoSel").onchange = rellenarClasesAdmin;
    $("#admClase").onchange = pintarAlumnadoAdmin;
    $("#admClaseForm").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, id = +$("#admClase").value;
      const nombre = f.nombre.value.trim(), tutor = f.tutor.value.trim().replace(/\s*,\s*/, ", ");
      if (!nombre) return toast("La clase necesita un nombre");
      try { await api.editarClase(id, { nombre, tutor }); await recargarDatos(); toast("Clase actualizada"); } catch (err) { fallo(err); }
    };
    $("#admAlumnos").onclick = async (e) => {
      const mod = e.target.closest("[data-modificar]");
      if (mod) return modificarAlumno(S.alumno.get(+mod.dataset.modificar));
      const b = e.target.closest("[data-baja]"); if (!b) return;
      const al = S.alumno.get(+b.dataset.baja), activo = al.activo === false;
      if (!activo && !confirm(`¿Dar de baja a ${nombreLargo(al.nombre)}?\n\nDejará de aparecer en Registrar. Sus salidas se conservan en los informes.`)) return;
      try { await api.actualizarAlumno(al.id, { activo }); await recargarDatos(); toast(activo ? "Alumno/a reactivado/a" : "Baja registrada"); } catch (err) { fallo(err); }
    };
    $("#admAlta").onsubmit = async (e) => {
      e.preventDefault();
      const nombre = normalizarNombre(e.target.nombre.value);
      if (!nombre) return toast("Escríbelo como «Apellidos, Nombre»");
      const claseId = +$("#admClase").value;
      try { await api.altaAlumno(claseId, nombre); e.target.reset(); await recargarDatos(); toast(`Añadido/a a ${S.clase.get(claseId).nombre}`); } catch (err) { fallo(err); }
    };

    // ── Cuentas de administración
    $("#admCuentas").onclick = async (e) => {
      const q = e.target.closest("[data-quitar-admin]");
      if (q) {
        if (!confirm(`¿Quitar el acceso de administración a ${q.dataset.quitarAdmin}?`)) return;
        try { await api.delAdmin(q.dataset.quitarAdmin); pintarCuentas(); toast("Acceso retirado"); } catch (err) { fallo(err); }
        return;
      }
      const m = e.target.closest("[data-modificar-admin]"); if (!m) return;
      const viejo = m.dataset.modificarAdmin;
      const r = await dialogo(`<h2>Modificar cuenta</h2>
        <label class="campo">Correo <input name="email" type="email" value="${esc(viejo)}" autocomplete="off" required></label>
        <div class="dlg-botones"><button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primario" value="ok">Guardar</button></div>`);
      const nuevo = (S.dlgDatos?.email || "").trim().toLowerCase();
      if (r !== "ok" || !nuevo || nuevo === viejo) return;
      if (!esCuentaColegio(nuevo)) return toast(`Tiene que ser una cuenta @${CFG.dominio}`);
      try { await api.addAdmin(nuevo); await api.delAdmin(viejo); pintarCuentas(); toast("Cuenta modificada"); } catch (err) { fallo(err); pintarCuentas(); }
    };
    $("#admCuentaForm").onsubmit = async (e) => {
      e.preventDefault();
      const email = e.target.email.value.trim().toLowerCase();
      if (!esCuentaColegio(email)) return toast(`Tiene que ser una cuenta @${CFG.dominio}`);
      try { await api.addAdmin(email); e.target.reset(); pintarCuentas(); toast("Cuenta añadida"); } catch (err) { fallo(err); }
    };
    pintarAdmin();
  }

  const esCuentaColegio = (email) => new RegExp(`^[^@\\s]+@${CFG.dominio.replace(".", "\\.")}$`).test(email);
  // "garcía lópez ,ana" → "García López, Ana"; null si no tiene la forma «Apellidos, Nombre»
  function normalizarNombre(txt) {
    const n = txt.trim().replace(/\s+/g, " ").replace(/\s*,\s*/, ", ");
    return /^[^,]+, [^,]+$/.test(n) ? n : null;
  }

  function cerrarNuevoCurso() {
    A.importadas = null; $("#admVista").innerHTML = "";
    $("#admNuevo").hidden = true; $("#btnNuevoCurso").hidden = false;
  }

  function pintarAdmin() {
    const nAl = (cid) => { const ids = new Set(clasesDe(cid).map((c) => c.id)); return S.alumnos.filter((a) => ids.has(a.clase_id) && a.activo !== false).length; };
    $("#admCursos").innerHTML = `<table><thead><tr><th>Curso</th><th class="num">Clases</th><th class="num">Alumnado</th><th>Estado</th><th></th></tr></thead><tbody>
      ${[...S.cursos].reverse().map((c) => `<tr><td><strong>${esc(c.nombre)}</strong></td><td class="num">${clasesDe(c.id).length}</td><td class="num">${nAl(c.id)}</td>
        <td>${c.activo ? `<span class="tag-actual">Actual</span>` : `<span class="tag-archivado">Archivado</span>`}</td>
        <td class="acciones-fila"><button class="btn mini" data-ver-curso="${c.id}">Ver alumnado</button>${c.activo ? "" : ` <button class="btn mini" data-activar="${c.id}">Volver a activar</button>`}</td></tr>`).join("")}
      </tbody></table>`;
    const y = parseInt(S.curso?.nombre, 10) || new Date().getFullYear() - 1;
    if (!$("#admNombre").value || S.cursos.some((c) => c.nombre === $("#admNombre").value)) $("#admNombre").value = `${y + 1}-${y + 2}`;

    const sc = $("#admCursoSel"), previo = sc.value;
    sc.innerHTML = [...S.cursos].reverse().map((c) => `<option value="${c.id}">${esc(c.nombre)}${c.activo ? " (actual)" : ""}</option>`).join("");
    sc.value = S.cursos.some((c) => c.id == previo) ? previo : S.curso?.id;
    rellenarClasesAdmin(true);
    pintarCuentas();
  }

  // Lista de clases del curso elegido; el alumnado solo aparece al elegir una
  function rellenarClasesAdmin(conservar) {
    const sel = $("#admClase"), previa = sel.value, clases = clasesDe($("#admCursoSel").value);
    sel.innerHTML = `<option value="">Elige una clase…</option>` + clases.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
    if (conservar === true && clases.some((c) => c.id == previa)) sel.value = previa;
    pintarAlumnadoAdmin();
  }

  async function pintarCuentas() {
    let lista = [];
    try { lista = await api.admins(); } catch (e) { $("#admCuentas").innerHTML = ""; return fallo(e); }
    $("#admCuentas").innerHTML = `<table><tbody>${lista.map(({ email }) => `<tr><td>${esc(email)}</td>
      <td class="acciones-fila">${email.toLowerCase() === S.user.email ? `<span class="tag-actual">Tú</span>`
        : `<button class="btn mini" data-modificar-admin="${esc(email)}">Modificar</button> <button class="btn mini peligro" data-quitar-admin="${esc(email)}">Quitar</button>`}</td></tr>`).join("")}</tbody></table>`;
  }

  function pintarAlumnadoAdmin() {
    const claseId = +$("#admClase").value, cl = S.clase.get(claseId);
    $("#admClaseDetalle").hidden = !cl;
    if (!cl) return;
    const fc = $("#admClaseForm");
    fc.nombre.value = cl.nombre || ""; fc.tutor.value = cl.tutor || "";
    const lista = S.alumnos.filter((a) => a.clase_id === claseId);
    const bajas = lista.filter((a) => a.activo === false).length;
    $("#admAlumnos").innerHTML = lista.length ? `
      <p class="ayuda">${lista.length - bajas} alumnos${bajas ? ` · ${bajas} de baja` : ""}</p>
      <table><tbody>
      ${lista.map((a, i) => `<tr class="${a.activo === false ? "de-baja" : ""}"><td class="num n-orden">${i + 1}</td><td>${esc(a.nombre)}${a.activo === false ? ' <span class="tag">baja</span>' : ""}</td>
        <td class="acciones-fila">${a.activo === false ? "" : `<button class="btn mini" data-modificar="${a.id}">Modificar</button> `}<button class="btn mini${a.activo === false ? "" : " peligro"}" data-baja="${a.id}">${a.activo === false ? "Reactivar" : "Dar de baja"}</button></td></tr>`).join("")}
      </tbody></table>` : `<div class="vacio">Esta clase no tiene alumnado.</div>`;
  }

  async function modificarAlumno(al) {
    const cl = S.clase.get(al.clase_id), mismas = clasesDe(cl.curso_id);
    const r = await dialogo(`<h2>Modificar alumno/a</h2>
      <p class="dlg-sub">${esc(nombreLargo(al.nombre))} · ${esc(cl.nombre)}</p>
      <div class="opciones">
        <label class="campo">Apellidos, Nombre <input name="nombre" value="${esc(al.nombre)}" autocomplete="off" required></label>
        <label class="campo">Clase <select name="clase">${mismas.map((c) => `<option value="${c.id}"${c.id === cl.id ? " selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select></label>
      </div>
      <p class="ayuda">Si cambia de clase, sus salidas anteriores siguen contando en la clase de antes.</p>
      <div class="dlg-botones"><button class="btn" value="" formnovalidate>Cancelar</button><button class="btn primario" value="ok">Guardar</button></div>`);
    if (r !== "ok") return;
    const nombre = normalizarNombre(S.dlgDatos?.nombre || ""), clase_id = +S.dlgDatos?.clase;
    if (!nombre) return toast("Escríbelo como «Apellidos, Nombre»");
    const cambios = {};
    if (nombre !== al.nombre) cambios.nombre = nombre;
    if (clase_id && clase_id !== al.clase_id) Object.assign(cambios, { clase_id, orden: 999 });
    if (!Object.keys(cambios).length) return;
    try {
      await api.actualizarAlumno(al.id, cambios); await recargarDatos();
      toast(cambios.clase_id ? `Cambiado/a a ${S.clase.get(clase_id).nombre}` : "Datos actualizados");
    } catch (err) { fallo(err); }
  }

  function pintarVistaPrevia() {
    const cl = A.importadas;
    if (!cl.length) {
      $("#admVista").innerHTML = `<div class="alerta">No he encontrado ninguna lista de clase en esos PDF. Tienen que ser los de Séneca «Lista de clase» (un grupo por página).</div>`;
      return;
    }
    const total = cl.reduce((n, c) => n + c.alumnos.length, 0);
    $("#admVista").innerHTML = `
      <div class="resumen-import"><strong>${cl.length} clases · ${total} alumnos</strong> encontrados. Revisa los nombres de las clases (puedes corregirlos) y pulsa «Crear curso».</div>
      <div class="import-lista">${cl.map((c, i) => `
        <div class="import-clase">
          <input value="${esc(c.nombre)}" data-nombre-clase="${i}" aria-label="Nombre de la clase">
          <span class="import-n">${c.alumnos.length} alumnos</span>
          <button class="btn mini peligro" data-quitar-clase="${i}" title="Quitar esta clase">✕</button>
          <details><summary>Tutor/a: ${esc(c.tutor || "—")} · ver alumnado</summary><ol>${c.alumnos.map((a) => `<li>${esc(a)}</li>`).join("")}</ol></details>
        </div>`).join("")}</div>
      <div id="admAvisos"></div>
      <div class="acciones"><button class="btn primario" id="admCrear">Crear curso</button><button class="btn" id="admCancelar">Cancelar</button></div>`;
    avisosVistaPrevia();
  }

  function avisosVistaPrevia() {
    const cl = A.importadas, avisos = [];
    const nombres = cl.map((c) => c.nombre.trim());
    const rep = nombres.filter((n, i) => n && nombres.indexOf(n) !== i);
    if (rep.length) avisos.push(`Hay clases con el mismo nombre: ${[...new Set(rep)].join(", ")}.`);
    if (nombres.some((n) => !n)) avisos.push("Hay alguna clase sin nombre.");
    const vacias = cl.filter((c) => !c.alumnos.length).map((c) => c.nombre);
    if (vacias.length) avisos.push(`No se ha leído alumnado en: ${vacias.join(", ")}.`);
    $("#admAvisos").innerHTML = avisos.map((a) => `<div class="alerta">${esc(a)}</div>`).join("");
    $("#admCrear").disabled = rep.length > 0 || nombres.some((n) => !n);
    $("#admCrear").textContent = `Crear curso ${$("#admNombre").value.trim()}`;
  }

  async function crearCursoNuevo() {
    const nombre = $("#admNombre").value.trim();
    if (!/^\d{4}-\d{4}$/.test(nombre)) return toast("El nombre del curso debe ser como 2027-2028");
    if (S.cursos.some((c) => c.nombre === nombre)) return toast(`Ya existe el curso ${nombre}`);
    const cl = A.importadas.map((c) => ({ nombre: c.nombre.trim(), tutor: c.tutor, alumnos: c.alumnos }));
    const total = cl.reduce((n, c) => n + c.alumnos.length, 0);
    const r = await dialogo(`
      <h2>Crear curso ${esc(nombre)}</h2>
      <p class="dlg-sub">${cl.length} clases · ${total} alumnos</p>
      ${S.curso ? `<p>El curso <strong>${esc(S.curso.nombre)}</strong> quedará <strong>archivado</strong>: sus salidas se conservan y se pueden consultar en Informes eligiendo el curso.</p>` : ""}
      <p>Desde ese momento, en Registrar solo aparecerá el alumnado de ${esc(nombre)}.</p>
      <div class="dlg-botones"><button class="btn" value="">Cancelar</button><button class="btn primario" value="crear">Crear curso</button></div>`);
    if (r !== "crear") return;
    try {
      await api.crearCurso(nombre, cl);
      cerrarNuevoCurso();
      await recargarDatos();
      toast(`Curso ${nombre} creado`);
    } catch (e) { fallo(e); }
  }

  // ─── App instalable ──────────────────────────────────────────────────────
  let instalar = null;
  const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const enApp = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  // El botón de la franja se ve siempre (salvo dentro de la app ya instalada); si el navegador no ofrece instalarla, explica cómo.
  function pintarInstalar() { $$(".instalar").forEach((el) => (el.hidden = el.matches(".franja .instalar") ? enApp() : !instalar)); }
  async function instalarApp() {
    if (instalar === "ios") {
      dialogo(`<h2>Instalar la app</h2>
        <ol class="pasos"><li>Pulsa el botón <b>Compartir</b> de Safari (el cuadrado con una flecha hacia arriba).</li>
        <li>Elige <b>«Añadir a pantalla de inicio»</b>.</li><li>Pulsa <b>Añadir</b>. Aparecerá el icono del colegio en tu pantalla.</li></ol>
        <div class="dlg-botones"><button class="btn primario" value="">Entendido</button></div>`);
      return;
    }
    if (instalar) { instalar.prompt(); await instalar.userChoice.catch(() => {}); instalar = null; pintarInstalar(); return; }
    dialogo(`<h2>Instalar la app</h2>
      <p>Abre el menú del navegador (⋮ o ⋯) y elige <b>«Instalar aplicación»</b> o <b>«Añadir a pantalla de inicio»</b>.</p>
      <div class="dlg-botones"><button class="btn primario" value="">Entendido</button></div>`);
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); instalar = e; pintarInstalar(); });
  window.addEventListener("appinstalled", () => { instalar = null; pintarInstalar(); toast("¡App instalada!"); });
  if (esIOS() && !enApp()) instalar = "ios";
  document.addEventListener("click", (e) => { if (e.target.closest(".instalar")) { e.preventDefault(); instalarApp(); } });
  pintarInstalar();

  iniciar();
})();
