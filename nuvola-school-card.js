/*
 * Nuvola Scuola card  v2.3.0
 * Card Lovelace per l'integrazione "Nuvola Madisoft" (registro elettronico).
 * Pensata per la vista a pannello singolo; si adatta alla dimensione del
 * pannello. Supporta più studenti, editor grafico e rilevamento automatico.
 *
 * Uso minimo (YAML):   type: custom:nuvola-school-card
 */

const NUVOLA_CARD_VERSION = "2.3.0";

// chiave logica -> [dominio, suffisso entity_id]
const NUVOLA_KEYS = {
  absence: ["sensor", "assenze"],
  unjustified: ["sensor", "assenze_non_giustificate"],
  late: ["sensor", "ritardi"],
  exits: ["sensor", "uscite_anticipate"],
  notes: ["sensor", "note"],
  notifications: ["sensor", "notifiche_non_lette"],
  hw_today: ["sensor", "compiti_oggi"],
  hw_next: ["sensor", "compiti_prossimi_giorni"],
  events: ["sensor", "eventi"],
  payments: ["sensor", "pagamenti"],
  average: ["sensor", "media"],
  last_vote: ["sensor", "ultimo_voto"],
  vote_count: ["sensor", "numero_voti"],
};

const NUVOLA_COLORS = ["#2f8cff", "#ffca28", "#2ee59d", "#ff6fae", "#a37bff"];
const NUVOLA_BAD_STATES = ["unknown", "unavailable", "none", ""];

const nvEsc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const nvNum = (s) => {
  if (s === null || s === undefined) return null;
  const n = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const nvFmt = (n, d = 2) =>
  n === null ? "—" : n.toLocaleString("it-IT", { maximumFractionDigits: d });

const nvDate = (iso, opts) => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("it-IT", opts || { weekday: "short", day: "numeric", month: "short" });
};

const nvDayLabel = (iso) => {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  if (isNaN(d)) return "";
  const t = new Date();
  const dayStart = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((dayStart(d) - dayStart(t)) / 86400000);
  if (diff === 0) return "Oggi";
  if (diff === 1) return "Domani";
  if (diff === -1) return "Ieri";
  return nvDate(iso, { weekday: "long", day: "numeric", month: "long" });
};

const nvCap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "");
const nvTitle = (s) => String(s || "").split(" ").map(nvCap).join(" ");

class NuvolaSchoolCard extends HTMLElement {
  constructor() {
    super();
    this._expanded = new Set();
    this._badPhotos = new Set();
    this._sig = "";
    if (typeof this.attachShadow === "function") {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.addEventListener("click", (ev) => this._onClick(ev));
      // l'evento "error" delle immagini non risale: lo intercetto in fase di cattura
      this.shadowRoot.addEventListener(
        "error",
        (ev) => {
          const t = ev.target;
          if (t && t.classList && t.classList.contains("av-img")) {
            this._badPhotos.add(t.getAttribute("src"));
            this._sig = "";
            this._render();
          }
        },
        true
      );
    }
  }

  static getConfigElement() {
    return document.createElement("nuvola-school-card-editor");
  }

  static getStubConfig(hass) {
    const card = new NuvolaSchoolCard();
    card._hass = hass;
    return { students: card._autoStudents() };
  }

  setConfig(config) {
    this._config = {
      title: "Scuola",
      show_homework: true,
      show_events: true,
      show_subjects: true,
      show_payments: true,
      events_limit: 4,
      homework_limit: 8,
      columns: 0, // studenti per riga: 0 = automatico
      avatar_size: 4.6, // dimensione dell'avatar (multiplo dell'unita' della card)
      avatar_shape: "circle", // circle | rounded | square
      header_align: "left", // left | center
      max_width: 0, // larghezza massima del contenuto in px (0 = tutta, centrato se > 0)
      ...config,
    };
    this._sig = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;
    const sig = this._signature();
    if (sig !== this._sig) {
      this._sig = sig;
      this._render();
    }
  }

  getCardSize() {
    return 12;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto", min_columns: 6 };
  }

  // ---------- rilevamento studenti / entità ----------

  _students() {
    const cfg = (this._config && this._config.students) || [];
    const list = cfg.length ? cfg : this._autoStudents();
    return list.map((s, i) => ({ ...s, _color: s.color || NUVOLA_COLORS[i % NUVOLA_COLORS.length] }));
  }

  _autoStudents() {
    const h = this._hass;
    const res = [];
    if (!h) return res;
    const seen = new Set();
    for (const [id, e] of Object.entries(h.entities || {})) {
      if (e.platform === "nuvola" && id.startsWith("sensor.") && id.endsWith("_assenze") && e.device_id && !seen.has(e.device_id)) {
        seen.add(e.device_id);
        res.push({ device_id: e.device_id });
      }
    }
    if (res.length) return res;
    // fallback: sensori "_assenze" con attributo "studente"
    for (const id of Object.keys(h.states || {})) {
      if (id.startsWith("sensor.") && id.endsWith("_assenze") && h.states[id].attributes && h.states[id].attributes.studente) {
        res.push({ prefix: id.slice("sensor.".length, -"_assenze".length) });
      }
    }
    return res;
  }

  _resolve(student) {
    const h = this._hass;
    const out = {};
    const overrides = student.entities || {};
    let pool = null;
    if (student.device_id) {
      pool = Object.keys(h.entities || {}).filter((e) => h.entities[e].device_id === student.device_id);
    }
    for (const [key, [dom, suf]] of Object.entries(NUVOLA_KEYS)) {
      if (overrides[key]) {
        out[key] = overrides[key];
        continue;
      }
      if (student.prefix) {
        const id = `${dom}.${student.prefix}_${suf}`;
        if (h.states[id]) {
          out[key] = id;
          continue;
        }
      }
      if (pool) {
        const id = pool.find((e) => e.startsWith(dom + ".") && e.endsWith("_" + suf));
        if (id) out[key] = id;
      }
    }
    return out;
  }

  _signature() {
    const h = this._hass;
    const parts = [JSON.stringify(this._config), new Date().toDateString()];
    for (const s of this._students()) {
      const pe = s.photo_entity && h.states[s.photo_entity];
      parts.push(pe && pe.attributes ? String(pe.attributes.entity_picture || "") : "");
      const ents = this._resolve(s);
      for (const id of Object.values(ents)) {
        const st = h.states[id];
        parts.push(st ? st.last_updated + st.state : "x");
      }
    }
    parts.push([...this._expanded].join(","));
    return parts.join("|");
  }

