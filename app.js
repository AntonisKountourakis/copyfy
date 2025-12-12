// Firebase (CDN, modular) — version pinned to 12.6.0
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, deleteDoc, doc,
  query, where, orderBy, limit, getDocs, startAfter
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-storage.js";

import { firebaseConfig } from "./firebase-config.js";

const state = {
  app: null,
  auth: null,
  db: null,
  storage: null,
  user: null,
  lastDoc: null,
  lastQueryKey: "",
  pageSize: 24,
  queue: [], // File[]
  queuePreviewUrls: new Map(), // key -> objectURL
};

const els = {
  authStatus: document.getElementById("authStatus"),
  openUploadBtn: document.getElementById("openUploadBtn"),
  uploadModal: document.getElementById("uploadModal"),
  viewerModal: document.getElementById("viewerModal"),

  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  uploadList: document.getElementById("uploadList"),
  uploadStatus: document.getElementById("uploadStatus"),
  titleInput: document.getElementById("titleInput"),
  tagsInput: document.getElementById("tagsInput"),
  sourceUrlInput: document.getElementById("sourceUrlInput"),
  licenseSelect: document.getElementById("licenseSelect"),
  confirmCk: document.getElementById("confirmCk"),
  clearQueueBtn: document.getElementById("clearQueueBtn"),
  startUploadBtn: document.getElementById("startUploadBtn"),

  searchInput: document.getElementById("searchInput"),
  licenseFilter: document.getElementById("licenseFilter"),
  sortSelect: document.getElementById("sortSelect"),
  searchBtn: document.getElementById("searchBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  loadMoreBtn: document.getElementById("loadMoreBtn"),
  resultInfo: document.getElementById("resultInfo"),
  grid: document.getElementById("grid"),
  emptyState: document.getElementById("emptyState"),
  indexHint: document.getElementById("indexHint"),
  quickTags: document.getElementById("quickTags"),

  viewerImg: document.getElementById("viewerImg"),
  viewerTitle: document.getElementById("viewerTitle"),
  viewerLicense: document.getElementById("viewerLicense"),
  viewerWhen: document.getElementById("viewerWhen"),
  viewerTags: document.getElementById("viewerTags"),
  viewerOpen: document.getElementById("viewerOpen"),
  viewerSource: document.getElementById("viewerSource"),
  downloadBtn: document.getElementById("downloadBtn"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  shareBtn: document.getElementById("shareBtn"),
  deleteBtn: document.getElementById("deleteBtn"),
  closeViewerBtn: document.getElementById("closeViewerBtn"),

  themeBtn: document.getElementById("themeBtn"),
  toast: document.getElementById("toast"),
};

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function setAuthStatus(text, ok) {
  const dot = els.authStatus.querySelector(".dot");
  els.authStatus.querySelector("span:last-child").textContent = text;
  dot.style.background = ok ? "rgba(116,255,210,.9)" : "rgba(255,255,255,.25)";
  dot.style.boxShadow = ok ? "0 0 0 4px rgba(116,255,210,.14)" : "0 0 0 4px rgba(255,255,255,.06)";
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[c]);
}

function safeWords(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function parseTags(str) {
  const raw = (str || "").replace(/[,]+/g, " ");
  const tags = safeWords(raw).slice(0, 20);
  return Array.from(new Set(tags));
}

function extFromMime(m) {
  if (m === "image/jpeg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  return "img";
}

function prettyDate(ms) {
  try { return new Date(ms).toLocaleString("el-GR"); } catch { return ""; }
}

function requireConfig() {
  const missing = Object.entries(firebaseConfig).filter(([k,v]) => !v || String(v).includes("REPLACE_ME"));
  if (missing.length) {
    els.indexHint.hidden = false;
    els.indexHint.innerHTML = `⚠️ Βάλε σωστό Firebase config στο <b>firebase-config.js</b> (λείπουν: ${missing.map(x => x[0]).join(", ")}).`;
    throw new Error("Missing Firebase config");
  }
}

async function initFirebase() {
  requireConfig();
  state.app = initializeApp(firebaseConfig);
  state.auth = getAuth(state.app);
  state.db = getFirestore(state.app);
  state.storage = getStorage(state.app);

  onAuthStateChanged(state.auth, (user) => {
    state.user = user;
    if (user) setAuthStatus(`Connected • ${user.uid.slice(0, 8)}…`, true);
  });

  try {
    await signInAnonymously(state.auth);
    setAuthStatus("Connected (anon)", true);
  } catch (e) {
    console.error(e);
    setAuthStatus("Auth error (δες Rules)", false);
    toast("⚠️ Auth error (δες console)");
  }
}

function openModal(dlg) { if (!dlg.open) dlg.showModal(); }
function closeModal(dlg) { if (dlg.open) dlg.close(); }

// ---------- Theme ----------
function initTheme() {
  const key = "copyfy_theme";
  const saved = localStorage.getItem(key);
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  const theme = saved || (prefersLight ? "light" : "dark");
  document.documentElement.dataset.theme = theme;

  const icon = theme === "light" ? "☀" : "◐";
  els.themeBtn.textContent = icon;

  els.themeBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(key, next);
    els.themeBtn.textContent = next === "light" ? "☀" : "◐";
  });
}

// ---------- Upload UI ----------
els.openUploadBtn.addEventListener("click", () => openModal(els.uploadModal));

els.clearQueueBtn.addEventListener("click", () => {
  clearQueue();
  els.uploadStatus.textContent = "";
});

function clearQueue() {
  for (const url of state.queuePreviewUrls.values()) URL.revokeObjectURL(url);
  state.queuePreviewUrls.clear();
  state.queue = [];
  renderQueue();
}

els.dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  els.dropzone.style.borderColor = "rgba(116,255,210,.75)";
});
els.dropzone.addEventListener("dragleave", () => {
  els.dropzone.style.borderColor = "rgba(122,162,255,.65)";
});
els.dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  els.dropzone.style.borderColor = "rgba(122,162,255,.65)";
  const files = Array.from(e.dataTransfer.files || []).filter(f => f.type.startsWith("image/"));
  addToQueue(files);
});
els.fileInput.addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);
  addToQueue(files);
  els.fileInput.value = "";
});

