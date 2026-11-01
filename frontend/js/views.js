/* Signed-in application views */
const App = { user: null, meta: null };

const ROLE_LABEL = { admin: "Village Administrator", supervisor: "Supervisor", department_head: "Department head", field_worker: "Field worker", citizen: "Citizen" };
const isAdmin = () => App.user.role === "admin";

/* nav: [key, icon, label, section] */
const NAV = {
  citizen: [["dashboard", "🏠", "Dashboard", "Overview"], ["complaints", "📣", "My complaints", "Services"], ["raise", "➕", "Raise a complaint", "Services"],
    ["notices", "📢", "Notices", "Services"], ["schemes", "🌾", "Schemes", "Services"], ["bills", "💰", "Bills & Tax", "Services"],
    ["events", "📅", "Events", "Services"], ["projects", "🏗️", "Projects", "Services"], ["profile", "👤", "Profile", "Account"]],
  field_worker: [["dashboard", "🏠", "Dashboard", "Overview"], ["complaints", "🛠️", "Complaints", "Work"], ["notices", "📢", "Notices", "Village"],
    ["events", "📅", "Events", "Village"], ["projects", "🏗️", "Projects", "Village"], ["profile", "👤", "Profile", "Account"]],
  department_head: [["dashboard", "🏠", "Dashboard", "Overview"], ["complaints", "📣", "Complaints", "Work"], ["notices", "📢", "Notices", "Village"],
    ["events", "📅", "Events", "Village"], ["projects", "🏗️", "Projects", "Village"], ["profile", "👤", "Profile", "Account"]],
  supervisor: [["dashboard", "🏠", "Dashboard", "Overview"], ["complaints", "📣", "Complaints", "Work"], ["reports", "📊", "Reports", "Work"],
    ["citizens", "👥", "Citizens", "People"], ["staff", "🧑‍🔧", "Staff", "People"], ["notices", "📢", "Notices", "Village"],
    ["schemes", "🌾", "Schemes", "Village"], ["bills", "💰", "Bills & Tax", "Village"], ["events", "📅", "Events", "Village"],
    ["projects", "🏗️", "Projects", "Village"], ["profile", "👤", "Profile", "Account"]],
  admin: [["dashboard", "🏠", "Dashboard", "Overview"], ["complaints", "📣", "Complaints", "Work"], ["reports", "📊", "Reports", "Work"],
    ["citizens", "👥", "Citizens", "People"], ["staff", "🧑‍🔧", "Staff", "People"], ["departments", "🏢", "Departments", "People"],
    ["notices", "📢", "Notices", "Village"], ["schemes", "🌾", "Schemes", "Village"], ["bills", "💰", "Bills & Tax", "Village"],
    ["events", "📅", "Events", "Village"], ["projects", "🏗️", "Projects", "Village"],
    ["messages", "✉️", "Messages", "System"], ["audit", "🗎", "Audit log", "System"], ["profile", "👤", "Profile", "Account"]],
};

