// Interface de TiktokMaker (vanilla JS, aucune compilation).
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let project = null;
let voices = [];
let previewScene = "chat";
let previewIndex = null; // message sélectionné dans l'aperçu (null = tous)
let busy = false;
let saveTimer = null;
let uploadRole = "";

/* ------------------------------ Utilitaires ------------------------------ */
async function api(method, url, body, isForm) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    if (isForm) opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
  }
  const r = await fetch(url, opts);
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  const type = r.headers.get("content-type") || "";
  return type.includes("json") ? r.json() : r.blob();
}

function toast(msg, error = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast ${error ? "error" : ""}`;
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add("hidden"), error ? 7000 : 3000);
}

const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
}

function imageUrl(ref) {
  if (!project || !ref) return "";
  if (ref === "@source") ref = project.ai_app.source_image;
  if (ref === "@result") ref = project.ai_app.result_image;
  const img = project.images.find(i => i.id === ref);
  return img ? `/files/${project.id}/images/${img.file}` : "";
}

function imageOptions() {
  return [
    { v: "@result", l: "✨ Photo modifiée" },
    { v: "@source", l: "📷 Photo originale" },
    ...project.images.map(i => ({ v: i.id, l: `🖼 ${i.name}` })),
  ];
}

async function withBusy(label, fn) {
  if (busy) return toast("Une opération est déjà en cours…");
  busy = true;
  document.body.classList.add("busy");
  showJob(5, label);
  try { return await fn(); }
  catch (e) { toast(e.message, true); }
  finally {
    busy = false;
    document.body.classList.remove("busy");
    $("#job").classList.add("hidden");
  }
}

function showJob(pct, msg) {
  $("#job").classList.remove("hidden");
  $("#jobFill").style.width = `${pct}%`;
  $("#jobMsg").textContent = msg;
}

/* ------------------------------ Sauvegarde ------------------------------- */
function scheduleSave() {
  $("#saveState").textContent = "Modifications…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (!project) return;
  try {
    await api("PUT", `/api/projects/${project.id}`, project);
    $("#saveState").textContent = "✓ Enregistré";
    refreshProjectList(false);
  } catch (e) { $("#saveState").textContent = "⚠ Non enregistré"; toast(e.message, true); }
}

/* ------------------------------ Projets ---------------------------------- */
async function refreshProjectList(selectCurrent = true) {
  const list = await api("GET", "/api/projects");
  const sel = $("#projectSelect");
  sel.innerHTML = list.map(p => `<option value="${p.id}">${escapeHtml(p.title || p.id)}</option>`).join("");
  if (project) sel.value = project.id;
  return list;
}

async function openProject(id) {
  project = await api("GET", `/api/projects/${id}`);
  localStorage.setItem("lastProject", id);
  previewIndex = null;
  renderAll();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/* ------------------------------ Formats ---------------------------------- */
// Même réglages par défaut que FORMAT_DEFAULTS dans tiktokmaker/projects.py
const FORMAT_DEFAULTS = {
  prank: { hook: { style: "outline", zoom: true, image: "@result" },
           chat: { style: "modern", layout: "scroll", time: "16:21", text_size: 13.5 }, ai_app: { enabled: true } },
  story: { hook: { style: "box", zoom: false, image: "@source" },
           chat: { style: "classic", layout: "pages", time: "00:00", text_size: 15.5 }, ai_app: { enabled: false },
           voices: { narrator: "fr-FR-DeniseNeural", me: "fr-FR-DeniseNeural", them: "fr-FR-HenriNeural" } },
};

function setFormat(fmt) {
  if (project.format === fmt) return;
  project.format = fmt;
  for (const [section, values] of Object.entries(FORMAT_DEFAULTS[fmt])) Object.assign(project[section], values);
  previewScene = fmt === "story" ? "hook" : "chat";
  renderAll();
  scheduleSave();
}

function updateFormatUI() {
  const story = project.format === "story";
  document.body.classList.toggle("fmt-story", story);
  document.body.classList.toggle("fmt-prank", !story);
  document.body.classList.toggle("chat-classic", project.chat.style === "classic");
  $$("#formatPicker button").forEach(b => b.classList.toggle("on", b.dataset.format === (project.format || "prank")));
  if (story && (previewScene === "app" || previewScene === "gen")) previewScene = "hook";
}

/* ------------------------------ Rendu UI --------------------------------- */
function renderAll() {
  updateFormatUI();
  $$("[data-images]").forEach(sel => {
    sel.innerHTML = imageOptions().map(o => `<option value="${o.v}">${escapeHtml(o.l)}</option>`).join("");
  });
  fillVoiceSelects();
  $$("[data-path]").forEach(el => {
    const v = getPath(project, el.dataset.path);
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v ?? "";
  });
  updateShownValues();
  renderThumbs();
  renderGallery();
  renderMessages();
  $("#musicName").textContent = project.audio.music ? `🎵 ${project.audio.music_name || project.audio.music}` : "Aucune";
  if (project.output) showResult(`/files/${project.id}/${project.output}`);
  else $("#result").classList.add("hidden");
  $("#projectSelect").value = project.id;
  updatePreview();
}

function updateShownValues() {
  $$("[data-show]").forEach(el => {
    const v = getPath(project, el.dataset.show);
    el.textContent = el.dataset.show === "voices.rate" ? `${v > 0 ? "+" : ""}${v}%`
      : el.dataset.show === "pace" ? `×${Number(v).toFixed(1)}` : `${Math.round(v * 100)}%`;
  });
}

function renderThumbs() {
  const slot = (id, ref, label) => {
    const url = imageUrl(ref);
    $(id).innerHTML = url ? `<img src="${url}">` : `<span>${label}</span>`;
  };
  slot("#thumbSource", "@source", "Aucune photo");
  slot("#thumbResult", "@result", "Pas encore générée");
}

function renderGallery() {
  $("#gallery").innerHTML = project.images.map(i => `
    <div class="gitem">
      <img src="/files/${project.id}/images/${i.file}" title="${escapeHtml(i.prompt || "")}">
      <input value="${escapeHtml(i.name)}" disabled>
      <div class="gactions">
        <button class="ghost" data-role="source" data-img="${i.id}" title="Utiliser comme photo originale">📷</button>
        <button class="ghost" data-role="result" data-img="${i.id}" title="Utiliser comme photo modifiée">✨</button>
        <button class="ghost danger" data-delimg="${i.id}" title="Supprimer">🗑</button>
      </div>
    </div>`).join("") || `<p class="muted">Aucune image pour l'instant.</p>`;
}

