// Page « Idées » : suivi des idées de vidéos (à faire / en cours / réalisées).
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let ideas = [];
let editing = null;

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
// Liens cliquables dans les notes (texte déjà échappé)
const linkify = s => s.replace(/https?:\/\/[^\s<]+/g, u => {
  const label = u.includes("youtube.com/shorts/") ? "▶ voir la vidéo" : u;
  return `<a href="${u}" target="_blank" rel="noopener">${label}</a>`;
});
const FORMATS = { prank: "⚡ Je fais croire", story: "💬 POV" };
const fmtOf = i => (i.format === "story" ? "story" : "prank");
const fmtDate = iso =>iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";

async function load() {
  ideas = await api("GET", "/api/ideas");
  render();
}

function cardHTML(i) {
  if (editing === i.id) {
    return `<div class="idea editing" data-id="${i.id}">
      <select data-f="format">${Object.entries(FORMATS).map(([k, v]) => `<option value="${k}" ${fmtOf(i) === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <textarea data-f="text" rows="2">${esc(i.text)}</textarea>
      <input data-f="character" value="${esc(i.character)}" placeholder="À qui ?" list="characters">
      <input data-f="notes" value="${esc(i.notes)}" placeholder="Notes">
      <div class="idea-actions"><button class="primary" data-act="save">Enregistrer</button><button class="ghost" data-act="cancel">Annuler</button></div>
    </div>`;
  }
  const project = i.project_id && i.project_exists
    ? `<button class="ghost" data-act="open" title="${esc(i.project_title)}">✏️ Ouvrir le projet</button>` : "";
  const actions = {
    todo: `<button class="primary" data-act="create">🎬 Créer la vidéo</button>
           <button class="ghost" data-act="status" data-to="done" title="Marquer comme réalisée">✓</button>`,
    doing: `${project || `<button class="primary" data-act="create">🎬 Créer la vidéo</button>`}
            <button class="ghost" data-act="status" data-to="done" title="Marquer comme réalisée">✓ Réalisée</button>
            <button class="ghost" data-act="status" data-to="todo" title="Remettre à faire">↩</button>`,
    done: `${project}<button class="ghost" data-act="status" data-to="todo" title="Remettre à faire">↩ À refaire</button>`,
  }[i.status];
  const date = i.status === "done" && i.done_at ? `✅ ${fmtDate(i.done_at)}` : `ajoutée le ${fmtDate(i.created)}`;
  return `<div class="idea" draggable="true" data-id="${i.id}">
    <div class="idea-text">${esc(i.text)}</div>
    <div class="idea-meta">
      <span class="chip-fmt ${fmtOf(i)}">${FORMATS[fmtOf(i)]}</span>
      ${i.character ? `<span class="chip-who">${esc(i.character)}</span>` : ""}
      <span class="muted">${date}</span>
    </div>
    ${i.notes ? `<div class="idea-notes">${linkify(esc(i.notes))}</div>` : ""}
    <div class="idea-actions">${actions}
      <span class="spacer"></span>
      <button class="ghost" data-act="edit" title="Modifier">✏️</button>
      <button class="ghost danger" data-act="del" title="Supprimer">🗑</button>
    </div>
  </div>`;
}

function render() {
  const q = $("#search").value.trim().toLowerCase();
  const fmt = $("#formatFilter").value;
  const visible = ideas.filter(i => (!fmt || fmtOf(i) === fmt)
    && (!q || `${i.text} ${i.character} ${i.notes}`.toLowerCase().includes(q)));
  for (const col of $$(".column")) {
    const status = col.dataset.status;
    let list = visible.filter(i => i.status === status);
    // Tes idées d'abord (les plus récentes en haut), puis les idées reprises d'une chaîne, des plus vues aux moins vues
    list = status === "done"
      ? list.sort((a, b) => (b.done_at || "").localeCompare(a.done_at || ""))
      : list.sort((a, b) => (a.views ? 1 : 0) - (b.views ? 1 : 0) || (b.views || 0) - (a.views || 0)
          || (b.created || "").localeCompare(a.created || ""));
    col.querySelector(".count").textContent = list.length;
    col.querySelector(".list").innerHTML = list.map(cardHTML).join("")
      || `<p class="muted empty">${status === "todo" ? "Aucune idée en attente. Ajoute-en une ci-dessus !" : "Rien ici pour l'instant."}</p>`;
  }
  const done = ideas.filter(i => i.status === "done").length;
  $("#stats").textContent = ideas.length ? `${done} / ${ideas.length} idées réalisées` : "";
}

async function setStatus(id, status) {
  await api("PUT", `/api/ideas/${id}`, { status });
  await load();
}

async function createVideo(id) {
  const { project_id } = await api("POST", `/api/ideas/${id}/project`);
  location.href = `index.html?project=${encodeURIComponent(project_id)}`;
}

function bind() {
  $("#addForm").addEventListener("submit", async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api("POST", "/api/ideas", data);
      e.target.reset();
      e.target.elements.character.value = data.character; // on garde le même proche et le même format pour enchaîner
      e.target.elements.format.value = data.format;
      e.target.elements.text.focus();
      toast("💡 Idée ajoutée");
      await load();
    } catch (err) { toast(err.message, true); }
  });

  $("#addBulk").addEventListener("click", async () => {
    const bulk = $("#bulk").value;
    if (!bulk.trim()) return toast("Colle au moins une idée (une par ligne).", true);
    try {
      const form = $("#addForm").elements;
      const added = await api("POST", "/api/ideas", { bulk, character: form.character.value, format: form.format.value });
      $("#bulk").value = "";
      toast(`💡 ${added.length} idées ajoutées`);
      await load();
    } catch (err) { toast(err.message, true); }
  });

  $("#copySuggest").addEventListener("click", async () => {
    const { prompt } = await api("GET", `/api/ideas/prompt?fmt=${$("#addForm").elements.format.value}`);
    try { await navigator.clipboard.writeText(prompt); }
    catch {
      const ta = Object.assign(document.createElement("textarea"), { value: prompt });
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    toast("📋 Prompt copié — colle-le dans Gemini, puis colle sa réponse dans le cadre ci-dessous");
  });

  $("#search").addEventListener("input", render);
  $("#formatFilter").addEventListener("change", render);

  document.addEventListener("click", async e => {
    const btn = e.target.closest("[data-act]");
    const card = e.target.closest(".idea");
    if (!btn || !card) return;
    const id = card.dataset.id;
    const idea = ideas.find(i => i.id === id);
    try {
      switch (btn.dataset.act) {
        case "status": await setStatus(id, btn.dataset.to); break;
        case "create": await createVideo(id); break;
        case "open": location.href = `index.html?project=${encodeURIComponent(idea.project_id)}`; break;
        case "edit": editing = id; render(); card.parentElement.querySelector(`[data-id="${id}"] textarea`)?.focus(); break;
        case "cancel": editing = null; render(); break;
        case "save": {
          const changes = Object.fromEntries([...card.querySelectorAll("[data-f]")].map(el => [el.dataset.f, el.value]));
          if (!changes.text.trim()) return toast("L'idée ne peut pas être vide.", true);
          await api("PUT", `/api/ideas/${id}`, changes);
          editing = null;
          await load();
          break;
        }
        case "del":
          if (confirm(`Supprimer l'idée « ${idea.text} » ?\n(le projet vidéo éventuel n'est pas supprimé)`)) {
            await api("DELETE", `/api/ideas/${id}`);
            await load();
          }
          break;
      }
    } catch (err) { toast(err.message, true); }
  });

  // Glisser-déposer d'une carte vers une autre colonne
  document.addEventListener("dragstart", e => {
    const card = e.target.closest?.(".idea");
    if (card) { e.dataTransfer.setData("text/plain", card.dataset.id); card.classList.add("dragging"); }
  });
  document.addEventListener("dragend", () => $$(".dragging").forEach(c => c.classList.remove("dragging")));
  for (const col of $$(".column")) {
    col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", e => { if (!col.contains(e.relatedTarget)) col.classList.remove("over"); });
    col.addEventListener("drop", async e => {
      e.preventDefault();
      col.classList.remove("over");
      const id = e.dataTransfer.getData("text/plain");
      const idea = ideas.find(i => i.id === id);
      if (idea && idea.status !== col.dataset.status) await setStatus(id, col.dataset.status);
    });
  }
}

bind();
load();
