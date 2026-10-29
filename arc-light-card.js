// Farbbogen-Licht (arc-light-card): Halbkreis fuer Farbe oder Weiss, Ein/Aus mit Glow, Helligkeit,
// Auto-Aus und Szenen als echte Home-Assistant-Szenen.
// https://github.com/lreinl/arc-light-card
//
// type: custom:arc-light-card
// entity: light.xyz
// name: Flur          (optional; Szenen namens "Flur · Putzen" werden in der Kachel als "Putzen" angezeigt)
// hue_end: 320        (optional, Ende des Farbbogens in Grad; 320 = Rot bis Pink)
// show_scenes: true   (optional, Standard fuer die Szenen-Leiste; im Zahnrad-Menue pro Benutzer umschaltbar)
//
// Szenen: Die Kachel zeigt automatisch alle Home-Assistant-Szenen, die dieses Licht enthalten.
// "+ Speichern" legt eine neue Szene "<Name> · <Szene>" an. Das Zahnrad oeffnet die Einstellungen
// (Szenen-Leiste ein/aus, Szenen sortieren per Griff, umbenennen, ueberschreiben, loeschen; Auto-Aus-Dauer).
// Alle Eingaben laufen in der Kachel selbst (keine Browser-Dialoge, die in Apps oft blockiert sind).
const ARC_VERSION = "1.0.1";
const ARC_HUE_END = 320;
const ARC_WHITE_STOPS = [[255, 147, 44], [255, 190, 120], [255, 236, 214], [232, 240, 255], [181, 210, 255]];
const ARC_AUTO_ALIAS = "licht | auto-aus";
const ARC_SEP = " · ";
const ARC_ICONS = {
  grip: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  take: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
  del: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
  ok: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L19 7"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};

class ArcLightCard extends HTMLElement {
  static getConfigElement() { return document.createElement("arc-light-card-editor"); }

  static getStubConfig(hass) {
    const id = Object.keys(hass.states).find((e) => e.startsWith("light.") &&
      (hass.states[e].attributes.supported_color_modes || []).some((m) => ["hs", "xy", "rgb", "rgbw", "rgbww"].includes(m)));
    return { entity: id || "light.example" };
  }

  setConfig(config) {
    if (!config || !config.entity || !config.entity.startsWith("light.")) {
      throw new Error("entity (light.*) erforderlich");
    }
    this._config = config;
    this._hueEnd = Number(config.hue_end) || ARC_HUE_END;
    if (!this.shadowRoot) this._build();
    this._prefsLoadedFor = null;
    this._sceneCfg = {};
    this._loadPrefs();
    this._update();
  }

  getCardSize() { return this._showScenes() ? 6 : 5; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._loadPrefs();
    this._update();
  }

  connectedCallback() { this._tick = setInterval(() => this._renderAuto(), 20000); }
  disconnectedCallback() { clearInterval(this._tick); }

  _build() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { position: relative; background: #1c1c1e; border: 1px solid #2e2e31; border-radius: 20px; padding: 14px 18px 14px;
                  display: flex; flex-direction: column; gap: 12px; align-items: center; box-sizing: border-box;
                  font-family: Roboto, system-ui, sans-serif; color: #ececec; overflow: hidden; }
        button { font-family: inherit; }
        .top { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .title { display: flex; flex-direction: column; gap: 2px; cursor: pointer; min-width: 0; }
        .name { font-size: 20px; font-weight: 500; color: #ececec; }
        .status { font-size: 13px; color: #9a9a9e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .tools { display: flex; align-items: center; gap: 6px; flex: none; }
        .seg { display: flex; padding: 3px; border-radius: 10px; background: #2a2a2d; gap: 2px; }
        .seg button { height: 30px; padding: 0 12px; border: none; border-radius: 8px; font: 500 13px Roboto, system-ui, sans-serif;
                      cursor: pointer; background: transparent; color: #a8a8ac; }
        .seg button.act { background: #4a4a4f; color: #fff; }
        .icon { width: 36px; height: 36px; border-radius: 50%; border: none; background: transparent; color: #9a9a9e;
                display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; flex: none; }
        .icon:hover { background: #2a2a2d; color: #ececec; }
        .icon.danger:hover { color: #ff6b6b; }
        .arcbox { width: 100%; max-width: 320px; position: relative; }
        .arc { position: absolute; left: 0; top: 0; width: 320px; height: 180px; transform-origin: 0 0;
               touch-action: none; user-select: none; cursor: pointer; }
        .paint { position: absolute; inset: 0; transition: opacity 0.25s, filter 0.25s; }
        .paint.off { opacity: 0.4; filter: saturate(0.6); }
        .cap { position: absolute; top: 140px; width: 40px; height: 40px; border-radius: 50%; }
        .ringclip { position: absolute; left: 0; top: 0; width: 320px; height: 160px; overflow: hidden; }
        .ring { width: 320px; height: 320px; border-radius: 50%;
                -webkit-mask: radial-gradient(circle at center, transparent 119.5px, #000 120px);
                mask: radial-gradient(circle at center, transparent 119.5px, #000 120px); }
        .knob { position: absolute; width: 36px; height: 36px; border-radius: 50%; border: 4px solid #fff;
                box-shadow: 0 2px 6px rgba(0,0,0,0.45); padding: 0; cursor: grab; box-sizing: border-box;
                transition: background-color 0.25s; }
        .pwr { --c: #8a8a8e; position: absolute; left: 124px; top: 82px; width: 72px; height: 72px; border-radius: 50%;
               border: 1px solid #3a3a3d; background: #242427; color: #8a8a8e; display: flex; align-items: center;
               justify-content: center; padding: 0; cursor: pointer; transition: box-shadow 0.4s, color 0.4s, border-color 0.4s; }
        .pwr svg { width: 34px; height: 34px; position: relative; transition: filter 0.4s; }
        /* An: Symbol in Lichtfarbe mit wenig Eigenleuchten, nach aussen ein weicher, ruhiger Schein. */
        .pwr.on { color: var(--c); border-color: color-mix(in srgb, var(--c) 45%, #3a3a3d);
                  box-shadow: 0 0 16px 0 color-mix(in srgb, var(--c) 40%, transparent),
                              0 0 4px 0 color-mix(in srgb, var(--c) 30%, transparent),
                              inset 0 0 12px -6px color-mix(in srgb, var(--c) 50%, transparent); }
        .pwr.on svg { filter: drop-shadow(0 0 1.5px color-mix(in srgb, var(--c) 70%, transparent)); }
        .row { width: 100%; display: flex; align-items: center; gap: 14px; }
        .bar { -webkit-appearance: none; appearance: none; flex: 1; height: 12px; border-radius: 6px; margin: 0; cursor: pointer;
               transition: opacity 0.25s, filter 0.25s; }
        .bar.off { opacity: 0.4; filter: saturate(0.6); }
        .bar::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 22px; height: 22px; border-radius: 50%;
                                     background: #fff; border: none; box-shadow: 0 1px 4px rgba(0,0,0,.55); }
        .bar::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: #fff; border: none; box-shadow: 0 1px 4px rgba(0,0,0,.55); }
        .bar::-moz-range-track { background: transparent; }
        .pct { width: 44px; text-align: right; font-size: 15px; color: #ececec; }
        .auto { flex: none; height: 44px; min-width: 44px; padding: 0 10px; border-radius: 22px; border: none; background: #2c2c2e;
                color: #c8c8cc; display: flex; align-items: center; justify-content: center; gap: 4px; cursor: pointer;
                font: 500 13px Roboto, system-ui, sans-serif; box-sizing: border-box; }
        .auto.act { background: #b5651d; color: #fff; }
        .scenebox { width: 100%; }
        .scenebox.hidden { display: none; }
        .chips { width: 100%; display: flex; gap: 8px; overflow-x: auto; padding-bottom: 2px; }
        .chip { flex: none; height: 36px; padding: 0 12px 0 8px; border-radius: 18px; border: 1px solid #3a3a3d;
                background: #242427; color: #ececec; display: flex; align-items: center; gap: 8px;
                font: 400 13px Roboto, system-ui, sans-serif; cursor: pointer; }
        .chip.act { background: #3a3a3e; border-color: #ececec; }
        .dot { width: 18px; height: 18px; border-radius: 50%; flex: none; }
        .save { flex: none; height: 36px; padding: 0 14px; border-radius: 18px; border: 1px dashed #5a5a5e; background: transparent;
                color: #c8c8cc; display: flex; align-items: center; gap: 6px; font: 400 13px Roboto, system-ui, sans-serif; cursor: pointer; }
        .namebar { display: none; width: 100%; align-items: center; gap: 8px; }
        .namebar.open { display: flex; }
        .namebar input, .sh-row input.rename { flex: 1; min-width: 0; height: 36px; border-radius: 10px; border: 1px solid #5a5a5e;
                background: #242427; color: #ececec; padding: 0 12px; font: 400 14px Roboto, system-ui, sans-serif; box-sizing: border-box; }
        .namebar input:focus, .sh-row input.rename:focus { outline: none; border-color: #b5651d; }
        .msg { width: 100%; font-size: 12px; color: #9a9a9e; min-height: 0; }
        .msg:empty { display: none; }
        .msg.err { color: #ff8a80; }
        .unavail { opacity: 0.4; pointer-events: none; }
        .sheet { position: absolute; inset: 0; background: #1c1c1e; border-radius: 20px; padding: 20px 18px; box-sizing: border-box;
                 display: none; flex-direction: column; gap: 12px; overflow-y: auto; z-index: 2; }
        .sheet.open { display: flex; }
        .sh-head { display: flex; justify-content: space-between; align-items: center; }
        .sh-title { font-size: 18px; font-weight: 500; }
        .sh-sec { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #9a9a9e; margin-top: 6px; }
        .sh-list { display: flex; flex-direction: column; gap: 6px; }
        .sh-row { display: flex; align-items: center; gap: 8px; padding: 4px 6px 4px 2px; border-radius: 12px; background: #242427;
                  position: relative; transition: transform 0.15s; min-height: 44px; box-sizing: border-box; }
        .sh-row.dragging { transition: none; z-index: 3; background: #303034; box-shadow: 0 6px 18px rgba(0,0,0,0.5); }
        .sh-row .lbl { flex: 1; min-width: 0; font-size: 14px; overflow-wrap: anywhere; }
        .sh-row .icon { width: 34px; height: 34px; }
        .grip { width: 28px; height: 36px; display: flex; align-items: center; justify-content: center; color: #6a6a6e;
                cursor: grab; touch-action: none; flex: none; }
        .grip:active { cursor: grabbing; color: #ececec; }
        .ask { font-size: 13px; color: #c8c8cc; }
        .mini { height: 30px; padding: 0 12px; border-radius: 15px; border: 1px solid #3a3a3d; background: #2a2a2d; color: #ececec;
                font: 500 12px Roboto, system-ui, sans-serif; cursor: pointer; flex: none; }
        .mini.danger { background: #5c2626; border-color: #7a3030; }
        .sh-hint { font-size: 12px; color: #9a9a9e; line-height: 1.4; }
        .sh-line { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 14px; }
        .sh-auto { display: flex; align-items: center; gap: 10px; font-size: 14px; }
        .sh-auto input { width: 64px; height: 32px; border-radius: 8px; border: 1px solid #3a3a3d; background: #242427;
                         color: #ececec; padding: 0 8px; font: 400 14px Roboto, system-ui, sans-serif; }
        .btn { height: 34px; padding: 0 14px; border-radius: 17px; border: 1px solid #3a3a3d; background: #2a2a2d; color: #ececec;
               font: 500 13px Roboto, system-ui, sans-serif; cursor: pointer; align-self: flex-start; display: flex; align-items: center; gap: 6px; }
        .link { background: none; border: none; color: #9a9a9e; text-decoration: underline; cursor: pointer; padding: 0;
                font: 400 12px Roboto, system-ui, sans-serif; align-self: flex-start; }
        .switch { position: relative; width: 44px; height: 26px; border-radius: 13px; background: #3a3a3d; border: none; cursor: pointer;
                  flex: none; padding: 0; transition: background 0.2s; }
        .switch::after { content: ""; position: absolute; left: 3px; top: 3px; width: 20px; height: 20px; border-radius: 50%;
                         background: #ececec; transition: left 0.2s; }
        .switch.on { background: #b5651d; }
        .switch.on::after { left: 21px; }
      </style>
      <ha-card>
        <div class="top">
          <div class="title"><span class="name"></span><span class="status"></span></div>
          <div class="tools">
            <div class="seg"><button class="m-color">Farbe</button><button class="m-white">Weiß</button></div>
            <button class="icon gear" aria-label="Einstellungen"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path></svg></button>
          </div>
        </div>
        <div class="arcbox">
          <div class="arc">
            <div class="paint">
              <div class="cap capL" style="left:0"></div>
              <div class="cap capR" style="left:280px"></div>
              <div class="ringclip"><div class="ring"></div></div>
            </div>
            <button class="knob" aria-label="Farbton"></button>
            <button class="pwr" aria-label="Ein/Aus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v9"></path><path d="M6.3 6.8a8 8 0 1 0 11.4 0"></path></svg></button>
          </div>
        </div>
        <div class="row">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#9a9a9e" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>
          <input class="bar" type="range" min="1" max="100" aria-label="Helligkeit" />
          <span class="pct"></span>
          <button class="auto" aria-label="Auto-Aus"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="13" r="8"></circle><path d="M12 9v4l2.5 2.5M9 2h6"></path></svg><span class="autotxt"></span></button>
        </div>
        <div class="scenebox">
          <div class="chips"></div>
          <div class="namebar">
            <input class="newname" type="text" placeholder="Name der neuen Szene" enterkeyhint="done" />
            <button class="icon ok" aria-label="Szene speichern">${ARC_ICONS.ok}</button>
            <button class="icon cancel" aria-label="Abbrechen">${ARC_ICONS.x}</button>
          </div>
        </div>
        <div class="msg"></div>
        <div class="sheet">
          <div class="sh-head"><span class="sh-title"></span><button class="icon close" aria-label="Schließen">${ARC_ICONS.x}</button></div>
          <div class="sh-line"><span>Szenen in der Kachel anzeigen</span><button class="switch showsw" role="switch" aria-label="Szenen in der Kachel anzeigen"></button></div>
          <div class="sh-sec">Szenen</div>
          <div class="sh-list"></div>
          <button class="btn newscene">${ARC_ICONS.plus}Neue Szene aus aktuellem Licht</button>
          <div class="sh-hint">Am Griff ⠿ ziehen zum Sortieren. Die Szenen sind normale Home-Assistant-Szenen: Jede Szene, die dieses Licht enthält, erscheint hier automatisch.</div>
          <button class="link manage">Alle Szenen in Home Assistant öffnen</button>
          <div class="sh-sec">Auto-Aus</div>
          <div class="sh-autobox"></div>
          <div class="msg shmsg"></div>
        </div>
      </ha-card>`;
    const $ = (s) => root.querySelector(s);
    this._$ = $;
    this._mode = null;
    this._t = { color: 0, white: 0.45 };
    this._lastSend = 0;

    $(".title").addEventListener("click", () => this._moreInfo());
    $(".m-color").addEventListener("click", () => this._setMode("color"));
    $(".m-white").addEventListener("click", () => this._setMode("white"));
    $(".gear").addEventListener("click", () => { this._sheetOpen = true; this._sheetSig = null; this._autoSig = null; this._renderSheet(); });
    $(".close").addEventListener("click", () => { this._sheetOpen = false; this._rowState = {}; this._renderSheet(); });
    $(".pwr").addEventListener("click", (e) => { e.stopPropagation(); this._call("toggle", {}); });
    $(".pwr").addEventListener("pointerdown", (e) => e.stopPropagation());
    $(".auto").addEventListener("click", () => this._toggleAutoOff());
    $(".showsw").addEventListener("click", () => this._setShowScenes(!this._showScenes()));
    $(".newscene").addEventListener("click", () => { this._sheetOpen = false; this._renderSheet(); this._openNameBar(); });
    $(".manage").addEventListener("click", () => {
      history.pushState(null, "", "/config/scene/dashboard");
      window.dispatchEvent(new CustomEvent("location-changed"));
    });
    const nb = $(".newname");
    $(".ok").addEventListener("click", () => this._saveScene(nb.value));
    $(".cancel").addEventListener("click", () => this._closeNameBar());
    nb.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this._saveScene(nb.value);
      if (e.key === "Escape") this._closeNameBar();
    });
    const bar = $(".bar");
    bar.addEventListener("input", () => {
      cancelAnimationFrame(this._barAnim);
      this._barShown = Number(bar.value);
      this._barTarget = undefined;
      $(".pct").textContent = bar.value + " %";
      this._barTouched = true;
    });
    bar.addEventListener("change", () => {
      this._barTouched = false;
      this._call("turn_on", { brightness_pct: Number(bar.value) });
    });

    const arc = $(".arc");
    arc.addEventListener("pointerdown", (e) => {
      if (!this._onRing(e)) return;
      this._dragging = true;
      try { arc.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      this._pick(e, false);
    });
    arc.addEventListener("pointermove", (e) => { if (this._dragging) this._pick(e, false); });
    const end = (e) => { if (!this._dragging) return; this._dragging = false; this._pick(e, true); };
    arc.addEventListener("pointerup", end);
    arc.addEventListener("pointercancel", end);
    $(".knob").addEventListener("keydown", (e) => {
      const d = ["ArrowRight", "ArrowUp"].includes(e.key) ? 0.02 : ["ArrowLeft", "ArrowDown"].includes(e.key) ? -0.02 : 0;
      if (!d) return;
      e.preventDefault();
      this._t[this._mode] = Math.min(1, Math.max(0, this._t[this._mode] + d));
      this._send(true);
      this._render();
    });

    new ResizeObserver(() => this._scale()).observe($(".arcbox"));
  }

  // ---------- Meldungen ----------
  _notify(text, isErr = false, where = ".msg") {
    const el = this._$(where);
    el.textContent = text;
    el.classList.toggle("err", isErr);
    clearTimeout(this._msgTimer);
    if (text) this._msgTimer = setTimeout(() => { el.textContent = ""; }, isErr ? 8000 : 4000);
  }

  // ---------- Zustand ----------
  _stateObj() { return this._hass && this._config ? this._hass.states[this._config.entity] : undefined; }
  _objectId() { return this._config.entity.split(".")[1]; }
  _cardName() { return this._config.name || this._stateObj()?.attributes.friendly_name || this._objectId(); }

  _caps() {
    const modes = this._stateObj()?.attributes.supported_color_modes || [];
    return {
      color: modes.some((m) => ["hs", "xy", "rgb", "rgbw", "rgbww"].includes(m)),
      white: modes.includes("color_temp") || modes.includes("rgbww"),
    };
  }

  _kelvinRange() {
    const a = this._stateObj()?.attributes || {};
    return [a.min_color_temp_kelvin || 2200, a.max_color_temp_kelvin || 6500];
  }

  _hueOf(t) { return Math.round(t * this._hueEnd); }
  _kelvinOf(t) { const [lo, hi] = this._kelvinRange(); return Math.round((lo + t * (hi - lo)) / 100) * 100; }
  _tOfKelvin(k) { const [lo, hi] = this._kelvinRange(); return Math.min(1, Math.max(0, (k - lo) / (hi - lo))); }

  _whiteColor(t) {
    const s = ARC_WHITE_STOPS, p = t * (s.length - 1), i = Math.min(s.length - 2, Math.floor(p)), f = p - i;
    return "rgb(" + s[i].map((v, j) => Math.round(v + (s[i + 1][j] - v) * f)).join(",") + ")";
  }

  _colorOf(mode, t) { return mode === "color" ? `hsl(${this._hueOf(t)} 100% 50%)` : this._whiteColor(t); }

  _readState() {
    const st = this._stateObj();
    if (!st) return;
    const a = st.attributes;
    const caps = this._caps();
    if (!this._dragging) {
      if (a.hs_color && a.color_mode !== "color_temp") {
        const h = a.hs_color[0];
        this._t.color = Math.min(1, Math.max(0, (h > this._hueEnd ? (h - this._hueEnd < 360 - h ? this._hueEnd : 0) : h) / this._hueEnd));
      }
      if (a.color_temp_kelvin) this._t.white = this._tOfKelvin(a.color_temp_kelvin);
    }
    if (this._userMode && Date.now() - this._lastSend > 3000) this._userMode = false;
    if (!this._mode || !this._userMode) {
      if (st.state === "on" && a.color_mode) this._mode = a.color_mode === "color_temp" ? "white" : "color";
      if (!this._mode) this._mode = caps.color ? "color" : "white";
      if (this._mode === "white" && !caps.white) this._mode = "color";
      if (this._mode === "color" && !caps.color) this._mode = "white";
    }
  }

  // ---------- Bedienung ----------
  _call(service, data, domain = "light") {
    return this._hass.callService(domain, service, domain === "light" ? { entity_id: this._config.entity, ...data } : data);
  }

  _moreInfo() {
    const ev = new Event("hass-more-info", { bubbles: true, composed: true });
    ev.detail = { entityId: this._config.entity };
    this.dispatchEvent(ev);
  }

  _setMode(mode) {
    if (!this._caps()[mode]) return;
    this._mode = mode;
    this._userMode = true;
    this._lastSend = Date.now();
    if (this._stateObj()?.state === "on") this._send(true);
    this._render();
  }

  _send(final) {
    const now = Date.now();
    if (!final && now - this._lastSend < 300) return;
    this._lastSend = now;
    this._userMode = true;
    const t = this._t[this._mode];
    this._call("turn_on", this._mode === "color" ? { hs_color: [this._hueOf(t), 100] } : { color_temp_kelvin: this._kelvinOf(t) });
  }

  _local(e) {
    const r = this._$(".arc").getBoundingClientRect();
    const s = r.width / 320;
    return { x: (e.clientX - r.left) / s - 160, y: 160 - (e.clientY - r.top) / s };
  }

  _onRing(e) {
    const { x, y } = this._local(e);
    const d = Math.hypot(x, y);
    return d > 100 && d < 182 && y > -24;
  }

  _pick(e, final) {
    const { x, y } = this._local(e);
    let a = Math.atan2(y, x);
    if (a < 0) a = x > 0 ? 0 : Math.PI;
    this._t[this._mode] = 1 - a / Math.PI;
    this._send(final);
    this._render();
  }

  // ---------- Einstellungen pro Benutzer (Reihenfolge, Szenen-Leiste) ----------
  _prefsKey() { return "arc_light_prefs_" + this._config.entity.replace(/\W/g, "_"); }
  _oldOrderKey() { return "arc_light_order_" + this._config.entity.replace(/\W/g, "_"); }

  async _loadPrefs() {
    if (!this._hass || !this._config || this._prefsLoadedFor === this._config.entity) return;
    this._prefsLoadedFor = this._config.entity;
    this._prefs = {};
    try {
      const res = await this._hass.callWS({ type: "frontend/get_user_data", key: this._prefsKey() });
      if (res && res.value && typeof res.value === "object") this._prefs = res.value;
      if (!this._prefs.order) {
        const old = await this._hass.callWS({ type: "frontend/get_user_data", key: this._oldOrderKey() });
        if (old && Array.isArray(old.value)) this._prefs.order = old.value;
      }
    } catch (err) { /* Standardwerte */ }
    this._chipSig = null;
    this._sheetSig = null;
    this._render();
    this._renderSheet();
  }

  _storePrefs() {
    this._hass.callWS({ type: "frontend/set_user_data", key: this._prefsKey(), value: this._prefs })
      .catch((err) => this._notify("Einstellung konnte nicht gespeichert werden: " + (err.message || err), true, ".shmsg"));
  }

  _showScenes() {
    if (this._prefs && typeof this._prefs.show_scenes === "boolean") return this._prefs.show_scenes;
    return this._config?.show_scenes !== false;
  }

  _setShowScenes(v) {
    this._prefs = { ...(this._prefs || {}), show_scenes: v };
    this._storePrefs();
    this._render();
    this._renderSheet();
  }

  // ---------- Auto-Aus ----------
  _timerId() { return this._config.auto_off_timer || "timer.auto_aus_" + this._objectId(); }

  _timerMinutes() {
    const d = this._hass?.states[this._timerId()]?.attributes.duration || "0:15:00";
    const [h, m] = d.split(":").map(Number);
    return h * 60 + m || 15;
  }

  _toggleAutoOff() {
    const tid = this._timerId();
    const tmr = this._hass.states[tid];
    if (!tmr) { this._sheetOpen = true; this._autoSig = null; this._renderSheet(); return; }
    if (tmr.state === "active") { this._call("cancel", { entity_id: tid }, "timer"); return; }
    if (this._stateObj()?.state !== "on") this._call("turn_on", {});
    this._call("start", { entity_id: tid }, "timer");
  }

  _renderAuto() {
    if (!this._hass || !this._config || !this._$) return;
    const btn = this._$(".auto");
    const tmr = this._hass.states[this._timerId()];
    const active = tmr?.state === "active";
    btn.classList.toggle("act", active);
    let txt = "";
    if (active && tmr.attributes.finishes_at) {
      txt = Math.max(1, Math.ceil((new Date(tmr.attributes.finishes_at) - Date.now()) / 60000)) + "′";
    }
    this._$(".autotxt").textContent = txt;
    btn.title = !tmr ? "Auto-Aus einrichten" : active ? "Auto-Aus läuft – antippen zum Abbrechen" : `Auto-Aus: nach ${this._timerMinutes()} Minuten ausschalten`;
  }

  async _setupAutoOff() {
    const obj = this._objectId();
    try {
      await this._hass.callWS({ type: "timer/create", name: "Auto-Aus " + obj, icon: "mdi:timer-outline", duration: "00:15:00", restore: true });
      const auto = Object.values(this._hass.states).find((s) => s.entity_id.startsWith("automation.") && s.attributes.friendly_name === ARC_AUTO_ALIAS);
      if (auto?.attributes.id) {
        const cfg = await this._hass.callApi("GET", "config/automation/config/" + auto.attributes.id);
        const trig = (cfg.triggers || []).find((t) => t.id === "licht_aus");
        if (trig) {
          const list = [].concat(trig.entity_id || []);
          if (!list.includes(this._config.entity)) list.push(this._config.entity);
          trig.entity_id = list;
          await this._hass.callApi("POST", "config/automation/config/" + auto.attributes.id, cfg);
        }
        this._notify("Auto-Aus ist eingerichtet.", false, ".shmsg");
      } else {
        this._notify(`Timer angelegt, aber die Automation „${ARC_AUTO_ALIAS}“ fehlt – ohne sie schaltet der Timer das Licht nicht aus.`, true, ".shmsg");
      }
    } catch (err) {
      this._notify("Auto-Aus konnte nicht eingerichtet werden: " + (err.message || err), true, ".shmsg");
    }
    this._autoSig = null;
    setTimeout(() => this._renderSheet(), 1500);
  }

  async _setAutoMinutes(min) {
    const m = Math.max(1, Math.min(600, Math.round(min) || 1));
    const dur = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
    const id = this._timerId().split(".")[1];
    try {
      await this._hass.callWS({ type: "timer/update", timer_id: id, name: this._hass.states[this._timerId()]?.attributes.friendly_name || id, duration: dur, icon: "mdi:timer-outline", restore: true });
      this._notify(`Auto-Aus: ${m} Minuten gespeichert.`, false, ".shmsg");
    } catch (err) {
      this._notify("Dauer konnte nicht gespeichert werden: " + (err.message || err), true, ".shmsg");
    }
  }

  // ---------- Szenen (echte Home-Assistant-Szenen) ----------
  _scenes() {
    if (!this._hass) return [];
    const ent = this._config.entity;
    const list = Object.values(this._hass.states).filter((s) => s.entity_id.startsWith("scene.") &&
      (s.attributes.entity_id || []).includes(ent));
    const order = this._prefs?.order || [];
    const pos = (id) => { const i = order.indexOf(id); return i < 0 ? 999 : i; };
    list.sort((a, b) => pos(a.entity_id) - pos(b.entity_id) || this._label(a).localeCompare(this._label(b), "de"));
    for (const s of list) this._fetchSceneCfg(s);
    return list;
  }

  _label(s) {
    const full = s.attributes.friendly_name || s.entity_id;
    const prefix = this._cardName() + ARC_SEP;
    return full.startsWith(prefix) ? full.slice(prefix.length) : full;
  }

  _fetchSceneCfg(s) {
    const id = s.attributes.id;
    if (!id || this._sceneCfg[id] !== undefined) return;
    this._sceneCfg[id] = null;
    this._hass.callApi("GET", "config/scene/config/" + id)
      .then((cfg) => { this._sceneCfg[id] = cfg; this._chipSig = null; this._sheetSig = null; this._render(); this._renderSheet(); })
      .catch(() => { this._sceneCfg[id] = false; });
  }

  _sceneDot(s) {
    const cfg = this._sceneCfg[s.attributes.id];
    const l = cfg && cfg.entities && cfg.entities[this._config.entity];
    if (!l) return "#888";
    if (l.state === "off") return "#3a3a3d";
    if (l.color_mode === "color_temp" && l.color_temp_kelvin) return this._whiteColor(this._tOfKelvin(l.color_temp_kelvin));
    if (l.rgb_color) return `rgb(${l.rgb_color.join(",")})`;
    if (l.hs_color) return `hsl(${Math.round(l.hs_color[0])} ${Math.round(l.hs_color[1])}% 50%)`;
    if (l.color_temp_kelvin) return this._whiteColor(this._tOfKelvin(l.color_temp_kelvin));
    return "#ffd9a0";
  }

  _activeScene(scenes) {
    const light = this._stateObj();
    if (!light || light.state !== "on") return null;
    let best = null;
    for (const s of scenes) {
      const ts = Date.parse(s.state);
      if (!isNaN(ts) && (!best || ts > Date.parse(best.state))) best = s;
    }
    if (!best) return null;
    return Date.parse(best.state) >= Date.parse(light.last_changed) - 10000 &&
      Date.parse(best.state) >= Date.parse(light.last_updated) - 10000 ? best.entity_id : null;
  }

  _currentLightConfig() {
    const st = this._stateObj();
    if (!st || st.state !== "on") return { state: "off" };
    const a = st.attributes;
    const out = { state: "on", brightness: a.brightness || 255, color_mode: a.color_mode };
    if (a.color_mode === "color_temp") out.color_temp_kelvin = a.color_temp_kelvin;
    else if (a.hs_color) out.hs_color = a.hs_color;
    return out;
  }

  _openNameBar() {
    this._nameOpen = true;
    this._$(".scenebox").classList.remove("hidden");
    const nb = this._$(".namebar");
    nb.classList.add("open");
    this._$(".chips").style.display = "none";
    const inp = this._$(".newname");
    inp.value = "";
    setTimeout(() => inp.focus(), 50);
  }

  _closeNameBar() {
    this._nameOpen = false;
    this._$(".namebar").classList.remove("open");
    this._$(".chips").style.display = "";
    this._render();
  }

  async _saveScene(raw) {
    const name = (raw || "").trim();
    if (!name) { this._notify("Bitte einen Namen eingeben.", true); return; }
    const full = this._cardName() + ARC_SEP + name;
    if (Object.values(this._hass.states).some((s) => s.entity_id.startsWith("scene.") && s.attributes.friendly_name === full)) {
      this._notify(`„${name}“ gibt es schon – zum Ändern im Zahnrad-Menü überschreiben.`, true);
      return;
    }
    const id = String(Date.now());
    const cfg = {
      id, name: full,
      entities: { [this._config.entity]: this._currentLightConfig() },
      metadata: { [this._config.entity]: { entity_only: true } },
    };
    try {
      await this._hass.callApi("POST", "config/scene/config/" + id, cfg);
      this._closeNameBar();
      this._notify(`Szene „${name}“ gespeichert – sie steht jetzt auch in Home Assistant zur Verfügung.`);
    } catch (err) {
      this._notify("Szene konnte nicht gespeichert werden: " + (err.body?.message || err.message || err), true);
    }
  }

  async _renameScene(s, raw) {
    const name = (raw || "").trim();
    if (!name) return;
    const id = s.attributes.id;
    const cfg = await this._hass.callApi("GET", "config/scene/config/" + id);
    cfg.name = this._cardName() + ARC_SEP + name;
    await this._hass.callApi("POST", "config/scene/config/" + id, cfg);
    this._sceneCfg[id] = undefined;
    this._notify(`Umbenannt in „${name}“.`, false, ".shmsg");
  }

  async _overwriteScene(s) {
    const id = s.attributes.id;
    const cfg = await this._hass.callApi("GET", "config/scene/config/" + id);
    cfg.entities = { ...(cfg.entities || {}), [this._config.entity]: this._currentLightConfig() };
    await this._hass.callApi("POST", "config/scene/config/" + id, cfg);
    this._sceneCfg[id] = undefined;
    this._notify(`„${this._label(s)}“ mit dem aktuellen Licht überschrieben.`, false, ".shmsg");
  }

  async _deleteScene(s) {
    await this._hass.callApi("DELETE", "config/scene/config/" + s.attributes.id);
    this._notify(`„${this._label(s)}“ gelöscht.`, false, ".shmsg");
  }

  // ---------- Darstellung ----------
  _scale() {
    const box = this._$(".arcbox");
    const s = Math.min(1.25, (box.clientWidth || 320) / 320);
    this._$(".arc").style.transform = `scale(${s})`;
    box.style.height = 180 * s + "px";
  }

  _update() {
    if (!this.shadowRoot || !this._hass || !this._config) return;
    this._readState();
    this._render();
    if (this._sheetOpen) this._renderSheet();
  }

  _render() {
    if (!this.shadowRoot || !this._config) return;
    const $ = this._$;
    const st = this._stateObj();
    const card = $("ha-card");
    if (!st) {
      $(".name").textContent = this._config.name || this._config.entity;
      $(".status").textContent = "Nicht gefunden";
      card.classList.add("unavail");
      return;
    }
    const avail = st.state !== "unavailable";
    card.classList.toggle("unavail", !avail);
    const on = st.state === "on";
    const caps = this._caps();
    const mode = this._mode || "color";
    const white = mode === "white";
    const t = this._t[mode];
    const cur = this._colorOf(mode, t);
    const bri = on && st.attributes.brightness ? Math.max(1, Math.round((st.attributes.brightness / 255) * 100)) : 0;

    const scenes = this._scenes();
    const activeId = this._activeScene(scenes);
    const active = scenes.find((s) => s.entity_id === activeId);
    const k = this._kelvinOf(t);
    const what = white ? (k < 3300 ? "Warmweiß" : k < 5000 ? "Neutralweiß" : "Tageslicht") : "Farbe";
    $(".name").textContent = this._cardName();
    $(".status").textContent = !avail ? "Nicht verfügbar" : on ? "An · " + (active ? this._label(active) : what) : "Aus";

    $(".m-color").classList.toggle("act", !white);
    $(".m-white").classList.toggle("act", white);
    $(".seg").style.display = caps.color && caps.white ? "" : "none";

    let ring;
    if (white) {
      ring = "conic-gradient(from 270deg, " + ARC_WHITE_STOPS.map((c, i) => `rgb(${c.join(",")}) ${i * 45}deg`).join(", ") + ", transparent 180deg)";
    } else {
      const stops = [];
      for (let i = 0; i <= 8; i++) stops.push(`hsl(${Math.round((i / 8) * this._hueEnd)} 100% 50%) ${i * 22.5}deg`);
      ring = "conic-gradient(from 270deg, " + stops.join(", ") + ", transparent 180deg)";
    }
    $(".ring").style.background = ring;
    $(".capL").style.background = this._colorOf(mode, 0);
    $(".capR").style.background = this._colorOf(mode, 1);
    $(".paint").classList.toggle("off", !on);

    const a = Math.PI * (1 - t);
    const knob = $(".knob");
    knob.style.left = (160 + 140 * Math.cos(a) - 18).toFixed(1) + "px";
    knob.style.top = (160 - 140 * Math.sin(a) - 18).toFixed(1) + "px";
    knob.style.background = on ? cur : "#5a5a5e";
    knob.setAttribute("aria-label", white ? "Farbtemperatur" : "Farbton");

    const pwr = $(".pwr");
    pwr.classList.toggle("on", on);
    if (on) pwr.style.setProperty("--c", cur);

    const bar = $(".bar");
    if (!this._barTouched) this._glideBar(bri);
    bar.style.background = `linear-gradient(90deg, #2c2c2e, ${cur})`;
    bar.classList.toggle("off", !on);

    $(".scenebox").classList.toggle("hidden", !this._showScenes() && !this._nameOpen);
    this._renderAuto();
    this._renderChips(scenes, activeId);
  }

  // Helligkeitsregler und Prozentwert gleiten zum neuen Wert, im selben Takt wie der Ein/Aus-Schein.
  _glideBar(target) {
    const bar = this._$(".bar");
    const pct = this._$(".pct");
    const show = (v) => { bar.value = Math.max(1, v); pct.textContent = Math.round(v) + " %"; };
    if (this._barTarget === target) return;
    this._barTarget = target;
    cancelAnimationFrame(this._barAnim);
    const from = this._barShown;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (from === undefined || reduce || !this.isConnected) { this._barShown = target; show(target); return; }
    const t0 = performance.now(), dur = 400;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      this._barShown = from + (target - from) * e;
      show(this._barShown);
      if (p < 1) this._barAnim = requestAnimationFrame(step);
    };
    this._barAnim = requestAnimationFrame(step);
  }

  _renderChips(scenes, activeId) {
    const box = this._$(".chips");
    const sig = JSON.stringify([scenes.map((s) => [s.entity_id, s.attributes.friendly_name, this._sceneDot(s)]), activeId, this._prefs?.order]);
    if (sig === this._chipSig) return;
    this._chipSig = sig;
    box.innerHTML = "";
    for (const s of scenes) {
      const b = document.createElement("button");
      b.className = "chip" + (s.entity_id === activeId ? " act" : "");
      b.title = "Antippen: Szene aktivieren · Zahnrad: bearbeiten";
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = this._sceneDot(s);
      b.append(dot, document.createTextNode(this._label(s)));
      b.addEventListener("click", () => this._call("turn_on", { entity_id: s.entity_id }, "scene"));
      box.append(b);
    }
    const save = document.createElement("button");
    save.className = "save";
    save.innerHTML = ARC_ICONS.plus + "Speichern";
    save.addEventListener("click", () => this._openNameBar());
    box.append(save);
  }

  // ---------- Einstellungen (Zahnrad) ----------
  _renderSheet() {
    const $ = this._$;
    if (!$) return;
    const sheet = $(".sheet");
    sheet.classList.toggle("open", !!this._sheetOpen);
    if (!this._sheetOpen || !this._hass) return;
    $(".sh-title").textContent = "Einstellungen · " + this._cardName();
    const sw = $(".showsw");
    sw.classList.toggle("on", this._showScenes());
    sw.setAttribute("aria-checked", String(this._showScenes()));

    if (!this._rowDrag && !this._rowEditing) {
      const scenes = this._scenes();
      const sig = JSON.stringify([scenes.map((s) => [s.entity_id, s.attributes.friendly_name, this._sceneDot(s)]), this._rowState]);
      if (sig !== this._sheetSig) {
        this._sheetSig = sig;
        this._buildSceneRows(scenes);
      }
    }

    const box = $(".sh-autobox");
    const tmr = this._hass.states[this._timerId()];
    const autoSig = tmr ? "t" + this._timerMinutes() : "none";
    if (autoSig === this._autoSig) return;
    this._autoSig = autoSig;
    box.innerHTML = "";
    if (!tmr) {
      const hint = document.createElement("div");
      hint.className = "sh-hint";
      hint.textContent = "Für dieses Licht ist Auto-Aus noch nicht eingerichtet.";
      const b = document.createElement("button");
      b.className = "btn";
      b.textContent = "Auto-Aus einrichten";
      b.addEventListener("click", () => this._setupAutoOff());
      box.append(hint, b);
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "sh-auto";
    const inp = document.createElement("input");
    inp.type = "number";
    inp.min = "1";
    inp.max = "600";
    inp.value = String(this._timerMinutes());
    inp.addEventListener("change", () => this._setAutoMinutes(Number(inp.value)));
    wrap.append(document.createTextNode("Ausschalten nach"), inp, document.createTextNode("Minuten"));
    box.append(wrap);
  }

  _buildSceneRows(scenes) {
    const list = this._$(".sh-list");
    list.innerHTML = "";
    this._rowState = this._rowState || {};
    if (!scenes.length) {
      const empty = document.createElement("div");
      empty.className = "sh-hint";
      empty.textContent = "Noch keine Szenen. Stelle das Licht ein und tippe auf „Neue Szene aus aktuellem Licht“.";
      list.append(empty);
      return;
    }
    const iconBtn = (svg, title, fn, danger = false) => {
      const b = document.createElement("button");
      b.className = "icon" + (danger ? " danger" : "");
      b.title = title;
      b.setAttribute("aria-label", title);
      b.innerHTML = svg;
      b.addEventListener("click", fn);
      return b;
    };
    const run = async (fn) => {
      try { await fn(); } catch (err) { this._notify(err.body?.message || err.message || String(err), true, ".shmsg"); }
    };
    const setState = (id, v) => { this._rowState = { ...this._rowState, [id]: v }; if (!v) delete this._rowState[id]; this._sheetSig = null; this._renderSheet(); };

    scenes.forEach((s) => {
      const row = document.createElement("div");
      row.className = "sh-row";
      row.dataset.id = s.entity_id;
      const grip = document.createElement("span");
      grip.className = "grip";
      grip.title = "Ziehen zum Sortieren";
      grip.innerHTML = ARC_ICONS.grip;
      this._attachDrag(grip, row);
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = this._sceneDot(s);
      row.append(grip, dot);
      const mode = this._rowState[s.entity_id];
      const editable = !!s.attributes.id;

      if (mode === "rename") {
        const inp = document.createElement("input");
        inp.className = "rename";
        inp.value = this._label(s);
        const done = () => { this._rowEditing = false; run(async () => { await this._renameScene(s, inp.value); setState(s.entity_id, null); }); };
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") done();
          if (e.key === "Escape") { this._rowEditing = false; setState(s.entity_id, null); }
        });
        inp.addEventListener("focus", () => { this._rowEditing = true; });
        row.append(inp, iconBtn(ARC_ICONS.ok, "Speichern", done),
          iconBtn(ARC_ICONS.x, "Abbrechen", () => { this._rowEditing = false; setState(s.entity_id, null); }));
        setTimeout(() => { inp.focus(); inp.select(); }, 30);
      } else if (mode === "overwrite" || mode === "delete") {
        const ask = document.createElement("span");
        ask.className = "lbl ask";
        ask.textContent = mode === "delete" ? `„${this._label(s)}“ löschen?` : `„${this._label(s)}“ mit aktuellem Licht überschreiben?`;
        const yes = document.createElement("button");
        yes.className = "mini" + (mode === "delete" ? " danger" : "");
        yes.textContent = mode === "delete" ? "Löschen" : "Überschreiben";
        yes.addEventListener("click", () => run(async () => {
          if (mode === "delete") await this._deleteScene(s); else await this._overwriteScene(s);
          setState(s.entity_id, null);
        }));
        const no = document.createElement("button");
        no.className = "mini";
        no.textContent = "Abbrechen";
        no.addEventListener("click", () => setState(s.entity_id, null));
        row.append(ask, yes, no);
      } else {
        const lbl = document.createElement("span");
        lbl.className = "lbl";
        lbl.textContent = this._label(s);
        row.append(lbl);
        if (editable) {
          row.append(
            iconBtn(ARC_ICONS.edit, "Umbenennen", () => setState(s.entity_id, "rename")),
            iconBtn(ARC_ICONS.take, "Mit aktuellem Licht überschreiben", () => setState(s.entity_id, "overwrite")),
            iconBtn(ARC_ICONS.del, "Löschen", () => setState(s.entity_id, "delete"), true),
          );
        } else {
          const ro = document.createElement("span");
          ro.className = "sh-hint";
          ro.textContent = "YAML";
          ro.title = "In YAML definiert – nur dort änderbar";
          row.append(ro);
        }
      }
      list.append(row);
    });
  }

  _attachDrag(grip, row) {
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const list = this._$(".sh-list");
      const rows = [...list.querySelectorAll(".sh-row")];
      const from = rows.indexOf(row);
      if (from < 0) return;
      const step = row.offsetHeight + 6;
      this._rowDrag = { row, rows, from, to: from, startY: e.clientY, step };
      row.classList.add("dragging");
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    grip.addEventListener("pointermove", (e) => {
      const d = this._rowDrag;
      if (!d || d.row !== row) return;
      const dy = e.clientY - d.startY;
      const to = Math.max(0, Math.min(d.rows.length - 1, d.from + Math.round(dy / d.step)));
      d.to = to;
      row.style.transform = `translateY(${dy}px)`;
      d.rows.forEach((r, i) => {
        if (r === row) return;
        let shift = 0;
        if (to > d.from && i > d.from && i <= to) shift = -d.step;
        if (to < d.from && i < d.from && i >= to) shift = d.step;
        r.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    });
    const finish = () => {
      const d = this._rowDrag;
      if (!d || d.row !== row) return;
      this._rowDrag = null;
      d.rows.forEach((r) => { r.style.transform = ""; });
      row.classList.remove("dragging");
      if (d.to !== d.from) {
        const ids = d.rows.map((r) => r.dataset.id);
        const [moved] = ids.splice(d.from, 1);
        ids.splice(d.to, 0, moved);
        this._prefs = { ...(this._prefs || {}), order: ids };
        this._storePrefs();
        this._chipSig = null;
        this._sheetSig = null;
        this._render();
      }
      this._renderSheet();
    };
    grip.addEventListener("pointerup", finish);
    grip.addEventListener("pointercancel", finish);
  }
}

// ---------- Grafischer Editor fuer die Dashboard-Bearbeitung ----------
class ArcLightCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      const labels = { entity: "Licht", name: "Name (optional)", hue_end: "Ende des Farbbogens (Grad)", show_scenes: "Szenen-Leiste anzeigen" };
      this._form.computeLabel = (s) => labels[s.name] || s.name;
      this._form.computeHelper = (s) => ({
        hue_end: "320 = Rot bis Pink (Standard), 300 = Rot bis Magenta",
        name: "Szenen mit dem Namen „<Name> · <Szene>“ werden verkürzt angezeigt",
        show_scenes: "Standard für alle; jeder Benutzer kann es im Zahnrad-Menü der Kachel für sich ändern",
      })[s.name] || "";
      this._form.addEventListener("value-changed", (e) => {
        const cfg = { ...this._config, ...e.detail.value };
        for (const k of Object.keys(cfg)) if (cfg[k] === "" || cfg[k] == null) delete cfg[k];
        if (cfg.show_scenes === true) delete cfg.show_scenes;
        this._config = cfg;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: cfg }, bubbles: true, composed: true }));
      });
      const hint = document.createElement("p");
      hint.style.cssText = "color: var(--secondary-text-color); font-size: 13px; line-height: 1.4;";
      hint.textContent = "Szenen und Auto-Aus stellst du direkt in der Kachel über das Zahnrad ein. Die Kachel zeigt automatisch alle Home-Assistant-Szenen, die dieses Licht enthalten.";
      this.append(this._form, hint);
    }
    this._form.hass = this._hass;
    this._form.data = { show_scenes: true, ...this._config };
    this._form.schema = [
      { name: "entity", required: true, selector: { entity: { domain: "light" } } },
      { name: "name", selector: { text: {} } },
      { name: "hue_end", selector: { number: { min: 240, max: 359, step: 5, mode: "slider" } } },
      { name: "show_scenes", selector: { boolean: {} } },
    ];
  }
}

if (!customElements.get("arc-light-card-editor")) customElements.define("arc-light-card-editor", ArcLightCardEditor);
if (!customElements.get("arc-light-card")) customElements.define("arc-light-card", ArcLightCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "arc-light-card",
  name: "Farbbogen-Licht",
  description: "Halbkreis für Farbe oder Weiß, Ein/Aus mit Glow, Helligkeit, Auto-Aus und Home-Assistant-Szenen",
  preview: true,
});
console.info(`%c ARC-LIGHT-CARD %c ${ARC_VERSION} `, "background:#ff9f0a;color:#000;font-weight:600", "background:#2c2c2e;color:#fff");