function renderMessages() {
  const msgs = project.chat.messages;
  const opts = imageOptions();
  $("#messages").innerHTML = msgs.map((m, i) => `
    <div class="msg ${m.from} ${previewIndex === i ? "selected" : ""}" data-i="${i}">
      <button class="who" data-act="who" title="Changer l'expéditeur">${m.from === "me" ? "Moi" : "Lui"}</button>
      ${m.type === "image"
        ? `<select data-field="image">${opts.map(o => `<option value="${o.v}" ${o.v === m.image ? "selected" : ""}>${escapeHtml(o.l)}</option>`).join("")}</select>`
        : m.type === "sticker"
        ? `<input data-field="text" class="sticker-input" value="${escapeHtml(m.text)}" placeholder="Émoji(s) envoyés en grand : 😭🤡">`
        : `<textarea data-field="text" rows="1">${escapeHtml(m.text)}</textarea>`}
      ${m.type === "image" || m.type === "sticker" ? `<span class="spk"></span>` :
        `<label class="spk" title="Lire à voix haute"><input type="checkbox" data-field="speak" ${m.speak !== false ? "checked" : ""}>🔊</label>`}
      <button class="ghost" data-act="up" title="Monter">↑</button>
      <button class="ghost" data-act="down" title="Descendre">↓</button>
      <button class="ghost" data-act="insert" title="Insérer un message en dessous">＋</button>
      <button class="ghost danger" data-act="del" title="Supprimer">✕</button>
    </div>`).join("") || `<p class="muted">Aucun message. Génère le script ou ajoute des messages.</p>`;
  $$("#messages textarea").forEach(autoGrow);
}

function autoGrow(el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }

