/* Better NYC v1 app logic: auth -> dashboard (benefits, renew, tracker) */
(function () {
  "use strict";

  var NOT_CONFIGURED = !SUPABASE_URL || !SUPABASE_ANON_KEY;
  var sb = null;
  if (!NOT_CONFIGURED) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  function $(id) { return document.getElementById(id); }
  function show(el) { el.classList.add("show"); }
  function hide(el) { el.classList.remove("show"); }
  function err(msg) {
    var e = $("form-err");
    e.textContent = msg;
    show(e);
  }

  function money(n) {
    return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  /* ---------- views ---------- */
  function setView(name) {
    ["view-setup", "view-auth", "view-app"].forEach(function (v) {
      $(v).style.display = v === "view-" + name ? "" : "none";
    });
  }

  /* ---------- auth ---------- */
  var mode = "signin"; // or "signup"
  function setMode(m) {
    mode = m;
    $("auth-title").textContent = m === "signin" ? "Welcome back." : "Create your account.";
    $("auth-hint").textContent = m === "signin"
      ? "Sign in to see your benefits dashboard."
      : "One account. Every benefit. Thirty seconds.";
    $("auth-submit").innerHTML = '<span>' + (m === "signin" ? "Sign in" : "Create account") + '</span><span class="arr">→</span>';
    $("switch-q").textContent = m === "signin"
      ? "New here?" : "Already have an account?";
    $("switch-btn").textContent = m === "signin" ? "Create one" : "Sign in";
    hide($("form-err"));
  }

  async function handleAuth(ev) {
    ev.preventDefault();
    hide($("form-err"));
    var email = $("email").value.trim();
    var password = $("password").value;
    if (!email || !password) return err("Enter your email and password.");
    var btn = $("auth-submit");
    btn.disabled = true;
    try {
      var res = mode === "signin"
        ? await sb.auth.signInWithPassword({ email: email, password: password })
        : await sb.auth.signUp({ email: email, password: password });
      if (res.error) throw res.error;
      await boot();
    } catch (e) {
      err(e.message || "Something went wrong. Try again.");
    } finally {
      btn.disabled = false;
    }
  }

  async function signOut() {
    await sb.auth.signOut();
    location.reload();
  }

  /* ---------- dashboard ---------- */
  function benefitCard(b) {
    var cls = b.program === "SNAP" ? "snap" : "cash";
    var label = b.program === "SNAP" ? "SNAP" : "CASH AID";
    var sub = b.program === "SNAP"
      ? "renews " + fmtDate(b.renews_on)
      : (b.status || "active");
    return (
      '<div class="bencard ' + cls + '">' +
        '<div class="t">' + label + "</div>" +
        '<div class="amt">' + money(b.amount) + "</div>" +
        '<div class="s">' + sub + "</div>" +
      "</div>"
    );
  }

  async function loadDashboard(user) {
    var benRes = await sb.from("benefits").select("*").eq("user_id", user.id);
    if (benRes.error) throw benRes.error;
    var benefits = benRes.data || [];

    var appRes = await sb.from("applications")
      .select("*").eq("user_id", user.id)
      .order("created_at", { ascending: false }).limit(1);
    if (appRes.error) throw appRes.error;
    var app = (appRes.data || [])[0] || null;

    var events = [];
    if (app) {
      var evRes = await sb.from("application_events")
        .select("*").eq("application_id", app.id).order("position");
      if (evRes.error) throw evRes.error;
      events = evRes.data || [];
    }

    var total = benefits.reduce(function (s, b) { return s + Number(b.amount || 0); }, 0);
    var name = (user.email || "New Yorker").split("@")[0];
    name = name.charAt(0).toUpperCase() + name.slice(1);

    var snap = benefits.find(function (b) { return b.program === "SNAP"; });
    var renewLabel = snap && snap.renews_on
      ? "Renew SNAP · due " + fmtDate(snap.renews_on)
      : "Renew SNAP";

    var doneCount = events.filter(function (e) { return e.done; }).length;
    var pct = events.length ? Math.round((doneCount / events.length) * 100) : 0;

    $("dash").innerHTML =
      '<div class="hello serif">Good morning, <i>' + escapeHtml(name) + ".</i></div>" +
      '<div class="total"><div class="l">TOTAL BENEFITS</div>' +
      '<div class="v">' + money(total) + "<span>/mo</span></div></div>" +
      '<div class="bencards">' + benefits.map(benefitCard).join("") + "</div>" +
      '<div class="okmsg" id="okmsg"></div>' +
      '<button class="btn block" id="renew-btn"><span>' + escapeHtml(renewLabel) +
      "<small>2 taps · 30 seconds</small></span>" + '<span class="arr">→</span></button>' +
      (events.length
        ? '<div class="track"><div class="l">APPLICATION STATUS</div>' +
          '<div class="pbar"><i style="width:' + pct + '%"></i></div>' +
          '<div class="steps">' + events.map(function (e) {
              return '<div class="step' + (e.done ? " done" : "") + '">' +
                '<div class="dot">' + (e.done ? "✓" : (e.position || "·")) + "</div>" +
                escapeHtml(e.label) + "</div>";
            }).join("") + "</div></div>"
        : "");

    $("renew-btn").addEventListener("click", renewSnap);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  async function renewSnap() {
    var btn = $("renew-btn");
    btn.disabled = true;
    try {
      var userRes = await sb.auth.getUser();
      var user = userRes.data.user;
      var d = new Date();
      d.setDate(d.getDate() + 30);
      var iso = d.toISOString().slice(0, 10);

      var up = await sb.from("benefits")
        .update({ renews_on: iso })
        .eq("user_id", user.id).eq("program", "SNAP");
      if (up.error) throw up.error;

      var appRes = await sb.from("applications")
        .select("id").eq("user_id", user.id)
        .order("created_at", { ascending: false }).limit(1);
      var app = (appRes.data || [])[0];
      if (app) {
        await sb.from("application_events").insert({
          application_id: app.id,
          label: "SNAP renewed · " + fmtDate(iso),
          done: true,
          position: 99,
        });
      }
      var ok = $("okmsg");
      ok.textContent = "Done — SNAP renewed through " + fmtDate(iso) + ". That was 2 taps.";
      show(ok);
      setTimeout(boot, 1200);
    } catch (e) {
      var ok2 = $("okmsg");
      ok2.textContent = "Couldn't renew: " + (e.message || "try again");
      ok2.style.borderColor = "rgba(255,60,40,.4)";
      show(ok2);
    } finally {
      btn.disabled = false;
    }
  }

  /* ---------- boot ---------- */
  async function boot() {
    if (NOT_CONFIGURED) { setView("setup"); return; }
    var res = await sb.auth.getSession();
    var session = res.data.session;
    if (!session) { setView("auth"); return; }
    try {
      await loadDashboard(session.user);
      setView("app");
    } catch (e) {
      err("Couldn't load your dashboard: " + (e.message || e));
      setView("auth");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (NOT_CONFIGURED) { setView("setup"); return; }
    setMode("signin");
    $("auth-form").addEventListener("submit", handleAuth);
    $("switch-btn").addEventListener("click", function () {
      setMode(mode === "signin" ? "signup" : "signin");
    });
    $("signout").addEventListener("click", signOut);
    boot();
  });
})();