function onAct(root, handlers) {
  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || !root.contains(el)) return;
    const h = handlers[el.dataset.act];
    if (h) { e.preventDefault(); Promise.resolve(h(el)).catch(fail); }
  });
}
const sel = (opts, value) => opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`).join("");
const head = (title, btn) => `<div class="toolbar"><h3 class="grow" style="margin:0">${esc(title)}</h3>${btn || ""}</div>`;
const addBtn = (act, label) => `<button class="btn primary" data-act="${act}">+ ${esc(label || t("Add"))}</button>`;
const reloadMeta = async () => { App.meta = await API.get("/meta"); };

const V = {};
let currentView = "dashboard";

/* ------------------------------------------------------------ Dashboard */
V.dashboard = async (view) => {
  const d = await API.get("/dashboard");
  const s = d.stats, r = App.user.role;
  let cards = "";
  if (r === "admin" || r === "supervisor") {
    cards = stat("Citizens", s.citizens) + stat("Population", s.population) + stat("Total complaints", s.complaints_total, "info") +
      stat("Open complaints", s.complaints_open, "warn") + stat("Overdue", s.overdue, s.overdue ? "bad" : "") + stat("Resolved", s.resolved) +
      stat("Collected", money(s.collected)) + stat("Pending dues", money(s.pending_amount), "warn") +
      stat("Satisfaction (avg /5)", s.avg_rating || "-", "info") + stat("Pending scheme applications", s.applications_pending, "warn") + stat("Active projects", s.projects_active) + stat("Staff", s.staff);
  } else if (r === "department_head") {
    cards = stat("Department complaints", s.dept_total, "info") + stat("Open complaints", s.dept_open, "warn") + stat("Waiting for assignment", s.dept_unassigned, s.dept_unassigned ? "bad" : "") +
      stat("Overdue", s.overdue, s.overdue ? "bad" : "") + stat("Resolved", s.resolved) + stat("Team size", s.team);
  } else if (r === "field_worker") {
    cards = stat("Assigned (open)", s.assigned_open, "warn") + stat("In progress", s.in_progress, "info") + stat("Overdue", s.overdue, s.overdue ? "bad" : "") + stat("Resolved", s.resolved);
  } else {
    cards = stat("Open complaints", s.my_open, "warn") + stat("Total complaints", s.my_total, "info") + stat("Dues to pay", money(s.dues), s.dues ? "bad" : "") +
      stat("Paid so far", money(s.paid)) + stat("Scheme applications", s.my_applications) + stat("Open schemes", s.open_schemes);
  }
  const ch = d.charts;
  const extra = (r === "admin" || r === "supervisor") ? `<div class="two-col"><div class="card"><h3>${esc(t("Complaints by department"))}</h3>${bars(ch.by_department, { raw: true })}</div>
      <div class="card"><h3>Complaints by category</h3>${bars(ch.by_category, { raw: true })}</div></div>
      <div class="card" style="margin-bottom:16px"><h3>Bills: collected vs pending</h3>${ch.bills_by_type.length ? ch.bills_by_type.map((b) => `<div class="item"><div class="meta"><b>${esc(b.label)}</b></div>
        ${bars([{ label: "Paid", value: b.paid }, { label: "Unpaid", value: b.unpaid }], { raw: true })}</div>`).join("") : `<p class="muted">${esc(t("No records yet."))}</p>`}</div>` : "";
  view.innerHTML = `<p class="muted" style="margin-top:0">${esc(t("Welcome"))}, <b>${esc(App.user.name)}</b> &middot; ${esc(t(ROLE_LABEL[r]))}${App.user.department_name ? " &middot; " + esc(App.user.department_name) : ""}</p>
    <div class="stats">${cards}</div>
    <div class="two-col"><div class="card"><h3>${esc(t("Complaints by status"))}</h3>${donut(ch.by_status)}</div>
      <div class="card"><div class="card-head"><h3>${esc(t("Upcoming events"))}</h3><a href="#/app/events">${esc(t("View"))}</a></div>
        ${d.events.length ? d.events.map((e) => `<div class="item"><h4>${esc(e.title)}</h4><div class="meta"><span>${fdate(e.event_date)}</span><span>${esc(e.venue)}</span></div></div>`).join("") : `<p class="muted">${esc(t("No records yet."))}</p>`}</div></div>
    ${extra}
    <div class="card"><div class="card-head"><h3>${esc(t("Latest notices"))}</h3><a href="#/app/notices">${esc(t("View"))}</a></div>
      ${d.notices.length ? d.notices.map((n) => `<div class="item"><div class="meta"><span class="badge b-blue">${esc(n.category)}</span>${fdate(n.created_at)}</div><h4>${esc(n.title)}</h4><p class="muted" style="margin:0">${esc(n.content)}</p></div>`).join("") : `<p class="muted">${esc(t("No records yet."))}</p>`}</div>`;
};

/* ------------------------------------------------------------ Complaints */
function complaintRow(c, showCitizen) {
  return `<tr>
    <td class="nowrap"><b>${esc(c.reference_code)}</b></td><td>${esc(c.title)}<div class="muted small">${esc(c.category || "")}</div></td>
    ${showCitizen ? `<td>${esc(c.citizen_name)}<div class="muted small">${esc(c.ward)}</div></td>` : ""}
    <td>${esc(c.department_name || "-")}<div class="muted small">${esc(c.assignee_name || "")}</div></td>
    <td>${badge(c.priority)}</td><td>${badge(c.status)}${c.overdue ? ' <span class="badge b-red">' + esc(t("Overdue")) + "</span>" : ""}</td>
    <td class="nowrap">${fdate(c.created_at)}</td>
    <td><button class="btn sm" data-act="open" data-id="${c.id}">${esc(t("View"))}</button></td></tr>`;
}

V.complaints = async (view) => {
  const showCitizen = App.user.role !== "citizen";
  const state = { status: "", q: "" };
  view.innerHTML = `<div class="toolbar">
      <select id="fStatus" aria-label="${esc(t("Status"))}"><option value="">${esc(t("All"))}</option><option value="OPEN">${esc(t("Open"))}</option>${App.meta.statuses.map((s) => `<option value="${s}">${esc(st(s))}</option>`).join("")}</select>
      <div class="grow"><input id="fQ" type="search" placeholder="${esc(t("Search"))}..." aria-label="${esc(t("Search"))}"></div>
      ${App.user.role === "citizen" ? addBtn("raise", t("Raise a complaint")) : ""}</div><div id="cList"></div>`;
  async function load() {
    const qs = new URLSearchParams(); if (state.status) qs.set("status", state.status); if (state.q) qs.set("q", state.q);
    const list = await API.get("/complaints?" + qs);
    $("#cList", view).innerHTML = table(["Ref", t("Title"), ...(showCitizen ? [t("Citizen")] : []), t("Department"), t("Priority"), t("Status"), t("Date"), ""],
      list.map((c) => complaintRow(c, showCitizen)));
  }
  $("#fStatus", view).onchange = (e) => { state.status = e.target.value; load().catch(fail); };
  let timer;
  $("#fQ", view).oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value.trim(); load().catch(fail); }, 250); };
  onAct(view, {
    open: (el) => openComplaint(+el.dataset.id, load),
    raise: () => raiseComplaint(load),
  });
  await load();
};

V.raise = async (view) => {
  view.innerHTML = `<div class="card"><p>${esc(t("Raise a complaint"))}...</p></div>`;
  location.hash = "#/app/complaints";
  raiseComplaint(() => { if (currentView === "complaints") Router.go(); });
};

function raiseComplaint(done) {
  const cats = App.meta.categories.map((c) => [c.id, c.name]);
  formModal({
    title: t("Raise a complaint"), submitLabel: t("Submit complaint"), wide: true,
    fields: [
      { name: "title", label: t("Title"), required: true, placeholder: "e.g. No water in the tap" },
      { name: "category_id", label: t("Category"), type: "select", options: cats, required: true },
      { name: "priority", label: t("Priority"), type: "select", options: [["NORMAL", st("NORMAL")], ["LOW", st("LOW")], ["HIGH", st("HIGH")], ["URGENT", st("URGENT")]], value: "NORMAL" },
      { name: "location", label: t("Location"), placeholder: "Street / landmark" },
      { name: "description", label: t("Description"), type: "textarea", required: true },
      { name: "photos", label: t("Attach photos (optional)"), type: "file", hint: "Up to 4 images (JPG, PNG or WebP), max 5 MB each" },
    ], pairs: ["category_id", "priority"],
    async onSubmit(data, form) {
      const fd = new FormData();
      Object.entries(data).forEach(([k, v]) => fd.append(k, v));
      const files = form.querySelector("input[type=file]").files;
      if (files.length > 4) throw new Error("You can attach at most 4 photos");
      for (const f of files) {
        if (f.size > 5 * 1024 * 1024) throw new Error(f.name + " is larger than 5 MB");
        fd.append("photos", f);
      }
      const res = await API.post("/complaints", fd);
      toast(`${t("Submitted")}: ${res.reference_code}`);
      if (done) await done();
    },
  });
}

async function openComplaint(id, refresh) {
  const c = await API.get("/complaints/" + id);
  const role = App.user.role;
  const m = openModal(c.reference_code, "", { wide: true });
  let workers = [];
  if (c.can_assign) { try { workers = await API.get("/assignees"); } catch (e) { workers = []; } }

  const draw = (c) => {
    const events = c.events.map((e) => `<li class="${e.event_type === "COMMENT" ? "comment" : ""}">
      <strong>${esc(e.event_type === "COMMENT" ? "Note" : st(e.new_status || e.event_type))}${e.old_status && e.new_status && e.old_status !== e.new_status ? ` <span class="muted small">(${esc(st(e.old_status))} &rarr; ${esc(st(e.new_status))})</span>` : ""}</strong>
      ${e.description ? `<div>${esc(e.description)}</div>` : ""}<span class="muted small">${esc(e.actor_name || "")} ${e.actor_role ? "(" + esc(t(ROLE_LABEL[e.actor_role] || e.actor_role)) + ")" : ""} &middot; ${fdate(e.created_at)}</span></li>`).join("");
    const photos = c.files.length ? `<div class="photos">${c.files.map((f) => `<img src="/api/files/${f.id}" alt="${esc(f.original_name)}" data-act="zoom" data-src="/api/files/${f.id}" loading="lazy">`).join("")}</div>` : "";
    const nextOpts = c.next_statuses.map((s) => [s, st(s)]);
    const statusForm = nextOpts.length ? `<form class="form card" data-form="status"><h4>${esc(t("Change status"))}</h4>
        <div class="grid2"><label>${esc(t("Status"))}<select name="status">${sel(nextOpts)}</select></label>
        <label>${esc(t("Note"))}<input name="note" maxlength="500" placeholder="Required for reject, reopen, waiting..."></label></div>
        <button class="btn primary" type="submit" style="width:fit-content">${esc(t("Change status"))}</button></form>` : "";
    const deptOpts = App.meta.departments.map((d) => [d.id, d.name]);
    const assignForm = c.can_assign ? `<form class="form card" data-form="assign"><h4>${esc(t("Assign"))}</h4>
        <div class="grid2">${role === "admin" ? `<label>${esc(t("Department"))}<select name="department_id">${sel(deptOpts, c.department_id)}</select></label>` : ""}
        <label>${esc(t("Assigned to"))}<select name="assigned_to"></select></label></div>
        <label>${esc(t("Note"))}<input name="note" maxlength="300"></label>
        <button class="btn primary" type="submit" style="width:fit-content">${esc(t("Assign"))}</button></form>` : "";
    const fb = role === "citizen" && c.status === "RESOLVED" ? (c.rating ? `<p>${stars(c.rating)} ${esc(c.feedback)}</p>` :
      `<form class="form card" data-form="feedback"><h4>${esc(t("Rate this resolution"))}</h4>
        <div class="star-pick" data-stars>${[1, 2, 3, 4, 5].map((i) => `<button type="button" data-v="${i}" aria-label="${i}">★</button>`).join("")}</div>
        <input type="hidden" name="rating" value="0"><label>${esc(t("Note"))}<input name="feedback" maxlength="500"></label>
        <button class="btn primary" type="submit" style="width:fit-content">${esc(t("Save"))}</button></form>`) : (c.rating ? `<p>${stars(c.rating)} ${esc(c.feedback)}</p>` : "");
    m.body.innerHTML = `
      <div class="card-head"><div><h3 style="margin:0">${esc(c.title)}</h3><div class="muted small">${esc(c.category || "")}</div></div>
        <div>${badge(c.status)} ${badge(c.priority)}${c.overdue ? ' <span class="badge b-red">' + esc(t("Overdue")) + "</span>" : ""}</div></div>
      <p style="white-space:pre-wrap">${esc(c.description)}</p>${photos}
      <dl class="kv"><dt>${esc(t("Citizen"))}</dt><dd>${esc(c.citizen_name)} ${c.citizen_phone ? "&middot; " + esc(c.citizen_phone) : ""} ${c.ward ? "&middot; " + esc(c.ward) : ""}</dd>
        <dt>${esc(t("Location"))}</dt><dd>${esc(c.location || "-")}</dd><dt>${esc(t("Department"))}</dt><dd>${esc(c.department_name || "-")}</dd>
        <dt>${esc(t("Assigned to"))}</dt><dd>${esc(c.assignee_name || "-")}</dd><dt>${esc(t("Submitted"))}</dt><dd>${fdate(c.created_at)}</dd>
        <dt>Target date</dt><dd>${fdate(c.sla_due)}</dd></dl>
      ${fb}
      <div style="display:grid;gap:12px;margin:14px 0">${assignForm}${statusForm}</div>
      <h4>${esc(t("Timeline"))}</h4><ul class="timeline">${events}</ul>
      <form class="form" data-form="comment"><label>${esc(t("Add note"))}<textarea name="note" maxlength="1000" required style="min-height:60px"></textarea></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">${esc(t("Add note"))}</button>
        ${role === "admin" ? `<button type="button" class="btn danger" data-act="del">${esc(t("Delete"))}</button>` : ""}</div></form>`;

    const aForm = $("[data-form=assign]", m.body);
    if (aForm) {
      const dsel = aForm.elements.department_id, wsel = aForm.elements.assigned_to;
      const fill = () => {
        const dep = dsel ? +dsel.value : App.user.department_id;
        const list = workers.filter((w) => w.department_id === dep);
        wsel.innerHTML = `<option value="">-- ${esc(t("Department"))} only --</option>` + list.map((w) => `<option value="${w.id}" ${w.name === c.assignee_name ? "selected" : ""}>${esc(w.name)}</option>`).join("");
      };
      if (dsel) dsel.onchange = fill;
      fill();
    }
    $$("[data-stars]", m.body).forEach((box) => box.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      const v = +b.dataset.v; box.nextElementSibling.value = v;
      $$("button", box).forEach((x) => x.classList.toggle("on", +x.dataset.v <= v));
    }));
  };

  const reload = async () => { const fresh = await API.get("/complaints/" + id); draw(fresh); if (refresh) await refresh(); };
  m.el.addEventListener("submit", async (e) => {
    const f = e.target.closest("form[data-form]"); if (!f) return;
    e.preventDefault();
    const data = readForm(f);
    try {
      const kind = f.dataset.form;
      if (kind === "status") await API.post(`/complaints/${id}/transition`, data);
      else if (kind === "assign") await API.post(`/complaints/${id}/assign`, data);
      else if (kind === "comment") await API.post(`/complaints/${id}/comment`, data);
      else if (kind === "feedback") await API.post(`/complaints/${id}/feedback`, data);
      toast(t("Save") + " ✓");
      await reload();
    } catch (ex) { fail(ex); }
  });
  onAct(m.el, {
    zoom: (el) => openModal("Photo", `<img src="${esc(el.dataset.src)}" alt="Complaint photo" style="max-width:100%;border-radius:10px">`, { wide: true, noFocus: true }),
    del: async () => { if (await confirmBox("Delete this complaint permanently?")) { await API.del("/complaints/" + id); m.close(); toast("Deleted"); if (refresh) await refresh(); } },
  });
  draw(c);
}

/* ------------------------------------------------------------ Notices */
V.notices = async (view) => {
  const list = await API.get("/notices");
  const draw = (list) => {
    view.innerHTML = head(t("Notices"), isAdmin() ? addBtn("add") : "") + (list.length ? `<div class="grid-cards">${list.map((n) => `<div class="card">
      <div class="meta"><span class="badge b-blue">${esc(n.category)}</span>${fdate(n.created_at)}</div><h4>${esc(n.title)}</h4><p style="white-space:pre-wrap">${esc(n.content)}</p>
      ${isAdmin() ? `<div class="actions" style="display:flex;gap:6px"><button class="btn sm" data-act="edit" data-id="${n.id}">${esc(t("Edit"))}</button><button class="btn sm danger" data-act="del" data-id="${n.id}">${esc(t("Delete"))}</button></div>` : ""}</div>`).join("")}</div>` : `<div class="card empty">${esc(t("No records yet."))}</div>`);
  };
  const noticeForm = (n) => formModal({ title: n ? t("Edit") : t("Add"), values: n || {}, fields: [
    { name: "title", label: t("Title"), required: true }, { name: "category", label: t("Category"), value: "General" },
    { name: "content", label: t("Description"), type: "textarea", required: true, max: 3000 }],
    onSubmit: async (d) => { n ? await API.put("/notices/" + n.id, d) : await API.post("/notices", d); toast("Saved"); Router.go(); } });
  draw(list);
  onAct(view, {
    add: () => noticeForm(null),
    edit: (el) => noticeForm(list.find((x) => x.id === +el.dataset.id)),
    del: async (el) => { if (await confirmBox("Delete this notice?")) { await API.del("/notices/" + el.dataset.id); Router.go(); } },
  });
};

/* ------------------------------------------------------------ Schemes */
V.schemes = async (view) => {
  const [list, apps] = await Promise.all([API.get("/schemes"), (App.user.role === "field_worker" || App.user.role === "department_head") ? [] : API.get("/applications")]);
  const today = new Date().toISOString().slice(0, 10);
  const cit = App.user.role === "citizen";
  view.innerHTML = head(t("Schemes"), isAdmin() ? addBtn("add") : "") +
    (list.length ? `<div class="grid-cards">${list.map((s) => {
      const closed = s.last_date && s.last_date < today;
      return `<div class="card"><h4>${esc(s.name)}</h4><p class="muted">${esc(s.description)}</p>
        <dl class="kv"><dt>${esc(t("Eligibility"))}</dt><dd>${esc(s.eligibility || "-")}</dd><dt>${esc(t("Benefit"))}</dt><dd>${esc(s.benefit || "-")}</dd>
        <dt>${esc(t("Last date"))}</dt><dd>${fdate(s.last_date)} ${closed ? '<span class="badge b-red">Closed</span>' : ""}</dd>${!cit ? `<dt>${esc(t("Applications"))}</dt><dd>${s.applicants}</dd>` : ""}</dl>
        <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
        ${cit ? (s.my_status ? badge(s.my_status) : `<button class="btn primary sm" data-act="apply" data-id="${s.id}" ${closed ? "disabled" : ""}>${esc(t("Apply"))}</button>`) : ""}
        ${isAdmin() ? `<button class="btn sm" data-act="edit" data-id="${s.id}">${esc(t("Edit"))}</button><button class="btn sm danger" data-act="del" data-id="${s.id}">${esc(t("Delete"))}</button>` : ""}</div></div>`;
    }).join("")}</div>` : `<div class="card empty">${esc(t("No records yet."))}</div>`) +
    `<h3 style="margin-top:26px">${esc(cit ? "My applications" : t("Applications"))}</h3>` +
    table([t("Scheme"), ...(cit ? [] : [t("Citizen")]), t("Status"), t("Date"), "Remarks", ...(isAdmin() ? [""] : [])],
      apps.map((a) => `<tr><td>${esc(a.scheme_name)}</td>${cit ? "" : `<td>${esc(a.resident_name)}<div class="muted small">${esc(a.ward)}</div></td>`}<td>${badge(a.status)}</td><td>${fdate(a.applied_at)}</td><td>${esc(a.remarks)}</td>
        ${isAdmin() ? `<td><button class="btn sm" data-act="review" data-id="${a.id}">${esc(t("Edit"))}</button></td>` : ""}</tr>`));
  const schemeForm = (s) => formModal({ title: s ? t("Edit") : t("Add"), values: s || {}, fields: [
    { name: "name", label: t("Title"), required: true }, { name: "description", label: t("Description"), type: "textarea" },
    { name: "eligibility", label: t("Eligibility") }, { name: "benefit", label: t("Benefit") }, { name: "last_date", label: t("Last date"), type: "date" }],
    onSubmit: async (d) => { s ? await API.put("/schemes/" + s.id, d) : await API.post("/schemes", d); toast("Saved"); Router.go(); } });
  onAct(view, {
    add: () => schemeForm(null), edit: (el) => schemeForm(list.find((x) => x.id === +el.dataset.id)),
    del: async (el) => { if (await confirmBox("Delete this scheme and its applications?")) { await API.del("/schemes/" + el.dataset.id); Router.go(); } },
    apply: async (el) => { await API.post(`/schemes/${el.dataset.id}/apply`); toast(t("Applied")); Router.go(); },
    review: (el) => { const a = apps.find((x) => x.id === +el.dataset.id);
      formModal({ title: a.scheme_name + " - " + a.resident_name, values: a, fields: [
        { name: "status", label: t("Status"), type: "select", options: [["Pending", t("Pending")], ["Approved", t("Approved")], ["Rejected", t("Rejected")]] },
        { name: "remarks", label: "Remarks" }], onSubmit: async (d) => { await API.put("/applications/" + a.id, d); toast("Saved"); Router.go(); } }); },
  });
};

/* ------------------------------------------------------------ Bills */
V.bills = async (view) => {
  const list = await API.get("/bills");
  const cit = App.user.role === "citizen";
  const due = list.filter((b) => b.status === "Unpaid").reduce((a, b) => a + b.amount, 0);
  const paid = list.filter((b) => b.status === "Paid").reduce((a, b) => a + b.amount, 0);
  const today = new Date().toISOString().slice(0, 10);
  view.innerHTML = `<div class="stats">${stat("Pending dues", money(due), due ? "bad" : "")}${stat("Collected", money(paid))}</div>` +
    head(t("Bills & Tax"), isAdmin() ? addBtn("add", "Generate bill") : "") +
    table(["#", ...(cit ? [] : [t("Citizen")]), "Type", t("Description"), t("Amount"), t("Due date"), t("Status"), ""],
      list.map((b) => `<tr><td>${b.id}</td>${cit ? "" : `<td>${esc(b.resident_name)}<div class="muted small">${esc(b.ward)}</div></td>`}<td>${esc(b.bill_type)}</td><td>${esc(b.description)}</td>
        <td><b>${money(b.amount)}</b></td><td class="nowrap">${fdate(b.due_date)}${b.status === "Unpaid" && b.due_date && b.due_date < today ? ' <span class="badge b-red">' + esc(t("Overdue")) + "</span>" : ""}</td>
        <td>${badge(b.status)}${b.payment_ref ? `<div class="muted small">${esc(b.payment_ref)}</div>` : ""}</td>
        <td><div class="actions">${b.status === "Unpaid" && (cit || isAdmin()) ? `<button class="btn primary sm" data-act="pay" data-id="${b.id}">${esc(t("Pay now"))}</button>` : ""}
        ${isAdmin() ? `<button class="btn sm danger" data-act="del" data-id="${b.id}">${esc(t("Delete"))}</button>` : ""}</div></td></tr>`));
  onAct(view, {
    pay: async (el) => {
      const b = list.find((x) => x.id === +el.dataset.id);
      if (!(await confirmBox(`${b.bill_type}: ${money(b.amount)}. This records the payment (demo payment, no real money moves).`, t("Pay now")))) return;
      const r = await API.post(`/bills/${b.id}/pay`); toast("Payment recorded: " + r.payment_ref); Router.go();
    },
    del: async (el) => { if (await confirmBox("Delete this bill?")) { await API.del("/bills/" + el.dataset.id); Router.go(); } },
    add: async () => {
      const cits = await API.get("/citizens");
      formModal({ title: "Generate bill", fields: [
        { name: "user_id", label: t("Citizen"), type: "select", options: [["all", "All citizens"], ...cits.filter((c) => c.active).map((c) => [c.id, `${c.name} (${c.ward || "-"})`])] },
        { name: "bill_type", label: "Type", type: "select", options: ["House Tax", "Water Bill", "Electricity Bill", "Sanitation Fee", "Other"].map((x) => [x, x]) },
        { name: "description", label: t("Description") }, { name: "amount", label: t("Amount"), type: "number", min: 1, required: true }, { name: "due_date", label: t("Due date"), type: "date" }],
        pairs: ["amount", "due_date"], onSubmit: async (d) => { const r = await API.post("/bills", d); toast(r.created + " bill(s) created"); Router.go(); } });
    },
  });
};

/* ------------------------------------------------------------ Events */
V.events = async (view) => {
  const list = await API.get("/events");
  const cit = App.user.role === "citizen";
  const today = new Date().toISOString().slice(0, 10);
  view.innerHTML = head(t("Events"), isAdmin() ? addBtn("add") : "") + (list.length ? `<div class="grid-cards">${list.map((e) => `<div class="card">
    <div class="meta"><span class="badge ${e.event_date >= today ? "b-green" : "b-grey"}">${fdate(e.event_date)}</span>${esc(e.venue)}</div>
    <h4>${esc(e.title)}</h4><p class="muted">${esc(e.description)}</p>
    <div class="meta">${e.registrations} registered</div>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${cit && e.event_date >= today ? `<button class="btn sm ${e.registered ? "" : "primary"}" data-act="reg" data-id="${e.id}">${e.registered ? "✓ Registered (cancel)" : esc(t("Register for event"))}</button>` : ""}
    ${isAdmin() ? `<button class="btn sm" data-act="edit" data-id="${e.id}">${esc(t("Edit"))}</button><button class="btn sm danger" data-act="del" data-id="${e.id}">${esc(t("Delete"))}</button>` : ""}</div></div>`).join("")}</div>` : `<div class="card empty">${esc(t("No records yet."))}</div>`);
  const form = (e) => formModal({ title: e ? t("Edit") : t("Add"), values: e || {}, fields: [
    { name: "title", label: t("Title"), required: true }, { name: "event_date", label: t("Date"), type: "date", required: true }, { name: "venue", label: t("Venue") },
    { name: "description", label: t("Description"), type: "textarea" }], pairs: ["event_date", "venue"],
    onSubmit: async (d) => { e ? await API.put("/events/" + e.id, d) : await API.post("/events", d); toast("Saved"); Router.go(); } });
  onAct(view, {
    add: () => form(null), edit: (el) => form(list.find((x) => x.id === +el.dataset.id)),
    del: async (el) => { if (await confirmBox("Delete this event?")) { await API.del("/events/" + el.dataset.id); Router.go(); } },
    reg: async (el) => { const r = await API.post(`/events/${el.dataset.id}/register`); toast(r.registered ? "Registered" : "Registration cancelled"); Router.go(); },
  });
};

/* ------------------------------------------------------------ Projects */
V.projects = async (view) => {
  const list = await API.get("/projects");
  view.innerHTML = head(t("Projects"), isAdmin() ? addBtn("add") : "") + (list.length ? `<div class="grid-cards">${list.map((p) => `<div class="card">
    <div class="card-head"><h4 style="margin:0">${esc(p.title)}</h4>${badge(p.status)}</div><p class="muted">${esc(p.description)}</p>
    <div class="progress" role="progressbar" aria-valuenow="${p.progress}" aria-valuemin="0" aria-valuemax="100"><div style="width:${p.progress}%"></div></div>
    <div class="meta" style="margin-top:6px"><b>${p.progress}%</b> ${esc(t("Progress"))}</div>
    <dl class="kv"><dt>${esc(t("Budget"))}</dt><dd>${money(p.budget)}</dd><dt>${esc(t("Spent"))}</dt><dd>${money(p.spent)}</dd><dt>Period</dt><dd>${fdate(p.start_date)} &ndash; ${fdate(p.end_date)}</dd></dl>
    ${isAdmin() ? `<div style="display:flex;gap:6px;margin-top:10px"><button class="btn sm" data-act="edit" data-id="${p.id}">${esc(t("Edit"))}</button><button class="btn sm danger" data-act="del" data-id="${p.id}">${esc(t("Delete"))}</button></div>` : ""}</div>`).join("")}</div>` : `<div class="card empty">${esc(t("No records yet."))}</div>`);
  const form = (p) => formModal({ title: p ? t("Edit") : t("Add"), values: p || {}, fields: [
    { name: "title", label: t("Title"), required: true }, { name: "description", label: t("Description"), type: "textarea" },
    { name: "budget", label: t("Budget"), type: "number", min: 0 }, { name: "spent", label: t("Spent"), type: "number", min: 0 },
    { name: "progress", label: t("Progress") + " %", type: "number", min: 0, max: 100 },
    { name: "status", label: t("Status"), type: "select", options: ["Planned", "In Progress", "Completed", "On Hold"].map((x) => [x, x]) },
    { name: "start_date", label: "Start", type: "date" }, { name: "end_date", label: "End", type: "date" }],
    pairs: ["budget", "spent", "progress", "status", "start_date", "end_date"],
    onSubmit: async (d) => { p ? await API.put("/projects/" + p.id, d) : await API.post("/projects", d); toast("Saved"); Router.go(); } });
  onAct(view, { add: () => form(null), edit: (el) => form(list.find((x) => x.id === +el.dataset.id)),
    del: async (el) => { if (await confirmBox("Delete this project?")) { await API.del("/projects/" + el.dataset.id); Router.go(); } } });
};

/* ------------------------------------------------------------ Citizens */
V.citizens = async (view) => {
  const list = await API.get("/citizens");
  const ad = isAdmin();
  view.innerHTML = head(t("Citizens") + ` (${list.length})`, ad ? addBtn("add") : "") +
    table([t("Full name"), t("Username"), t("Phone"), t("Ward"), t("Address"), "Family", t("Status"), ...(ad ? [""] : [])],
      list.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.username)}</td><td>${esc(c.phone)}</td><td>${esc(c.ward)}</td><td>${esc(c.address)}</td><td>${c.family_members}</td>
        <td>${c.active ? '<span class="badge b-green">Active</span>' : '<span class="badge b-grey">Disabled</span>'}</td>
        ${ad ? `<td><div class="actions"><button class="btn sm" data-act="edit" data-id="${c.id}">${esc(t("Edit"))}</button><button class="btn sm danger" data-act="del" data-id="${c.id}">${esc(t("Delete"))}</button></div></td>` : ""}</tr>`));
  const form = (c) => formModal({ title: c ? t("Edit") : t("Add"), values: c || { family_members: 1, active: true }, fields: [
    { name: "name", label: t("Full name"), required: true },
    ...(c ? [] : [{ name: "username", label: t("Username"), required: true }]),
    { name: "password", label: c ? "New password (leave blank to keep)" : t("Password"), type: "password", required: !c },
    { name: "phone", label: t("Phone") }, { name: "ward", label: t("Ward") }, { name: "address", label: t("Address") },
    { name: "family_members", label: t("Family members"), type: "number", min: 1 },
    ...(c ? [{ name: "active", label: "Account active", type: "checkbox" }] : [])], pairs: ["phone", "ward"],
    onSubmit: async (d) => { c ? await API.put("/citizens/" + c.id, d) : await API.post("/citizens", d); toast("Saved"); Router.go(); } });
  onAct(view, { add: () => form(null), edit: (el) => form(list.find((x) => x.id === +el.dataset.id)),
    del: async (el) => { if (await confirmBox("Delete this citizen and all their complaints, bills and applications?")) { await API.del("/citizens/" + el.dataset.id); Router.go(); } } });
};

