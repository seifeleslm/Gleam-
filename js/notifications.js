import { auth, db } from "./firebase-config.js?v=3";
import {
    doc, collection, query, where,
    onSnapshot, getDocs, writeBatch, updateDoc
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ── STATE ──────────────────────────────────────────────
let currentUser  = null;
let allNotifDocs = []; // raw {_id, _ref, ...data} objects from onSnapshot

// ── BOOT ───────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

    // Auth guard
    auth.onAuthStateChanged((user) => {
        if (!user) { window.location.href = "login.html"; return; }
        currentUser = user;
        startNotificationsStream(user.uid);
    });

    // Back button
    document.getElementById("backBtn")?.addEventListener("click", () => history.back());

    // Clear All button (header icon) — Dart: IconButton(delete_sweep_outlined)
    document.getElementById("clearAllBtn")?.addEventListener("click", async () => {
        if (!currentUser) return;

        // Dart: get all notifications for userId, pass to _clearAllNotifications
        const snap = await getDocs(
            query(collection(db, "notifications"), where("userId", "==", currentUser.uid))
        );

        if (snap.docs.length === 0) {
            showToast("No notifications to clear.", "#F97316");
            return;
        }

        // Store refs on the pending set, open confirm modal
        _pendingDeleteDocs = snap.docs.map(d => ({ _ref: d.ref }));
        openConfirmModal();
    });

    // Mark all read button
    document.getElementById("markAllReadBtn")?.addEventListener("click", markAllRead);

    // Confirm modal — cancel
    document.getElementById("confirmCancelBtn")?.addEventListener("click", closeConfirmModal);

    // Confirm modal — delete (hard delete, Dart: batch.delete)
    document.getElementById("confirmDeleteBtn")?.addEventListener("click", () => {
        clearAllNotifications(_pendingDeleteDocs);
    });
});

let _pendingDeleteDocs = [];

// ── REAL-TIME NOTIFICATIONS STREAM ────────────────────
// Dart: StreamBuilder on notifications where userId == uid
// Note: no .orderBy() to avoid composite index requirement — sort client-side
function startNotificationsStream(uid) {
    const q = query(
        collection(db, "notifications"),
        where("userId", "==", uid)
    );

    onSnapshot(q, (snap) => {
        // Map to plain objects, keeping ref for updates + deletes
        allNotifDocs = snap.docs.map(d => ({
            _id:  d.id,
            _ref: d.ref,
            ...d.data()
        }));

        renderNotifications();
    }, (err) => {
        console.error("Notifications stream error:", err);
        showEmptyState();
    });
}

// ── RENDER ────────────────────────────────────────────
function renderNotifications() {
    const listEl    = document.getElementById("notifList");
    const loadingEl = document.getElementById("loadingState");
    const emptyEl   = document.getElementById("emptyState");
    const unreadLbl = document.getElementById("unreadLabel");
    if (!listEl) return;

    loadingEl?.classList.add("hidden");

    // Dart: docs.sort((a,b) => t2.compareTo(t1)) — newest first
    const sorted = [...allNotifDocs].sort((a, b) => {
        const t1 = a.createdAt?.toMillis?.() ?? 0;
        const t2 = b.createdAt?.toMillis?.() ?? 0;
        return t2 - t1;
    });

    if (sorted.length === 0) {
        listEl.classList.add("hidden");
        emptyEl?.classList.remove("hidden");
        if (unreadLbl) unreadLbl.textContent = "";
        return;
    }

    emptyEl?.classList.add("hidden");
    listEl.classList.remove("hidden");

    // Unread count badge label
    const unreadCount = sorted.filter(n => n.isRead !== true).length;
    if (unreadLbl) {
        unreadLbl.textContent = unreadCount > 0
            ? `${unreadCount} unread notification${unreadCount > 1 ? "s" : ""}`
            : "All caught up ✅";
    }

    // Render cards
    listEl.innerHTML = sorted.map(n => buildNotifCardHTML(n)).join("");

    // Wire click handlers after render
    listEl.querySelectorAll(".notif-card").forEach(card => {
        card.addEventListener("click", () => {
            const id   = card.dataset.id;
            const type = card.dataset.type;
            const read = card.dataset.read === "true";
            handleNotifClick(id, type, read);
        });
    });
}

