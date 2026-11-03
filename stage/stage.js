// Rendu des écrans de la vidéo. window.renderState(state) est appelé par le
// moteur (Playwright) pour chaque image, et par l'interface pour l'aperçu.

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp01 = t => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeBack = t => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };

const ICONS = {
  signal: c => `<svg width="17" height="11" viewBox="0 0 17 11"><g fill="${c}"><rect x="0" y="7" width="3" height="4" rx=".8"/><rect x="4.6" y="5" width="3" height="6" rx=".8"/><rect x="9.2" y="2.5" width="3" height="8.5" rx=".8"/><rect x="13.8" y="0" width="3" height="11" rx=".8"/></g></svg>`,
  wifi: c => `<svg width="15" height="11" viewBox="0 0 15 11"><g fill="${c}"><path d="M7.5 2.3c2.1 0 4 .8 5.4 2.1l1.1-1.1C12.3 1.6 10 .7 7.5.7S2.7 1.6 1 3.3l1.1 1.1C3.5 3.1 5.4 2.3 7.5 2.3z"/><path d="M7.5 5.4c1.2 0 2.3.5 3.2 1.2l1.1-1.1C10.6 4.4 9.1 3.8 7.5 3.8S4.4 4.4 3.2 5.5l1.1 1.1c.9-.7 2-1.2 3.2-1.2z"/><path d="M9.6 7.7 7.5 9.9 5.4 7.7c.6-.5 1.3-.8 2.1-.8s1.5.3 2.1.8z"/></g></svg>`,
  battery: c => `<svg width="26" height="12" viewBox="0 0 26 12"><rect x=".6" y=".6" width="22" height="10.8" rx="3.2" fill="none" stroke="${c}" stroke-opacity=".4" stroke-width="1.1"/><rect x="2.2" y="2.2" width="16" height="7.6" rx="1.8" fill="${c}"/><path d="M24 4.2v3.6c.8-.3 1.3-1 1.3-1.8s-.5-1.5-1.3-1.8z" fill="${c}" fill-opacity=".45"/></svg>`,
  back: c => `<svg width="13" height="22" viewBox="0 0 13 22"><path d="M11 2 2.5 11 11 20" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  facetime: c => `<svg width="26" height="17" viewBox="0 0 26 17"><rect x="1" y="1.5" width="16.5" height="14" rx="3.5" fill="none" stroke="${c}" stroke-width="1.9"/><path d="M19.2 6.4 24.4 3v11l-5.2-3.4z" fill="none" stroke="${c}" stroke-width="1.9" stroke-linejoin="round"/></svg>`,
  person: `<svg width="38" height="38" viewBox="0 0 38 38"><circle cx="19" cy="15" r="7" fill="#fff"/><path d="M5.5 34c1.8-7 7-10.5 13.5-10.5S30.7 27 32.5 34z" fill="#fff"/></svg>`,
  ghost: (s, c) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M12 2.5c-4.4 0-7.5 3.3-7.5 7.6v9.7c0 .9 1 1.3 1.6.7l1.4-1.3 1.6 1.4c.4.3.9.3 1.3 0L12 19.2l1.6 1.4c.4.3.9.3 1.3 0l1.6-1.4 1.4 1.3c.6.6 1.6.2 1.6-.7v-9.7c0-4.3-3.1-7.6-7.5-7.6z" fill="${c}"/><circle cx="9.3" cy="10.5" r="1.4" fill="#6d28d9"/><circle cx="14.7" cy="10.5" r="1.4" fill="#6d28d9"/></svg>`,
  arrowUp: `<svg width="18" height="18" viewBox="0 0 18 18"><path d="M9 15V3M3.5 8.5 9 3l5.5 5.5" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  shift: `<svg width="20" height="18" viewBox="0 0 20 18"><path d="M10 2 2 10h4.5v6h7v-6H18z" fill="none" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  del: `<svg width="24" height="18" viewBox="0 0 24 18"><path d="M8 2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8L1.5 9z" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/><path d="m11 6 6 6m0-6-6 6" stroke="#000" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  photo: `<svg width="14" height="14" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="9" cy="10" r="2" fill="currentColor"/><path d="m4 18 5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`,
  video: `<svg width="14" height="14" viewBox="0 0 24 24"><rect x="2.5" y="5" width="13" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="m16 10 5.5-3.5v11L16 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>`,
  bell: `<svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zm-2 15a2 2 0 0 0 4 0" fill="none" stroke="#7c3aed" stroke-width="2" stroke-linejoin="round"/></svg>`,
};

function statusBar(time, light) {
  const c = light ? "#fff" : "#000";
  return `<div class="statusbar ${light ? "light" : ""}">
    <span class="sb-time">${esc(time || "16:21")}</span><div class="island"></div>
    <div class="sb-icons">${ICONS.signal(c)}${ICONS.wifi(c)}${ICONS.battery(c)}</div></div>`;
}