/* ------------------------------------------------------------ Staff */
V.staff = async (view) => {
  const list = await API.get("/staff");
  const ad = isAdmin();
  const deptOpts = App.meta.departments.map((d) => [d.id, d.name]);
  view.innerHTML = head(t("Staff") + ` (${list.length})`, ad ? addBtn("add") : "") +
    table([t("Full name"), t("Username"), "Role", t("Department"), t("Phone"), "Open work", t("Status"), ...(ad ? [""] : [])],
      list.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.username)}</td><td>${esc(t(ROLE_LABEL[s.role]))}</td><td>${esc(s.department_name || "-")}</td><td>${esc(s.phone)}</td><td>${s.workload}</td>
        <td>${s.active ? '<span class="badge b-green">Active</span>' : '<span class="badge b-grey">Disabled</span>'}</td>
        ${ad ? `<td><div class="actions"><button class="btn sm" data-act="edit" data-id="${s.id}">${esc(t("Edit"))}</button><button class="btn sm danger" data-act="del" data-id="${s.id}">${esc(t("Delete"))}</button></div></td>` : ""}</tr>`));
  const form = (s) => formModal({ title: s ? t("Edit") : t("Add"), values: s || { role: "field_worker", active: true }, fields: [
    { name: "name", label: t("Full name"), required: true },
    ...(s ? [] : [{ name: "username", label: t("Username"), required: true }]),
    { name: "password", label: s ? "New password (leave blank to keep)" : t("Password"), type: "password", required: !s },
    { name: "role", label: "Role", type: "select", options: [["field_worker", t("Field worker")], ["department_head", t("Department head")], ["supervisor", t("Supervisor")]] },
    { name: "department_id", label: t("Department"), type: "select", options: [["", "-- none (supervisor) --"], ...deptOpts], hint: "Required for field workers and department heads" },
    { name: "phone", label: t("Phone") }, ...(s ? [{ name: "active", label: "Account active", type: "checkbox" }] : [])], pairs: ["role", "department_id"],
    onSubmit: async (d) => { s ? await API.put("/staff/" + s.id, d) : await API.post("/staff", d); toast("Saved"); Router.go(); } });
  onAct(view, { add: () => form(null), edit: (el) => form(list.find((x) => x.id === +el.dataset.id)),
    del: async (el) => { if (await confirmBox("Delete this staff member?")) { await API.del("/staff/" + el.dataset.id); Router.go(); } } });
};

/* ------------------------------------------------------------ Departments & categories */
V.departments = async (view) => {
  await reloadMeta();
  const { departments, categories } = App.meta;
  const dname = (id) => (departments.find((d) => d.id === id) || {}).name || "-";
  view.innerHTML = head(t("Departments"), addBtn("addDept")) +
    table([t("Department"), t("Description"), ""], departments.map((d) => `<tr><td><b>${esc(d.name)}</b></td><td>${esc(d.description)}</td>
      <td><div class="actions"><button class="btn sm" data-act="editDept" data-id="${d.id}">${esc(t("Edit"))}</button><button class="btn sm danger" data-act="delDept" data-id="${d.id}">${esc(t("Delete"))}</button></div></td></tr>`)) +
    `<div style="height:22px"></div>` + head(t("Categories"), addBtn("addCat")) +
    table([t("Category"), t("Department"), "Default priority", ""], categories.map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(dname(c.department_id))}</td><td>${badge(c.default_priority)}</td>
      <td><div class="actions"><button class="btn sm" data-act="editCat" data-id="${c.id}">${esc(t("Edit"))}</button><button class="btn sm danger" data-act="delCat" data-id="${c.id}">${esc(t("Delete"))}</button></div></td></tr>`));
  const deptForm = (d) => formModal({ title: d ? t("Edit") : t("Add"), values: d || {}, fields: [{ name: "name", label: t("Department"), required: true }, { name: "description", label: t("Description") }],
    onSubmit: async (x) => { d ? await API.put("/departments/" + d.id, x) : await API.post("/departments", x); toast("Saved"); Router.go(); } });
  const catForm = (c) => formModal({ title: c ? t("Edit") : t("Add"), values: c || { default_priority: "NORMAL" }, fields: [
    { name: "name", label: t("Category"), required: true },
    { name: "department_id", label: t("Department"), type: "select", options: [["", "-- none --"], ...departments.map((d) => [d.id, d.name])] },
    { name: "default_priority", label: "Default priority", type: "select", options: App.meta.priorities.map((p) => [p, st(p)]) }], pairs: ["department_id", "default_priority"],
    onSubmit: async (x) => { c ? await API.put("/categories/" + c.id, x) : await API.post("/categories", x); toast("Saved"); Router.go(); } });
  onAct(view, {
    addDept: () => deptForm(null), editDept: (el) => deptForm(departments.find((x) => x.id === +el.dataset.id)),
    delDept: async (el) => { if (await confirmBox("Delete this department? Staff and complaints keep their records but lose the link.")) { await API.del("/departments/" + el.dataset.id); Router.go(); } },
    addCat: () => catForm(null), editCat: (el) => catForm(categories.find((x) => x.id === +el.dataset.id)),
    delCat: async (el) => { if (await confirmBox("Delete this category?")) { await API.del("/categories/" + el.dataset.id); Router.go(); } },
  });
};