/* ------------------------------ Voix ------------------------------------- */
async function loadVoices() {
  try { voices = await api("GET", `/api/voices?provider=${project?.voices.provider || "edge"}`); }
  catch (e) { voices = []; toast(e.message, true); }
  fillVoiceSelects();
}

function fillVoiceSelects() {
  if (!project) return;
  const all = $("#allLocales").checked || project.voices.provider === "elevenlabs";
  const list = voices.filter(v => all || v.locale.startsWith("fr"));
  $$("[data-voices]").forEach(sel => {
    const cur = getPath(project, sel.dataset.path);
    const opts = list.map(v => `<option value="${v.id}">${escapeHtml(v.name)} — ${v.locale} ${v.gender === "Male" ? "♂" : v.gender === "Female" ? "♀" : ""}</option>`);
    if (cur && !list.some(v => v.id === cur)) opts.unshift(`<option value="${cur}">${escapeHtml(cur)}</option>`);
    sel.innerHTML = opts.join("");
    sel.value = cur || "";
  });
}

async function testVoice(who) {
  const sample = who === "narrator" ? (project.hook.text || "Je fais croire à mon père que…")
    : (project.chat.messages.find(m => m.from === who && m.type !== "image")?.text || "Salut, ça va ?");
  try {
    const blob = await api("POST", "/api/tts/preview", {
      text: sample, voice: project.voices[who], provider: project.voices.provider, rate: Number(project.voices.rate) || 0,
    });
    new Audio(URL.createObjectURL(blob)).play();
  } catch (e) { toast(e.message, true); }
}

/* ------------------------------ Aperçu ----------------------------------- */
function previewState() {
  const c = project.chat;
  if (previewScene === "hook") {
    return { scene: "hook", hook: { image: imageUrl(project.hook.image || "@result"), text: project.hook.text, zoom: 1,
                                    style: project.hook.style } };
  }
  if (previewScene === "app" || previewScene === "gen") {
    const a = project.ai_app;
    return { scene: "app", app: {
      appName: a.app_name, image: imageUrl("@source"), resultImage: imageUrl("@result"),
      mode: previewScene === "gen" ? "generating" : "prompt", typed: a.prompt_text, progress: 42, reveal: 1,
    } };
  }
  const end = previewIndex === null ? c.messages.length : previewIndex + 1;
  const msgs = c.messages.slice(0, end)
    .filter(m => m.type === "image" || (m.text || "").trim())
    .map(m => m.type === "image" ? { from: m.from, type: "image", image: imageUrl(m.image) }
      : { from: m.from, type: m.type === "sticker" ? "sticker" : "text", text: m.text });
  return { scene: "chat", chat: { contact: c.contact_name, time: c.time, textSize: c.text_size, messages: msgs, anim: 1,
                                  style: c.style, layout: c.layout, carrier: c.carrier, battery: c.battery } };
}

let previewQueued = false;
function updatePreview() {
  if (previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    const win = $("#stage").contentWindow;
    if (project && win && win.renderState) win.renderState(previewState());
  });
  $$("#previewTabs button").forEach(b => b.classList.toggle("on", b.dataset.scene === previewScene));
}

/* ------------------------------ Vidéo ------------------------------------ */
function showResult(url) {
  $("#result").classList.remove("hidden");
  const v = $("#video");
  const full = `${url}?t=${Date.now()}`;
  if (!v.src.includes(url)) v.src = full;
  $("#download").href = url;
  $("#download").setAttribute("download", url.split("/").pop());
}

async function runJob(url, body) {
  await saveNow();
  return withBusy("Démarrage…", async () => {
    let job = await api("POST", url, body);
    while (job.status === "running") {
      showJob(job.progress, job.message);
      await new Promise(r => setTimeout(r, 700));
      job = await api("GET", `/api/jobs/${job.id}`);
    }
    await openProject(project.id);
    if (job.status === "error") throw new Error(job.error);
    if (job.result?.video) { showResult(job.result.video); toast("🎉 Vidéo prête !"); $("#video").play().catch(() => {}); }
    else toast("✓ Terminé");
  });
}

