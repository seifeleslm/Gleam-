import { auth, db } from "./firebase-config.js?v=3";
import {
    doc, getDoc, collection, query, where,
    onSnapshot, addDoc, updateDoc,
    serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ── STATE ──────────────────────────────────────────────
let allBookings    = [];   // raw Firestore docs (all statuses)
let activeFilter   = "all"; // tab filter
let selectedRating = 0;
let currentUser    = null;

// ── STATUS MAP — exact Dart values ──────────────────────
// Dart: statusColor + statusText logic
const STATUS_MAP = {
    confirmed: { text: "Confirmed",          css: "status-confirmed" },
    pending:   { text: "Pending Approval",   css: "status-pending"   },
    cancelled: { text: "Declined/Cancelled", css: "status-cancelled" },
    completed: { text: "Completed",          css: "status-completed" },
};

// ── BOOT ───────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

    // Auth guard
    auth.onAuthStateChanged((user) => {
        if (!user) { window.location.href = "login.html"; return; }
        currentUser = user;
        monitorNotifications(user.uid);
        startBookingsStream(user.uid);
    });

    // Back button
    document.getElementById("backBtn")?.addEventListener("click", () => history.back());

    // Status tab buttons
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeFilter = btn.dataset.filter;
            renderBookings();
        });
    });

    // Rating modal — stars
    document.querySelectorAll(".star-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            selectedRating = parseInt(btn.dataset.val, 10);
            document.querySelectorAll(".star-btn").forEach(s => {
                s.classList.toggle("filled", parseInt(s.dataset.val, 10) <= selectedRating);
            });
        });
    });

    // Rating modal — cancel / close
    document.getElementById("cancelRatingBtn")?.addEventListener("click", closeRatingModal);
    document.getElementById("closeRatingModal")?.addEventListener("click", closeRatingModal);

    // Rating modal — submit
    document.getElementById("submitRatingBtn")?.addEventListener("click", handleRatingSubmit);
});

// ── REAL-TIME BOOKINGS STREAM ──────────────────────────
// Dart: StreamBuilder on bookings where parentId == uid
function startBookingsStream(uid) {
    const q = query(
        collection(db, "bookings"),
        where("parentId", "==", uid)
    );

    onSnapshot(q, (snap) => {
        allBookings = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderBookings();
    }, (err) => {
        console.error("Bookings stream error:", err);
        showEmpty("Could not load bookings.");
    });
}

// ── RENDER BOOKINGS LIST ───────────────────────────────
function renderBookings() {
    const listEl     = document.getElementById("bookingsList");
    const loadingEl  = document.getElementById("loadingState");
    const emptyEl    = document.getElementById("emptyState");
    if (!listEl) return;

    // Hide loading once we have data
    loadingEl?.classList.add("hidden");

    // Apply tab filter
    let bookings = allBookings;
    if (activeFilter !== "all") {
        bookings = allBookings.filter(b => b.status === activeFilter);
    }

    if (bookings.length === 0) {
        listEl.classList.add("hidden");
        emptyEl?.classList.remove("hidden");
        const emptyTitle = document.getElementById("emptyTitle");
        const emptyMsg   = document.getElementById("emptyMsg");
        if (activeFilter === "all") {
            if (emptyTitle) emptyTitle.textContent = "No bookings yet.";
            if (emptyMsg)   emptyMsg.textContent   = "Your bookings will appear here once you book a session.";
        } else {
            if (emptyTitle) emptyTitle.textContent = `No ${activeFilter} bookings.`;
            if (emptyMsg)   emptyMsg.textContent   = "Try selecting a different filter.";
        }
        return;
    }

    emptyEl?.classList.add("hidden");
    listEl.classList.remove("hidden");
    listEl.innerHTML = bookings.map(b => buildBookingCardHTML(b)).join("");

    // Wire up action buttons after render
    listEl.querySelectorAll(".btn-cancel-booking").forEach(btn => {
        btn.addEventListener("click", () => cancelBooking(btn.dataset.bookingId));
    });
    listEl.querySelectorAll(".btn-rate-provider").forEach(btn => {
        btn.addEventListener("click", () => {
            openRatingModal(
                btn.dataset.providerId,
                btn.dataset.bookingId,
                btn.dataset.providerName
            );
        });
    });
}

