import { auth, db } from "./firebase-config.js?v=3";
import {
    doc, getDoc, collection, query, where,
    getDocs, onSnapshot, addDoc, updateDoc,
    serverTimestamp, runTransaction
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let currentUser = null;
let selectedRating = 0;
let pendingRatingData = null; // { bookingId, bookingData } for the rating modal

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

    // 1. Auth guard — identical to Flutter initState check
    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            window.location.href = "login.html";
            return;
        }
        currentUser = user;

        // Run all startup tasks in parallel
        await Promise.all([
            setupUI(user.uid),
            checkScheduleBar(user.uid),
            loadTestimonials(),
        ]);

        monitorNotifications(user.uid);

        // Dart: _checkCompletedBookingsAndPromptReview — runs on home open
        checkCompletedBookingsAndPromptReview(user.uid);
    });

    // 2. Drawer controls
    const menuToggle  = document.getElementById("menuToggle");
    const closeDrawer = document.getElementById("closeDrawer");
    const sideDrawer  = document.getElementById("sideDrawer");
    const overlay     = document.getElementById("mainOverlay");

    function openDrawer()  { sideDrawer.classList.add("open");  overlay.classList.add("show"); }
    function closeDrawerFn(){ sideDrawer.classList.remove("open"); overlay.classList.remove("show"); }

    if (menuToggle)  menuToggle .addEventListener("click", openDrawer);
    if (closeDrawer) closeDrawer.addEventListener("click", closeDrawerFn);
    if (overlay)     overlay    .addEventListener("click", closeDrawerFn);

    // 3. Logout — confirm then sign out
    const logoutBtn = document.getElementById("logoutRequest");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            if (confirm("Are you sure you want to sign out from Gleam?")) {
                auth.signOut().then(() => { window.location.href = "login.html"; });
            }
        });
    }

    // 4. Profile avatar click
    const profileClick = document.getElementById("profileClick");
    if (profileClick) profileClick.addEventListener("click", () => { window.location.href = "profile.html"; });

    // 5. Medical card — toggle sub-options instead of navigating directly
    const medicalCard = document.getElementById("medicalCard");
    const medicalSub  = document.getElementById("medicalSub");
    if (medicalCard && medicalSub) {
        medicalCard.addEventListener("click", (e) => {
            medicalSub.classList.toggle("show");
        });
        // Close sub-options if user clicks anywhere else
        document.addEventListener("click", (e) => {
            if (!medicalCard.contains(e.target)) {
                medicalSub.classList.remove("show");
            }
        });
    }

    // 6. Rating modal — star selection
    const starBtns = document.querySelectorAll(".star-btn");
    starBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            selectedRating = parseInt(btn.dataset.val, 10);
            starBtns.forEach(s => {
                s.classList.toggle("filled", parseInt(s.dataset.val, 10) <= selectedRating);
            });
        });
    });

    // 7. Rating modal — skip
    const skipRating = document.getElementById("skipRating");
    if (skipRating) skipRating.addEventListener("click", hideRatingModal);

    // 8. Rating modal — submit
    const submitRatingBtn = document.getElementById("submitRating");
    if (submitRatingBtn) {
        submitRatingBtn.addEventListener("click", handleRatingSubmit);
    }
});

// ─────────────────────────────────────────────
// NAVIGATION HELPERS (called from HTML onclick)
// ─────────────────────────────────────────────
window.scrollToServices = () => {
    document.getElementById("servicesSection")?.scrollIntoView({ behavior: "smooth" });
};

window.goToProviders = (category) => {
    window.location.href = `providers-list.html?category=${encodeURIComponent(category)}`;
};

// openMedical is kept for orbit click — toggles the sub-options on the card
window.openMedical = () => {
    const sub = document.getElementById("medicalSub");
    if (sub) sub.classList.toggle("show");
};

