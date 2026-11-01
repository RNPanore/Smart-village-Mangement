/* Shared UI helpers: escaping, toasts, modals, forms, charts */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function pretty(s) {
  const x = String(s || "").replace(/_/g, " ").toLowerCase();
  return x.charAt(0).toUpperCase() + x.slice(1);
}
function st(code) { return I18N.lang === "mr" && MR[code] ? MR[code] : pretty(code); }
function money(n) { return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 }); }
function fdate(s) {
  if (!s) return "-";
  const d = new Date(String(s).replace(" ", "T"));
  if (isNaN(d)) return esc(s);
  const opts = String(s).length > 10 ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" };
  return d.toLocaleString(I18N.lang === "mr" ? "mr-IN" : "en-IN", opts);
}
function ago(s) {
  const d = new Date(String(s).replace(" ", "T"));
  if (isNaN(d)) return "";
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  if (m < 1440) return Math.round(m / 60) + " h ago";
  return Math.round(m / 1440) + " d ago";
}

const STATUS_CLASS = {
  SUBMITTED: "b-blue", UNDER_REVIEW: "b-blue", ASSIGNED: "b-amber", IN_PROGRESS: "b-amber",
  WAITING_FOR_INFORMATION: "b-grey", RESOLVED: "b-green", REOPENED: "b-red", REFERRED_OUT: "b-grey",
  REJECTED: "b-red", DUPLICATE: "b-grey", Pending: "b-amber", Approved: "b-green", Rejected: "b-red",
  Paid: "b-green", Unpaid: "b-red", Planned: "b-blue", "In Progress": "b-amber", Completed: "b-green", "On Hold": "b-grey",
  LOW: "b-grey", NORMAL: "b-blue", HIGH: "b-amber", URGENT: "b-red",
};
function badge(code, label) {
  return `<span class="badge ${STATUS_CLASS[code] || ""}">${esc(label || st(code))}</span>`;
}
function stars(n) { return n ? `<span class="stars" title="${n}/5">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>` : '<span class="muted">-</span>'; }

/* ---- Toasts ---- */
function toast(msg, isErr) {
  const d = document.createElement("div");
  d.className = "toast" + (isErr ? " err" : "");
  d.textContent = msg;
  $("#toasts").appendChild(d);
  setTimeout(() => d.remove(), isErr ? 5500 : 3200);
}
function fail(e) { toast(e && e.message ? e.message : String(e), true); }