// ── BUILD NOTIFICATION CARD HTML ──────────────────────
// Dart _buildNotifCard — exact field + style mapping
function buildNotifCardHTML(data) {
    const title  = escHtml(data.title  || "Notification");
    const body   = escHtml(data.body   || "");
    const isRead = data.isRead === true;
    const type   = data.type   || "general";

    // Dart: isAccepted = title.contains('Accepted') || title.contains('Confirmed')
    const rawTitle   = data.title || "";
    const isAccepted  = rawTitle.includes("Accepted") || rawTitle.includes("Confirmed");
    // Dart: isCancelled = title.contains('Declined') || title.contains('Cancelled')
    const isCancelled = rawTitle.includes("Declined") || rawTitle.includes("Cancelled");

    // Dart: DateFormat('MMM dd, hh:mm a').format(createdAt.toDate())
    let timeStr = "";
    if (data.createdAt?.toMillis) {
        const d = new Date(data.createdAt.toMillis());
        timeStr = d.toLocaleDateString("en-US", { month: "short", day: "2-digit" })
                + ", "
                + d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    }

    // Dart: leading icon logic
    // isCancelled → cancel, isAccepted → check_circle, else → notifications
    let iconName = "notifications";
    if (isCancelled) iconName = "cancel";
    else if (isAccepted) iconName = "check_circle";

    // CSS class for card state
    const stateClass = [
        isRead     ? "read"         : "unread",
        isCancelled ? "is-cancelled" : ""
    ].join(" ").trim();

    return `
        <div class="notif-card ${stateClass}"
             data-id="${escHtml(data._id)}"
             data-type="${escHtml(type)}"
             data-read="${isRead}"
             role="button" tabindex="0"
             aria-label="${title}">
            <div class="notif-avatar">
                <span class="material-symbols-outlined">${iconName}</span>
            </div>
            <div class="notif-content">
                <div class="notif-title">${title}</div>
                <div class="notif-body">${body}</div>
                <div class="notif-time">${timeStr}</div>
            </div>
            <div class="unread-dot" aria-hidden="true"></div>
        </div>`;
}

// ── NOTIFICATION CLICK — mark read + route ─────────────
// Dart onTap: if(!isRead) update isRead:true → route by type
async function handleNotifClick(docId, type, isAlreadyRead) {
    try {
        // Find the ref from our local state
        const notifData = allNotifDocs.find(n => n._id === docId);
        if (!notifData) return;

        // Dart: if (!isRead) await docs[index].reference.update({'isRead': true})
        if (!isAlreadyRead) {
            await updateDoc(notifData._ref, { isRead: true });
            // onSnapshot will fire and re-render automatically
        }

        // Dart smart routing — type == 'booking' → ParentBookingsScreen
        //                       type == 'report'  → ParentReportsScreen
        if (type === "booking") {
            window.location.href = "bookings.html";
        } else if (type === "report") {
            window.location.href = "reports.html";
        }
        // type == 'general' or unknown — no navigation, just mark read

    } catch (err) {
        console.error("handleNotifClick error:", err);
    }
}

// ── MARK ALL READ ─────────────────────────────────────
async function markAllRead() {
    if (!currentUser) return;
    const unread = allNotifDocs.filter(n => n.isRead !== true);
    if (unread.length === 0) { showToast("All notifications are already read.", "#F97316"); return; }

    try {
        const batch = writeBatch(db);
        unread.forEach(n => batch.update(n._ref, { isRead: true }));
        await batch.commit();
        // onSnapshot re-renders automatically
    } catch (err) {
        console.error("markAllRead error:", err);
        showToast(`Error: ${err.message}`, "#EF4444");
    }
}

// ── CLEAR ALL (HARD DELETE) ────────────────────────────
// Dart _clearAllNotifications: WriteBatch → batch.delete(doc.reference)
// This is a HARD DELETE unlike reports which uses soft delete (clearedByParent)
async function clearAllNotifications(docsToDelete) {
    const btn = document.getElementById("confirmDeleteBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Deleting..."; }

    try {
        // Dart: WriteBatch batch = FirebaseFirestore.instance.batch()
        const batch = writeBatch(db);
        docsToDelete.forEach(d => {
            // Dart: batch.delete(doc.reference)
            batch.delete(d._ref);
        });
        await batch.commit();

        closeConfirmModal();
        _pendingDeleteDocs = [];
        // onSnapshot fires → empty state shown automatically
        showToast("All notifications cleared!", "#EF4444");

    } catch (err) {
        console.error("clearAllNotifications error:", err);
        showToast(`Error: ${err.message}`, "#EF4444");
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Delete"; }
    }
}

// ── MODAL HELPERS ─────────────────────────────────────
function openConfirmModal() {
    document.getElementById("confirmModal")?.classList.remove("hidden");
}
function closeConfirmModal() {
    document.getElementById("confirmModal")?.classList.add("hidden");
    _pendingDeleteDocs = [];
}

// ── EMPTY STATE ───────────────────────────────────────
function showEmptyState() {
    document.getElementById("loadingState")?.classList.add("hidden");
    document.getElementById("notifList")?.classList.add("hidden");
    document.getElementById("emptyState")?.classList.remove("hidden");
}

// ── UTILITIES ─────────────────────────────────────────
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
    setTimeout(() => t.remove(), 3000);
}
