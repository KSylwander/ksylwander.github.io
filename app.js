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
  return `<img class="headerIcon" src="${escapeHtml(iconUrl)}" alt="" aria-hidden="true">`;
}

// ÖPPET kort: header (ikon + titel) + ev bild + text
function openInnerHtml(card) {
  return `
    <div class="cardHeader">
      ${openedHeaderHtml(card)}
      <h2>${escapeHtml(card.title)}</h2>
      <span class="openedTag">Öppnat</span>
    </div>
    ${card.image ? `<img src="${escapeHtml(card.image)}" alt="">` : ""}
    <p class="cardText">${escapeHtml(card.text)}</p>
  `;
}

function closedInnerHtml(card, state, teaser) {
  const label = state === "unlockable" ? "Redo att öppnas" : "";
  const t = (teaser && String(teaser).trim().length) ? teaser : card.title;

  return `
    <div class="closedHeader">
      ${stateIconHtml(state)}
      <h2 class="teaserTitle">${escapeHtml(t)}</h2>
    </div>
    ${label ? `<div class="meta">${label}</div>` : ``}
  `;
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
                        ? `<button class="openBtn openBtnSmall" type="button">Öppna</button>`
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
        openedSet.add(c.id);
        writeOpenedSet(openedSet);

        // animera "open" direkt utan full rerender
        el.classList.remove("unlockable");
        el.classList.add("open");

        setTimeout(() => {
            const badge = el.querySelector(".stateBadge");
            if (badge) badge.remove();

            const inner = el.querySelector(".inner");
            if (inner) inner.innerHTML = openInnerHtml(c);
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