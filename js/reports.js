import { auth, db } from "./firebase-config.js?v=3";
import {
    doc, getDoc, collection, query, where,
    onSnapshot, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ── STATE ──────────────────────────────────────────────
let allReports       = [];     // raw docs from Firestore (excluding clearedByParent)
let selectedCategory = "All";  // Dart: _selectedCategory
let currentUser      = null;
let pendingClearDocs = [];     // docs to batch-update on confirm

// Dart: _categories = ['All', 'Medical', 'Educational', 'Sports', 'Behavioral']
const CATEGORIES = ["All", "Medical", "Educational", "Sports", "Behavioral"];

// ── BOOT ───────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

    auth.onAuthStateChanged((user) => {
        if (!user) { window.location.href = "login.html"; return; }
        currentUser = user;
        monitorNotifications(user.uid);
        startReportsStream(user.uid);
    });

    document.getElementById("backBtn")?.addEventListener("click", () => history.back());

    // Category chip buttons
    document.querySelectorAll(".chip-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            selectedCategory = btn.dataset.category;
            document.querySelectorAll(".chip-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderReports();
        });
    });

    // Clear All button — Dart: _clearAllReports flow
    document.getElementById("clearAllBtn")?.addEventListener("click", async () => {
        if (!currentUser) return;

        // Dart: get all reports for parentId, filter where clearedByParent != true
        const snap = await getDocs(
            query(collection(db, "reports"), where("parentId", "==", currentUser.uid))
        );

        const visibleDocs = snap.docs.filter(d => d.data().clearedByParent !== true);

        if (visibleDocs.length === 0) {
            showToast("Inbox is already empty.", "#F97316");
            return;
        }

        // Store for confirm modal
        pendingClearDocs = visibleDocs;
        document.getElementById("confirmModal")?.classList.remove("hidden");
    });

    // Confirm modal — Cancel
    document.getElementById("confirmCancelBtn")?.addEventListener("click", () => {
        document.getElementById("confirmModal")?.classList.add("hidden");
        pendingClearDocs = [];
    });

    // Confirm modal — Delete (soft delete)
    document.getElementById("confirmDeleteBtn")?.addEventListener("click", () => {
        clearAllReports(pendingClearDocs);
    });
});

// ── REAL-TIME REPORTS STREAM ───────────────────────────
// Dart: StreamBuilder on reports where parentId == myUid
// Note: Firestore doesn't support orderBy + where without composite index,
// so we sort client-side (same approach as Dart)
function startReportsStream(uid) {
    const q = query(
        collection(db, "reports"),
        where("parentId", "==", uid)
    );

    onSnapshot(q, (snap) => {
        // Store raw docs — filtering happens in renderReports()
        allReports = snap.docs.map(d => ({ _id: d.id, _ref: d.ref, ...d.data() }));
        renderReports();
    }, (err) => {
        console.error("Reports stream error:", err);
        showEmpty();
    });
}

// ── RENDER REPORTS ─────────────────────────────────────
function renderReports() {
    const listEl    = document.getElementById("reportsList");
    const loadingEl = document.getElementById("loadingState");
    const emptyEl   = document.getElementById("emptyState");
    if (!listEl) return;

    loadingEl?.classList.add("hidden");

    // Dart filter logic:
    // 1. isCleared = data['clearedByParent'] == true → exclude
    // 2. category = data['serviceCategory'] ?? 'Medical' → default
    // 3. matchesCategory = _selectedCategory == 'All' || category == _selectedCategory
    let visible = allReports.filter(data => {
        const isCleared = data.clearedByParent === true;
        if (isCleared) return false;

        // Dart: String category = data['serviceCategory'] ?? 'Medical'
        const rawCat = data.serviceCategory || "Medical";
        // Normalise — Dart normalises in _buildReportCard
        const normalised = normaliseCat(rawCat);

        const matches = selectedCategory === "All" || normalised === selectedCategory;
        return matches;
    });

    // Dart sort: t2.compareTo(t1) — newest first
    visible.sort((a, b) => {
        const t1 = a.createdAt?.toMillis?.() ?? 0;
        const t2 = b.createdAt?.toMillis?.() ?? 0;
        return t2 - t1;
    });

    if (visible.length === 0) {
        listEl.classList.add("hidden");
        emptyEl?.classList.remove("hidden");
        return;
    }

    emptyEl?.classList.add("hidden");
    listEl.classList.remove("hidden");
    listEl.innerHTML = visible.map(data => buildReportCardHTML(data)).join("");
}