  // Foto dello studente: indirizzo scritto a mano oppure immagine di un'entità (persona/immagine)
  _photoUrl(student) {
    let url = String(student.photo || "").trim();
    if (!url && student.photo_entity) {
      const st = this._hass.states[student.photo_entity];
      url = String((st && st.attributes && st.attributes.entity_picture) || "").trim();
    }
    if (!url || this._badPhotos.has(url)) return "";
    // solo indirizzi normali: http(s), percorsi di HA (/local/...) o immagini incorporate
    return /^(https?:\/\/|\/|data:image\/)/i.test(url) ? url : "";
  }

  // ---------- helpers di lettura ----------

  _val(id) {
    const st = id && this._hass.states[id];
    if (!st || NUVOLA_BAD_STATES.includes(String(st.state).toLowerCase())) return null;
    return st.state;
  }

  _attr(id, name) {
    const st = id && this._hass.states[id];
    return st && st.attributes ? st.attributes[name] : undefined;
  }

  // ---------- modello dati di uno studente ----------

  _model(student) {
    const e = this._resolve(student);
    const anyId = e.absence || e.average || Object.values(e)[0];
    const fullName = this._attr(anyId, "studente") || "";
    const name = student.name || nvCap((fullName.split(" ")[0] || "").trim()) || "Studente";

    const intOf = (k) => {
      const n = nvNum(this._val(e[k]));
      return n === null ? null : n;
    };

    const avg = nvNum(this._val(e.average));
    const votes = intOf("vote_count");
    const dueCount = intOf("payments");
    const dueTotal = nvNum(this._attr(e.payments, "totale_da_pagare")) || 0;
    const lastVote = this._val(e.last_vote);

    const mapped = {
      name,
      fullName,
      color: student._color,
      photo: this._photoUrl(student),
      photoZoom: Math.min(4, Math.max(1, nvNum(student.photo_zoom) || 1)),
      photoX: Math.min(100, Math.max(-100, nvNum(student.photo_x) || 0)),
      photoY: Math.min(100, Math.max(-100, nvNum(student.photo_y) || 0)),
      klass: this._attr(anyId, "classe"),
      school: this._attr(anyId, "scuola"),
      period: this._attr(anyId, "periodo_corrente"),
      updated: this._attr(anyId, "ultimo_aggiornamento"),
      ents: e,
      found: Object.keys(e).length > 0,
      avg,
      votes,
      lastVote,
      lastVoteSubject: this._attr(e.last_vote, "materia"),
      lastVoteDate: this._attr(e.last_vote, "data"),
      hwToday: intOf("hw_today"),
      hwNext: intOf("hw_next"),
      absence: intOf("absence"),
      unjustified: intOf("unjustified"),
      late: intOf("late"),
      exits: intOf("exits"),
      notes: intOf("notes"),
      notifications: intOf("notifications"),
      dueCount,
      dueTotal,
      nextDue: this._attr(e.payments, "prossima_scadenza"),
      dueList: this._attr(e.payments, "da_pagare") || [],
      homework: this._attr(e.hw_next, "elenco") || [],
      events: this._attr(e.events, "elenco") || [],
      subjects: this._attr(e.average, "materie") || [],
    };
    return mapped;
  }

  // ---------- rendering ----------

  _tiles(m) {
    const st = (cond, s) => (cond ? s : "");
    return [
      { k: "absence", label: "Assenze", icon: "mdi:calendar-remove", value: nvFmt(m.absence, 0), status: "", sub: "" },
      { k: "unjustified", label: "Non giustificate", icon: "mdi:alert-circle-outline", value: nvFmt(m.unjustified, 0), status: st(m.unjustified > 0, "bad"), sub: "" },
      { k: "late", label: "Ritardi", icon: "mdi:clock-alert-outline", value: nvFmt(m.late, 0), status: st(m.late > 0, "warn"), sub: "" },
      { k: "exits", label: "Uscite anticipate", icon: "mdi:exit-run", value: nvFmt(m.exits, 0), status: st(m.exits > 0, "warn"), sub: "" },
      { k: "notes", label: "Note", icon: "mdi:alert", value: nvFmt(m.notes, 0), status: st(m.notes > 0, "warn"), sub: "" },
      { k: "notifications", label: "Notifiche", icon: "mdi:bell", value: nvFmt(m.notifications, 0), status: st(m.notifications > 0, "info"), sub: "non lette" },
    ];
  }

  _tileHTML(m, t, big) {
    return `<div class="tile ${t.status} ${big ? "big" : ""}" data-entity="${nvEsc(m.ents[t.k] || "")}">
      <ha-icon icon="${t.icon}"></ha-icon>
      <div class="tv">${nvEsc(t.value)}</div>
      <div class="tl">${nvEsc(t.label)}</div>
      ${t.sub ? `<div class="ts">${nvEsc(t.sub)}</div>` : ""}
    </div>`;
  }

  _heroHTML(m) {
    const pct = m.avg === null ? 0 : Math.max(0, Math.min(100, m.avg * 10));
    const ringCls = m.avg === null ? "" : m.avg < 5.5 ? "bad" : m.avg < 6 ? "warn" : "ok";
    const lv = m.lastVote !== null ? (nvNum(m.lastVote) !== null ? nvFmt(nvNum(m.lastVote), 2) : String(m.lastVote)) : "—";
    const lvSub = m.lastVote !== null ? [nvCap(m.lastVoteSubject || ""), nvDate(m.lastVoteDate, { day: "numeric", month: "short" })].filter(Boolean).join(" · ") : "nessun voto";
    const big = [
      { k: "last_vote", label: "Ultimo voto", icon: "mdi:clipboard-text", value: lv, status: "", sub: lvSub },
      { k: "hw_today", label: "Compiti oggi", icon: "mdi:book-open-page-variant", value: nvFmt(m.hwToday, 0), status: m.hwToday > 0 ? "info" : "", sub: m.hwNext !== null ? `${m.hwNext} nei prossimi giorni` : "" },
      { k: "payments", label: "Da pagare", icon: m.dueCount > 0 ? "mdi:cash-clock" : "mdi:cash-check", value: nvFmt(m.dueCount, 0), status: m.dueCount > 0 ? "bad" : m.dueCount === 0 ? "ok" : "", sub: m.dueCount > 0 ? `€ ${nvFmt(m.dueTotal, 2)}` : "tutto pagato" },
    ];
    return `<div class="hero">
      <div class="ring ${ringCls}" data-entity="${nvEsc(m.ents.average || "")}">
        <svg viewBox="0 0 36 36" aria-hidden="true"><circle class="r0" cx="18" cy="18" r="15.9155"/><circle class="r1" cx="18" cy="18" r="15.9155" stroke-dasharray="${pct} 100" ${pct > 0 ? "" : 'style="display:none"'}/></svg>
        <div class="rc"><b>${nvFmt(m.avg)}</b><small>Media${m.votes ? " · " + m.votes + " voti" : ""}</small></div>
      </div>
      <div class="hstats">${big.map((t) => this._tileHTML(m, t, true)).join("")}</div>
    </div>`;
  }