// Barre d'état d'ancien iPhone (opérateur à gauche, heure au centre, batterie en %)
function classicStatusBar(c) {
  const dots = "●●●●○";
  const wifi = ICONS.wifi("#000").replace('width="15" height="11"', 'width="12" height="9"');
  return `<div class="statusbar classic">
    <span class="sb-left">${dots} ${esc(c.carrier ?? "F SFR")} ${wifi}</span>
    <span class="sb-center">${esc(c.time || "00:00")}</span>
    <span class="sb-right">${esc(c.battery ?? 76)} % ${ICONS.battery("#000").replace('width="26" height="12"', 'width="22" height="10"')}</span>
  </div>`;
}

/* ------------------------------ Accroche ------------------------------ */
function hookHTML(h) {
  // "outline" : texte blanc contouré (format Je fais croire) ; "box" : texte noir encadré de blanc (format POV)
  const text = !h.text ? "" : h.style === "box"
    ? `<div class="hook-box"><span>${esc(h.text)}</span></div>`
    : `<div class="hook-text">${esc(h.text)}</div>`;
  return `<div class="hook">
    ${h.image ? `<img src="${esc(h.image)}" style="transform:scale(${h.zoom || 1})">` : ""}
    ${text}
  </div>`;
}

/* ------------------------------ iMessage ------------------------------ */
function chatHTML(c) {
  const msgs = c.messages || [];
  const rows = [];
  const items = msgs.map(m => ({ ...m }));
  if (c.typing) items.push({ from: "them", type: "typing" });
  items.forEach((m, i) => {
    const prev = items[i - 1], next = items[i + 1];
    const gap = !prev ? "first" : prev.from === m.from ? "gap-small" : "gap-big";
    const isNew = i === items.length - 1 && (c.anim ?? 1) < 1;
    const tail = !next || next.from !== m.from;
    let inner;
    if (m.type === "image") inner = `<div class="photo"><img src="${esc(m.image)}"></div>`;
    else if (m.type === "sticker") inner = `<div class="sticker">${esc(m.text)}</div>`;
    else if (m.type === "typing") {
      const p = c.phase || 0;
      inner = `<div class="bubble them typing tail">${[0, 1, 2].map(k => `<span class="${k === p ? "on" : ""}"></span>`).join("")}</div>`;
    } else inner = `<div class="bubble ${m.from} ${tail ? "tail" : ""}">${esc(m.text)}</div>`;
    rows.push(`<div class="row ${m.from} ${gap} ${isNew ? "new" : ""}">${inner}</div>`);
  });
  const classic = c.style === "classic";
  return `<div class="chat ${classic ? "classic" : ""}" style="font-size:${c.textSize || 14}px">
    ${classic ? classicStatusBar(c) : statusBar(c.time)}
    <div class="chat-header">
      <div class="chat-back">${ICONS.back("#1a87ff")}</div>
      <div class="contact"><div class="avatar">${ICONS.person}</div>
        <div class="cname">${esc(c.contact)} <span class="chev">›</span></div></div>
      <div class="chat-facetime">${ICONS.facetime("#1a87ff")}</div>
    </div>
    <div class="chat-body"><div class="chat-scroll">${rows.join("")}</div></div>
  </div>`;
}

let typingRowHeight = null;
function measureTypingRow(scroll) {
  if (typingRowHeight !== null) return typingRowHeight;
  const probe = document.createElement("div");
  probe.className = "row them gap-big";
  probe.innerHTML = `<div class="bubble them typing tail"><span></span><span></span><span></span></div>`;
  scroll.appendChild(probe);
  typingRowHeight = probe.offsetHeight;
  probe.remove();
  return typingRowHeight;
}

// Mode « pages » : quand l'écran est plein, on repart d'un écran vide à partir du message qui déborde
function paginate(body, scroll) {
  const rows = [...scroll.querySelectorAll(".row")];
  const visible = body.clientHeight - 22;
  let start = 0, used = 0;
  rows.forEach((r, i) => {
    const h = r.offsetHeight;
    if (i > start && used + h > visible) { start = i; used = 0; }
    used += h;
  });
  rows.forEach((r, i) => { if (i < start) r.style.display = "none"; });
  if (rows[start]) { rows[start].classList.remove("gap-small", "gap-big"); rows[start].classList.add("first"); }
}

function layoutChat(root, c) {
  const body = root.querySelector(".chat-body");
  const scroll = root.querySelector(".chat-scroll");
  if (c.layout === "pages") paginate(body, scroll);
  const row = scroll.querySelector(".row.new");
  if (row) {
    const t = clamp01(c.anim ?? 1);
    const e = easeOut(t);
    const h = row.offsetHeight;
    const h0 = c.fromTyping ? Math.min(h, measureTypingRow(scroll)) : 0;
    row.style.height = `${lerp(h0, h, e)}px`;
    row.style.alignItems = "flex-start";
    const inner = row.firstElementChild;
    const me = row.classList.contains("me");
    inner.style.transformOrigin = me ? "100% 100%" : "0% 100%";
    inner.style.transform = `scale(${lerp(c.fromTyping ? 0.85 : 0.55, 1, easeBack(t))})`;
    inner.style.opacity = String(clamp01(t * 2.2));
  }
  const overflow = scroll.offsetHeight - body.clientHeight;
  scroll.style.transform = `translateY(${-Math.max(0, overflow)}px)`;
}