// ─────────────────────────────────────────────
// 1. SETUP UI — fetch user doc, populate avatar + drawer
//    Collection: users / doc: uid
//    Fields: role, profileImage, parentImage, fullName
// ─────────────────────────────────────────────
async function setupUI(uid) {
    try {
        const userSnap = await getDoc(doc(db, "users", uid));
        if (!userSnap.exists()) { window.location.href = "login.html"; return; }

        const data = userSnap.data();

        // Role guard — only parents allowed
        if (data.role !== "parent") {
            window.location.href = "login.html";
            return;
        }

        // Avatar — matches Dart: data['profileImage'] ?? data['parentImage']
        const avatar = data.profileImage || data.parentImage || "";
        if (avatar) {
            const userImg = document.getElementById("userImg");
            if (userImg) userImg.src = avatar;
            const drawerAvatar = document.getElementById("drawerAvatar");
            if (drawerAvatar) drawerAvatar.src = avatar;
        }

        // Drawer name
        const drawerName = document.getElementById("drawerName");
        if (drawerName) drawerName.textContent = data.fullName || "Parent";

        // Greeting line
        const greetingLine = document.getElementById("greetingLine");
        if (greetingLine && data.fullName) {
            const hour = new Date().getHours();
            let greeting = "Good evening";
            if (hour < 12) greeting = "Good morning";
            else if (hour < 17) greeting = "Good afternoon";
            greetingLine.textContent = `${greeting}, ${data.fullName.split(" ")[0]}! 👋`;
        }

    } catch (err) {
        console.error("setupUI error:", err);
    }
}

// ─────────────────────────────────────────────
// 2. NOTIFICATION BADGE — real-time listener
//    Collection: notifications
//    Query: userId == uid AND isRead == false
//    Matches Dart StreamBuilder on notifications
// ─────────────────────────────────────────────
function monitorNotifications(uid) {
    const q = query(
        collection(db, "notifications"),
        where("userId", "==", uid),
        where("isRead", "==", false)
    );
    onSnapshot(q, (snap) => {
        const count = snap.docs.length;
        const badge = document.getElementById("notifCount");
        if (!badge) return;
        if (count > 0) {
            badge.textContent = count > 99 ? "99+" : count;
            badge.classList.remove("hidden");
        } else {
            badge.classList.add("hidden");
        }
    }, (err) => console.error("monitorNotifications error:", err));
}

// ─────────────────────────────────────────────
// 3. SCHEDULE STATUS BAR
//    Collection: bookings
//    Query: parentId == uid AND status == 'confirmed'
//    Shows upcoming session or empty prompt
// ─────────────────────────────────────────────
async function checkScheduleBar(uid) {
    const bar = document.getElementById("scheduleStatus");
    if (!bar) return;

    try {
        const q = query(
            collection(db, "bookings"),
            where("parentId", "==", uid),
            where("status", "==", "confirmed")
        );
        const snap = await getDocs(q);

        if (snap.empty) {
            bar.innerHTML = `
                <div class="empty-state">
                    <div>
                        <span class="material-symbols-outlined">event_busy</span>
                        <p>Your schedule is clear. Ready to book your first session?</p>
                    </div>
                    <button onclick="scrollToServices()" class="btn-book-now">Book Now</button>
                </div>`;
        } else {
            // Find the closest upcoming booking
            let closestBooking = null;
            let closestDiff = Infinity;
            const now = new Date();

            snap.docs.forEach(d => {
                const data = d.data();
                const dateTimeStr = `${data.date} ${data.time}`;
                const parsed = parseDateTimeStr(dateTimeStr);
                if (parsed && parsed > now) {
                    const diff = parsed - now;
                    if (diff < closestDiff) {
                        closestDiff = diff;
                        closestBooking = data;
                    }
                }
            });

            if (closestBooking) {
                const title = closestBooking.providerTitle || "";
                const name  = closestBooking.providerName  || "your provider";
                bar.innerHTML = `
                    <div class="empty-state">
                        <div>
                            <span class="material-symbols-outlined">event_available</span>
                            <p>Next session: <strong>${title} ${name}</strong> on ${closestBooking.date} at ${closestBooking.time}</p>
                        </div>
                        <button onclick="window.location.href='bookings.html'" class="btn-book-now">View Details</button>
                    </div>`;
            } else {
                bar.innerHTML = `
                    <div class="empty-state">
                        <div>
                            <span class="material-symbols-outlined">event_available</span>
                            <p>You have upcoming sessions! Check your Bookings tab.</p>
                        </div>
                        <button onclick="window.location.href='bookings.html'" class="btn-book-now">View Details</button>
                    </div>`;
            }
        }
    } catch (err) {
        console.error("checkScheduleBar error:", err);
        bar.innerHTML = `<div class="empty-state"><div><span class="material-symbols-outlined">error</span><p>Could not load schedule.</p></div></div>`;
    }
}