// ── BUILD BOOKING CARD HTML ────────────────────────────
// Exact port of Dart ListView.builder itemBuilder
function buildBookingCardHTML(data) {
    const docId = data.id;

    // Dart: fullProviderName = pTitle.isNotEmpty ? '$pTitle $pName' : pName
    const pName  = data.providerName  || "Unknown Provider";
    const pTitle = data.providerTitle || "";
    const fullProviderName = pTitle ? `${pTitle} ${pName}` : pName;

    const serviceCategory = data.serviceCategory || "Service";
    const date   = data.date   || "";
    const time   = data.time   || "";
    const status = data.status || "pending";
    const type   = data.type   || "session";
    const providerId = data.providerId || "";
    // Dart: isRated = data['isRated'] ?? false
    const isRated = data.isRated === true;

    // Dart status text + colour
    const statusInfo = STATUS_MAP[status] || { text: status, css: "status-pending" };

    // Dart: Cancel button shown if status == 'pending'
    const showCancel = status === "pending";
    // Dart: Rate button shown if status == 'completed' && !isRated
    const showRate   = status === "completed" && !isRated;

    const actionsHTML = (showCancel || showRate) ? `
        <div class="card-divider"></div>
        <div class="card-actions">
            ${showCancel ? `
                <button class="btn-cancel-booking"
                    data-booking-id="${docId}">
                    <span class="material-symbols-outlined">close</span>
                    Cancel Request
                </button>` : ""}
            ${showRate ? `
                <button class="btn-rate-provider"
                    data-provider-id="${escHtml(providerId)}"
                    data-booking-id="${docId}"
                    data-provider-name="${escHtml(fullProviderName)}">
                    <span class="material-symbols-outlined">star</span>
                    Rate Provider
                </button>` : ""}
        </div>` : "";

    return `
        <div class="booking-card">
            <div class="booking-card-header">
                <div class="booking-provider-name">${escHtml(fullProviderName)}</div>
                <span class="status-badge ${statusInfo.css}">${statusInfo.text}</span>
            </div>
            <div class="service-category-chip">${escHtml(serviceCategory)}</div>
            <div class="booking-meta">
                <div class="meta-row">
                    <span class="material-symbols-outlined">calendar_today</span>
                    <span>${escHtml(date)} at ${escHtml(time)}</span>
                </div>
                <div class="meta-row">
                    <span class="material-symbols-outlined">category</span>
                    <span>Type: ${escHtml(type.toUpperCase())}</span>
                </div>
            </div>
            ${actionsHTML}
        </div>`;
}

// ── CANCEL BOOKING ─────────────────────────────────────
// Dart _cancelBooking: update bookings.doc(id) → {status: 'cancelled'}
async function cancelBooking(bookingId) {
    if (!confirm("Are you sure you want to cancel this booking?")) return;
    try {
        await updateDoc(doc(db, "bookings", bookingId), { status: "cancelled" });
        showToast("Request cancelled successfully.", "#EF4444");
    } catch (err) {
        console.error("cancelBooking error:", err);
        alert(`Error: ${err.message}`);
    }
}

// ── RATING MODAL ────────────────────────────────────────
function openRatingModal(providerId, bookingId, providerName) {
    selectedRating = 0;
    document.querySelectorAll(".star-btn").forEach(s => s.classList.remove("filled"));
    const commentEl = document.getElementById("ratingComment");
    if (commentEl) commentEl.value = "";

    setText("ratingModalTitle", `Rate ${providerName}`);
    setText("ratingModalSub",   "How was your experience?");

    const providerIdEl = document.getElementById("ratingProviderId");
    const bookingIdEl  = document.getElementById("ratingBookingId");
    if (providerIdEl) providerIdEl.value = providerId;
    if (bookingIdEl)  bookingIdEl.value  = bookingId;

    document.getElementById("ratingModal")?.classList.remove("hidden");
}

