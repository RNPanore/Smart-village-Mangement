/* Public website: Home, About, Features, How it works, Track, Contact, Login/Register */
const Public = {
  pages: ["home", "about", "features", "how", "track", "contact"],

  header(active) {
    const link = (p, label) => `<a href="#/${p === "home" ? "" : p}" class="${active === p ? "active" : ""}">${esc(t(label))}</a>`;
    return `<header class="pub-head">
      <a class="brand" href="#/" style="text-decoration:none;color:inherit"><div class="logo-mark sm">SV</div><span>${esc(t("Smart Village Management System"))}</span></a>
      <nav class="pub-nav">${link("home", "Home")}${link("about", "About")}${link("features", "Features")}${link("how", "How it works")}${link("track", "Track complaint")}${link("contact", "Contact")}</nav>
      <div class="pub-tools">
        <button class="icon-btn" data-act="lang" title="English / मराठी">${I18N.lang === "mr" ? "EN" : "मराठी"}</button>
        <button class="icon-btn" data-act="theme" title="${esc(t("Dark mode"))}" aria-label="${esc(t("Dark mode"))}">&#9728;</button>
        <a class="btn" href="#/login">${esc(t("Login"))}</a>
        <a class="btn primary" href="#/register">${esc(t("Register"))}</a>
      </div></header>`;
  },

  footer() {
    return `<footer class="pub-foot">&copy; ${new Date().getFullYear()} ${esc(t("Smart Village Management System"))} &middot; Gram Panchayat Digital Services</footer>`;
  },

  heroArt() {
    return `<svg viewBox="0 0 560 380" role="img" aria-label="Illustration of a village with fields, houses and a banyan tree">
      <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe9f5"/><stop offset="1" stop-color="#fdf3dc"/></linearGradient></defs>
      <rect width="560" height="380" fill="url(#sky)"/>
      <circle cx="450" cy="78" r="38" fill="#f7c85a"/>
      <path d="M0 250 Q90 180 190 235 T380 215 T560 240 V380 H0Z" fill="#8fc79b"/>
      <path d="M0 290 Q120 240 250 285 T560 275 V380 H0Z" fill="#5fae78"/>
      <path d="M0 335 Q140 300 300 330 T560 322 V380 H0Z" fill="#3f9461"/>
      <g fill="#e9d2a6"><rect x="70" y="238" width="62" height="42"/><rect x="170" y="252" width="54" height="36"/><rect x="400" y="246" width="66" height="44"/></g>
      <g fill="#b5543b"><path d="M62 240 L101 208 L140 240Z"/><path d="M164 254 L197 226 L230 254Z"/><path d="M392 248 L433 214 L474 248Z"/></g>
      <g fill="#7a5a3d"><rect x="93" y="258" width="16" height="22"/><rect x="190" y="268" width="14" height="20"/><rect x="424" y="266" width="16" height="24"/></g>
      <rect x="305" y="230" width="14" height="70" fill="#6f4e37"/>
      <g fill="#2e7d4f"><circle cx="312" cy="205" r="46"/><circle cx="278" cy="226" r="30"/><circle cx="346" cy="226" r="30"/></g>
      <g stroke="#6f4e37" stroke-width="3"><path d="M284 252 V290"/><path d="M340 252 V290"/></g>
      <g fill="#fff" opacity=".9"><ellipse cx="120" cy="70" rx="40" ry="13"/><ellipse cx="150" cy="60" rx="26" ry="11"/><ellipse cx="320" cy="48" rx="34" ry="11"/></g>
    </svg>`;
  },

  home(ov) {
    return `<section class="hero"><div>
        <h1>${esc(t("Gram Panchayat services, in one place."))}</h1>
        <p class="lead">${esc(t("Raise issues, follow their progress, pay village dues and stay informed about everything happening in your village."))}</p>
        <div class="cta"><a class="btn primary" href="#/register">${esc(t("Get started"))}</a><a class="btn" href="#/track">${esc(t("Track complaint"))}</a></div>
        <div class="public-stats">
          ${stat("Citizens", ov.citizens)}${stat("Total complaints", ov.complaints, "warn")}${stat("Resolved", ov.resolved, "info")}${stat("Projects", ov.projects)}
        </div></div>
      <div>${this.heroArt()}</div></section>
      ${this.featureSection(true)}
      <section class="section alt"><h2>${esc(t("Latest notices"))}</h2>
        <div class="grid-cards">${ov.notices.length ? ov.notices.map((n) => `<div class="feat"><div class="meta"><span class="badge b-blue">${esc(n.category)}</span>${fdate(n.created_at)}</div><h4>${esc(n.title)}</h4><p>${esc(n.content)}</p></div>`).join("") : `<p class="muted">${esc(t("No records yet."))}</p>`}</div></section>`;
  },

  featureList: [
    ["📣", "Complaints with live tracking", "Report water, road, sanitation or health issues with photos and follow every step until it is fixed."],
    ["👥", "Role-based workspaces", "Citizens, field workers, department heads, the supervisor and the village administrator each get their own dashboard."],
    ["⏱️", "Deadlines (SLA)", "Every complaint has a target time by priority, and overdue work is highlighted for staff."],
    ["💰", "Taxes and bills", "House tax, water and other dues are listed per family and can be paid online."],
    ["🌾", "Government schemes", "Browse schemes, check eligibility and apply, then see the approval status."],
    ["📅", "Events and notices", "Gram Sabha dates, health camps and announcements, with one-tap event registration."],
    ["🏗️", "Development projects", "See budgets, spending and progress of every village development work."],
    ["📊", "Reports and audit trail", "Department performance, collections, CSV exports and a log of important actions."],
  ],
  featureSection(short) {
    const list = short ? this.featureList.slice(0, 4) : this.featureList;
    return `<section class="section"><h2>${esc(t("Features"))}</h2><p class="sub">${esc(t("Smart Village Management System"))}</p>
      <div class="grid-cards">${list.map(([ic, h, p]) => `<div class="feat"><div class="ic">${ic}</div><h4>${esc(h)}</h4><p>${esc(p)}</p></div>`).join("")}</div>
      ${short ? `<p style="margin-top:18px"><a href="#/features">${esc(t("Features"))} &rarr;</a></p>` : ""}</section>`;
  },

  about() {
    return `<section class="section narrow"><h2>${esc(t("About"))}</h2>
      <p>The Smart Village Management System helps a Gram Panchayat run day-to-day services in a transparent way. Villagers can report problems, see who is working on them and how long it is taking. Panchayat staff get a clear queue of work, and the Sarpanch and administrator see how every department is performing.</p>
      <p>It brings together things that are usually scattered across registers and phone calls: complaints, notices, tax collection, welfare schemes, events and development projects.</p>
      <h3>Who uses it</h3>
      <div class="grid-cards">
        ${[["Citizen", "Raises complaints, pays dues, applies for schemes, joins events."],
          ["Field worker", "Sees assigned complaints and updates the work status."],
          ["Department head", "Manages the department queue and assigns workers."],
          ["Supervisor", "Oversees all resolved work and can reopen it for rework."],
          ["Village Administrator", "Manages people, departments, notices, schemes, bills and reports."]]
          .map(([r, d]) => `<div class="feat"><h4>${esc(t(r))}</h4><p>${esc(d)}</p></div>`).join("")}
      </div></section>`;
  },

  how() {
    const steps = [["Register", "Create a free citizen account with your name, ward and phone number."],
      ["Raise a complaint", "Pick a category, describe the issue and attach photos if you have them. You get a reference code."],
      ["Work is assigned", "The department head assigns a field worker. You see each update in the timeline."],
      ["Issue is resolved", "The worker marks it resolved with a note. You can rate the work or reopen it if it is not fixed."]];
    return `<section class="section"><h2>${esc(t("How it works"))}</h2><p class="sub">Four simple steps from problem to solution.</p>
      <div class="steps">${steps.map(([h, p]) => `<div class="step"><h4>${esc(t(h))}</h4><p class="muted">${esc(p)}</p></div>`).join("")}</div></section>`;
  },

  track() {
    return `<section class="section narrow"><h2>${esc(t("Track your complaint"))}</h2>
      <p class="sub">No login needed. Enter the reference code you received, for example <b>SV-2026-00001</b>.</p>
      <form class="track-box" id="trackForm"><input name="ref" placeholder="${esc(t("Enter reference code"))}" required maxlength="32" aria-label="${esc(t("Reference"))}">
        <button class="btn primary" type="submit">${esc(t("Track"))}</button></form>
      <p class="error" id="trackErr" role="alert"></p><div id="trackOut"></div></section>`;
  },

  contact() {
    return `<section class="section narrow"><h2>${esc(t("Contact"))}</h2>
      <p class="sub">Gram Panchayat Office &middot; Open Monday to Saturday, 10 AM to 5 PM. For urgent problems like a burst pipeline, please raise a complaint with URGENT priority.</p>
      <form class="form card" id="contactForm">
        <label>${esc(t("Your name"))}<input name="name" required maxlength="100"></label>
        <label>${esc(t("Phone or email"))}<input name="contact" maxlength="120"></label>
        <label>${esc(t("Message"))}<textarea name="message" required maxlength="2000"></textarea></label>
        <p class="error" role="alert"></p>
        <button class="btn primary" type="submit">${esc(t("Send message"))}</button></form></section>`;
  },

  authPage(mode, sessionUser) {
    const resume = sessionUser ? `<div class="demo-box" style="margin-bottom:14px">You are signed in as <b>${esc(sessionUser.name)}</b>.
        <a class="btn sm primary" href="#/app/dashboard" style="width:fit-content">${esc(t("Dashboard"))}</a></div>` : "";
    return `<div class="auth"><div class="auth-hero"><div class="auth-hero-inner">
        <div class="logo-mark">SV</div><h1>${esc(t("Smart Village Management System"))}</h1>
        <p>${esc(t("Raise issues, follow their progress, pay village dues and stay informed about everything happening in your village."))}</p>
        <ul><li>Raise and track complaints with photos</li><li>Pay house tax and water bills online</li><li>Apply for government schemes</li><li>Follow village development projects</li></ul>
      </div></div>
      <div class="auth-pane"><div class="auth-card">
        <a class="back-home" href="#/">&larr; ${esc(t("Home"))}</a>
        <div class="tabs"><a class="tab ${mode === "login" ? "active" : ""}" href="#/login" style="text-align:center;text-decoration:none">${esc(t("Login"))}</a>
          <a class="tab ${mode === "register" ? "active" : ""}" href="#/register" style="text-align:center;text-decoration:none">${esc(t("Register"))}</a></div>
        ${resume}
        ${mode === "login" ? `<form id="loginForm" class="form">
          <label>${esc(t("Username"))}<input name="username" autocomplete="username" required maxlength="40"></label>
          <label>${esc(t("Password"))}<input name="password" type="password" autocomplete="current-password" required></label>
          <p class="error" role="alert"></p>
          <button class="btn primary block" type="submit">${esc(t("Login"))}</button>
          <div class="demo-box"><strong>${esc(t("Demo accounts"))}</strong>
            ${[["admin", "admin123", "Village Administrator"], ["sarpanch", "staff123", "Supervisor"], ["water_head", "staff123", "Department head"],
              ["water_worker", "staff123", "Field worker"], ["ramesh", "citizen123", "Citizen"]]
              .map(([u, p, r]) => `<button type="button" class="link" data-fill="${u}|${p}">${esc(t(r))}: ${u} / ${p}</button>`).join("")}</div></form>`
        : `<form id="registerForm" class="form">
          <label>${esc(t("Full name"))}<input name="name" required maxlength="100"></label>
          <div class="grid2"><label>${esc(t("Username"))}<input name="username" autocomplete="username" required maxlength="40"></label>
            <label>${esc(t("Password"))}<input name="password" type="password" minlength="6" autocomplete="new-password" required></label></div>
          <div class="grid2"><label>${esc(t("Phone"))}<input name="phone" inputmode="tel" maxlength="20"></label>
            <label>${esc(t("Ward"))}<input name="ward" placeholder="Ward 2" maxlength="50"></label></div>
          <label>${esc(t("Address"))}<input name="address" maxlength="200"></label>
          <label>${esc(t("Family members"))}<input name="family_members" type="number" min="1" value="1"></label>
          <p class="error" role="alert"></p>
          <button class="btn primary block" type="submit">${esc(t("Create account"))}</button></form>`}
      </div></div></div>`;
  },

  timelineHtml(events) {
    return `<ul class="timeline">${events.map((e) => `<li class="${e.event_type === "COMMENT" ? "comment" : ""}">
      <strong>${esc(e.event_type === "STATUS_CHANGE" || e.event_type === "ASSIGNED" || e.event_type === "SUBMITTED" ? st(e.new_status || e.event_type) : st(e.event_type))}</strong>
      <span class="muted small">${fdate(e.created_at)}</span></li>`).join("")}</ul>`;
  },

  async render(page) {
    const root = $("#root");
    let ov = null;
    if (page === "home") { try { ov = await API.get("/public/overview"); } catch (e) { ov = { citizens: 0, complaints: 0, resolved: 0, projects: 0, notices: [] }; } }
    const body = { home: () => this.home(ov), about: () => this.about(), features: () => this.featureSection(false), how: () => this.how(), track: () => this.track(), contact: () => this.contact() }[page]();
    root.innerHTML = `${this.header(page)}<main class="pub-main">${body}</main>${this.footer()}`;
    document.title = t("Smart Village Management System");

    const tf = $("#trackForm");
    if (tf) tf.addEventListener("submit", async (e) => {
      e.preventDefault();
      const out = $("#trackOut"), er = $("#trackErr");
      er.textContent = ""; out.innerHTML = "";
      try {
        const c = await API.get("/public/track/" + encodeURIComponent(tf.ref.value.trim()));
        out.innerHTML = `<div class="card"><div class="card-head"><h3>${esc(c.reference_code)}</h3>${badge(c.status)}</div>
          <p><b>${esc(c.title)}</b><br><span class="muted">${esc(c.category || "")} &middot; ${badge(c.priority)} &middot; ${esc(t("Submitted"))} ${fdate(c.created_at)}</span></p>
          <h4>${esc(t("Timeline"))}</h4>${this.timelineHtml(c.timeline)}</div>`;
      } catch (ex) { er.textContent = ex.message; }
    });
    const cf = $("#contactForm");
    if (cf) cf.addEventListener("submit", async (e) => {
      e.preventDefault();
      const er = $(".error", cf); er.textContent = "";
      try { await API.post("/public/contact", readForm(cf)); cf.reset(); toast("Thank you! The Panchayat office will get back to you."); }
      catch (ex) { er.textContent = ex.message; }
    });
  },

  renderAuth(mode, sessionUser, onAuthed) {
    $("#root").innerHTML = this.authPage(mode, sessionUser);
    document.title = t(mode === "login" ? "Login" : "Register") + " - " + t("Smart Village Management System");
    const form = $("#loginForm") || $("#registerForm");
    $$("[data-fill]").forEach((b) => b.addEventListener("click", () => {
      const [u, p] = b.dataset.fill.split("|"); form.username.value = u; form.password.value = p;
    }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const er = $(".error", form), btn = $("button[type=submit]", form);
      er.textContent = ""; btn.disabled = true;
      try {
        const user = await API.post(mode === "login" ? "/login" : "/register", readForm(form));
        onAuthed(user);
      } catch (ex) { er.textContent = ex.message; btn.disabled = false; }
    });
  },
};