// ─────────────────────────────────────────────
// 4. AUTO-COMPLETE BOOKINGS & PROMPT REVIEW
//    Exact port of Dart _checkCompletedBookingsAndPromptReview()
//    Collection: bookings
//    Query: parentId == uid AND status == 'confirmed'
//    Logic: if now - bookingDateTime >= 2 hours → update status to 'completed'
//           then show rating dialog (break after first)
// ─────────────────────────────────────────────
async function checkCompletedBookingsAndPromptReview(uid) {
    try {
        const q = query(
            collection(db, "bookings"),
            where("parentId", "==", uid),
            where("status", "==", "confirmed")
        );
        const snap = await getDocs(q);
        if (snap.empty) return;

        const now = new Date();

        for (const docSnap of snap.docs) {
            const data = docSnap.data();
            const dateStr = data.date || ""; // yyyy-MM-dd
            const timeStr = data.time || ""; // hh:mm a (e.g. 10:30 AM)

            if (!dateStr || !timeStr) continue;

            const bookingDateTime = parseDateTimeStr(`${dateStr} ${timeStr}`);
            if (!bookingDateTime) continue;

            // Dart: now.difference(bookingDateTime).inHours >= 2
            const diffHours = (now - bookingDateTime) / (1000 * 60 * 60);
            if (diffHours >= 2) {
                // 1. Update status to completed
                await updateDoc(docSnap.ref, { status: "completed" });

                // 2. Show rating dialog (only one at a time — Dart: break)
                pendingRatingData = { bookingId: docSnap.id, bookingData: data };
                showRatingModal(data);
                break; // Dart equivalent of break after first match
            }
        }
    } catch (err) {
        console.error("checkCompletedBookings error:", err);
    }
}

// ─────────────────────────────────────────────
// 5. RATING MODAL — show / hide
// ─────────────────────────────────────────────
function showRatingModal(bookingData) {
    const modal    = document.getElementById("ratingModal");
    const subtitle = document.getElementById("ratingModalSubtitle");
    if (!modal) return;

    const title = bookingData.providerTitle || "";
    const name  = bookingData.providerName  || "your provider";
    if (subtitle) subtitle.textContent = `How was your session with ${title} ${name}?`;

    // Reset stars
    selectedRating = 5; // Default 5 stars as in Dart
    document.querySelectorAll(".star-btn").forEach(s => {
        s.classList.toggle("filled", parseInt(s.dataset.val, 10) <= 5);
    });

    // Reset comment
    const commentEl = document.getElementById("ratingComment");
    if (commentEl) commentEl.value = "";

    modal.classList.remove("hidden");
}

function hideRatingModal() {
    const modal = document.getElementById("ratingModal");
    if (modal) modal.classList.add("hidden");
    pendingRatingData = null;
    selectedRating = 0;
}

