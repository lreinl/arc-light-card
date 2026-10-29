// Simuliertes Home Assistant fuer die Testseite.
// Lichter, Szenen, Timer und Benutzer-Einstellungen leben nur in diesem Browser (localStorage);
// die Karte bekommt dasselbe hass-Objekt wie in Home Assistant und merkt keinen Unterschied.

const STORE = "arc_light_demo_v1";
const SEP = " · ";

const now = () => new Date().toISOString();

function light(id, name, extra) {
  const t = now();
  return {
    entity_id: id, state: "on", last_changed: t, last_updated: t,
    attributes: {
      friendly_name: name, supported_color_modes: ["color_temp", "hs"],
      min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500, ...extra,
    },
  };
}

function initialState() {
  return {
    states: {
      "light.flur_lampen": light("light.flur_lampen", "Flur Lampen",
        { color_mode: "hs", hs_color: [225, 100], brightness: 255 }),
      "light.nanoleaf": light("light.nanoleaf", "Nanoleaf",
        { color_mode: "hs", hs_color: [165, 100], brightness: 180, min_color_temp_kelvin: 1200 }),
      "timer.auto_aus_flur_lampen": {
        entity_id: "timer.auto_aus_flur_lampen", state: "idle", last_changed: now(), last_updated: now(),
        attributes: { friendly_name: "Auto-Aus Flur", duration: "0:10:00", restore: true },
      },
      "automation.licht_auto_aus": {
        entity_id: "automation.licht_auto_aus", state: "on", last_changed: now(), last_updated: now(),
        attributes: { friendly_name: "licht | auto-aus", id: "demo_auto_aus" },
      },
    },
    scenes: {
      "1001": { id: "1001", name: "Flur" + SEP + "Standard",
        entities: { "light.flur_lampen": { state: "on", brightness: 200, color_mode: "color_temp", color_temp_kelvin: 2700 } } },
      "1002": { id: "1002", name: "Flur" + SEP + "Putzen",
        entities: { "light.flur_lampen": { state: "on", brightness: 255, color_mode: "color_temp", color_temp_kelvin: 5000 } } },
      "1003": { id: "1003", name: "Nanoleaf" + SEP + "Standard",
        entities: { "light.nanoleaf": { state: "on", brightness: 180, color_mode: "hs", hs_color: [165, 100] } } },
    },
    automations: {
      demo_auto_aus: { id: "demo_auto_aus", alias: "licht | auto-aus",
        triggers: [{ trigger: "state", id: "licht_aus", entity_id: ["light.flur_lampen"], to: "off" }] },
    },
    userData: {},
  };
}

