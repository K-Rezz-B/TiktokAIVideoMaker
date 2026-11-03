// Page « Série » : rendu de plusieurs vidéos à la suite + kit de publication.
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let projects = [];
let job = null;
const selected = new Set();
let polling = null;

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
  const r = await fetch(url, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return r.json();
}

function toast(msg, error = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast ${error ? "error" : ""}`;
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), error ? 6000 : 2500);
}

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const FORMATS = { prank: "⚡ Je fais croire", story: "💬 POV" };

function slug(s) {
  return (s || "video").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "video";
}

// Légende TikTok / Instagram : le titre généré (avec hashtags), sinon l'accroche
function caption(p) {
  let c = (p.youtube_title || p.hook_text || p.title || "").trim();
  if (!c.includes("#")) c += " #sms #message #humour";
  return c;
}

// Titre YouTube Shorts : 100 caractères max, avec #shorts
function ytTitle(p) {
  let t = caption(p);
  if (!/#shorts/i.test(t)) t = `${t} #shorts`;
  while (t.length > 100 && t.includes(" #")) t = t.replace(/\s#[^\s#]+(?=[^#]*$)/, "").trim();  // retire les derniers hashtags
  if (!/#shorts/i.test(t) && t.length <= 92) t += " #shorts";
  return t.slice(0, 100);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
}

/* ------------------------------ Rendu ------------------------------ */
function itemOf(id) { return job?.items?.find(i => i.id === id); }

function stateHTML(p) {
  const it = itemOf(p.id);
  if (it && job.status === "running" || it && ["error", "cancelled"].includes(it.status)) {
    if (it.status === "waiting") return `<span class="badge wait">⏳ En attente</span>`;
    if (it.status === "running") return `<div class="mini-bar"><div style="width:${it.progress}%"></div></div><small class="muted">${esc(it.message)}</small>`;
    if (it.status === "error") return `<span class="badge bad">❌ ${esc(it.error)}</span>`;
    if (it.status === "cancelled") return `<span class="badge wait">Annulée</span>`;
  }
  if (p.video) return `<span class="badge ok">🎬 Vidéo prête</span>`;
  if (p.problems.length) return `<span class="badge warn">⚠️ À compléter : ${esc(p.problems.join(", "))}</span>`;
  return `<span class="badge ready">✅ Prêt à rendre</span>`;
}

function render() {
  const hideDone = $("#hideDone").checked;
  const running = job?.status === "running";
  const list = projects.filter(p => !hideDone || !p.video);
  $("#rows").innerHTML = list.map(p => `
    <tr class="${p.problems.length ? "blocked" : ""}">
      <td><input type="checkbox" data-id="${p.id}" ${selected.has(p.id) ? "checked" : ""} ${p.problems.length || running ? "disabled" : ""}></td>
      <td><div class="p-title">${esc(p.title)}</div>
          <span class="chip-fmt ${p.format === "story" ? "story" : "prank"}">${FORMATS[p.format] || FORMATS.prank}</span>
          <small class="muted">${p.messages} messages</small></td>
      <td class="state">${stateHTML(p)}</td>
      <td class="right"><a class="button ghost" href="index.html?project=${encodeURIComponent(p.id)}">✏️ Ouvrir</a></td>
    </tr>`).join("") || `<tr><td colspan="4" class="muted">Aucun projet.</td></tr>`;

  const n = selected.size;
  $("#start").textContent = n ? `▶ Lancer la série (${n} vidéo${n > 1 ? "s" : ""}, ≈ ${Math.ceil(n * 1.5)} min)` : "▶ Lancer la série";
  $("#start").disabled = !n || running;
  $("#selectReady").disabled = running;
  $("#cancel").classList.toggle("hidden", !running);
  const ready = projects.filter(p => !p.problems.length && !p.video).length;
  $("#summary").textContent = `${projects.length} projets · ${ready} prêts · ${projects.filter(p => p.video).length} vidéos`;

  if (job && job.id) {
    $("#overall").classList.remove("hidden");
    $("#overallFill").style.width = `${job.progress || 0}%`;
    $("#overallMsg").textContent = job.status === "error" ? job.error : job.message;
  }
  renderKits();
}

function renderKits() {
  const withVideo = projects.filter(p => p.video).sort((a, b) => (b.video || "").localeCompare(a.video || ""));
  $("#kits").innerHTML = withVideo.map(p => `
    <div class="kit" data-id="${p.id}">
      <video src="${p.video}#t=0.5" preload="metadata" controls playsinline></video>
      <div class="kit-body">
        <div class="p-title">${esc(p.title)}</div>
        <label>Légende TikTok / Instagram<textarea readonly rows="3">${esc(caption(p))}</textarea></label>
        <label>Titre YouTube Shorts <small class="muted">(${ytTitle(p).length}/100)</small><input readonly value="${esc(ytTitle(p))}"></label>
        <div class="actions">
          <button data-copy="caption">📋 Copier la légende</button>
          <button data-copy="yt">📋 Copier le titre YouTube</button>
          <a class="button primary" href="${p.video}" download="${slug(p.title)}.mp4">⬇️ Télécharger</a>
        </div>
      </div>
    </div>`).join("") || `<p class="muted">Aucune vidéo pour l'instant : lance une série ci-dessus.</p>`;
}

/* ------------------------------ Données ----------------------------- */
async function load() {
  projects = await api("GET", "/api/series");
  const ids = new Set(projects.map(p => p.id));
  for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
  render();
}

async function poll() {
  const wasRunning = job?.status === "running";
  job = await api("GET", "/api/series/job");
  if (!job.id) { job = null; return; }
  if (job.status === "running") {
    render();
    clearTimeout(polling);
    polling = setTimeout(poll, 1500);
  } else {
    await load();  // rafraîchit les vidéos produites
    if (wasRunning) toast(`🎉 ${job.message}`);
  }
}

function bind() {
  $("#rows").addEventListener("change", e => {
    const id = e.target.dataset.id;
    if (!id) return;
    e.target.checked ? selected.add(id) : selected.delete(id);
    render();
  });
  $("#hideDone").addEventListener("change", render);
  $("#selectReady").addEventListener("click", () => {
    projects.filter(p => !p.problems.length && !p.video).forEach(p => selected.add(p.id));
    render();
    if (!selected.size) toast("Aucun projet prêt sans vidéo.");
  });
  $("#selectNone").addEventListener("click", () => { selected.clear(); render(); });
  $("#start").addEventListener("click", async () => {
    // garde l'ordre d'affichage
    const ids = projects.filter(p => selected.has(p.id)).map(p => p.id);
    try {
      job = await api("POST", "/api/series/render", { ids });
      selected.clear();
      toast("▶ Série lancée");
      poll();
    } catch (err) { toast(err.message, true); }
  });
  $("#cancel").addEventListener("click", async () => {
    await api("POST", "/api/series/cancel");
    toast("La série s'arrêtera après la vidéo en cours");
  });
  $("#kits").addEventListener("click", async e => {
    const btn = e.target.closest("[data-copy]");
    if (!btn) return;
    const p = projects.find(x => x.id === btn.closest(".kit").dataset.id);
    await copy(btn.dataset.copy === "yt" ? ytTitle(p) : caption(p));
    toast("📋 Copié");
  });
}

bind();
load().then(poll);
