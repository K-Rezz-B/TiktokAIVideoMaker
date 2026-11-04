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
  renderBatch();
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

/* --------------------- Lot : idées -> prompt groupé -> photos ---------------------- */
let allIdeas = [];
let batch = JSON.parse(localStorage.getItem("batch") || "null") || { format: "story", ideaIds: [], projectIds: [] };
let uploadTarget = null;
const saveBatch = () => localStorage.setItem("batch", JSON.stringify(batch));

// Même ordre que la page Idées : tes idées d'abord, puis les plus vues
const ideaOrder = (a, b) => (a.views ? 1 : 0) - (b.views ? 1 : 0) || (b.views || 0) - (a.views || 0)
  || (b.created || "").localeCompare(a.created || "");

function candidates() {
  return allIdeas.filter(i => (i.format === "story" ? "story" : "prank") === batch.format && i.status === "todo")
    .sort(ideaOrder).slice(0, 40);
}

function renderBatch() {
  $("#batchFormat").value = batch.format;
  document.body.classList.toggle("batch-story", batch.format === "story");
  const list = candidates();
  const fmtViews = v => !v ? "ton idée" : v >= 1e6 ? `${(v / 1e6).toFixed(1).replace(".", ",")} M vues` : `${Math.round(v / 1e3)} k vues`;
  $("#batchIdeas").innerHTML = list.map(i => `
    <label class="check bi"><input type="checkbox" data-idea="${i.id}" ${batch.ideaIds.includes(i.id) ? "checked" : ""}>
      <span>${esc(i.text)}${i.character ? ` <small class="chip-who">${esc(i.character)}</small>` : ""}</span>
      <small class="muted">${fmtViews(i.views)}</small></label>`).join("")
    || `<p class="muted">Aucune idée « à faire » dans ce format : ajoute-en dans la page Idées.</p>`;
  const n = batch.ideaIds.length;
  $("#batchCopy").textContent = n ? `📋 Copier le prompt groupé (${n} idée${n > 1 ? "s" : ""})` : "📋 Copier le prompt groupé";

  const items = batch.projectIds.map(id => projects.find(p => p.id === id)).filter(Boolean);
  $("#batchPhotosStep").classList.toggle("hidden", !items.length);
  $("#batchPhotos").innerHTML = items.map(p => {
    const story = p.format === "story";
    const slot = (role, url, label) => `
      <div class="slot ${url ? "has" : ""}" data-pid="${p.id}" data-role="${role}" title="Glisse une image ou clique">
        ${url ? `<img src="${url}">` : `<span>${label}</span>`}
      </div>`;
    return `<div class="bp" data-pid="${p.id}">
      <div class="p-title">${esc(p.title)}</div>
      <div class="bp-state">${p.video ? `<span class="badge ok">🎬 Vidéo prête</span>`
        : p.problems.length ? `<span class="badge warn">⚠️ ${esc(p.problems.join(", "))}</span>` : `<span class="badge ready">✅ Prêt</span>`}</div>
      <div class="slots">
        ${story ? slot("source", p.source, "📷 Photo d'accroche")
                : slot("source", p.source, "📷 Photo originale") + slot("result", p.result, "✨ Photo modifiée")}
      </div>
      <div class="actions">
        ${!story ? `<button data-prompt="edit" ${p.has_edit_prompt ? "" : "disabled"}>📋 Consigne de retouche</button>` : ""}
        <button class="ghost" data-prompt="photo">📋 Prompt photo</button>
        <a class="button ghost" href="index.html?project=${encodeURIComponent(p.id)}">✏️</a>
      </div>
    </div>`;
  }).join("");
  const ready = items.filter(p => !p.problems.length && !p.video).length;
  $("#batchRender").textContent = ready ? `▶ Rendre les ${ready} vidéo${ready > 1 ? "s" : ""} prête${ready > 1 ? "s" : ""}` : "▶ Rendre les vidéos du lot";
  $("#batchRender").disabled = !ready || job?.status === "running";
}

async function uploadPhoto(pid, role, file) {
  const targets = [pid];
  const p = projects.find(x => x.id === pid);
  if (role === "source" && p?.format === "story" && $("#sameHook").checked) {
    batch.projectIds.forEach(id => { const q = projects.find(x => x.id === id); if (q && q.format === "story" && id !== pid) targets.push(id); });
  }
  for (const id of targets) {
    const fd = new FormData();
    fd.append("file", file, file.name || "photo.png");
    const r = await fetch(`/api/projects/${id}/images/upload?role=${role}`, { method: "POST", body: fd });
    if (!r.ok) { toast((await r.json()).detail || "Échec de l'import", true); return; }
  }
  toast(targets.length > 1 ? `📷 Photo ajoutée à ${targets.length} vidéos` : "📷 Photo ajoutée");
  await load();
}