/* ------------------------------------------------------------ Reports */
V.reports = async (view) => {
  const r = await API.get("/reports/summary");
  const pr = r.projects;
  view.innerHTML = `<div class="stats">${stat("Average resolution time (hours)", r.resolution_hours, "info")}${stat("Project budget", money(pr.budget))}${stat("Project spending", money(pr.spent), "warn")}${stat("Average project progress %", Math.round(pr.avg_progress))}</div>
    <div class="toolbar"><h3 class="grow" style="margin:0">${esc(t("Download CSV"))}</h3>${["complaints", "citizens", "bills", "applications", "projects"].map((n) => `<a class="btn sm" href="/api/reports/export/${n}">${esc(pretty(n))}</a>`).join("")}</div>
    <h3>Department performance</h3>${table([t("Department"), "Complaints", t("Resolved"), t("Overdue"), "Avg rating"], r.departments.map((d) => `<tr><td>${esc(d.department)}</td><td>${d.total}</td><td>${d.resolved}</td><td>${d.overdue ? '<span class="badge b-red">' + d.overdue + "</span>" : 0}</td><td>${d.avg_rating || "-"}</td></tr>`))}
    <h3 style="margin-top:22px">Revenue</h3>${table(["Type", "Bills", "Total", t("Collected"), t("Pending dues")], r.revenue.map((x) => `<tr><td>${esc(x.bill_type)}</td><td>${x.bills}</td><td>${money(x.total)}</td><td>${money(x.collected)}</td><td>${money(x.pending)}</td></tr>`))}
    <h3 style="margin-top:22px">Population by ward</h3>${table([t("Ward"), t("Citizens"), t("Population")], r.by_ward.map((w) => `<tr><td>${esc(w.ward || "-")}</td><td>${w.citizens}</td><td>${w.population}</td></tr>`))}
    <h3 style="margin-top:22px">Overdue bills</h3>${table([t("Citizen"), "Type", t("Amount"), t("Due date")], r.overdue_bills.map((b) => `<tr><td>${esc(b.resident_name)}</td><td>${esc(b.bill_type)}</td><td>${money(b.amount)}</td><td>${fdate(b.due_date)}</td></tr>`), "No overdue bills.")}`;
};