  _badgesHTML(m) {
    const unseen = (m.events || []).filter((e) => e.visto === false).length;
    const b = [];
    if (m.unjustified > 0) b.push(["bad", "mdi:alert-circle", `${m.unjustified} ${m.unjustified === 1 ? "assenza non giustificata" : "assenze non giustificate"}`]);
    if (m.dueCount > 0) b.push(["bad", "mdi:cash-clock", `€ ${nvFmt(m.dueTotal, 2)} da pagare`]);
    if (m.hwToday > 0) b.push(["info", "mdi:book-open-page-variant", `${m.hwToday} ${m.hwToday === 1 ? "compito" : "compiti"} oggi`]);
    if (m.notes > 0) b.push(["warn", "mdi:alert", `${m.notes} ${m.notes === 1 ? "nota" : "note"}`]);
    if (m.late > 0) b.push(["warn", "mdi:clock-alert-outline", `${m.late} ${m.late === 1 ? "ritardo" : "ritardi"}`]);
    if (unseen > 0) b.push(["info", "mdi:bullhorn", `${unseen} ${unseen === 1 ? "avviso nuovo" : "avvisi nuovi"}`]);
    if (m.notifications > 0) b.push(["info", "mdi:bell", `${m.notifications} ${m.notifications === 1 ? "notifica" : "notifiche"}`]);
    if (!b.length) b.push(["ok", "mdi:check-circle", "Tutto in regola"]);
    return b.map(([c, i, t]) => `<span class="pill ${c}"><ha-icon icon="${i}"></ha-icon>${nvEsc(t)}</span>`).join("");
  }

  _homeworkHTML(m) {
    const limit = Number(this._config.homework_limit) || 8;
    const items = [...m.homework].sort((a, b) => String(a.data).localeCompare(String(b.data))).slice(0, limit);
    if (!items.length) return `<div class="empty"><ha-icon icon="mdi:check-circle-outline"></ha-icon>Nessun compito nei prossimi giorni</div>`;
    let html = "";
    let last = null;
    for (const it of items) {
      if (it.data !== last) {
        last = it.data;
        html += `<div class="day">${nvEsc(nvDayLabel(it.data))}</div>`;
      }
      html += `<div class="row"><div class="rt"><b>${nvEsc(it.materia || "")}</b><span>${nvEsc(it.descrizione || "")}</span></div></div>`;
    }
    return html;
  }

  _eventsHTML(m, sid) {
    const limit = Number(this._config.events_limit) || 4;
    const items = [...m.events]
      .sort((a, b) => String(b.dataInizio || "").localeCompare(String(a.dataInizio || "")))
      .slice(0, limit);
    if (!items.length) return `<div class="empty"><ha-icon icon="mdi:calendar-blank-outline"></ha-icon>Nessun avviso</div>`;
    return items
      .map((ev) => {
        const key = `${sid}:${ev.id}`;
        const open = this._expanded.has(key);
        const unseen = ev.visto === false;
        return `<div class="row ev ${open ? "open" : ""}" data-toggle="${nvEsc(key)}">
          <div class="rt">
            <b>${unseen ? '<i class="dot"></i>' : ""}${nvEsc(ev.nome || "")}</b>
            <span class="meta">${nvEsc(ev.tipo || "")}${ev.dataInizio ? " · " + nvEsc(nvDate(ev.dataInizio, { day: "numeric", month: "short" })) : ""}${ev.docente ? " · " + nvEsc(nvTitle(ev.docente)) : ""}</span>
            ${open && ev.descrizione ? `<span class="desc">${nvEsc(ev.descrizione)}</span>` : ""}
          </div>
          <ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>
        </div>`;
      })
      .join("");
  }

  _subjectsHTML(m) {
    const list = m.subjects || [];
    if (!list.length) return `<div class="empty"><ha-icon icon="mdi:school-outline"></ha-icon>Nessuna materia</div>`;
    const anyVote = list.some((s) => nvNum(s.media) !== null || (s.voti || []).length);
    const head = anyVote ? "" : `<div class="empty small"><ha-icon icon="mdi:information-outline"></ha-icon>Nessun voto in questo periodo</div>`;
    const rows = list
      .map((s) => {
        const a = nvNum(s.media);
        const pct = a === null ? 0 : Math.max(0, Math.min(100, a * 10));
        const cls = a === null ? "" : a < 5.5 ? "bad" : a < 6 ? "warn" : "ok";
        const chips = (s.voti || [])
          .slice(0, 6)
          .map((v) => {
            const x = typeof v === "object" && v ? v.valutazione ?? v.voto ?? v.valore : v;
            return x === undefined || x === null ? "" : `<i class="chip">${nvEsc(x)}</i>`;
          })
          .join("");
        return `<div class="subj"><div class="sn">${nvEsc(nvCap(s.materia || ""))}</div>
          <div class="bar"><span class="${cls}" style="width:${pct}%"></span></div>
          <div class="sv ${a === null ? "mute" : ""}">${a === null ? "—" : nvFmt(a)}</div>
          ${chips ? `<div class="chips">${chips}</div>` : ""}</div>`;
      })
      .join("");
    return head + `<div class="subjgrid">${rows}</div>`;
  }

  _paymentsHTML(m) {
    if (!m.dueList.length) {
      return `<div class="empty ok"><ha-icon icon="mdi:cash-check"></ha-icon>Tutto in regola, nessun pagamento da effettuare</div>`;
    }
    return m.dueList
      .map(
        (p) => `<div class="row"><div class="rt"><b>${nvEsc(p.tassa || "")}</b>
        <span class="meta">${p.scadenza ? "Scade " + nvEsc(nvDate(p.scadenza, { day: "numeric", month: "long", year: "numeric" })) : ""} · ${nvEsc(p.stato || "")}</span></div>
        <div class="amount">${nvEsc(p.importo || "")}</div></div>`
      )
      .join("");
  }