function closeRatingModal() {
    document.getElementById("ratingModal")?.classList.add("hidden");
    selectedRating = 0;
}

// ── RATING SUBMIT ──────────────────────────────────────
// Dart _submitReview():
//  1. Write to reviews collection
//  2. Update bookings.doc(id) → {isRated: true}
//  3. Firestore transaction on users.doc(providerId) → recalculate averageRating + totalReviews
async function handleRatingSubmit() {
    if (selectedRating === 0) { alert("Please select a star rating."); return; }

    const providerId = document.getElementById("ratingProviderId")?.value || "";
    const bookingId  = document.getElementById("ratingBookingId")?.value  || "";
    const comment    = document.getElementById("ratingComment")?.value.trim() || "";

    if (!providerId || !bookingId || !currentUser) return;

    const submitBtn = document.getElementById("submitRatingBtn");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Submitting..."; }

    try {
        // 1. Read parent name from users doc — Dart: parentDoc.data()['fullName']
        const parentSnap = await getDoc(doc(db, "users", currentUser.uid));
        const parentName = parentSnap.exists()
            ? (parentSnap.data().fullName || "Unknown Parent")
            : "Unknown Parent";

        // 2. Write review
        await addDoc(collection(db, "reviews"), {
            providerId,
            parentId:   currentUser.uid,
            parentName,
            rating:     selectedRating,
            comment,
            date:       serverTimestamp(),
            bookingId,
        });

        // 3. Mark booking as rated
        await updateDoc(doc(db, "bookings", bookingId), { isRated: true });

        // 4. Firestore transaction — recalculate provider averageRating + totalReviews
        // Dart: runTransaction → currentTotal, currentAverage → newAverage
        const providerRef = doc(db, "users", providerId);
        await runTransaction(db, async (transaction) => {
            const provSnap = await transaction.get(providerRef);
            if (!provSnap.exists()) return;
            const provData = provSnap.data();

            const currentTotalReviews = provData.totalReviews   || 0;
            const currentAverage      = parseFloat(provData.averageRating) || 0.0;
            const newTotalReviews     = currentTotalReviews + 1;
            const newAverage          = ((currentAverage * currentTotalReviews) + selectedRating) / newTotalReviews;

            transaction.update(providerRef, {
                totalReviews:  newTotalReviews,
                averageRating: newAverage,
            });
        });

        closeRatingModal();
        showToast("Thank you for your review! 🌟", "#39CB69");

    } catch (err) {
        console.error("handleRatingSubmit error:", err);
        alert(`Error submitting review: ${err.message}`);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit"; }
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
        else { badge.classList.add("hidden"); }
    });
}

// ── UTILITIES ──────────────────────────────────────────
function showEmpty(msg) {
    document.getElementById("loadingState")?.classList.add("hidden");
    document.getElementById("bookingsList")?.classList.add("hidden");
    const emptyEl = document.getElementById("emptyState");
    const emptyMsg = document.getElementById("emptyMsg");
    if (emptyMsg) emptyMsg.textContent = msg;
    emptyEl?.classList.remove("hidden");
}

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function escHtml(str) {
    if (typeof str !== "string") return str;
    const d = document.createElement("div");
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
}

function showToast(msg, color = "#0D524F") {
    const t = document.createElement("div");
    t.style.cssText = `position:fixed;bottom:30px;left:50%;transform:translateX(-50%);
        background:${color};color:white;padding:13px 26px;border-radius:30px;
        font-size:14px;font-weight:700;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.2);`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}