/* ------------------------------ Événements ------------------------------- */
function bindEvents() {
  document.addEventListener("input", e => {
    const el = e.target;
    if (!project) return;
    if (el.dataset.path) {
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (el.type === "range" || el.type === "number") v = Number(v);
      setPath(project, el.dataset.path, v);
      if (el.dataset.path === "hook.text") previewScene = "hook";
      if (el.dataset.path.startsWith("ai_app.prompt") || el.dataset.path === "ai_app.app_name") previewScene = "app";
      if (el.dataset.path.startsWith("chat.")) previewScene = "chat";
      if (el.dataset.path === "hook.style") previewScene = "hook";
      updateFormatUI();
      updateShownValues();
      scheduleSave();
      updatePreview();
    }
    const row = el.closest(".msg");
    if (row && el.dataset.field) {
      const m = project.chat.messages[+row.dataset.i];
      m[el.dataset.field] = el.type === "checkbox" ? el.checked : el.value;
      if (el.tagName === "TEXTAREA") autoGrow(el);
      previewScene = "chat";
      previewIndex = +row.dataset.i;
      scheduleSave();
      updatePreview();
    }
  });

  document.addEventListener("change", e => {
    if (e.target.dataset.path === "voices.provider") loadVoices();
    if (e.target.id === "allLocales") fillVoiceSelects();
  });

  $("#messages").addEventListener("click", e => {
    const row = e.target.closest(".msg");
    if (!row) return;
    const i = +row.dataset.i;
    const msgs = project.chat.messages;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "who") msgs[i].from = msgs[i].from === "me" ? "them" : "me";
    else if (act === "up" && i > 0) [msgs[i - 1], msgs[i]] = [msgs[i], msgs[i - 1]];
    else if (act === "down" && i < msgs.length - 1) [msgs[i + 1], msgs[i]] = [msgs[i], msgs[i + 1]];
    else if (act === "insert") msgs.splice(i + 1, 0, { from: msgs[i].from === "me" ? "them" : "me", type: "text", text: "", speak: true });
    else if (act === "del") { msgs.splice(i, 1); previewIndex = null; }
    previewScene = "chat";
    if (act !== "del") previewIndex = act === "insert" ? i + 1 : i;
    if (act) { renderMessages(); scheduleSave(); }
    else $$(".msg").forEach(r => r.classList.toggle("selected", r === row));
    updatePreview();
  });

  $$("[data-add]").forEach(b => b.addEventListener("click", () => {
    const kind = b.dataset.add;
    const last = project.chat.messages[project.chat.messages.length - 1];
    project.chat.messages.push(kind === "image"
      ? { from: "me", type: "image", image: project.format === "story" ? "@source" : "@result", text: "", speak: false }
      : kind === "sticker"
      ? { from: last?.from === "me" ? "them" : "me", type: "sticker", text: "😭", speak: false }
      : { from: kind, type: "text", text: "", speak: true });
    previewIndex = null;
    previewScene = "chat";
    renderMessages();
    scheduleSave();
    updatePreview();
    $$("#messages textarea").pop()?.focus();
  }));

  $$("#previewTabs button").forEach(b => b.addEventListener("click", () => {
    previewScene = b.dataset.scene;
    if (previewScene === "chat") previewIndex = null;
    updatePreview();
  }));

  $("#stage").addEventListener("load", updatePreview);
  $$("#formatPicker button").forEach(b => b.addEventListener("click", () => setFormat(b.dataset.format)));

  // Projets
  $("#projectSelect").addEventListener("change", async e => { await saveNow(); openProject(e.target.value); });
  $("#newProject").addEventListener("click", async () => {
    await saveNow();
    const p = await api("POST", "/api/projects");
    await openProject(p.id);
    await refreshProjectList();
  });
  $("#deleteProject").addEventListener("click", async () => {
    if (!confirm(`Supprimer définitivement le projet « ${project.title} » et ses fichiers ?`)) return;
    await api("DELETE", `/api/projects/${project.id}`);
    project = null;
    const list = await refreshProjectList();
    if (list.length) openProject(list[0].id);
    else { const p = await api("POST", "/api/projects"); await openProject(p.id); refreshProjectList(); }
  });

  // Images
  document.addEventListener("click", async e => {
    const up = e.target.closest("[data-upload]");
    if (up) { uploadRole = up.dataset.upload; $("#fileInput").click(); }
    const role = e.target.closest("[data-role]");
    if (role) {
      project.ai_app[role.dataset.role === "source" ? "source_image" : "result_image"] = role.dataset.img;
      renderThumbs(); scheduleSave(); updatePreview();
      toast("Image assignée");
    }
    const del = e.target.closest("[data-delimg]");
    if (del && confirm("Supprimer cette image ?")) {
      await saveNow();
      project = await api("DELETE", `/api/projects/${project.id}/images/${del.dataset.delimg}`);
      renderAll();
    }
    const test = e.target.closest("[data-test]");
    if (test) testVoice(test.dataset.test);
    if (e.target.closest("[data-upload-music]")) $("#musicInput").click();
  });

  $("#fileInput").addEventListener("change", e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) uploadImage(file, uploadRole);
  });

  $("#musicInput").addEventListener("change", async e => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    await saveNow();
    const fd = new FormData();
    fd.append("file", file);
    await withBusy("Import de la musique…", async () => {
      project = await api("POST", `/api/projects/${project.id}/music`, fd, true);
      renderAll();
    });
  });
  $("#removeMusic").addEventListener("click", async () => {
    await saveNow();
    project = await api("DELETE", `/api/projects/${project.id}/music`);
    renderAll();
  });

  $("#genSource").addEventListener("click", async () => {
    const prompt = project.ai_app.photo_prompt || project.idea;
    if (!prompt) return toast("Décris la photo à générer (ou l'idée).", true);
    await saveNow();
    await withBusy("Gemini génère la photo originale…", async () => {
      const story = project.format === "story";
      project = await api("POST", `/api/projects/${project.id}/images/generate`,
        { prompt, name: story ? "Photo d'accroche" : "Photo originale", role: "source" });
      previewScene = story ? "hook" : "app"; renderAll();
    });
  });

  $("#genResult").addEventListener("click", async () => {
    if (!project.ai_app.source_image) return toast("Il faut d'abord une photo originale.", true);
    const prompt = project.ai_app.edit_prompt;
    if (!prompt) return toast("Écris l'instruction de retouche (ou génère le script).", true);
    await saveNow();
    await withBusy("Gemini retouche la photo…", async () => {
      project = await api("POST", `/api/projects/${project.id}/images/generate`,
        { prompt, source: project.ai_app.source_image, name: "Photo modifiée", role: "result" });
      previewScene = "hook"; renderAll();
    });
  });

  $("#genScript").addEventListener("click", async () => {
    if (!project.idea.trim()) return toast("Écris d'abord l'idée de la blague.", true);
    await saveNow();
    await withBusy("Gemini écrit le script…", async () => {
      project = await api("POST", `/api/projects/${project.id}/script`, { idea: project.idea, character: project.character });
      previewScene = "chat"; previewIndex = null; renderAll();
      toast("📝 Script généré — relis-le et ajuste si besoin");
    });
  });

  $("#autoAll").addEventListener("click", () => {
    if (!project.idea.trim()) return toast("Écris d'abord l'idée de la blague.", true);
    runJob(`/api/projects/${project.id}/auto`, { idea: project.idea, character: project.character, render: true });
  });

  $("#render").addEventListener("click", () => runJob(`/api/projects/${project.id}/render`));

  // Mode manuel : prompts à copier dans Gemini, réponses / images à recoller ici
  const copyPrompt = (kind, missing, done) => async () => {
    await saveNow();
    const prompts = await api("GET", `/api/projects/${project.id}/prompts`);
    if (!prompts[kind]) return toast(missing, true);
    await copyText(prompts[kind]);
    toast(done);
  };
  $("#copyScriptPrompt").addEventListener("click", copyPrompt("script", "",
    "📋 Prompt copié — colle-le dans Gemini (avec ta photo), puis recolle la réponse ici"));
  $("#copyEditPrompt").addEventListener("click", copyPrompt("edit",
    "Écris d'abord la consigne de retouche (ou importe le script).",
    "📋 Consigne copiée — dans Gemini, joins la photo originale et colle-la"));
  $("#copyPhotoPrompt").addEventListener("click", copyPrompt("photo",
    "Décris la photo à générer (ou écris l'idée).",
    "📋 Prompt copié — colle-le dans Gemini puis importe l'image comme photo originale"));

  $("#importScript").addEventListener("click", async () => {
    const text = $("#scriptPaste").value.trim();
    if (!text) return toast("Colle d'abord la réponse de Gemini.", true);
    await saveNow();
    await withBusy("Import du script…", async () => {
      project = await api("POST", `/api/projects/${project.id}/script/import`, { text });
      $("#scriptPaste").value = "";
      previewScene = "chat"; previewIndex = null; renderAll();
      toast(`📝 ${project.chat.messages.length} messages importés — étape suivante : la photo modifiée`);
    });
  });

  // Glisser-déposer sur les cadres photo, et Ctrl/⌘+V d'une image copiée
  $$("[data-drop]").forEach(zone => {
    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", e => {
      e.preventDefault();
      zone.classList.remove("over");
      const file = [...e.dataTransfer.files].find(f => f.type.startsWith("image/"));
      if (file) uploadImage(file, zone.dataset.drop);
    });
  });
  document.addEventListener("paste", e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
    if (!item || !project) return;
    e.preventDefault();
    const role = project.ai_app.source_image ? "result" : "source";
    uploadImage(item.getAsFile(), role);
  });

  $("#copyTitle").addEventListener("click", () => {
    navigator.clipboard.writeText(project.youtube_title || "");
    toast("Titre copié");
  });

  // Réglages
  $("#openSettings").addEventListener("click", openSettings);
  $("#loadModels").addEventListener("click", async () => {
    try {
      await saveSettingsForm();
      const models = await api("GET", "/api/models");
      $("#modelList").innerHTML = models.map(m => `<option value="${m.id}">${escapeHtml(m.label)}</option>`).join("");
      toast(`${models.length} modèles trouvés — clique dans un champ pour choisir`);
    } catch (e) { toast(e.message, true); }
  });
  $("#settings").addEventListener("close", async () => {
    if ($("#settings").returnValue === "save") {
      await saveSettingsForm();
      toast("Réglages enregistrés");
      if (project.voices.provider === "elevenlabs") loadVoices();
    }
  });
}