function fileKey(f){ return f.name + "_" + f.size + "_" + f.lastModified; }

function addToQueue(files) {
  if (!files.length) return;
  const allowed = new Set(["image/jpeg","image/png","image/webp","image/gif"]);
  const filtered = files.filter(f => allowed.has(f.type));
  if (filtered.length !== files.length) toast("Μερικά αρχεία απορρίφθηκαν (τύπος).");

  for (const f of filtered) {
    const k = fileKey(f);
    if (!state.queuePreviewUrls.has(k)) {
      state.queuePreviewUrls.set(k, URL.createObjectURL(f));
    }
  }

  state.queue.push(...filtered);
  state.queue = state.queue.slice(0, 20);
  renderQueue();
}

function renderQueue(progressMap = new Map()) {
  els.uploadList.innerHTML = "";
  if (!state.queue.length) {
    els.uploadList.innerHTML = `<div class="muted small">Δεν έχεις επιλέξει αρχεία ακόμη.</div>`;
    return;
  }

  for (const f of state.queue) {
    const k = fileKey(f);
    const p = progressMap.get(k) ?? 0;
    const url = state.queuePreviewUrls.get(k);

    const row = document.createElement("div");
    row.className = "uploadRow";
    row.innerHTML = `
      <div class="uploadRow__top">
        <div class="row" style="gap:10px;">
          <img class="preview" src="${escapeHtml(url || "")}" alt="" />
          <div>
            <div style="font-weight:900">${escapeHtml(f.name)}</div>
            <div class="muted small">${(f.size/1024/1024).toFixed(2)} MB • ${escapeHtml(f.type)}</div>
          </div>
        </div>
        <button class="btn btn--ghost" type="button" data-remove="${escapeHtml(k)}">Remove</button>
      </div>
      <div class="progress"><div style="width:${p}%"></div></div>
      <div class="muted small">${p.toFixed(0)}%</div>
    `;
    row.querySelector("[data-remove]").addEventListener("click", () => {
      state.queue = state.queue.filter(x => fileKey(x) !== k);
      const u = state.queuePreviewUrls.get(k);
      if (u) URL.revokeObjectURL(u);
      state.queuePreviewUrls.delete(k);
      renderQueue(progressMap);
    });
    els.uploadList.appendChild(row);
  }
}