function bindBatch() {
  $("#batchFormat").addEventListener("change", e => { batch.format = e.target.value; batch.ideaIds = []; saveBatch(); renderBatch(); });
  $("#batchIdeas").addEventListener("change", e => {
    const id = e.target.dataset.idea;
    if (!id) return;
    batch.ideaIds = e.target.checked ? [...batch.ideaIds, id] : batch.ideaIds.filter(x => x !== id);
    saveBatch(); renderBatch();
  });
  $("#batchPick").addEventListener("click", () => {
    const n = Math.max(1, Math.min(10, +$("#batchCount").value || 5));
    batch.ideaIds = candidates().slice(0, n).map(i => i.id);
    saveBatch(); renderBatch();
  });
  $("#batchCopy").addEventListener("click", async () => {
    if (!batch.ideaIds.length) return toast("Coche d'abord les idées du lot.", true);
    try {
      const { prompt } = await api("POST", "/api/series/batch-prompt", { idea_ids: orderedIdeas(), format: batch.format });
      await copy(prompt);
      toast(`📋 Prompt copié pour ${batch.ideaIds.length} vidéos — colle-le dans Gemini`);
    } catch (err) { toast(err.message, true); }
  });
  $("#batchImport").addEventListener("click", async () => {
    const text = $("#batchPaste").value.trim();
    if (!text) return toast("Colle d'abord la réponse de Gemini.", true);
    try {
      const r = await api("POST", "/api/series/batch-import", { idea_ids: orderedIdeas(), format: batch.format, text });
      batch.projectIds = [...new Set([...r.project_ids, ...batch.projectIds])];
      batch.ideaIds = [];
      saveBatch();
      $("#batchPaste").value = "";
      allIdeas = await api("GET", "/api/ideas");
      await load();
      toast(r.scripts < r.ideas ? `⚠️ ${r.scripts} scripts reçus pour ${r.ideas} idées : ${r.project_ids.length} projets créés`
                                : `📝 ${r.project_ids.length} projets créés — ajoute les photos`);
      $("#batchPhotosStep").scrollIntoView({ behavior: "smooth" });
    } catch (err) { toast(err.message, true); }
  });

  // Cadres photo : clic ou glisser-déposer
  $("#batchPhotos").addEventListener("click", async e => {
    const slot = e.target.closest(".slot");
    if (slot) { uploadTarget = slot.dataset; $("#fileInput").click(); return; }
    const btn = e.target.closest("[data-prompt]");
    if (!btn) return;
    const pid = btn.closest(".bp").dataset.pid;
    const prompts = await api("GET", `/api/projects/${pid}/prompts`);
    const text = prompts[btn.dataset.prompt];
    if (!text) return toast("Rien à copier pour ce projet (consigne vide).", true);
    await copy(text);
    toast(btn.dataset.prompt === "edit" ? "📋 Consigne copiée — joins la photo originale dans Gemini" : "📋 Prompt photo copié");
  });
  $("#fileInput").addEventListener("change", e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file && uploadTarget) uploadPhoto(uploadTarget.pid, uploadTarget.role, file);
  });
  $("#batchPhotos").addEventListener("dragover", e => { const s = e.target.closest(".slot"); if (s) { e.preventDefault(); s.classList.add("over"); } });
  $("#batchPhotos").addEventListener("dragleave", e => e.target.closest(".slot")?.classList.remove("over"));
  $("#batchPhotos").addEventListener("drop", e => {
    const s = e.target.closest(".slot");
    if (!s) return;
    e.preventDefault();
    s.classList.remove("over");
    const file = [...e.dataTransfer.files].find(f => f.type.startsWith("image/"));
    if (file) uploadPhoto(s.dataset.pid, s.dataset.role, file);
  });

  $("#batchRender").addEventListener("click", async () => {
    const ids = batch.projectIds.filter(id => { const p = projects.find(x => x.id === id); return p && !p.problems.length && !p.video; });
    try {
      job = await api("POST", "/api/series/render", { ids });
      toast(`▶ Rendu de ${ids.length} vidéo(s) lancé`);
      poll();
    } catch (err) { toast(err.message, true); }
  });
  $("#batchClear").addEventListener("click", () => { batch.projectIds = []; batch.ideaIds = []; saveBatch(); renderBatch(); });
}

// Les idées cochées, dans l'ordre d'affichage (= l'ordre des scripts demandés à Gemini)
function orderedIdeas() {
  const order = candidates().map(i => i.id);
  return [...batch.ideaIds].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/* ------------------------------ Données ----------------------------- */
async function load() {
  projects = await api("GET", "/api/series");
  const ids = new Set(projects.map(p => p.id));
  for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);
  batch.projectIds = batch.projectIds.filter(id => ids.has(id));
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
bindBatch();
api("GET", "/api/ideas").then(list => { allIdeas = list; }).then(load).then(poll);
