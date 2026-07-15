// ======================= CONFIG =======================
// ID таблиці з посилання Google Sheets (між /d/ та /edit)
const SHEET_ID = "1geQTND41siY5pobPYLqFZWjgVMCm51Zpa7bEv_8uJMU";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

const PHONE_NUMBER = "+380985388466";
const LINKS = {
  maps: "https://maps.app.goo.gl/QXQKuCX14sXrZhys8",
  instagram: "https://www.instagram.com/karnavalstudio.vn?igsh=MXM4ajVjbmgzaHNv",
  telegram: "https://t.me/+380985388466",
  viber: "viber://chat?number=%2B380985388466"
};

const BATCH_SIZE = 16; // скільки карток підвантажувати за раз (нескінченна прокрутка)
const STASH_KEY = "karnaval_stash_v1";

// ======================= CSV PARSING =======================
// Простий, але надійний парсер CSV (враховує лапки й коми всередині полів)
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function rowsToCostumes(rows) {
  // Очікувані колонки: № | Назва | Фото | Категорія | Теги | Розмір | Ціна | Технічний стовпчик (фото для сайту)
  const costumes = [];
  for (let i = 1; i < rows.length; i++) { // пропускаємо заголовок
    const r = rows[i];
    if (!r || !r[0] || !r[1]) continue; // порожній рядок або немає назви — пропускаємо
    const id = (r[0] || "").trim();
    const name = (r[1] || "").trim();
    const categoriesRaw = (r[3] || "").trim();
    const tagsRaw = (r[4] || "").trim();
    const size = (r[5] || "").trim();
    const price = (r[6] || "").trim();
    const photo = (r[7] || "").trim();
    if (!name) continue;
    costumes.push({
      id,
      name,
      categories: categoriesRaw ? categoriesRaw.split(/\s+/).filter(Boolean) : [],
      tags: tagsRaw ? tagsRaw.split(/\s+/).filter(Boolean) : [],
      size,
      price,
      photo,
      searchBlob: (name + " " + categoriesRaw + " " + tagsRaw).toLowerCase()
    });
  }
  return costumes;
}

// ======================= STATE =======================
let ALL_COSTUMES = [];
let VISIBLE_LIST = [];
let renderedCount = 0;
let activeCategory = "Всі";
let searchQuery = "";
let stash = loadStash();

// ======================= DOM =======================
const grid = document.getElementById("catalog-grid");
const sentinel = document.getElementById("scroll-sentinel");
const categoryNav = document.getElementById("category-nav");
const searchInput = document.getElementById("search-input");
const stashFab = document.getElementById("stash-fab");
const stashCount = document.getElementById("stash-count");

// Overlay/sheet elements — must be declared before init() runs, since
// setupOverlayClose() (called inside init()) references them.
const overlay = document.getElementById("product-overlay");
const sheet = document.getElementById("product-sheet");

const CATEGORIES = [
  "Жіночі", "Чоловічі", "Новорічні", "Геловін", "Весняні", "Осінні",
  "Звірята", "Українські", "Національності", "Професії", "Вечірні", "Аксесуари"
];

// ======================= INIT =======================
init();

async function init() {
  buildCategoryNav();
  setupHeaderIcons();
  setupSearch();
  setupOverlayClose();
  setupStashUI();
  updateStashCount();

  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error("Network response was not ok");
    const text = await res.text();
    const rows = parseCSV(text);
    ALL_COSTUMES = rowsToCostumes(rows);
  } catch (err) {
    console.error("Не вдалося завантажити каталог:", err);
    grid.innerHTML = `<div class="empty-state">Не вдалося завантажити каталог. Перевірте інтернет-з'єднання та спробуйте оновити сторінку.</div>`;
    return;
  }

  applyFilters();
}