els.startUploadBtn.addEventListener("click", async () => {
  if (!state.user) return toast("Δεν υπάρχει σύνδεση χρήστη (Auth).");
  if (!els.confirmCk.checked) return toast("Τσέκαρε τη δήλωση δικαιωμάτων.");
  if (!state.queue.length) return toast("Διάλεξε τουλάχιστον 1 εικόνα.");

  const title = (els.titleInput.value || "").trim().slice(0, 80);
  const tags = parseTags(els.tagsInput.value);
  const sourceUrl = (els.sourceUrlInput.value || "").trim().slice(0, 300);
  const license = els.licenseSelect.value;

  if (!["CC0-1.0","PUBLIC-DOMAIN"].includes(license)) return toast("Μόνο CC0 ή Public Domain.");

  els.startUploadBtn.disabled = true;
  els.uploadStatus.textContent = "Upload…";
  const progressMap = new Map();
  renderQueue(progressMap);

  let ok = 0;
  for (const file of state.queue) {
    const k = fileKey(file);
    try {
      const id = crypto.randomUUID();
      const ext = extFromMime(file.type);
      const storagePath = `images/${state.user.uid}/${id}.${ext}`;
      const storageRef = ref(state.storage, storagePath);

      const task = uploadBytesResumable(storageRef, file, { contentType: file.type });

      await new Promise((resolve, reject) => {
        task.on("state_changed",
          (snap) => {
            const pct = snap.totalBytes ? (snap.bytesTransferred / snap.totalBytes) * 100 : 0;
            progressMap.set(k, pct);
            renderQueue(progressMap);
          },
          reject,
          resolve
        );
      });

      const downloadURL = await getDownloadURL(storageRef);

      const keywords = Array.from(new Set([
        ...safeWords(title),
        ...tags,
      ])).slice(0, 30);

      const docData = {
        title: title || "Untitled",
        tags,
        keywords,
        sourceUrl: sourceUrl || "",
        license,
        ownerUid: state.user.uid,
        createdAt: Date.now(),
        downloadURL,
        storagePath,
        mime: file.type,
        bytes: file.size,
      };

      await addDoc(collection(state.db, "images"), docData);

      ok++;
      progressMap.set(k, 100);
      renderQueue(progressMap);
    } catch (e) {
      console.error(e);
      toast("⚠️ Κάποιο upload απέτυχε (δες console).");
    }
  }

  els.uploadStatus.textContent = `✅ Ολοκληρώθηκε: ${ok}/${state.queue.length}`;
  toast(`Uploaded ${ok}/${state.queue.length}`);

  clearQueue();
  els.startUploadBtn.disabled = false;

  // refresh gallery
  await loadGallery({ reset: true });
});

// ---------- Gallery ----------
let debounceT = null;
els.searchInput.addEventListener("input", () => {
  clearTimeout(debounceT);
  debounceT = setTimeout(() => loadGallery({ reset: true }), 260);
});
els.licenseFilter.addEventListener("change", () => loadGallery({ reset: true }));
els.sortSelect.addEventListener("change", () => loadGallery({ reset: true }));
els.searchBtn.addEventListener("click", () => loadGallery({ reset: true }));
els.refreshBtn.addEventListener("click", () => {
  els.searchInput.value = "";
  els.licenseFilter.value = "ALL";
  els.sortSelect.value = "NEW";
  loadGallery({ reset: true });
});
els.loadMoreBtn.addEventListener("click", () => loadGallery({ reset: false }));