  _studentHTML(student, idx) {
    const m = this._model(student);
    const sid = `s${idx}`;
    if (!m.found) {
      return `<section class="stu" style="--accent:${nvEsc(m.color)}"><div class="sin"><div class="empty"><ha-icon icon="mdi:alert-outline"></ha-icon>Entità Nuvola non trovate per questo studente. Controlla la selezione nell'editor.</div></div></section>`;
    }
    const tiles = this._tiles(m).map((t) => this._tileHTML(m, t, false)).join("");
    const c = this._config;
    const panels = [];
    if (c.show_homework) panels.push(`<div class="panel"><h3><ha-icon icon="mdi:book-clock"></ha-icon>Compiti</h3>${this._homeworkHTML(m)}</div>`);
    if (c.show_events) panels.push(`<div class="panel"><h3><ha-icon icon="mdi:bullhorn-outline"></ha-icon>Avvisi ed eventi</h3>${this._eventsHTML(m, sid)}</div>`);
    const shape = ["circle", "rounded", "square"].includes(c.avatar_shape) ? c.avatar_shape : "circle";
    const size = Math.min(14, Math.max(2.5, nvNum(c.avatar_size) || 4.6));
    const center = c.header_align === "center";
    const imgStyle = `transform:translate(${m.photoX}%,${m.photoY}%) scale(${m.photoZoom})`;
    return `<section class="stu" style="--accent:${nvEsc(m.color)}"><div class="sin">
      <header class="shead${center ? " center" : ""}" style="--avs:${size}">
        ${m.photo
          ? `<div class="avatar photo ${shape}"><img class="av-img" src="${nvEsc(m.photo)}" alt="${nvEsc(m.name)}" style="${imgStyle}" loading="lazy" referrerpolicy="no-referrer"></div>`
          : `<div class="avatar ${shape}">${nvEsc((m.name || "?").charAt(0).toUpperCase())}</div>`}
        <div class="who"><div class="name">${nvEsc(m.name)}</div>
        <div class="sub">${nvEsc([m.klass ? "Classe " + m.klass : "", m.period ? nvCap(m.period) : ""].filter(Boolean).join(" · "))}</div></div>
        <div class="badges">${this._badgesHTML(m)}</div>
      </header>
      ${this._heroHTML(m)}
      <div class="tiles">${tiles}</div>
      ${panels.length ? `<div class="cols">${panels.join("")}</div>` : ""}
      ${c.show_subjects ? `<div class="panel"><h3><ha-icon icon="mdi:chart-bar"></ha-icon>Medie per materia</h3>${this._subjectsHTML(m)}</div>` : ""}
      ${c.show_payments ? `<div class="panel"><h3><ha-icon icon="mdi:cash-clock"></ha-icon>Pagamenti da effettuare</h3>${this._paymentsHTML(m)}</div>` : ""}
    </div></section>`;
  }

  _render() {
    if (!this.shadowRoot || !this._hass || !this._config) return;
    const students = this._students();
    const models = students.map((s) => this._model(s));
    const school = (models.find((m) => m.school) || {}).school;
    const upd = (models.find((m) => m.updated) || {}).updated;
    const updTxt = upd ? new Date(upd).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }) : "";
    const header = this._config.title || school
      ? `<div class="top"><div class="title">${nvEsc(this._config.title || "")}</div>
         <div class="meta">${nvEsc(nvTitle(school))}${updTxt ? ` · aggiornato ${nvEsc(updTxt)}` : ""}</div></div>`
      : "";
    const body = students.length
      ? students.map((s, i) => this._studentHTML(s, i)).join("")
      : `<div class="empty big"><ha-icon icon="mdi:account-school-outline"></ha-icon>Nessuno studente Nuvola trovato.<br>Apri l'editor e seleziona i dispositivi degli studenti.</div>`;

    const cols = Math.max(0, Math.min(6, parseInt(this._config.columns, 10) || 0));
    const mw = Math.max(0, Math.min(4000, parseInt(this._config.max_width, 10) || 0));
    const grid = cols > 0 ? ` fixed" style="--cols:${cols}` : "";
    this.shadowRoot.innerHTML = `<style>${NUVOLA_CSS}</style>
      <ha-card><div class="wrap"${mw > 0 ? ` style="max-width:${mw}px;margin-inline:auto;width:100%"` : ""}>${header}<div class="students${grid}">${body}</div></div></ha-card>`;
  }

  _onClick(ev) {
    const path = ev.composedPath ? ev.composedPath() : [];
    for (const el of path) {
      if (!el || !el.dataset) continue;
      if (el.dataset.toggle) {
        const k = el.dataset.toggle;
        if (this._expanded.has(k)) this._expanded.delete(k);
        else this._expanded.add(k);
        this._sig = "";
        this._render();
        return;
      }
      if (el.dataset.entity) {
        this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId: el.dataset.entity } }));
        return;
      }
    }
  }
}