/* ------------------------------------------------------------ Audit & messages */
V.audit = async (view) => {
  const list = await API.get("/audit");
  view.innerHTML = head(t("Audit log")) + table([t("Date"), "User", "Action", "Resource", "Detail"], list.map((a) => `<tr><td class="nowrap">${fdate(a.created_at)}</td><td>${esc(a.actor_name)}</td><td><span class="badge">${esc(a.action)}</span></td><td>${esc(a.resource)} ${a.resource_id ? "#" + a.resource_id : ""}</td><td>${esc(a.detail)}</td></tr>`));
};
V.messages = async (view) => {
  const list = await API.get("/messages");
  view.innerHTML = head(t("Messages")) + table([t("Date"), t("Your name"), t("Phone or email"), t("Message"), ""], list.map((m) => `<tr><td class="nowrap">${fdate(m.created_at)}</td><td>${esc(m.name)}</td><td>${esc(m.contact)}</td><td style="white-space:pre-wrap">${esc(m.message)}</td>
    <td><button class="btn sm danger" data-act="del" data-id="${m.id}">${esc(t("Delete"))}</button></td></tr>`));
  onAct(view, { del: async (el) => { await API.del("/messages/" + el.dataset.id); Router.go(); } });
};

/* ------------------------------------------------------------ Profile */
V.profile = async (view) => {
  const u = App.user;
  view.innerHTML = `<div class="two-col"><form class="form card" id="pf"><h3>${esc(t("Profile"))}</h3>
      <dl class="kv"><dt>${esc(t("Username"))}</dt><dd>${esc(u.username)}</dd><dt>Role</dt><dd>${esc(t(ROLE_LABEL[u.role]))}${u.department_name ? " &middot; " + esc(u.department_name) : ""}</dd></dl>
      <label>${esc(t("Full name"))}<input name="name" value="${esc(u.name)}" required maxlength="100"></label>
      <div class="grid2"><label>${esc(t("Phone"))}<input name="phone" value="${esc(u.phone)}" maxlength="20"></label><label>${esc(t("Ward"))}<input name="ward" value="${esc(u.ward)}" maxlength="50"></label></div>
      <label>${esc(t("Address"))}<input name="address" value="${esc(u.address)}" maxlength="200"></label>
      <label>${esc(t("Family members"))}<input name="family_members" type="number" min="1" value="${u.family_members || 1}"></label>
      <p class="error" role="alert"></p><button class="btn primary" type="submit" style="width:fit-content">${esc(t("Save"))}</button></form>
    <form class="form card" id="pw"><h3>${esc(t("Change password"))}</h3>
      <label>${esc(t("Current password"))}<input name="old_password" type="password" autocomplete="current-password" required></label>
      <label>${esc(t("New password"))}<input name="new_password" type="password" minlength="6" autocomplete="new-password" required></label>
      <p class="error" role="alert"></p><button class="btn primary" type="submit" style="width:fit-content">${esc(t("Change password"))}</button></form></div>`;
  $("#pf", view).onsubmit = async (e) => { e.preventDefault(); const er = $(".error", e.target); er.textContent = "";
    try { App.user = { ...App.user, ...(await API.put("/profile", readForm(e.target))) }; toast("Profile updated"); Shell.drawUser(); } catch (ex) { er.textContent = ex.message; } };
  $("#pw", view).onsubmit = async (e) => { e.preventDefault(); const er = $(".error", e.target); er.textContent = "";
    try { await API.post("/change-password", readForm(e.target)); e.target.reset(); toast("Password changed"); } catch (ex) { er.textContent = ex.message; } };
};