function queryKey() {
  return JSON.stringify({
    q: (els.searchInput.value || "").trim().toLowerCase(),
    lic: els.licenseFilter.value,
    sort: els.sortSelect.value,
  });
}

function showSkeleton(count=9) {
  els.grid.innerHTML = "";
  for (let i=0;i<count;i++){
    const card = document.createElement("article");
    card.className = "cardimg cardimg--skeleton";
    const h = 170 + (i % 5) * 24;
    card.innerHTML = `
      <div class="skel skelImg" style="height:${h}px"></div>
      <div class="skel skelLine" style="width:72%"></div>
      <div class="skel skelLine" style="width:40%; margin-top:0"></div>
    `;
    els.grid.appendChild(card);
  }
}

function updateQuickTags(items) {
  const freq = new Map();
  for (const it of items) {
    for (const t of (it.tags || [])) freq.set(t, (freq.get(t) || 0) + 1);
  }
  const top = Array.from(freq.entries())
    .sort((a,b)=>b[1]-a[1])
    .slice(0, 10)
    .map(x=>x[0]);

  // If no tags yet, show some defaults
  const defaults = ["nature","city","sea","sunset","food","travel","portrait","night","mountain"];
  const list = top.length ? top : defaults;

  els.quickTags.innerHTML = "";
  list.slice(0, 9).forEach(t => {
    const b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.textContent = t;
    b.addEventListener("click", () => {
      els.searchInput.value = t;
      loadGallery({ reset: true });
    });
    els.quickTags.appendChild(b);
  });
}

async function loadGallery({ reset }) {
  if (!state.db) return;
  els.indexHint.hidden = true;

  const key = queryKey();
  const isNewQuery = key !== state.lastQueryKey;

  if (reset || isNewQuery) {
    state.lastDoc = null;
    state.lastQueryKey = key;
    showSkeleton(10);
  }

  const qtxt = (els.searchInput.value || "").trim();
  const tokens = safeWords(qtxt);
  const lic = els.licenseFilter.value;
  const sortDir = els.sortSelect.value === "OLD" ? "asc" : "desc";

  const constraints = [];
  if (lic !== "ALL") constraints.push(where("license", "==", lic));

  if (tokens.length) {
    // array-contains-any supports up to 30 terms
    constraints.push(where("keywords", "array-contains-any", tokens.slice(0, 30)));
  }

  constraints.push(orderBy("createdAt", sortDir));
  constraints.push(limit(state.pageSize));
  if (state.lastDoc) constraints.push(startAfter(state.lastDoc));

  const qref = query(collection(state.db, "images"), ...constraints);

  let snap;
  try {
    snap = await getDocs(qref);
  } catch (e) {
    console.error(e);
    els.indexHint.hidden = false;
    els.indexHint.innerHTML =
      "⚠️ Πιθανόν χρειάζεται <b>composite index</b> στο Firestore για αυτό το query (Firestore → Indexes). " +
      "Δες και το DevTools Console για το link που δίνει το Firebase error.";
    toast("Index needed (δες notice)");
    els.loadMoreBtn.disabled = true;
    return;
  }

  const docs = snap.docs;

  // If we were showing skeleton for a reset, clear it now.
  if (reset || isNewQuery) els.grid.innerHTML = "";

  state.lastDoc = docs.length ? docs[docs.length - 1] : state.lastDoc;

  const items = docs.map(d => ({ docId: d.id, ...d.data() }));

  for (const it of items) renderCard(it);

  const totalNow = els.grid.querySelectorAll(".cardimg").length;
  els.resultInfo.textContent = `Εμφάνιση: ${totalNow}${tokens.length ? " (search)" : ""}${lic !== "ALL" ? " • " + lic : ""}${sortDir === "asc" ? " • παλαιότερα" : ""}`;

  const canMore = docs.length === state.pageSize;
  els.loadMoreBtn.disabled = !canMore;

  els.emptyState.hidden = totalNow !== 0;

  // Update quick tags only on fresh loads (not load more)
  if (reset || isNewQuery) updateQuickTags(items);
}