const NUVOLA_CSS = `
:host{display:block;height:100%;container-type:inline-size;--u:clamp(9px,1.15cqi,17px);
  --ok:#2ee59d;--warn:var(--warning-color,#ffb300);--bad:#ff5470;--info:var(--primary-text-color,#00b0ff);
  --t1:var(--primary-text-color,#e8f1ff);--t2:var(--secondary-text-color,#a9bbd0);
  --line:var(--divider-color,rgba(255,202,40,.2));--amb:var(--accent-color,#ffca28);}
ha-card{height:100%;box-sizing:border-box;overflow:hidden;font-size:calc(var(--u)*1.0);}
.wrap{height:100%;display:flex;flex-direction:column;padding:calc(var(--u)*1.2);gap:calc(var(--u)*1);box-sizing:border-box;}

/* titolo */
.top{position:relative;display:flex;align-items:baseline;justify-content:space-between;gap:calc(var(--u)*1);flex:none;padding:0 calc(var(--u)*.4) calc(var(--u)*.8)}
.top::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--amb),var(--primary-color,#0055ff),transparent);background-size:200% 100%;animation:nvshim 7s linear infinite;opacity:.8}
@keyframes nvshim{from{background-position:0 0}to{background-position:200% 0}}
.title{font-size:calc(var(--u)*2.1);font-weight:800;letter-spacing:.6px;text-transform:uppercase;
  background:linear-gradient(90deg,var(--t1),var(--amb));-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 calc(var(--u)*.5) color-mix(in srgb,var(--t1) 45%,transparent))}
.top .meta{font-size:calc(var(--u)*1.0);color:var(--t2);text-align:right}

/* colonne studente: vetro scuro con riflesso, bagliore e angoli "tech" */
.students{flex:1;min-height:0;display:grid;gap:calc(var(--u)*1.1);grid-template-columns:repeat(auto-fit,minmax(min(100%,calc(var(--u)*34)),1fr));}
.students.fixed{grid-template-columns:repeat(var(--cols),minmax(0,1fr))}
@container (max-width:640px){.students.fixed{grid-template-columns:1fr}}
.stu{position:relative;min-height:0;display:flex;flex-direction:column;overflow:hidden;border-radius:calc(var(--u)*1.3);
  background:linear-gradient(165deg,color-mix(in srgb,var(--accent) 17%,transparent),transparent 48%),color-mix(in srgb,var(--accent) 5%,rgba(127,127,127,.07));
  border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);
  box-shadow:0 0 calc(var(--u)*1.6) color-mix(in srgb,var(--accent) 28%,transparent),inset 0 1px 0 rgba(255,255,255,.14),inset 0 0 calc(var(--u)*2) color-mix(in srgb,var(--accent) 8%,transparent)}
.stu::before{content:"";position:absolute;left:0;right:0;top:0;height:34%;border-radius:inherit;pointer-events:none;
  background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,0))}
.stu::after{content:"";position:absolute;inset:calc(var(--u)*.45);pointer-events:none;--c:color-mix(in srgb,var(--accent) 85%,transparent);--l:calc(var(--u)*1.5);
  background:
   linear-gradient(var(--c),var(--c)) top left/var(--l) 1px no-repeat,linear-gradient(var(--c),var(--c)) top left/1px var(--l) no-repeat,
   linear-gradient(var(--c),var(--c)) top right/var(--l) 1px no-repeat,linear-gradient(var(--c),var(--c)) top right/1px var(--l) no-repeat,
   linear-gradient(var(--c),var(--c)) bottom left/var(--l) 1px no-repeat,linear-gradient(var(--c),var(--c)) bottom left/1px var(--l) no-repeat,
   linear-gradient(var(--c),var(--c)) bottom right/var(--l) 1px no-repeat,linear-gradient(var(--c),var(--c)) bottom right/1px var(--l) no-repeat}
.sin{position:relative;z-index:1;flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:calc(var(--u)*1);padding:calc(var(--u)*1.1);
  scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--accent) 60%,transparent) transparent}

/* intestazione studente */
.shead{display:flex;align-items:center;gap:calc(var(--u)*.9);flex:none;flex-wrap:wrap}
.avatar{width:calc(var(--u)*var(--avs,4.6));height:calc(var(--u)*var(--avs,4.6));border-radius:50%;display:flex;align-items:center;justify-content:center;flex:none;
  font-weight:800;font-size:calc(var(--u)*var(--avs,4.6)*.48);color:var(--accent);border:2px solid var(--accent);
  background:radial-gradient(circle at 30% 25%,color-mix(in srgb,var(--accent) 38%,transparent),rgba(0,0,0,.3));
  text-shadow:0 0 calc(var(--u)*.9) var(--accent);
  box-shadow:0 0 calc(var(--u)*1.2) color-mix(in srgb,var(--accent) 60%,transparent),inset 0 0 calc(var(--u)*.9) color-mix(in srgb,var(--accent) 35%,transparent)}
.avatar.rounded{border-radius:24%}.avatar.square{border-radius:calc(var(--u)*.5)}
.avatar.photo{padding:0;overflow:hidden;background:rgba(0,0,0,.35)}
.avatar .av-img{width:100%;height:100%;object-fit:cover;display:block;border-radius:inherit;transform-origin:center center}
.shead.center{flex-direction:column;justify-content:center;text-align:center;gap:calc(var(--u)*.6)}
.shead.center .badges{margin-left:0;justify-content:center}
.name{font-size:calc(var(--u)*2.0);font-weight:800;color:var(--t1);line-height:1.05;text-shadow:0 0 calc(var(--u)*.7) color-mix(in srgb,var(--accent) 55%,transparent)}
.sub{font-size:calc(var(--u)*.95);color:var(--t2);margin-top:3px}
.badges{margin-left:auto;display:flex;flex-wrap:wrap;gap:calc(var(--u)*.4);justify-content:flex-end;min-width:0}
.pill{--pc:var(--t2);display:inline-flex;align-items:center;gap:calc(var(--u)*.35);padding:calc(var(--u)*.25) calc(var(--u)*.75);border-radius:99px;
  font-size:calc(var(--u)*.9);font-weight:700;color:var(--pc);white-space:nowrap;
  background:color-mix(in srgb,var(--pc) 14%,transparent);border:1px solid color-mix(in srgb,var(--pc) 55%,transparent);
  box-shadow:0 0 calc(var(--u)*.8) color-mix(in srgb,var(--pc) 28%,transparent)}
.pill ha-icon{--mdc-icon-size:calc(var(--u)*1.25)}
.pill.ok{--pc:var(--ok)}.pill.warn{--pc:var(--warn)}.pill.bad{--pc:var(--bad)}.pill.info{--pc:var(--info)}

/* hero: anello media + 3 valori grandi */
.hero{display:flex;align-items:center;gap:calc(var(--u)*1);flex:none;flex-wrap:wrap}
.ring{--rc:var(--accent);position:relative;width:calc(var(--u)*9.5);aspect-ratio:1;flex:none;cursor:pointer;margin:0 auto}
.ring.ok{--rc:var(--ok)}.ring.warn{--rc:var(--warn)}.ring.bad{--rc:var(--bad)}
.ring svg{width:100%;height:100%;transform:rotate(-90deg);overflow:visible}
.ring circle{fill:none;stroke-width:2.6;stroke-linecap:round}
.ring .r0{stroke:color-mix(in srgb,var(--rc) 20%,transparent)}
.ring .r1{stroke:var(--rc);filter:drop-shadow(0 0 3px var(--rc));transition:stroke-dasharray .8s ease}
.rc{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.rc b{font-size:calc(var(--u)*2.6);font-weight:800;line-height:1;color:var(--t1);text-shadow:0 0 calc(var(--u)*.9) color-mix(in srgb,var(--rc) 65%,transparent)}
.rc small{font-size:calc(var(--u)*.8);color:var(--t2);text-transform:uppercase;letter-spacing:.7px;margin-top:3px;padding:0 calc(var(--u)*.6)}
.hstats{flex:1;min-width:0;display:grid;gap:calc(var(--u)*.6);grid-template-columns:repeat(auto-fit,minmax(calc(var(--u)*10),1fr))}

/* riquadri */
.tiles{display:grid;gap:calc(var(--u)*.6);grid-template-columns:repeat(auto-fit,minmax(calc(var(--u)*9.5),1fr));flex:none}
.tile{--tc:color-mix(in srgb,var(--accent) 70%,transparent);position:relative;padding:calc(var(--u)*.8) calc(var(--u)*.8) calc(var(--u)*.7);border-radius:calc(var(--u)*.9);cursor:pointer;
  display:flex;flex-direction:column;gap:1px;min-width:0;
  background:linear-gradient(135deg,color-mix(in srgb,var(--tc) 14%,transparent),transparent 70%),color-mix(in srgb,var(--tc) 5%,rgba(127,127,127,.08));
  border:1px solid color-mix(in srgb,var(--tc) 38%,transparent);border-left:calc(var(--u)*.28) solid var(--tc);
  box-shadow:0 0 calc(var(--u)*.9) color-mix(in srgb,var(--tc) 18%,transparent),inset 0 1px 0 rgba(255,255,255,.08);
  transition:transform .14s ease, box-shadow .14s ease}
.tile:hover{transform:translateY(-2px);box-shadow:0 0 calc(var(--u)*1.5) color-mix(in srgb,var(--tc) 45%,transparent),inset 0 1px 0 rgba(255,255,255,.12)}
.tile ha-icon{--mdc-icon-size:calc(var(--u)*1.7);position:absolute;top:calc(var(--u)*.6);right:calc(var(--u)*.6);color:var(--tc);filter:drop-shadow(0 0 4px var(--tc));opacity:.95}
.tile.ok{--tc:var(--ok)}.tile.warn{--tc:var(--warn)}.tile.bad{--tc:var(--bad)}.tile.info{--tc:var(--info)}
.tv{font-size:calc(var(--u)*2.5);font-weight:800;line-height:1.05;color:var(--t1);font-variant-numeric:tabular-nums;text-shadow:0 0 calc(var(--u)*.8) color-mix(in srgb,var(--tc) 50%,transparent)}
.tile.big .tv{font-size:calc(var(--u)*3.1)}
.tile.bad .tv{color:var(--bad)}.tile.warn .tv{color:var(--warn)}.tile.ok .tv{color:var(--ok)}
.tl{font-size:calc(var(--u)*.95);font-weight:700;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ts{font-size:calc(var(--u)*.85);color:var(--t2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* pannelli */
.cols{display:grid;gap:calc(var(--u)*.8);grid-template-columns:repeat(auto-fit,minmax(min(100%,calc(var(--u)*20)),1fr));flex:none}
.panel{min-width:0;flex:none;padding:calc(var(--u)*.95);border-radius:calc(var(--u)*1);
  background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 7%,transparent),transparent 60%),rgba(127,127,127,.07);
  border:1px solid color-mix(in srgb,var(--accent) 24%,var(--line));box-shadow:inset 0 1px 0 rgba(255,255,255,.07)}
.panel h3{margin:0 0 calc(var(--u)*.65);font-size:calc(var(--u)*1.0);font-weight:800;text-transform:uppercase;letter-spacing:.9px;color:var(--t2);display:flex;align-items:center;gap:calc(var(--u)*.5)}
.panel h3::before{content:"";width:3px;height:1.15em;border-radius:2px;background:var(--accent);box-shadow:0 0 7px var(--accent);flex:none}
.panel h3 ha-icon{--mdc-icon-size:calc(var(--u)*1.4);color:var(--accent);filter:drop-shadow(0 0 3px var(--accent))}
.day{font-size:calc(var(--u)*.9);font-weight:800;color:var(--accent);margin:calc(var(--u)*.5) 0 calc(var(--u)*.2);text-transform:capitalize;letter-spacing:.3px}
.row{display:flex;align-items:flex-start;justify-content:space-between;gap:calc(var(--u)*.6);padding:calc(var(--u)*.5) 0;border-top:1px solid var(--line)}
.row:first-of-type,.day+.row{border-top:none}
.rt{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.rt b{font-size:calc(var(--u)*1.05);color:var(--t1);font-weight:700;overflow-wrap:anywhere}
.rt span{font-size:calc(var(--u)*.95);color:var(--t2);overflow-wrap:anywhere}
.rt .meta{font-size:calc(var(--u)*.85)}
.ev{cursor:pointer;border-radius:calc(var(--u)*.5);transition:background .15s}
.ev:hover{background:color-mix(in srgb,var(--accent) 8%,transparent)}
.ev .chev{--mdc-icon-size:calc(var(--u)*1.5);color:var(--accent);transition:transform .15s;flex:none}
.ev.open .chev{transform:rotate(180deg)}
.rt .desc{white-space:pre-wrap;margin-top:calc(var(--u)*.3);color:var(--t1);opacity:.9;line-height:1.4}
.dot{display:inline-block;width:calc(var(--u)*.7);height:calc(var(--u)*.7);border-radius:50%;background:var(--info);box-shadow:0 0 8px var(--info);margin-right:calc(var(--u)*.45);vertical-align:middle}
.amount{font-weight:800;color:var(--bad);font-size:calc(var(--u)*1.1);white-space:nowrap;text-shadow:0 0 8px color-mix(in srgb,var(--bad) 55%,transparent)}

/* materie */
.subjgrid{display:grid;gap:calc(var(--u)*.7) calc(var(--u)*1.3);grid-template-columns:repeat(auto-fit,minmax(min(100%,calc(var(--u)*17)),1fr))}
.subj{display:grid;grid-template-columns:1fr auto;grid-template-areas:"n v" "b b" "c c";align-items:center;gap:calc(var(--u)*.25) calc(var(--u)*.6)}
.sn{grid-area:n;font-size:calc(var(--u)*.95);color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sv{grid-area:v;font-weight:800;font-size:calc(var(--u)*1.05);color:var(--t1)}.sv.mute{color:var(--t2);font-weight:400}
.bar{grid-area:b;height:calc(var(--u)*.5);border-radius:99px;background:color-mix(in srgb,var(--accent) 14%,rgba(127,127,127,.15));overflow:hidden}
.bar span{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 55%,transparent),var(--accent));box-shadow:0 0 8px var(--accent)}
.bar span.ok{background:linear-gradient(90deg,color-mix(in srgb,var(--ok) 55%,transparent),var(--ok));box-shadow:0 0 8px var(--ok)}
.bar span.warn{background:linear-gradient(90deg,color-mix(in srgb,var(--warn) 55%,transparent),var(--warn));box-shadow:0 0 8px var(--warn)}
.bar span.bad{background:linear-gradient(90deg,color-mix(in srgb,var(--bad) 55%,transparent),var(--bad));box-shadow:0 0 8px var(--bad)}
.chips{grid-area:c;display:flex;flex-wrap:wrap;gap:calc(var(--u)*.3)}
.chip{font-style:normal;font-size:calc(var(--u)*.8);font-weight:700;padding:1px calc(var(--u)*.55);border-radius:99px;color:var(--t1);
  background:color-mix(in srgb,var(--accent) 20%,transparent);border:1px solid color-mix(in srgb,var(--accent) 45%,transparent)}

/* stati vuoti */
.empty{display:flex;align-items:center;gap:calc(var(--u)*.6);color:var(--t2);font-size:calc(var(--u)*1.0);padding:calc(var(--u)*.3) 0}
.empty ha-icon{--mdc-icon-size:calc(var(--u)*1.6);flex:none;color:var(--accent)}
.empty.ok,.empty.ok ha-icon{color:var(--ok)}.empty.small{font-size:calc(var(--u)*.9);margin-bottom:calc(var(--u)*.4)}
.empty.big{flex-direction:column;justify-content:center;text-align:center;height:100%;font-size:calc(var(--u)*1.3);grid-column:1/-1}
.empty.big ha-icon{--mdc-icon-size:calc(var(--u)*4)}
@media (prefers-reduced-motion:reduce){.tile,.chev,.ring .r1,.top::after{transition:none;animation:none}}
`;