/* ---- Modals ---- */
function openModal(title, bodyHtml, opts = {}) {
  const root = $("#modalRoot");
  const bg = document.createElement("div");
  bg.className = "modal-bg";
  bg.innerHTML = `<div class="modal ${opts.wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="${esc(t("Close"))}">&times;</button></div>
      <div class="modal-body">${bodyHtml}</div></div>`;
  root.appendChild(bg);
  const close = () => { bg.remove(); document.removeEventListener("keydown", onKey); if (opts.onClose) opts.onClose(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
  $("[data-close]", bg).addEventListener("click", close);
  const first = $("input,select,textarea,button.primary", bg);
  if (first && !opts.noFocus) first.focus();
  return { el: bg, close, body: $(".modal-body", bg) };
}

function confirmBox(message, okLabel) {
  return new Promise((resolve) => {
    const m = openModal(t("Delete"), `<p>${esc(message)}</p>
      <div class="modal-foot"><button class="btn" data-no>${esc(t("Cancel"))}</button>
      <button class="btn primary" data-yes>${esc(okLabel || t("Delete"))}</button></div>`, { onClose: () => resolve(false) });
    $("[data-no]", m.el).onclick = () => { m.close(); };
    $("[data-yes]", m.el).onclick = () => { resolve(true); m.close(); };
  });
}

/* ---- Forms ----
   field: {name,label,type,options:[[value,label]],required,hint,value,min,max,placeholder,rows} */
function fieldHtml(f, v) {
  const val = v !== undefined ? v : (f.value !== undefined ? f.value : "");
  const id = "f_" + f.name;
  const req = f.required ? "required" : "";
  const lab = `<span class="${f.required ? "req" : ""}">${esc(f.label)}</span>`;
  const hint = f.hint ? `<span class="hint">${esc(f.hint)}</span>` : "";
  let ctl;
  if (f.type === "textarea") ctl = `<textarea id="${id}" name="${f.name}" ${req} maxlength="${f.max || 2000}" placeholder="${esc(f.placeholder || "")}">${esc(val)}</textarea>`;
  else if (f.type === "select") {
    ctl = `<select id="${id}" name="${f.name}" ${req}>${(f.options || []).map(([ov, ol]) =>
      `<option value="${esc(ov)}" ${String(ov) === String(val) ? "selected" : ""}>${esc(ol)}</option>`).join("")}</select>`;
  } else if (f.type === "checkbox") {
    return `<label style="grid-template-columns:auto 1fr;align-items:center"><input type="checkbox" name="${f.name}" ${val ? "checked" : ""} style="width:auto"> ${esc(f.label)}</label>`;
  } else if (f.type === "file") {
    ctl = `<input id="${id}" type="file" name="${f.name}" accept="image/jpeg,image/png,image/webp" multiple>`;
  } else {
    ctl = `<input id="${id}" type="${f.type || "text"}" name="${f.name}" value="${esc(val)}" ${req}
      ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.max !== undefined && f.type === "number" ? `max="${f.max}"` : ""}
      ${f.type === "password" ? 'autocomplete="new-password"' : ""} ${f.type === "number" ? 'step="any"' : ""} placeholder="${esc(f.placeholder || "")}" maxlength="${f.type === "number" ? "" : 200}">`;
  }
  return `<label for="${id}">${lab}${ctl}${hint}</label>`;
}
function readForm(form) {
  const out = {};
  $$("input,select,textarea", form).forEach((el) => {
    if (!el.name || el.type === "file") return;
    out[el.name] = el.type === "checkbox" ? el.checked : el.value;
  });
  return out;
}

/* Opens a modal with a form; onSubmit(data, formEl) may throw an Error (shown inline). */
function formModal({ title, fields, values = {}, submitLabel, onSubmit, wide, pairs, extraHtml = "" }) {
  const pairSet = new Set(pairs || []);
  let html = "", buf = [];
  fields.forEach((f, i) => {
    const h = fieldHtml(f, values[f.name]);
    if (pairSet.has(f.name)) { buf.push(h); if (buf.length === 2) { html += `<div class="grid2">${buf.join("")}</div>`; buf = []; } }
    else { if (buf.length) { html += buf.join(""); buf = []; } html += h; }
  });
  html += buf.join("");
  const m = openModal(title, `<form class="form" novalidate>${html}${extraHtml}<p class="error" role="alert"></p>
    <div class="modal-foot"><button type="button" class="btn" data-close2>${esc(t("Cancel"))}</button>
    <button class="btn primary" type="submit">${esc(submitLabel || t("Save"))}</button></div></form>`, { wide });
  const form = $("form", m.el);
  $("[data-close2]", m.el).onclick = m.close;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $(".error", form);
    err.textContent = "";
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const btn = $("button[type=submit]", form);
    btn.disabled = true;
    try {
      await onSubmit(readForm(form), form);
      m.close();
    } catch (ex) {
      err.textContent = ex.message || String(ex);
      btn.disabled = false;
    }
  });
  return m;
}

/* ---- Tables ---- */
function table(headers, bodyRows, emptyText) {
  if (!bodyRows.length) return `<div class="card empty">${esc(emptyText || t("No records yet."))}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${bodyRows.join("")}</tbody></table></div>`;
}

/* ---- Charts (pure CSS) ---- */
const PALETTE = ["#2f7d4f", "#d98a2b", "#2c6fb0", "#c0392b", "#7d5ba6", "#2a9d8f", "#8d6e63", "#6b7f3a", "#c2185b", "#546e7a"];
function bars(data, opts = {}) {
  if (!data || !data.length) return `<p class="muted">${esc(t("No records yet."))}</p>`;
  const max = Math.max(...data.map((d) => d.value), 1);
  return `<div class="bars">${data.map((d, i) => `<div class="bar-row"><span class="lab" title="${esc(d.label)}">${esc(opts.raw ? d.label : (STATUS_CLASS[d.label] ? st(d.label) : d.label))}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${(d.value / max) * 100}%;background:${opts.color || PALETTE[i % PALETTE.length]}"></div></div>
    <b>${d.value}</b></div>`).join("")}</div>`;
}
function donut(data) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return `<p class="muted">${esc(t("No records yet."))}</p>`;
  let acc = 0;
  const stops = data.map((d, i) => {
    const from = (acc / total) * 100; acc += d.value; const to = (acc / total) * 100;
    return `${PALETTE[i % PALETTE.length]} ${from}% ${to}%`;
  });
  return `<div class="donut-wrap"><div class="donut" data-total="${total}" style="background:conic-gradient(${stops.join(",")})"></div>
    <div class="legend">${data.map((d, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(st(d.label))} <b>${d.value}</b></span>`).join("")}</div></div>`;
}
function stat(label, value, cls) {
  return `<div class="stat ${cls || ""}"><div class="n">${esc(value)}</div><div class="l">${esc(t(label))}</div></div>`;
}

/* Theme */
const Theme = {
  get() { try { return localStorage.getItem("sv-theme") || "light"; } catch (e) { return "light"; } },
  set(v) { try { localStorage.setItem("sv-theme", v); } catch (e) { /* ignore */ } document.documentElement.dataset.theme = v; },
  toggle() { this.set(this.get() === "dark" ? "light" : "dark"); },
};
Theme.set(Theme.get());