function renderCard(item) {
  const card = document.createElement("article");
  card.className = "cardimg";
  card.tabIndex = 0;

  const title = item.title || "Untitled";
  const when = prettyDate(item.createdAt);
  const lic = item.license || "—";

  card.innerHTML = `
    <img class="cardimg__img" loading="lazy" src="${escapeHtml(item.downloadURL)}" alt="${escapeHtml(title)}" />
    <div class="cardimg__meta">
      <div class="cardimg__title">${escapeHtml(title)}</div>
      <div class="cardimg__sub">
        <span class="pill">${escapeHtml(lic)}</span>
        <span class="muted small">${escapeHtml(when)}</span>
      </div>
    </div>
  `;
  card.addEventListener("click", () => openViewer(item));
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openViewer(item); }
  });
  els.grid.appendChild(card);
}

let currentItem = null;

function openViewer(item) {
  currentItem = item;

  els.viewerImg.src = item.downloadURL;
  els.viewerImg.alt = item.title || "Image";
  els.viewerTitle.textContent = item.title || "Untitled";
  els.viewerLicense.textContent = item.license || "—";
  els.viewerWhen.textContent = prettyDate(item.createdAt);

  els.viewerOpen.href = item.downloadURL;
  els.downloadBtn.href = item.downloadURL;

  // tags
  els.viewerTags.innerHTML = "";
  (item.tags || []).slice(0, 25).forEach(t => {
    const span = document.createElement("span");
    span.className = "tag";
    span.textContent = t;
    span.addEventListener("click", () => {
      els.searchInput.value = t;
      closeModal(els.viewerModal);
      loadGallery({ reset: true });
    });
    els.viewerTags.appendChild(span);
  });

  // source
  if (item.sourceUrl) {
    els.viewerSource.hidden = false;
    els.viewerSource.href = item.sourceUrl;
    els.viewerSource.textContent = "Source";
  } else {
    els.viewerSource.hidden = true;
  }

  // delete visible only for owner
  const canDelete = state.user && item.ownerUid && state.user.uid === item.ownerUid && item.docId;
  els.deleteBtn.hidden = !canDelete;

  openModal(els.viewerModal);
}

els.closeViewerBtn.addEventListener("click", () => closeModal(els.viewerModal));

els.copyLinkBtn.addEventListener("click", async () => {
  if (!currentItem?.downloadURL) return;
  try {
    await navigator.clipboard.writeText(currentItem.downloadURL);
    toast("Copied!");
  } catch {
    toast("Δεν έγινε αντιγραφή (browser).");
  }
});

els.shareBtn.addEventListener("click", async () => {
  if (!currentItem?.downloadURL) return;
  const title = currentItem.title || "Free Image";
  const url = currentItem.downloadURL;

  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      toast("Shared!");
      return;
    } catch { /* user cancelled */ }
  }
  // fallback
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied!");
  } catch {
    toast("Share not supported.");
  }
});

els.deleteBtn.addEventListener("click", async () => {
  if (!currentItem || !state.user) return;
  if (!confirm("Να διαγραφεί αυτή η εικόνα;")) return;

  try {
    // Delete Firestore doc first
    if (currentItem.docId) await deleteDoc(doc(state.db, "images", currentItem.docId));
    // Then Storage object
    if (currentItem.storagePath) await deleteObject(ref(state.storage, currentItem.storagePath));

    toast("Deleted");
    closeModal(els.viewerModal);
    await loadGallery({ reset: true });
  } catch (e) {
    console.error(e);
    toast("Delete failed (rules?)");
  }
});

// ---------- Boot ----------
(async function main(){
  initTheme();
  try {
    await initFirebase();
  } catch (e) {
    console.error(e);
    toast("Βάλε Firebase config πρώτα.");
    return;
  }

  renderQueue();
  await loadGallery({ reset: true });
})();