// ── BUILD REPORT CARD HTML ─────────────────────────────
// Exact port of Dart _buildReportCard()
function buildReportCardHTML(data) {
    // Dart: senderName ?? providerName, senderTitle ?? providerTitle, senderImage ?? providerImage
    const providerName  = escHtml(data.senderName  || data.providerName  || "Provider");
    const providerTitle = escHtml(data.senderTitle || data.providerTitle || "");
    const providerImage = data.senderImage || data.providerImage || "";

    // Dart: category = data['serviceCategory'] ?? 'Medical'
    const rawCat  = data.serviceCategory || "Medical";
    const category = normaliseCat(rawCat); // "Medical" | "Educational" | "Sports"

    const notes           = data.notes           || "";
    const recommendations = data.recommendations || "";
    const attachedFile    = data.attachedFileName || "";
    const fileUrl         = data.fileUrl          || "";

    // Dart: DateFormat('MMM dd, yyyy - hh:mm a').format(createdAt.toDate())
    let dateStr = "Unknown Date";
    if (data.createdAt?.toMillis) {
        const d = new Date(data.createdAt.toMillis());
        dateStr = d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
                + " - "
                + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    }

    // Category badge config — Dart catColor + catIcon + category label
    const catConfig = getCatConfig(category);

    // Avatar block
    const avatarHTML = providerImage
        ? `<img class="provider-avatar" src="${escHtml(providerImage)}" alt="${providerName}"
               onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
           <div class="provider-avatar-placeholder" style="display:none;">
               <span class="material-symbols-outlined">person</span>
           </div>`
        : `<div class="provider-avatar-placeholder">
               <span class="material-symbols-outlined">person</span>
           </div>`;

    // Full provider name — Dart: '$providerTitle $providerName'.trim()
    const fullName = [providerTitle, providerName].filter(Boolean).join(" ").trim();

    // Notes block
    const notesHTML = notes ? `
        <p class="content-label">Provider Notes:</p>
        <p class="content-text">${escHtml(notes)}</p>` : "";

    // Recommendations block
    const recoHTML = recommendations ? `
        <p class="content-label">Recommendations:</p>
        <p class="content-text">${escHtml(recommendations)}</p>` : "";

    const displayFileName = attachedFile || "Attached File";
    const attachHTML = fileUrl ? `
        <a class="attachment-btn" href="${escHtml(fileUrl)}" target="_blank" rel="noopener noreferrer"
           title="Open ${escHtml(displayFileName)}">
            <span class="material-symbols-outlined">file_present</span>
            <span class="attachment-filename">${escHtml(displayFileName)}</span>
            <span class="attachment-download">
                <span class="material-symbols-outlined">download</span>
            </span>
        </a>` : "";

    return `
        <div class="report-card">
            <div class="card-header">
                ${avatarHTML}
                <div class="provider-info">
                    <div class="provider-full-name">${fullName}</div>
                    <div class="report-date">${dateStr}</div>
                </div>
                <div class="cat-badge cat-${category.toLowerCase()}">
                    <span class="material-symbols-outlined">${catConfig.icon}</span>
                    ${category}
                </div>
            </div>
            <div class="card-divider"></div>
            ${notesHTML}
            ${recoHTML}
            ${attachHTML}
        </div>`;
}

// ── SOFT DELETE — CLEAR ALL ────────────────────────────
// Dart _clearAllReports(List<QueryDocumentSnapshot> docs)
// WriteBatch: set clearedByParent = true on each doc
async function clearAllReports(docs) {
    const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
    if (confirmDeleteBtn) { confirmDeleteBtn.disabled = true; confirmDeleteBtn.textContent = "Clearing..."; }

    try {
        // Dart: WriteBatch batch = FirebaseFirestore.instance.batch()
        const batch = writeBatch(db);
        docs.forEach(docSnap => {
            // Dart: batch.update(doc.reference, {'clearedByParent': true})
            batch.update(docSnap._ref || docSnap.ref, { clearedByParent: true });
        });
        await batch.commit();

        document.getElementById("confirmModal")?.classList.add("hidden");
        pendingClearDocs = [];
        showToast("All reports have been cleared! ✨", "#39CB69");
    } catch (err) {
        console.error("clearAllReports error:", err);
        showToast(`Error clearing reports: ${err.message}`, "#EF4444");
    } finally {
        if (confirmDeleteBtn) { confirmDeleteBtn.disabled = false; confirmDeleteBtn.textContent = "Clear All"; }
    }
}

// ── NOTIFICATION BADGE ─────────────────────────────────
function monitorNotifications(uid) {
    const q = query(
        collection(db, "notifications"),
        where("userId", "==", uid),
        where("isRead", "==", false)
    );
    onSnapshot(q, (snap) => {
        const badge = document.getElementById("notifCount");
        if (!badge) return;
        const count = snap.docs.length;
        if (count > 0) { badge.textContent = count > 99 ? "99+" : count; badge.classList.remove("hidden"); }
        else badge.classList.add("hidden");
    });
}

// ── UTILITIES ──────────────────────────────────────────

// Dart normaliseCat — maps raw Firestore value to display category
// Dart: medical/doctor/nurse/health → Medical, education/teacher → Educational, sport/coach → Sports, behavioral → Behavioral
function normaliseCat(raw) {
    const l = raw.toLowerCase();
    if (l.includes("medical") || l === "doctor" || l === "nurse" || l.includes("health")) return "Medical";
    if (l.includes("education") || l === "teacher")               return "Educational";
    if (l.includes("sport") || l === "coach")                     return "Sports";
    if (l.includes("behavior"))                                   return "Behavioral";
    return "Medical"; // Dart default
}

// Category icon mapping — Dart catIcon
function getCatConfig(category) {
    switch (category) {
        case "Medical":     return { icon: "medical_services" };
        case "Educational": return { icon: "school"           };
        case "Sports":      return { icon: "sports_handball"  };
        case "Behavioral":  return { icon: "psychology"       };
        default:            return { icon: "category"         };
    }
}

function showEmpty() {
    document.getElementById("loadingState")?.classList.add("hidden");
    document.getElementById("reportsList")?.classList.add("hidden");
    document.getElementById("emptyState")?.classList.remove("hidden");
}

function escHtml(str) {
    if (typeof str !== "string") return String(str ?? "");
    const d = document.createElement("div");
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
}

function showToast(msg, color = "#0D524F") {
    const t = document.createElement("div");
    t.style.cssText = `position:fixed;bottom:30px;left:50%;transform:translateX(-50%);
        background:${color};color:white;padding:13px 26px;border-radius:30px;
        font-size:14px;font-weight:700;z-index:9999;
        box-shadow:0 8px 24px rgba(0,0,0,0.2);white-space:nowrap;`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}