async function uploadImage(file, role) {
  await saveNow();
  const fd = new FormData();
  const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
  const name = file.name && file.name !== "image.png" ? file.name
    : `${role === "result" ? "Photo modifiée" : role === "source" ? "Photo originale" : "Image"}.${ext}`;
  fd.append("file", file, name);
  await withBusy("Import de l'image…", async () => {
    project = await api("POST", `/api/projects/${project.id}/images/upload?role=${role}`, fd, true);
    if (role === "result") previewScene = "hook";
    if (role === "source") previewScene = project.format === "story" ? "hook" : "app";
    renderAll();
    toast(role === "result" ? "✨ Photo modifiée importée" : role === "source" ? "📷 Photo originale importée" : "Image importée");
  });
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

async function refreshKeyMode() {
  const s = await api("GET", "/api/settings");
  document.body.classList.toggle("no-key", !s.gemini_api_key);
}

async function saveSettingsForm() {
  const form = $("#settings form");
  const data = Object.fromEntries(new FormData(form).entries());
  await api("PUT", "/api/settings", data);
  await refreshKeyMode();
}

async function openSettings() {
  const s = await api("GET", "/api/settings");
  const form = $("#settings form");
  for (const [k, v] of Object.entries(s)) if (form.elements[k]) form.elements[k].value = v;
  $("#settings").showModal();
}

/* ------------------------------ Démarrage -------------------------------- */
(async function init() {
  bindEvents();
  let list = await refreshProjectList();
  if (!list.length) { await api("POST", "/api/projects"); list = await refreshProjectList(); }
  // ?project=… : ouverture directe depuis la page Idées
  const wanted = new URLSearchParams(location.search).get("project") || localStorage.getItem("lastProject");
  await openProject(list.some(p => p.id === wanted) ? wanted : list[0].id);
  if (location.search) history.replaceState(null, "", location.pathname);
  await refreshKeyMode();
  await loadVoices();
})();