function slug(text) {
  return text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function durationMs(d) {
  const [h, m, s] = String(d).split(":").map(Number);
  return ((h || 0) * 3600 + (m || 0) * 60 + (s || 0)) * 1000;
}

export class MockHass {
  constructor({ onCall } = {}) {
    this._subs = new Set();
    this._timers = {};
    this._onCall = onCall || (() => {});
    this._load();
    this._syncScenes();
  }

  _load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE)); } catch (e) { /* frisch starten */ }
    this.db = saved && saved.states ? saved : initialState();
    // Laufende Timer ueberleben kein Neuladen.
    for (const s of Object.values(this.db.states)) {
      if (s.entity_id.startsWith("timer.")) { s.state = "idle"; delete s.attributes.finishes_at; delete s.attributes.remaining; }
    }
  }

  _save() {
    try { localStorage.setItem(STORE, JSON.stringify(this.db)); } catch (e) { /* nur fuer diese Sitzung */ }
  }

  reset() {
    for (const t of Object.values(this._timers)) clearTimeout(t);
    this._timers = {};
    try { localStorage.removeItem(STORE); } catch (e) { /* egal */ }
    this.db = initialState();
    this._syncScenes();
    this._publish();
  }

  subscribe(fn) { this._subs.add(fn); fn(this.hass); return () => this._subs.delete(fn); }

  get hass() {
    return {
      states: { ...this.db.states },
      user: { id: "demo", name: "Demo", is_admin: true },
      language: "de", locale: { language: "de", number_format: "language", time_format: "24" },
      themes: { darkMode: true }, config: { version: "demo", components: [] },
      callService: (d, s, data) => this.callService(d, s, data),
      callWS: (msg) => this.callWS(msg),
      callApi: (method, path, body) => this.callApi(method, path, body),
    };
  }

  _publish() {
    this._save();
    const h = this.hass;
    for (const fn of this._subs) fn(h);
  }

  _setState(id, state, attrs) {
    const old = this.db.states[id];
    const t = now();
    this.db.states[id] = {
      ...old, entity_id: id, state,
      attributes: { ...(old ? old.attributes : {}), ...attrs },
      last_changed: !old || old.state !== state ? t : old.last_changed,
      last_updated: t,
    };
  }

  // Szenen-Entities aus den Szenen-Konfigurationen ableiten, wie es Home Assistant beim Neuladen tut.
  _syncScenes() {
    for (const id of Object.keys(this.db.states)) {
      if (id.startsWith("scene.") && !Object.values(this.db.scenes).some((c) => this._sceneEntityId(c) === id)) {
        delete this.db.states[id];
      }
    }
    for (const cfg of Object.values(this.db.scenes)) {
      const eid = this._sceneEntityId(cfg);
      const old = this.db.states[eid];
      this.db.states[eid] = {
        entity_id: eid, state: old ? old.state : "unknown", last_changed: now(), last_updated: now(),
        attributes: { friendly_name: cfg.name, id: cfg.id, entity_id: Object.keys(cfg.entities || {}) },
      };
    }
  }

  _sceneEntityId(cfg) {
    cfg._eid = cfg._eid || "scene." + slug(cfg.name);
    return cfg._eid;
  }

  _applyLight(id, data) {
    const st = this.db.states[id];
    if (!st) throw new Error("Unbekannte Entity " + id);
    const a = {};
    if (data.state === "off") { this._setState(id, "off", {}); this._lightOff(id); return; }
    if (data.brightness_pct !== undefined) a.brightness = Math.round(data.brightness_pct * 2.55);
    if (data.brightness !== undefined) a.brightness = data.brightness;
    if (data.hs_color) { a.hs_color = data.hs_color; a.color_mode = "hs"; }
    if (data.color_temp_kelvin) { a.color_temp_kelvin = data.color_temp_kelvin; a.color_mode = "color_temp"; }
    if (a.brightness === 0) { this._setState(id, "off", {}); this._lightOff(id); return; }
    this._setState(id, "on", a);
  }

  // Wie die Automation "licht | auto-aus": Licht aus -> laufenden Auto-Aus-Timer abbrechen.
  _lightOff(id) {
    const tid = "timer.auto_aus_" + id.split(".")[1];
    if (this.db.states[tid]?.state === "active") this._timer("cancel", tid);
  }

  _timer(service, id) {
    const st = this.db.states[id];
    if (!st) throw new Error("Unbekannter Timer " + id);
    clearTimeout(this._timers[id]);
    if (service === "start") {
      const ms = durationMs(st.attributes.duration);
      this._setState(id, "active", { finishes_at: new Date(Date.now() + ms).toISOString(), remaining: st.attributes.duration });
      this._timers[id] = setTimeout(() => {
        this._setState(id, "idle", { finishes_at: undefined, remaining: undefined });
        const lid = "light." + id.split(".")[1].replace(/^auto_aus_/, "");
        if (this.db.states[lid]) this._setState(lid, "off", {});
        this._onCall("Timer abgelaufen", { entity_id: id });
        this._publish();
      }, ms);
    } else {
      this._setState(id, "idle", { finishes_at: undefined, remaining: undefined });
    }
  }

  async callService(domain, service, data = {}) {
    this._onCall(`${domain}.${service}`, data);
    const ids = [].concat(data.entity_id || []);
    if (domain === "light") {
      for (const id of ids) {
        const on = this.db.states[id]?.state === "on";
        if (service === "turn_off" || (service === "toggle" && on)) this._applyLight(id, { state: "off" });
        else this._applyLight(id, data);
      }
    } else if (domain === "scene" && service === "turn_on") {
      for (const id of ids) {
        const cfg = Object.values(this.db.scenes).find((c) => this._sceneEntityId(c) === id);
        if (!cfg) continue;
        for (const [lid, l] of Object.entries(cfg.entities || {})) this._applyLight(lid, l);
        this._setState(id, now(), {});
      }
    } else if (domain === "timer") {
      for (const id of ids) this._timer(service, id);
    }
    this._publish();
  }

  async callWS(msg) {
    this._onCall("ws " + msg.type, msg);
    switch (msg.type) {
      case "frontend/get_user_data":
        return { value: this.db.userData[msg.key] ?? null };
      case "frontend/set_user_data":
        this.db.userData[msg.key] = msg.value; this._save(); return null;
      case "timer/create": {
        const id = "timer." + slug(msg.name);
        this._setState(id, "idle", { friendly_name: msg.name, duration: msg.duration.replace(/^0(\d):/, "$1:"), restore: msg.restore });
        this._publish();
        return { id: id.split(".")[1], ...msg };
      }
      case "timer/update": {
        const id = "timer." + msg.timer_id;
        this._setState(id, this.db.states[id]?.state || "idle", { friendly_name: msg.name, duration: msg.duration.replace(/^0(\d):/, "$1:") });
        this._publish();
        return { id: msg.timer_id, ...msg };
      }
      default:
        throw new Error("Nicht simuliert: " + msg.type);
    }
  }

  async callApi(method, path, body) {
    this._onCall(`api ${method} ${path}`, body || {});
    const m = path.match(/^config\/(scene|automation)\/config\/(.+)$/);
    if (!m) throw new Error("Nicht simuliert: " + path);
    const [, kind, id] = m;
    const table = kind === "scene" ? this.db.scenes : this.db.automations;
    if (method === "GET") {
      if (!table[id]) throw { body: { message: "Nicht gefunden" } };
      return JSON.parse(JSON.stringify(table[id]));
    }
    if (method === "POST") {
      const keep = table[id]?._eid;
      table[id] = { ...JSON.parse(JSON.stringify(body)), id };
      if (keep) table[id]._eid = keep;
    } else if (method === "DELETE") {
      delete table[id];
    }
    if (kind === "scene") this._syncScenes();
    this._publish();
    return { result: "ok" };
  }
}