// ─────────────────────────────────────────────
// 6. RATING SUBMIT
//    Exact port of Dart _submitReview()
//    Writes to: reviews collection
//    Updates:   bookings.doc(id) isRated = true
//    Transaction: users.doc(providerId) → recalculate averageRating + totalReviews
// ─────────────────────────────────────────────
async function handleRatingSubmit() {
    if (!pendingRatingData || !currentUser) return;
    if (selectedRating === 0) {
        alert("Please select a star rating.");
        return;
    }

    const submitBtn  = document.getElementById("submitRating");
    const commentVal = document.getElementById("ratingComment")?.value.trim() || "";
    const { bookingId, bookingData } = pendingRatingData;
    const providerId = bookingData.providerId || "";

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Submitting..."; }

    try {
        // a. Write review document
        await addDoc(collection(db, "reviews"), {
            bookingId:   bookingId,
            providerId:  providerId,
            parentId:    currentUser.uid,
            parentName:  bookingData.parentName || "Unknown Parent",
            rating:      selectedRating,
            comment:     commentVal,
            date:        serverTimestamp(),
        });

        // b. Mark booking as rated
        await updateDoc(doc(db, "bookings", bookingId), { isRated: true });

        // c. Firestore transaction to recalculate provider averageRating + totalReviews
        //    Exact port of Dart runTransaction logic
        if (providerId) {
            const providerRef = doc(db, "users", providerId);
            await runTransaction(db, async (transaction) => {
                const provSnap = await transaction.get(providerRef);
                if (!provSnap.exists()) return;

                const provData = provSnap.data();
                const currentTotalReviews = provData.totalReviews || 0;
                const currentAverage      = parseFloat(provData.averageRating) || 0.0;

                const newTotalReviews = currentTotalReviews + 1;
                const newAverage = ((currentAverage * currentTotalReviews) + selectedRating) / newTotalReviews;

                transaction.update(providerRef, {
                    totalReviews:  newTotalReviews,
                    averageRating: newAverage,
                });
            });
        }

        hideRatingModal();
        showToast("Thank you for your review! 🌟");

    } catch (err) {
        console.error("Rating submit error:", err);
        alert(`Error submitting review: ${err.message}`);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit"; }
    }
}

// ─────────────────────────────────────────────
// 7. TESTIMONIALS — from app_feedback collection
//    Query: where isFeatured == true
//    Falls back gracefully to static cards if empty
// ─────────────────────────────────────────────
async function loadTestimonials() {
    const container = document.getElementById("feedbackContainer");
    if (!container) return;

    try {
        const q = query(
            collection(db, "app_feedback"),
            where("isFeatured", "==", true)
        );
        const snap = await getDocs(q);

        if (!snap.empty) {
            container.innerHTML = "";
            snap.forEach(docSnap => {
                const data = docSnap.data();
                container.innerHTML += `
                    <div class="testimonial-card">
                        <p>"${escapeHtml(data.comment || "")}"</p>
                        <h5>- ${escapeHtml(data.parentName || "A Happy Parent")}</h5>
                    </div>`;
            });
        }
        // If empty → keep static fallback cards that are already in HTML
    } catch (err) {
        // Non-critical — static fallbacks remain visible
        console.warn("loadTestimonials error (non-critical):", err);
    }
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

/**
 * Parse "yyyy-MM-dd hh:mm a" into a Date object.
 * Matches Dart: DateFormat("yyyy-MM-dd hh:mm a").parse(dateTimeStr)
 * Example input: "2026-04-20 10:30 AM"
 */
function parseDateTimeStr(str) {
    try {
        // str format: "2026-04-20 10:30 AM"
        const parts = str.trim().split(" "); // ["2026-04-20", "10:30", "AM"]
        if (parts.length < 3) return null;

        const dateParts  = parts[0].split("-"); // [2026, 04, 20]
        const timeParts  = parts[1].split(":"); // [10, 30]
        const meridiem   = parts[2].toUpperCase(); // AM / PM

        let year   = parseInt(dateParts[0], 10);
        let month  = parseInt(dateParts[1], 10) - 1; // JS months 0-indexed
        let day    = parseInt(dateParts[2], 10);
        let hour   = parseInt(timeParts[0], 10);
        let minute = parseInt(timeParts[1] || "0", 10);

        // Convert 12-hour to 24-hour — matches Dart _parseTime()
        if (meridiem === "PM" && hour !== 12) hour += 12;
        if (meridiem === "AM" && hour === 12) hour = 0;

        return new Date(year, month, day, hour, minute, 0);
    } catch {
        return null;
    }
}

/** Simple HTML escaping to prevent XSS in dynamic content */
function escapeHtml(str) {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

/** Non-blocking toast message */
function showToast(msg) {
    const toast = document.createElement("div");
    toast.style.cssText = `
        position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
        background: #0D524F; color: white; padding: 14px 28px; border-radius: 30px;
        font-size: 15px; font-weight: 600; z-index: 9999;
        box-shadow: 0 10px 30px rgba(0,0,0,0.2);
        animation: fadeInUp 0.3s ease;
    `;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}