/* Router, application shell and start-up */
const Shell = {
  built: false,
  drawUser() {
    const box = $("#userBox");
    if (box) box.innerHTML = `<b>${esc(App.user.name)}</b><span class="muted">${esc(t(ROLE_LABEL[App.user.role]))}${App.user.department_name ? " &middot; " + esc(App.user.department_name) : ""}</span>`;
  },
  build() {
    const nav = NAV[App.user.role];
    let lastSec = "", items = "";
    nav.forEach(([key, ic, label, sec]) => {
      if (sec !== lastSec) { items += `<div class="nav-sec">${esc(t(sec))}</div>`; lastSec = sec; }
      items += `<button class="nav-item" data-view="${key}"><span class="ic">${ic}</span>${esc(t(label))}</button>`;
    });
    $("#root").innerHTML = `<div class="app">
      <aside id="sidebar" class="sidebar" aria-label="Main navigation">
        <div class="brand"><div class="logo-mark sm">SV</div><span>Smart Village</span></div>
        <nav id="nav">${items}</nav>
        <div class="side-foot"><div id="userBox" class="user-box"></div>
          <div style="display:flex;gap:6px"><button class="icon-btn" id="langBtn" title="English / मराठी">${I18N.lang === "mr" ? "EN" : "मराठी"}</button>
          <button class="icon-btn" id="themeBtn" aria-label="${esc(t("Dark mode"))}" title="${esc(t("Dark mode"))}">&#9728;</button>
          <button class="btn ghost" id="logoutBtn" style="flex:1">${esc(t("Logout"))}</button></div></div></aside>
      <div class="scrim" id="scrim"></div>
      <main class="main"><header class="topbar"><button id="menuBtn" class="icon-btn" aria-label="Menu">&#9776;</button><h2 id="pageTitle"></h2></header>
        <div id="view" class="view" tabindex="-1"></div></main></div>`;
    this.drawUser();
    const side = $("#sidebar"), scrim = $("#scrim");
    const toggle = (open) => { side.classList.toggle("open", open); scrim.classList.toggle("show", open); };
    $("#menuBtn").onclick = () => toggle(!side.classList.contains("open"));
    scrim.onclick = () => toggle(false);
    $("#nav").onclick = (e) => { const b = e.target.closest("[data-view]"); if (b) { toggle(false); location.hash = "#/app/" + b.dataset.view; } };
    $("#themeBtn").onclick = () => Theme.toggle();
    $("#langBtn").onclick = () => { I18N.set(I18N.lang === "mr" ? "en" : "mr"); Shell.built = false; Router.go(); };
    $("#logoutBtn").onclick = async () => { try { await API.post("/logout"); } catch (e) { /* ignore */ } App.user = null; App.meta = null; location.hash = "#/"; Router.go(); };
  },
};

const Router = {
  async go() {
    const hash = location.hash.replace(/^#\/?/, "");
    const [first, second] = hash.split("/");
    window.scrollTo(0, 0);
    try {
      if (first === "app") {
        if (!App.user) { location.hash = "#/login"; return; }
        return await this.app(second || "dashboard");
      }
      if (first === "login" || first === "register") {
        // login / register are always reachable, even with an active session
        Shell.built = false;
        return Public.renderAuth(first, App.user, async (user) => {
          App.user = user; await reloadMeta(); location.hash = "#/app/dashboard";
        });
      }
      Shell.built = false;
      const page = Public.pages.includes(first) ? first : "home";
      return await Public.render(page);
    } catch (e) { fail(e); }
  },

  async app(key) {
    const allowed = NAV[App.user.role].map((n) => n[0]);
    if (!allowed.includes(key) || !V[key]) { location.hash = "#/app/dashboard"; return; }
    if (!Shell.built || !$("#view")) { Shell.build(); Shell.built = true; }
    currentView = key;
    const item = NAV[App.user.role].find((n) => n[0] === key);
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === (key === "raise" ? "complaints" : key)));
    $("#pageTitle").textContent = t(item[2]);
    document.title = t(item[2]) + " - " + t("Smart Village Management System");
    const view = $("#view");
    view.innerHTML = `<p class="muted">${esc(t("Loading..."))}</p>`;
    // replace node so previous click handlers are dropped
    const fresh = view.cloneNode(false);
    view.replaceWith(fresh);
    fresh.innerHTML = `<p class="muted">${esc(t("Loading..."))}</p>`;
    try {
      await V[key](fresh);
    } catch (e) {
      if (e.status === 401) { App.user = null; Shell.built = false; toast("Your session has expired. Please log in again.", true); location.hash = "#/login"; return; }
      fresh.innerHTML = `<div class="card empty">${esc(e.message)}</div>`;
    }
  },
};

document.addEventListener("click", (e) => {
  // public header / auth helpers (event delegation)
  const act = e.target.closest("[data-act]");
  if (!act) return;
  if (act.dataset.act === "lang" && !$("#sidebar")) { I18N.set(I18N.lang === "mr" ? "en" : "mr"); Router.go(); }
  if (act.dataset.act === "theme" && !$("#sidebar")) Theme.toggle();
});
window.addEventListener("hashchange", () => Router.go());

(async function start() {
  try {
    App.user = await API.get("/me");
    if (App.user) await reloadMeta();
  } catch (e) { App.user = null; }
  Router.go();
})();
