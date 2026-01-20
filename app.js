const CONTENT_URL = "./content.json";
const OPENED_KEY = "openedCards:v1";

const els = {
  title: document.getElementById("title"),
  logo: document.getElementById("logo"),
  status: document.getElementById("status"),
  grid: document.getElementById("grid"),
  refreshBtn: document.getElementById("refreshBtn"),
  dd: document.getElementById("dd"),
  hh: document.getElementById("hh"),
  mm: document.getElementById("mm"),
  confettiHost: document.getElementById("confettiHost")
};

let model = null;
let timerInterval = null;

function readOpenedSet() {
  try {
    const raw = localStorage.getItem(OPENED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
function writeOpenedSet(set) {
  localStorage.setItem(OPENED_KEY, JSON.stringify([...set]));
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
  const isOpen = openedSet.has(card.id);

  if (isOpen) return "open";
  if (now >= unlockAt) return "unlockable";
  return "locked";
}

function friendlyDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("sv-SE", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

function render() {
  const opened = readOpenedSet();

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
  cards.sort((a, b) => new Date(a.unlockAt).getTime() - new Date(b.unlockAt).getTime());

  els.grid.innerHTML = "";
  for (const c of cards) {
    const state = cardState(c, opened);
    const el = document.createElement("article");
    el.className = `card ${state}`;
    el.dataset.cardId = c.id;

    const unlockLabel = friendlyDate(c.unlockAt);
    const teaser = c.preview?.teaser ?? "Snart…";

    el.innerHTML = `
      <div class="inner">
        <h2>${escapeHtml(c.title)}</h2>
        <div class="meta">${state === "open" ? "Öppnat" : state === "unlockable" ? "Redo att öppnas" : "Låst"}</div>

        <div class="content">
          ${state === "open" ? `
            ${c.image ? `<img src="${escapeHtml(c.image)}" alt="">` : ""}
            <p>${escapeHtml(c.text)}</p>
          ` : `
            <p style="color: rgba(255,255,255,0.72); margin:0;">
              ${escapeHtml(teaser)}
            </p>
          `}
        </div>
      </div>

      <div class="door" aria-hidden="true"></div>

      ${state !== "open" ? `
        <div class="lockBadge">
          <div class="teaser">${escapeHtml(teaser)}</div>
          <div class="when">
            <span class="pill"><span class="lockIcon"></span><span>${escapeHtml(unlockLabel)}</span></span>
          </div>
          ${state === "unlockable" ? `<button class="openBtn" type="button">Öppna</button>` : ``}
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
        openedSet.add(c.id);
        writeOpenedSet(openedSet);

        // animera "open" direkt utan full rerender
        el.classList.remove("unlockable");
        el.classList.add("open");

        // Ta bort badge efter liten delay (så animationen syns)
        setTimeout(() => {
          const badge = el.querySelector(".lockBadge");
          if (badge) badge.remove();
          // rendera content efter öppning
          const content = el.querySelector(".content");
          if (content) {
            content.innerHTML = `
              ${c.image ? `<img src="${escapeHtml(c.image)}" alt="">` : ""}
              <p>${escapeHtml(c.text)}</p>
            `;
          }
          const meta = el.querySelector(".meta");
          if (meta) meta.textContent = "Öppnat";
        }, 450);

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

function burstConfetti(cardEl) {
  const rect = cardEl.getBoundingClientRect();
  const originX = rect.left + rect.width * 0.5;
  const originY = rect.top + rect.height * 0.25;

  const count = 42;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "confetti";

    // position
    const spread = 180;
    const x = originX + (Math.random() - 0.5) * spread;
    const y = originY + (Math.random() - 0.5) * 40;

    p.style.left = `${x}px`;
    p.style.top = `${y}px`;

    // size variation
    const w = 6 + Math.random() * 10;
    const h = 10 + Math.random() * 14;
    p.style.width = `${w}px`;
    p.style.height = `${h}px`;

    // random color-ish using gradients already present in page
    const hue = Math.floor(160 + Math.random() * 160);
    p.style.background = `hsla(${hue}, 90%, 70%, 0.95)`;

    // stagger + drift
    const delay = Math.random() * 120;
    const dur = 950 + Math.random() * 650;
    p.style.animationDelay = `${delay}ms`;
    p.style.animationDuration = `${dur}ms`;

    els.confettiHost.appendChild(p);

    setTimeout(() => p.remove(), dur + delay + 50);
  }
}

async function loadContent({ bustCache = false } = {}) {
  try {
    // setStatus("Hämtar…");
    const url = bustCache ? `${CONTENT_URL}?t=${Date.now()}` : CONTENT_URL;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    model = await res.json();

    // setStatus(`Senast uppdaterad: ${new Date().toLocaleString("sv-SE")}`);
    render();

    if (timerInterval) clearInterval(timerInterval);
    updateCountdown();
    timerInterval = setInterval(updateCountdown, 1000);

  } catch (e) {
    console.error(e);
    setStatus("Kunde inte hämta content. Kontakt supporten för böveln!.");
  }
}

els.refreshBtn.addEventListener("click", () => loadContent({ bustCache: true }));

loadContent();