/* ---------------------------- Appli d'IA ----------------------------- */
const KB_ROWS = [
  "azertyuiop".split(""),
  "qsdfghjklm".split(""),
  ["shift", ..."wxcvbn'".split(""), "del"],
];

function keyboardHTML(typed, pressed) {
  const words = (typed || "").trim().split(/\s+/);
  const last = words[words.length - 1] || "Je";
  const sugg = [`« ${last} »`, "les", "et"];
  const key = k => {
    const p = pressed === k ? "pressed" : "";
    if (k === "shift") return `<div class="key dark wide">${ICONS.shift}</div>`;
    if (k === "del") return `<div class="key dark wide">${ICONS.del}</div>`;
    return `<div class="key letter ${p}" data-l="${esc(k)}">${esc(k)}</div>`;
  };
  return `<div class="kb">
    <div class="kb-sugg">${sugg.map(s => `<span>${esc(s)}</span>`).join("")}</div>
    ${KB_ROWS.map(r => `<div class="kb-row">${r.map(key).join("")}</div>`).join("")}
    <div class="kb-row">
      <div class="key dark num">123</div><div class="key dark num">🙂</div>
      <div class="key space ${pressed === "space" ? "pressed" : ""}">espace</div>
      <div class="key dark ret">retour</div>
    </div>
    <div class="kb-bottom"><div class="home-ind"></div></div>
  </div>`;
}

function appHTML(a) {
  const name = esc(a.appName || "Ora AI");
  const top = `${statusBar(a.time)}
    <div class="app-top"><div class="app-back">${ICONS.back("#111").replace('width="13" height="22"', 'width="9" height="15"')}</div>
      <div class="app-pill"><span class="logo">${ICONS.ghost(16, "#fff")}</span>${name}</div></div>`;

  if (a.mode === "generating") {
    const p = Math.round(a.progress || 0);
    return `<div class="app">${top}
      <div class="gen-card"><div class="bg" style="background-image:url('${esc(a.image)}')"></div>
        <div class="gen-center">
          <div class="gen-logo">${ICONS.ghost(46, "#e9e3ff")}</div>
          <div class="gen-name">${name}</div>
          <div class="gen-bar"><div class="gen-track"><div class="gen-fill" style="width:${p}%"></div></div></div>
          <div class="gen-label"><span>génère ton image</span><b>${p}%</b></div>
        </div></div>
      <div class="gen-note"><div class="ic">${ICONS.bell}</div>
        <div><b>Tu peux quitter cet écran</b><small>Ton image apparaîtra dans ta Galerie dès qu'elle sera prête.</small></div></div>
    </div>`;
  }

  if (a.mode === "result") {
    const r = clamp01(a.reveal ?? 1);
    return `<div class="app">${top}
      <div class="app-card result-card" style="bottom:112px">
        <img src="${esc(a.resultImage || a.image)}" style="filter:blur(${lerp(22, 0, easeOut(r))}px);transform:scale(${lerp(1.12, 1, easeOut(r))})">
        <div class="result-badge" style="opacity:${clamp01(r * 1.5 - 0.5)}">✨ Image générée</div>
      </div>
      <div class="result-actions"><div class="share">Partager</div><div class="save">Enregistrer</div></div>
    </div>`;
  }

  const typed = a.typed || "";
  const prompt = typed ? `${esc(typed)}<span class="caret"></span>` : `<span class="caret"></span><span class="ph">Décris ce que tu veux changer…</span>`;
  return `<div class="app">${top}
    <div class="app-card" style="height:128px"><img src="${esc(a.image)}"></div>
    <div class="app-panel" style="top:232px">
      <div class="seg"><span class="on">${ICONS.photo} Photo</span><span>${ICONS.video} Vidéo</span></div>
      <div class="prompt">${prompt}</div>
      <div class="panel-row"><span class="chip auto">◌ Auto</span><span class="chip pro">✦ Pro</span>
        <div class="send ${a.sendPressed ? "pressed" : ""}">${ICONS.arrowUp}</div></div>
    </div>
    ${keyboardHTML(typed, a.pressed)}
  </div>`;
}

/* ------------------------------ Entrée ------------------------------- */
async function waitImages(root) {
  const imgs = [...root.querySelectorAll("img")];
  await Promise.all(imgs.map(img => (img.complete && img.naturalWidth ? img.decode() : new Promise(res => {
    img.onload = () => img.decode().then(res, res);
    img.onerror = res;
  })).catch(() => {})));
  const bgs = [...root.querySelectorAll(".bg")].map(el => el.style.backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1]).filter(Boolean);
  await Promise.all(bgs.map(src => new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = src; })));
}

window.renderState = async function (s) {
  const root = document.getElementById("stage");
  if (s.scene === "hook") root.innerHTML = hookHTML(s.hook || {});
  else if (s.scene === "app") root.innerHTML = appHTML(s.app || {});
  else root.innerHTML = chatHTML(s.chat || {});
  await waitImages(root);
  if (s.scene === "chat") layoutChat(root, s.chat || {});
  return true;
};
