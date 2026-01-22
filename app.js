const CONTENT_URL = "./content.json";
const OPENED_KEY = "openedCards:v1";
const CONTENT_VERSION_KEY = "contentVersion:v1";

const els = {
  title: document.getElementById("title"),
  logo: document.getElementById("logo"),
  status: document.getElementById("status"),
  grid: document.getElementById("grid"),
  refreshBtn: document.getElementById("refreshBtn"),
  dd: document.getElementById("dd"),
  hh: document.getElementById("hh"),
  mm: document.getElementById("mm"),
  confettiHost: document.getElementById("confettiHost"),
  versionTag: document.getElementById("versionTag")
};

let model = null;
let timerInterval = null;
let contentLoadSeq = 0;
let contentAbort = null;

// iOS WebClip (standalone) kan cachea HTML/JS aggressivt.
// Detta tvingar en "ny" URL per session så dokumentet hämtas på nytt.
(function bustStandaloneDocCacheOncePerSession() {
  const isStandalone = window.navigator.standalone === true;
  if (!isStandalone) return;

  const KEY = "standaloneDocBust:v1";
  if (sessionStorage.getItem(KEY)) return;

  sessionStorage.setItem(KEY, "1");
  const u = new URL(window.location.href);
  u.searchParams.set("v", String(Date.now()));
  window.location.replace(u.toString());
})();

(function wireRefreshPressFeedback() {
  const btn = els.refreshBtn;
  if (!btn) return;

  const pressOn  = () => btn.classList.add("is-pressed");
  const pressOff = () => btn.classList.remove("is-pressed");

  // Pointer events (modern)
  btn.addEventListener("pointerdown", pressOn, { passive: true });
  btn.addEventListener("pointerup", pressOff, { passive: true });
  btn.addEventListener("pointercancel", pressOff, { passive: true });
  btn.addEventListener("pointerleave", pressOff, { passive: true });

  // Fallback for older iOS behavior
  btn.addEventListener("touchstart", pressOn, { passive: true });
  btn.addEventListener("touchend", pressOff, { passive: true });
  btn.addEventListener("touchcancel", pressOff, { passive: true });
})();

function readOpenedSet() {
  try {
    const raw = localStorage.getItem(OPENED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set((Array.isArray(arr) ? arr : []).map(v => String(v)));
  } catch {
    return new Set();
  }
}

function writeOpenedSet(set) {
  localStorage.setItem(OPENED_KEY, JSON.stringify([...set]));
}

function markCardOpened(cardId, { rerender = true } = {}) {
  const opened = readOpenedSet();
  opened.add(String(cardId));

  const ok = writeOpenedSet(opened);
  if (!ok) return false;

  if (rerender) render();
  return true;
}

function setStatus(msg) {
  els.status.textContent = msg || "";
}

function fmt2(n) {
  return String(n).padStart(2, "0");
}

function splitRemaining(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const mins = Math.floor((total % 3600) / 60);
  return { days, hours, mins };
}

function updateCountdown() {
  if (!model?.site?.eventTime) return;

  const target = new Date(model.site.eventTime).getTime();
  const now = Date.now();
  const diff = target - now;

  const { days, hours, mins  } = splitRemaining(diff);
  els.dd.textContent = String(days);
  els.hh.textContent = fmt2(hours);
  els.mm.textContent = fmt2(mins);

  // När tiden passerat: rendera om så locked -> unlockable
  if (diff <= 0) {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      // låt den stå kvar på 0 och uppdatera kortläget ibland
      refreshCardStates();
    }, 5000);
    refreshCardStates(true);
  }
}

function cardState(card, openedSet) {
  const now = Date.now();
  const unlockAt = new Date(card.unlockAt).getTime();
  const isOpen = openedSet.has(String(card.id));

  if (isOpen) return "open";
  if (now >= unlockAt) return "unlockable";
  return "locked";
}

function friendlyDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("sv-SE", { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

function uiIcon(key) {
  const url = model?.site?.ui?.icons?.[key];
  return typeof url === "string" && url.trim().length ? url.trim() : null;
}

function stateIconHtml(state) {
  const key = state === "locked" ? "locked" : state === "unlockable" ? "unlockable" : null;
  const iconUrl = key ? uiIcon(key) : null;

  if (iconUrl) {
    return `<img class="stateIcon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">`;
  }

  // fallback om du inte har valt bilder än
  if (state === "unlockable") return `<span class="unlockIcon" aria-hidden="true"></span>`;
  return `<span class="lockIcon" aria-hidden="true"></span>`;
}

function openedHeaderHtml(card) {
  const iconUrl = card?.headerIcon || uiIcon("openedHeader") || null;
  if (!iconUrl) return "";

  return `
    <span class="headerIconWrap" aria-hidden="true">
      <img class="headerIconImg" src="${escapeHtml(iconUrl)}" alt="">
    </span>
  `;
}

function openInnerHtml(card) {
  const alt = card?.imageAlt ? escapeHtml(card.imageAlt) : "";
  return `
    <div class="cardHeader openHeader">
      ${openedHeaderHtml(card)}
      <h2 class="openTitle">${escapeHtml(card.title)}</h2>
    </div>

    ${card.image ? `<img class="openMedia" src="${escapeHtml(card.image)}" alt="${alt}">` : ""}

    <p class="cardText">${escapeHtml(card.text)}</p>
  `;
}

function closedInnerHtml(card, state, teaser) {
  const t = (teaser && String(teaser).trim().length) ? teaser : card.title;

  return `
    <div class="closedHeader">
      ${stateIconHtml(state)}
      <h2 class="teaserTitle">${escapeHtml(t)}</h2>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

function render() {
  if (!model) return;

  // VIKTIGT: tvinga en full omrender vid varje ny loadContent()
  els.grid.innerHTML = "";

  const opened = readOpenedSet(); // läs varje render (inte cache:a globalt)

  // header
  document.title = model.site?.title || "Sida";
  els.title.textContent = model.site?.title || "";

  const logoUrl = model.site?.logo;
  if (logoUrl) {
    els.logo.src = logoUrl;
    els.logo.style.display = "block";
    els.logo.onerror = () => { els.logo.style.display = "none"; };
  } else {
    els.logo.style.display = "none";
  }

  // cards
  const cards = Array.isArray(model.cards) ? model.cards : [];
  // sort: tidigast unlock först (eller byt till senaste först om du vill)
  cards.sort((a, b) => new Date(b.unlockAt).getTime() - new Date(a.unlockAt).getTime());

  els.grid.innerHTML = "";
  for (const c of cards) {
    const el = document.createElement("article");
    const state = cardState(c, opened);
    const unlockLabel = friendlyDate(c.unlockAt);          // datum-only
    const teaser = c.preview?.teaser ?? c.title ?? "Snart…";

    el.className = `card ${state}`;
    el.dataset.cardId = c.id;

    el.innerHTML = `
    <div class="inner">
        ${state === "open" ? openInnerHtml(c) : closedInnerHtml(c, state, teaser)}
    </div>

    <div class="door" aria-hidden="true"></div>

    ${state !== "open" ? `
        <div class="stateBadge ${state}">
                ${
                    state === "unlockable"
                        ? `<button class="openBtn" type="button">ÖPPNA</button>`
                        : `<span class="dateText">${escapeHtml(unlockLabel)}</span>`
                }
        </div>
    ` : ``}
    `;

    // click behavior
    el.addEventListener("click", (ev) => {
      const openedSet = readOpenedSet();
      const st = cardState(c, openedSet);

      // Om man klickar på knappen: hantera det, stoppa dubbeltriggers
      if (ev.target && ev.target.classList?.contains("openBtn")) {
        ev.preventDefault();
        ev.stopPropagation();
      }

      if (st === "locked") {
        el.classList.remove("clunk");
        // reflow för att alltid trigga anim
        void el.offsetWidth;
        el.classList.add("clunk");
        return;
      }

      if (st === "unlockable") {
        // Spara öppnat-läge utan att re-rendera hela listan (annars tappar vi referensen till klickat kort)
        markCardOpened(c.id, { rerender: false });

        // Starta sömlös övergång
        el.classList.remove("unlockable");
        el.classList.add("opening", "open"); // open triggar dörr-rotationen

        const badge = el.querySelector(".stateBadge");
        const inner = el.querySelector(".inner");

        // Ta bort badgen efter att den hunnit fade:a ut
        if (badge) setTimeout(() => badge.remove(), 280);

        // Byt innehåll nära slutet av dörr-anim (din door = 900ms)
        setTimeout(() => {
            if (inner) inner.innerHTML = openInnerHtml(c);

            el.classList.remove("opening");
            el.classList.add("justOpened");
            setTimeout(() => el.classList.remove("justOpened"), 450);
        }, 720);

        burstConfetti(el);
      }
    });

    els.grid.appendChild(el);
  }

  refreshCardStates();
}

function refreshCardStates(force = false) {
  const opened = readOpenedSet();
  const nodes = els.grid.querySelectorAll(".card");
  nodes.forEach((node) => {
    const id = node.dataset.cardId;
    const card = model.cards.find(x => x.id === id);
    if (!card) return;

    const st = cardState(card, opened);
    const hasClass = node.classList.contains(st);

    if (!hasClass || force) {
      node.classList.remove("locked", "unlockable", "open");
      node.classList.add(st);
      // enklast: rerender om states ändras (små listor -> ok)
      if (!hasClass) render();
    }
  });
}

// Canvas-baserad confetti med enkel fysik (realistisk spridning + fall)
const confettiEngine = (() => {
  let canvas = null;
  let ctx = null;
  let dpr = 1;
  let w = 0, h = 0;

  let particles = [];
  let rafId = null;
  let lastT = 0;
  let running = false;

  // Tweak här om du vill:
  const GRAVITY = 1200;     // px/s^2
  const AIR_DRAG = 0.985;   // per frame-ish
  const WIND_STRENGTH = 120; // px/s^2
  const MAX_LIFE = 2.6;     // sek

  function ensureCanvas() {
    if (canvas && ctx) return;

    canvas = document.createElement("canvas");
    canvas.className = "confettiCanvas";
    els.confettiHost.appendChild(canvas);

    ctx = canvas.getContext("2d", { alpha: true });
    resize();
    window.addEventListener("resize", resize, { passive: true });
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    w = window.innerWidth;
    h = window.innerHeight;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function wind(t, y) {
    // mjuk vind som varierar i tid + lite beroende på höjd
    return (
      Math.sin(t * 0.8) * WIND_STRENGTH +
      Math.sin((t * 1.7) + y * 0.004) * (WIND_STRENGTH * 0.6)
    );
  }

  function rand(min, max) { return min + Math.random() * (max - min); }

  function makeParticle(x, y) {
    const typeRoll = Math.random();
    const type = typeRoll < 0.18 ? "circle" : typeRoll < 0.35 ? "ribbon" : "rect";

    let pw = rand(6, 12);
    let ph = rand(10, 18);
    if (type === "circle") { ph = pw; }
    if (type === "ribbon") { pw = rand(4, 7); ph = rand(18, 34); }

    // Större spridning: bredare vinkel + högre initial fart
    const angle = rand((-Math.PI / 2) - 1.1, (-Math.PI / 2) + 1.1); // uppåt med stor sid-spridning
    const speed = rand(650, 1250);

    const hue = Math.floor(rand(0, 360));
    const colorA = `hsla(${hue}, 95%, 65%, 0.95)`;
    const colorB = `hsla(${(hue + rand(20, 70)) % 360}, 95%, 60%, 0.95)`;

    return {
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      ax: 0,
      ay: GRAVITY,

      w: pw,
      h: ph,
      type,

      // rotation + “flip” för realistiskt tumlande
      angle: rand(0, Math.PI * 2),
      spin: rand(-10, 10),          // rad/s
      flip: rand(0, Math.PI * 2),
      flipSpeed: rand(8, 18),       // rad/s

      // färg (vi simulerar framsida/baksida via flip)
      c1: colorA,
      c2: colorB,

      life: 0,
      maxLife: rand(1.6, MAX_LIFE)
    };
  }

  function drawParticle(p, t) {
    // flip: 0..1 (hur "tunn" den ser ut när den roterar)
    const flipVal = Math.sin(p.flip + t * p.flipSpeed);
    const thin = Math.abs(flipVal);            // 0..1
    const face = flipVal >= 0 ? p.c1 : p.c2;   // byt “sida”

    // lite fade mot slutet
    const remaining = Math.max(0, 1 - (p.life / p.maxLife));
    const alpha = remaining * (0.35 + 0.65 * (0.25 + 0.75 * thin));

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);

    // skala i “tjocklek” för tumbling-känsla
    ctx.scale(1, 0.25 + 0.75 * thin);

    ctx.globalAlpha = alpha;
    ctx.fillStyle = face;

    if (p.type === "circle") {
      ctx.beginPath();
      ctx.arc(0, 0, p.w * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // rectangle / ribbon
      ctx.fillRect(-p.w * 0.5, -p.h * 0.5, p.w, p.h);
    }

    ctx.restore();
  }

  function step(ts) {
    if (!running) return;

    const t = ts / 1000;
    const dt = Math.min(0.033, lastT ? (t - lastT) : 0.016);
    lastT = t;

    ctx.clearRect(0, 0, w, h);

    // uppdatera + rita
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life += dt;

      // vind påverkar ax, lite mer när den “fladdrar” (thin)
      const thin = Math.abs(Math.sin(p.flip + t * p.flipSpeed));
      const wx = wind(t, p.y) * (0.6 + 0.8 * thin);

      p.ax = wx;

      // integrera
      p.vx += p.ax * dt;
      p.vy += p.ay * dt;

      // luftmotstånd
      p.vx *= Math.pow(AIR_DRAG, dt * 60);
      p.vy *= Math.pow(AIR_DRAG, dt * 60);

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // rotation
      p.angle += p.spin * dt;

      // döda om den är “klar” eller långt utanför
      if (p.life > p.maxLife || p.y > h + 120 || p.x < -200 || p.x > w + 200) {
        particles.splice(i, 1);
        continue;
      }

      drawParticle(p, t);
    }

    if (particles.length === 0) {
      running = false;
      rafId = null;
      return;
    }

    rafId = requestAnimationFrame(step);
  }

  function start() {
    if (running) return;
    running = true;
    lastT = 0;
    rafId = requestAnimationFrame(step);
  }

  function burst(x, y, amount = 110) {
    ensureCanvas();

    for (let i = 0; i < amount; i++) {
      // sprid startpunkten lite så det inte ser “perfekt”
      particles.push(makeParticle(
        x + rand(-18, 18),
        y + rand(-12, 12)
      ));
    }

    start();
  }

  return { burst };
})();

function burstConfetti(cardEl) {
  const rect = cardEl.getBoundingClientRect();
  const originX = rect.left + rect.width * 0.5;
  const originY = rect.top + rect.height * 0.28;

  // flera vågor = mer energi + “spridning”
  confettiEngine.burst(originX, originY, 90);
  setTimeout(() => confettiEngine.burst(originX, originY, 70), 90);
  setTimeout(() => confettiEngine.burst(originX, originY, 55), 180);
}

async function loadContent({ bustCache = true } = {}) {
  try {
    const url = bustCache ? `${CONTENT_URL}?t=${Date.now()}` : CONTENT_URL;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const next = await res.json();

    // Om content bytts: resetta state i denna container (WebApp har egen localStorage)
    const prevVer = localStorage.getItem(CONTENT_VERSION_KEY);
    const nextVer = String(next?.version || "");

    if (els.versionTag) {
      els.versionTag.textContent = nextVer ? `${nextVer}` : "";
    }

    if (nextVer && nextVer !== prevVer) {
      localStorage.setItem(CONTENT_VERSION_KEY, nextVer);
    }

    model = next;

    // Bra indikator på att render kör på nya datan
    // setStatus(`Laddad ${new Date().toLocaleTimeString("sv-SE")} · v=i${nextVer || "?"}`);

    render();

    if (timerInterval) clearInterval(timerInterval);
    updateCountdown();
    timerInterval = setInterval(updateCountdown, 1000);
  } catch (e) {
    console.error(e);
    setStatus(`Kunde inte hämta content: ${String(e.message || e)}`);
  }
}

// els.refreshBtn?.addEventListener("click", () => hardReset());
els.refreshBtn.addEventListener("click", () => loadContent({ bustCache: true }));

// iOS standalone återställer ofta sidan från BFCache/snapshot.
// Då måste vi aktivt trigga omhämtning när sidan “kommer tillbaka”.
window.addEventListener("pageshow", (e) => {
  // e.persisted = true betyder BFCache restore
  if (e.persisted) loadContent({ bustCache: true });
});

// När appen blir aktiv igen (t.ex. efter att ha varit i bakgrunden)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadContent({ bustCache: true });
  }
});

function hardReset() {
  localStorage.removeItem(OPENED_KEY);
  localStorage.removeItem(CONTENT_VERSION_KEY);
  loadContent({ bustCache: true });
} 

loadContent({ bustCache: true });