// ======================= CATEGORY NAV =======================
function buildCategoryNav() {
  const pills = ["Всі", ...CATEGORIES];
  categoryNav.innerHTML = pills.map(cat =>
    `<button class="category-pill${cat === "Всі" ? " active" : ""}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
  ).join("");
  categoryNav.querySelectorAll(".category-pill").forEach(btn => {
    btn.addEventListener("click", () => {
      activeCategory = btn.dataset.cat;
      categoryNav.querySelectorAll(".category-pill").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      applyFilters();
    });
  });
}

// ======================= SEARCH =======================
function setupSearch() {
  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    applyFilters();
  });
}

// ======================= FILTER + RENDER =======================
function applyFilters() {
  VISIBLE_LIST = ALL_COSTUMES.filter(c => {
    const matchesCategory = activeCategory === "Всі" || c.categories.includes(activeCategory);
    const matchesSearch = !searchQuery || c.searchBlob.includes(searchQuery);
    return matchesCategory && matchesSearch;
  });
  renderedCount = 0;
  grid.innerHTML = "";
  renderNextBatch();
}

function renderNextBatch() {
  if (renderedCount === 0 && VISIBLE_LIST.length === 0) {
    grid.innerHTML = `<div class="empty-state">Нічого не знайдено. Спробуйте інший запит або категорію.</div>`;
    return;
  }
  const slice = VISIBLE_LIST.slice(renderedCount, renderedCount + BATCH_SIZE);
  slice.forEach(costume => grid.appendChild(buildCard(costume)));
  renderedCount += slice.length;
}

function buildCard(costume) {
  const card = document.createElement("div");
  card.className = "costume-card";
  const isSaved = stash.includes(costume.id);
  card.innerHTML = `
    <div class="photo-wrap">
      <img src="${escapeHtml(costume.photo)}" alt="${escapeHtml(costume.name)}" loading="lazy">
    </div>
    <button class="heart-btn${isSaved ? " saved" : ""}" aria-label="Відкласти">
      <svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 21s-7.5-4.6-10-9.3C.5 8.2 2.3 4.5 6 4c2.2-.3 4 .9 6 3 2-2.1 3.8-3.3 6-3 3.7.5 5.5 4.2 4 7.7C19.5 16.4 12 21 12 21z"/>
      </svg>
    </button>
    <div class="card-info">
      <div class="name">${escapeHtml(costume.name)}</div>
      <button class="price-btn">${escapeHtml(costume.price)} грн</button>
    </div>
  `;
  card.querySelector(".heart-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleStash(costume.id);
    e.currentTarget.classList.toggle("saved");
  });
  card.addEventListener("click", () => openProduct(costume));
  return card;
}

// infinite scroll
const io = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) renderNextBatch();
  });
}, { rootMargin: "400px" });
io.observe(sentinel);

// ======================= PRODUCT OVERLAY =======================
function openProduct(costume) {
  const isSaved = stash.includes(costume.id);
  sheet.innerHTML = `
    <button class="close-btn" aria-label="Закрити">&times;</button>
    <div class="photo-wrap"><img src="${escapeHtml(costume.photo)}" alt="${escapeHtml(costume.name)}"></div>
    <div class="product-details">
      <div class="detail-row title-row">
        <span class="label">${escapeHtml(costume.name)}</span>
        <span class="value">${escapeHtml(costume.price)} грн</span>
      </div>
      <div class="detail-row"><span class="label">Категорія</span><span class="value">${escapeHtml(costume.categories.join(", ") || "—")}</span></div>
      <div class="detail-row"><span class="label">Теги</span><span class="value">${escapeHtml(costume.tags.join(", ") || "—")}</span></div>
      <div class="detail-row"><span class="label">Розмір</span><span class="value">${escapeHtml(costume.size || "—")}</span></div>
      <div class="detail-row"><span class="label">Артикул</span><span class="value">№ ${escapeHtml(costume.id)}</span></div>
    </div>
    <button class="stash-btn${isSaved ? " saved" : ""}" data-id="${escapeHtml(costume.id)}">${isSaved ? "Відкладено ✓" : "Відкласти"}</button>
  `;
  sheet.querySelector(".close-btn").addEventListener("click", closeProduct);
  sheet.querySelector(".stash-btn").addEventListener("click", (e) => {
    toggleStash(costume.id);
    const btn = e.currentTarget;
    const nowSaved = stash.includes(costume.id);
    btn.classList.toggle("saved", nowSaved);
    btn.textContent = nowSaved ? "Відкладено ✓" : "Відкласти";
    // синхронізуємо сердечко на картці, якщо вона на екрані
    refreshHeartIcons(costume.id, nowSaved);
  });
  overlay.classList.add("open");
}

function closeProduct() {
  overlay.classList.remove("open");
}

function setupOverlayClose() {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeProduct();
  });
}

function refreshHeartIcons(id, saved) {
  document.querySelectorAll(".costume-card").forEach(card => {
    const img = card.querySelector("img");
    if (img && ALL_COSTUMES.find(c => c.id === id && c.photo === img.getAttribute("src"))) {
      card.querySelector(".heart-btn").classList.toggle("saved", saved);
    }
  });
}

// ======================= STASH (Відкладені) =======================
function loadStash() {
  try {
    const raw = localStorage.getItem(STASH_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveStash() {
  try { localStorage.setItem(STASH_KEY, JSON.stringify(stash)); } catch {}
}
function toggleStash(id) {
  const idx = stash.indexOf(id);
  if (idx >= 0) stash.splice(idx, 1);
  else stash.push(id);
  saveStash();
  updateStashCount();
}
function updateStashCount() {
  stashCount.textContent = stash.length;
  stashFab.style.display = "flex";
}

const stashPanel = document.getElementById("stash-panel");
const stashList = document.getElementById("stash-list");

function setupStashUI() {
  stashFab.addEventListener("click", openStashPanel);
  document.getElementById("stash-close").addEventListener("click", () => stashPanel.classList.remove("open"));
  stashPanel.addEventListener("click", (e) => { if (e.target === stashPanel) stashPanel.classList.remove("open"); });
}

function openStashPanel() {
  const items = ALL_COSTUMES.filter(c => stash.includes(c.id));
  if (!items.length) {
    stashList.innerHTML = `<div class="stash-empty">Тут поки нічого немає. Натисніть на сердечко біля костюма, щоб відкласти його.</div>`;
  } else {
    stashList.innerHTML = items.map(c => `
      <div class="stash-item" data-id="${escapeHtml(c.id)}">
        <img src="${escapeHtml(c.photo)}" alt="${escapeHtml(c.name)}">
        <div class="info">
          <div class="n">${escapeHtml(c.name)}</div>
          <div class="sub">Артикул № ${escapeHtml(c.id)} · ${escapeHtml(c.price)} грн</div>
        </div>
        <button class="remove" aria-label="Прибрати">&times;</button>
      </div>
    `).join("");
    stashList.querySelectorAll(".remove").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const id = e.currentTarget.closest(".stash-item").dataset.id;
        toggleStash(id);
        refreshHeartIcons(id, false);
        openStashPanel();
      });
    });
  }
  stashPanel.classList.add("open");
}

// ======================= HEADER ICONS + PHONE MODAL =======================
function setupHeaderIcons() {
  document.getElementById("icon-maps").href = LINKS.maps;
  document.getElementById("icon-instagram").href = LINKS.instagram;
  document.getElementById("icon-telegram").href = LINKS.telegram;
  document.getElementById("icon-viber").href = LINKS.viber;

  const phoneBtn = document.getElementById("icon-phone");
  const phoneModal = document.getElementById("phone-modal");
  document.getElementById("phone-number-text").textContent = PHONE_NUMBER;
  document.getElementById("phone-call-link").href = `tel:${PHONE_NUMBER}`;

  phoneBtn.addEventListener("click", (e) => {
    e.preventDefault();
    phoneModal.classList.add("open");
  });
  phoneModal.addEventListener("click", (e) => {
    if (e.target === phoneModal) phoneModal.classList.remove("open");
  });
  document.getElementById("phone-close").addEventListener("click", () => phoneModal.classList.remove("open"));
}

// ======================= UTIL =======================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