// ======================= EDITOR GRAFICO =======================

const NUVOLA_LABELS = {
  title: "Titolo",
  show_homework: "Mostra compiti",
  show_events: "Mostra avvisi ed eventi",
  show_subjects: "Mostra medie per materia",
  show_payments: "Mostra pagamenti",
  events_limit: "Numero massimo di avvisi",
  homework_limit: "Numero massimo di compiti",
  columns: "Studenti per riga",
  device_id: "Dispositivo studente",
  name: "Nome (opzionale)",
  photo: "Foto (indirizzo, es. /local/foto.jpg)",
  photo_entity: "Oppure foto da una persona/immagine",
  photo_zoom: "Zoom foto",
  photo_x: "Sposta foto: sinistra / destra (%)",
  photo_y: "Sposta foto: su / giù (%)",
  avatar_size: "Dimensione avatar",
  avatar_shape: "Forma avatar",
  header_align: "Allineamento intestazione",
  max_width: "Larghezza massima del contenuto (px, 0 = tutta)",
  color: "Colore (es. #4f8cff)",
};

class NuvolaSchoolCardEditor extends HTMLElement {
  constructor() {
    super();
    this._structure = "";
  }

  setConfig(config) {
    this._config = { ...config };
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  _fire(config) {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  _students() {
    return [...(this._config.students || [])];
  }

  _update() {
    if (!this._config) return;
    const students = this._students();
    const structure = String(students.length);
    if (structure !== this._structure || !this._built) this._build(students);
    this._sync(students);
  }

  _build(students) {
    this._structure = String(students.length);
    this._built = true;
    this.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = `
      .sec{margin:0 0 16px}.sec h4{margin:12px 0 8px;font-size:14px;font-weight:600;color:var(--primary-text-color)}
      .stu{border:1px solid var(--divider-color);border-radius:12px;padding:12px;margin-bottom:12px}
      .stu .hd{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:600;color:var(--primary-text-color)}
      button.nv{cursor:pointer;border:1px solid var(--divider-color);background:var(--card-background-color);color:var(--primary-text-color);border-radius:8px;padding:6px 12px;font:inherit}
      button.nv.danger{color:var(--error-color)}
      .hint{font-size:12px;color:var(--secondary-text-color);margin:4px 0 12px}
      .pos{display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:8px}
      .posview{position:relative;width:170px;height:170px;overflow:hidden;cursor:grab;touch-action:none;user-select:none;
        border:2px solid var(--primary-color);background:#000;border-radius:50%}
      .posview:active{cursor:grabbing}
      .posview img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;-webkit-user-drag:none;transform-origin:center center}
      .posview::after{content:"";position:absolute;inset:0;pointer-events:none;
        background:linear-gradient(rgba(255,255,255,.45),rgba(255,255,255,.45)) center/1px 100% no-repeat,
                   linear-gradient(rgba(255,255,255,.45),rgba(255,255,255,.45)) center/100% 1px no-repeat}
      .posbtns{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}`;
    this.appendChild(style);

    this._main = document.createElement("ha-form");
    this._main.computeLabel = (s) => NUVOLA_LABELS[s.name] || s.name;
    this._main.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      const v = { ...ev.detail.value };
      if (v.columns !== undefined) v.columns = Number(v.columns) || 0;
      if (v.max_width !== undefined) v.max_width = Number(v.max_width) || 0;
      if (v.avatar_size !== undefined) v.avatar_size = Number(v.avatar_size) || 4.6;
      this._fire({ ...this._config, ...v });
    });
    this._main.schema = [
      { name: "title", selector: { text: {} } },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "show_homework", selector: { boolean: {} } },
          { name: "show_events", selector: { boolean: {} } },
          { name: "show_subjects", selector: { boolean: {} } },
          { name: "show_payments", selector: { boolean: {} } },
        ],
      },
      {
        name: "columns",
        selector: {
          select: {
            mode: "dropdown",
            options: [
              { value: "0", label: "Automatico" },
              { value: "1", label: "1 per riga" },
              { value: "2", label: "2 per riga" },
              { value: "3", label: "3 per riga" },
              { value: "4", label: "4 per riga" },
              { value: "5", label: "5 per riga" },
            ],
          },
        },
      },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "avatar_size", selector: { number: { min: 3, max: 12, step: 0.2, mode: "slider" } } },
          {
            name: "avatar_shape",
            selector: {
              select: {
                mode: "dropdown",
                options: [
                  { value: "circle", label: "Cerchio" },
                  { value: "rounded", label: "Quadrato arrotondato" },
                  { value: "square", label: "Quadrato" },
                ],
              },
            },
          },
          {
            name: "header_align",
            selector: {
              select: {
                mode: "dropdown",
                options: [
                  { value: "left", label: "A sinistra" },
                  { value: "center", label: "Centrata" },
                ],
              },
            },
          },
          { name: "max_width", selector: { number: { min: 0, max: 2400, step: 20, mode: "box" } } },
        ],
      },
      {
        type: "grid",
        name: "",
        schema: [
          { name: "homework_limit", selector: { number: { min: 1, max: 20, mode: "box" } } },
          { name: "events_limit", selector: { number: { min: 1, max: 10, mode: "box" } } },
        ],
      },
    ];
    const sec = document.createElement("div");
    sec.className = "sec";
    sec.appendChild(this._main);
    this.appendChild(sec);

    const h = document.createElement("h4");
    h.textContent = "Studenti";
    this.appendChild(h);
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Se non ne aggiungi nessuno, la card trova da sola tutti gli studenti Nuvola.";
    this.appendChild(hint);

    this._forms = [];
    this._pos = [];
    students.forEach((_, i) => {
      const box = document.createElement("div");
      box.className = "stu";
      const hd = document.createElement("div");
      hd.className = "hd";
      const t = document.createElement("span");
      t.textContent = `Studente ${i + 1}`;
      const rm = document.createElement("button");
      rm.className = "nv danger";
      rm.type = "button";
      rm.textContent = "Rimuovi";
      rm.addEventListener("click", () => {
        const list = this._students();
        list.splice(i, 1);
        this._fire({ ...this._config, students: list });
        this._update();
      });
      hd.append(t, rm);
      const form = document.createElement("ha-form");
      form.computeLabel = (s) => NUVOLA_LABELS[s.name] || s.name;
      form.schema = [
        { name: "device_id", selector: { device: { integration: "nuvola" } } },
        { type: "grid", name: "", schema: [{ name: "name", selector: { text: {} } }, { name: "color", selector: { text: {} } }] },
        { name: "photo", selector: { text: {} } },
        { name: "photo_entity", selector: { entity: { domain: ["person", "image"] } } },
        { name: "photo_zoom", selector: { number: { min: 1, max: 4, step: 0.05, mode: "slider" } } },
        { name: "photo_x", selector: { number: { min: -100, max: 100, step: 1, mode: "slider", unit_of_measurement: "%" } } },
        { name: "photo_y", selector: { number: { min: -100, max: 100, step: 1, mode: "slider", unit_of_measurement: "%" } } },
      ];
      form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const list = this._students();
        list[i] = { ...list[i], ...ev.detail.value };
        this._fire({ ...this._config, students: list });
      });
      const posUi = this._makePositioner(i);
      this._pos.push(posUi);
      box.append(hd, form, posUi.el);
      this.appendChild(box);
      this._forms.push(form);
    });

    const add = document.createElement("button");
    add.className = "nv";
    add.type = "button";
    add.textContent = "+ Aggiungi studente";
    add.addEventListener("click", () => {
      const list = this._students();
      list.push({ device_id: "" });
      this._fire({ ...this._config, students: list });
      this._update();
    });
    this.appendChild(add);
  }

  _photoUrl(student) {
    let u = String((student && student.photo) || "").trim();
    if (!u && student && student.photo_entity && this._hass) {
      const st = this._hass.states[student.photo_entity];
      u = String((st && st.attributes && st.attributes.entity_picture) || "").trim();
    }
    return /^(https?:\/\/|\/|data:image\/)/i.test(u) ? u : "";
  }

  // anteprima: trascina per centrare il viso, rotellina o +/- per lo zoom
  _makePositioner(i) {
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const el = document.createElement("div");
    el.className = "pos";

    const none = document.createElement("div");
    none.className = "hint";
    none.textContent = "Aggiungi una foto (indirizzo o persona) per poterla centrare qui.";

    const view = document.createElement("div");
    view.className = "posview";
    const img = document.createElement("img");
    img.alt = "";
    view.appendChild(img);

    const help = document.createElement("div");
    help.className = "hint";
    help.textContent = "Trascina la foto per mettere il viso al centro della croce. Rotellina o pulsanti per lo zoom.";

    const btns = document.createElement("div");
    btns.className = "posbtns";
    const mk = (label, fn) => {
      const b = document.createElement("button");
      b.className = "nv";
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };

    const cur = () => (this._students()[i] || {});
    const commit = (patch) => {
      const list = this._students();
      list[i] = { ...list[i], ...patch };
      this._fire({ ...this._config, students: list });
      this._update();
    };
    const zoomBy = (d) => commit({ photo_zoom: Math.round(clamp((Number(cur().photo_zoom) || 1) + d, 1, 4) * 100) / 100 });

    btns.append(
      mk("− Zoom", () => zoomBy(-0.1)),
      mk("+ Zoom", () => zoomBy(0.1)),
      mk("Reimposta", () => commit({ photo_zoom: 1, photo_x: 0, photo_y: 0 }))
    );

    let drag = null;
    const apply = (x, y, z) => {
      img.style.transform = `translate(${x}%,${y}%) scale(${z})`;
    };
    view.addEventListener("pointerdown", (ev) => {
      const c = cur();
      drag = { sx: ev.clientX, sy: ev.clientY, x0: Number(c.photo_x) || 0, y0: Number(c.photo_y) || 0, z: Number(c.photo_zoom) || 1 };
      this._dragging = true;
      if (view.setPointerCapture && ev.pointerId !== undefined) view.setPointerCapture(ev.pointerId);
      if (ev.preventDefault) ev.preventDefault();
    });
    view.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const size = (view.getBoundingClientRect && view.getBoundingClientRect().width) || 170;
      drag.x = clamp(drag.x0 + ((ev.clientX - drag.sx) / size) * 100, -100, 100);
      drag.y = clamp(drag.y0 + ((ev.clientY - drag.sy) / size) * 100, -100, 100);
      apply(drag.x, drag.y, drag.z);
    });
    const end = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      this._dragging = false;
      if (d.x !== undefined) commit({ photo_x: Math.round(d.x), photo_y: Math.round(d.y) });
    };
    view.addEventListener("pointerup", end);
    view.addEventListener("pointercancel", end);
    view.addEventListener(
      "wheel",
      (ev) => {
        if (ev.preventDefault) ev.preventDefault();
        zoomBy(ev.deltaY < 0 ? 0.1 : -0.1);
      },
      { passive: false }
    );

    el.append(none, view, btns, help);
    return { el, none, view, img, btns, help, apply };
  }

  _sync(students) {
    const c = this._config;
    if (this._main) {
      this._main.hass = this._hass;
      this._main.data = {
        title: c.title ?? "Scuola",
        columns: String(c.columns ?? 0),
        avatar_size: c.avatar_size ?? 4.6,
        avatar_shape: c.avatar_shape ?? "circle",
        header_align: c.header_align ?? "left",
        max_width: c.max_width ?? 0,
        show_homework: c.show_homework !== false,
        show_events: c.show_events !== false,
        show_subjects: c.show_subjects !== false,
        show_payments: c.show_payments !== false,
        homework_limit: c.homework_limit ?? 8,
        events_limit: c.events_limit ?? 4,
      };
    }
    (this._pos || []).forEach((p, i) => {
      if (this._dragging) return;
      const st = students[i] || {};
      const url = this._photoUrl(st);
      p.view.style.display = url ? "" : "none";
      p.btns.style.display = url ? "" : "none";
      p.help.style.display = url ? "" : "none";
      p.none.style.display = url ? "none" : "";
      if (url && p.img.getAttribute("src") !== url) p.img.setAttribute("src", url);
      const shape = c.avatar_shape === "square" ? "8px" : c.avatar_shape === "rounded" ? "24%" : "50%";
      p.view.style.borderRadius = shape;
      p.apply(Number(st.photo_x) || 0, Number(st.photo_y) || 0, Number(st.photo_zoom) || 1);
    });
    (this._forms || []).forEach((f, i) => {
      f.hass = this._hass;
      f.data = { photo_zoom: 1, photo_x: 0, photo_y: 0, ...(students[i] || {}) };
    });
  }
}

if (typeof customElements !== "undefined") {
  if (!customElements.get("nuvola-school-card")) customElements.define("nuvola-school-card", NuvolaSchoolCard);
  if (!customElements.get("nuvola-school-card-editor")) customElements.define("nuvola-school-card-editor", NuvolaSchoolCardEditor);
}

if (typeof window !== "undefined") {
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === "nuvola-school-card")) {
    window.customCards.push({
      type: "nuvola-school-card",
      name: "Nuvola Scuola",
      description: "Registro elettronico Nuvola: voti, compiti, assenze, avvisi e pagamenti per ogni studente.",
      preview: false,
    });
  }
  console.info(`%c NUVOLA-SCHOOL-CARD %c v${NUVOLA_CARD_VERSION} `, "color:#fff;background:#4f8cff;border-radius:3px 0 0 3px", "color:#fff;background:#555;border-radius:0 3px 3px 0");
}

if (typeof module !== "undefined") module.exports = { NuvolaSchoolCard, NuvolaSchoolCardEditor };
