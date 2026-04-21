import { auth, db } from "./firebase-config.js?v=3";
import {
    doc, getDoc, collection, query, where,
    getDocs, onSnapshot, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ── STATE ──────────────────────────────────────────────
let providerData    = null;   // loaded from sessionStorage
let scheduleMap     = {};     // {Mon: "9AM-5PM", ...}
let sessionDuration = 60;     // minutes, from providerData.sessionDuration
let upcomingDates   = [];     // 14 Date objects
let selectedDate    = null;   // Date object
let selectedTime    = "";     // "10:30 AM"
let allSlots        = [];     // generated slots for selected day
let bookedSlots     = [];     // already booked slots from Firestore
let isBooking       = false;
let currentUser     = null;
let unsubReviews    = null;

// ── BOOT ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

    // 1. Load provider from sessionStorage
    try {
        const raw = sessionStorage.getItem("selectedProvider");
        if (!raw) { window.location.href = "parent-home.html"; return; }
        providerData = JSON.parse(raw);
    } catch (e) {
        window.location.href = "parent-home.html";
        return;
    }

    // 2. Auth guard
    auth.onAuthStateChanged(async (user) => {
        if (!user) { window.location.href = "login.html"; return; }
        currentUser = user;

        populateProfileUI();
        generateNextTwoWeeks();   // Dart _generateNextTwoWeeks()
        renderDateRow();
        startReviewsStream();
        monitorNotifications(user.uid);
    });

    // 3. Back button
    document.getElementById("backBtn")?.addEventListener("click", () => history.back());

    // 4. Book Session button
    document.getElementById("bookSessionBtn")?.addEventListener("click", () => {
        submitBooking(false); // isMonthly = false
    });

    // 5. Subscribe Monthly button
    document.getElementById("subscribeMonthlyBtn")?.addEventListener("click", () => {
        submitBooking(true); // isMonthly = true
    });

    // 6. Success modal close
    document.getElementById("awesomeBtn")?.addEventListener("click", () => {
        document.getElementById("successModal")?.classList.add("hidden");
        history.back(); // Go back to providers list like Dart: Navigator.pop x2
    });
});

// ── POPULATE PROFILE UI ────────────────────────────────
function populateProfileUI() {
    const d = providerData;

    // Avatar
    const avatar = d.profileImage || "";
    if (avatar) {
        const el = document.getElementById("providerAvatar");
        if (el) { el.src = avatar; el.onerror = () => { el.src = "assets/images/app_logo.png"; }; }
    }

    // Name & specialty — Dart: data['fullName'], data['specialty'] ?? data['title']
    setText("providerName",     d.fullName    || "Unknown Provider");
    setText("providerSpecialty", d.specialty  || d.title || "Specialist");
    document.title = `Gleam | ${d.fullName || "Provider"}`;

    // Info cards — Dart _buildInfoCard()
    // experience
    setText("infoExpVal",     d.experience ? `${d.experience}` : "+5 Yrs");
    // session price — Dart: price > 0 ? '${price} EGP' : 'N/A'
    setText("infoPriceVal",   (d.price && d.price > 0) ? `${d.price} EGP` : "N/A");
    // monthly price
    const monthlyPrice = d.monthlyPrice && d.monthlyPrice > 0 ? d.monthlyPrice : null;
    setText("infoMonthlyVal", monthlyPrice ? `${monthlyPrice} EGP` : "N/A");
    // city
    setText("infoCityVal",    d.governorate || "—");

    // Show/hide Monthly button — Dart: if (monthlyPrice != 'N/A')
    const monthlyBtn = document.getElementById("subscribeMonthlyBtn");
    if (monthlyBtn && monthlyPrice) {
        monthlyBtn.classList.remove("hidden");
        setText("monthlyBtnLabel", `Monthly (${monthlyPrice} EGP)`);
    }

    // Build scheduleMap from providerData.schedule
    scheduleMap = d.schedule || {};

    // Parse sessionDuration — Dart: int.tryParse(durationStr.replaceAll(RegExp(r'[^0-9]'), '')) ?? 60
    const durStr = String(d.sessionDuration || "60").replace(/[^0-9]/g, "");
    sessionDuration = parseInt(durStr, 10) || 60;
}

// ── 14-DAY GENERATION ─────────────────────────────────
// Dart _generateNextTwoWeeks(): for i in 0..13, add today + i
function generateNextTwoWeeks() {
    upcomingDates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        upcomingDates.push(d);
    }
}

// ── RENDER DATE ROW ───────────────────────────────────
function renderDateRow() {
    const container = document.getElementById("datesScroll");
    if (!container) return;
    container.innerHTML = "";

    upcomingDates.forEach((date, idx) => {
        // Dart: dayName = DateFormat('E').format(date)  → "Mon", "Tue" etc.
        const dayName   = date.toLocaleDateString("en-US", { weekday: "short" }); // "Mon"
        // Dart: dayNumber = DateFormat('d MMM').format(date) → "19 Apr"
        const dayNumber = date.toLocaleDateString("en-US", { day: "numeric", month: "short" });

        // Dart: isDayAvailable = _scheduleMap.containsKey(dayName)
        const isAvailable = Object.prototype.hasOwnProperty.call(scheduleMap, dayName);

        const chip = document.createElement("div");
        chip.className = `date-chip${isAvailable ? "" : " unavailable"}`;
        chip.dataset.index = idx;
        chip.innerHTML = `
            <div class="day-name">${dayName}</div>
            <div class="day-date">${dayNumber}</div>`;

        chip.addEventListener("click", () => onDateChipClick(date, dayName, isAvailable, chip));
        container.appendChild(chip);
    });
}

// ── DATE CHIP CLICK ───────────────────────────────────
async function onDateChipClick(date, dayName, isAvailable, chip) {
    // Dart: if not available → SnackBar("Provider is not available on this day.")
    if (!isAvailable) {
        showUnavailable(true);
        hideSlotsSection();
        clearDateSelection();
        chip.classList.add("selected");
        return;
    }
    showUnavailable(false);

    // Mark selected chip
    clearDateSelection();
    chip.classList.add("selected");
    selectedDate = date;
    selectedTime = ""; // reset time

    // Dart: _calculateSmartSlots(_scheduleMap[dayName])
    const timeRange = scheduleMap[dayName] || "";
    calculateSmartSlots(timeRange);

    // Dart: await _fetchBookedSlots(date)
    await fetchBookedSlots(date);

    renderSlots();
}

function clearDateSelection() {
    document.querySelectorAll(".date-chip").forEach(c => c.classList.remove("selected"));
}

function showUnavailable(show) {
    const el = document.getElementById("dayUnavailable");
    if (el) el.classList.toggle("hidden", !show);
}

function hideSlotsSection() {
    document.getElementById("slotsSection")?.classList.add("hidden");
}

// ── SMART SLOT CALCULATION ────────────────────────────
// Dart _calculateSmartSlots(timeRange)
// E.g. timeRange = "9AM-5PM" or "09:00AM-05:00PM"
function calculateSmartSlots(timeRange) {
    allSlots = [];
    try {
        // Dart: timeRange.toUpperCase().replaceAll(' ', '')
        const cleaned = timeRange.toUpperCase().replace(/\s/g, "");
        // Dart: parts = timeRange.split('-')
        const parts = cleaned.split("-");
        if (parts.length !== 2) return;

        const startTime = parseTimeStr(parts[0]);
        let   endTime   = parseTimeStr(parts[1]);
        if (!startTime || !endTime) return;

        // Dart: if endTime.isBefore(startTime) → endTime.add(Duration(days:1))
        if (endTime <= startTime) endTime += 24 * 60; // add 24h in minutes

        // Dart: totalSlotDuration = sessionDurationMins + 5 (5-min buffer)
        const slotStep = sessionDuration + 5;

        let current = startTime; // minutes from midnight
        while (current + sessionDuration <= endTime) {
            allSlots.push(minutesToAmPm(current)); // Dart: DateFormat('hh:mm a')
            current += slotStep;
        }
    } catch (e) {
        console.error("calculateSmartSlots error:", e);
    }
}

// Parse "9AM", "09:00AM", "10:30PM" → minutes from midnight
// Dart _parseTime()
function parseTimeStr(str) {
    try {
        const isPM = str.includes("PM");
        const cleaned = str.replace("AM", "").replace("PM", "");
        const [hStr, mStr] = cleaned.split(":");
        let hour   = parseInt(hStr, 10);
        let minute = mStr ? parseInt(mStr, 10) : 0;

        // Dart: if isPM && hour != 12 → hour += 12
        if (isPM && hour !== 12) hour += 12;
        // Dart: if !isPM && hour == 12 → hour = 0
        if (!isPM && hour === 12) hour = 0;

        return hour * 60 + minute; // return minutes from midnight
    } catch { return null; }
}

// Convert minutes from midnight → "hh:mm AM/PM"
// Dart: DateFormat('hh:mm a').format(currentSlot)
function minutesToAmPm(mins) {
    let h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    const meridiem = h >= 12 ? "PM" : "AM";
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${meridiem}`;
}

// ── FETCH BOOKED SLOTS ────────────────────────────────
// Dart _fetchBookedSlots(date)
// Query: bookings where providerId==id AND date==formattedDate
// Extract: time field from each doc
async function fetchBookedSlots(date) {
    bookedSlots = [];
    const slotsLoading = document.getElementById("slotsLoading");
    if (slotsLoading) slotsLoading.classList.remove("hidden");

    const providerId  = providerData.uid || providerData.id || "";
    // Dart: DateFormat('yyyy-MM-dd').format(date)
    const formattedDate = formatDate(date);

    try {
        const q = query(
            collection(db, "bookings"),
            where("providerId", "==", providerId),
            where("date",       "==", formattedDate)
        );
        const snap = await getDocs(q);
        // Dart: snapshot.docs.map((doc) => doc['time'] as String).toList()
        bookedSlots = snap.docs.map(d => d.data().time || "");
    } catch (e) {
        console.error("fetchBookedSlots error:", e);
    } finally {
        if (slotsLoading) slotsLoading.classList.add("hidden");
    }
}

// ── RENDER SLOTS GRID ─────────────────────────────────
function renderSlots() {
    const slotsSection = document.getElementById("slotsSection");
    const slotsGrid    = document.getElementById("slotsGrid");
    const noSlots      = document.getElementById("noSlots");

    if (!slotsSection || !slotsGrid) return;
    slotsSection.classList.remove("hidden");

    if (allSlots.length === 0) {
        slotsGrid.innerHTML = "";
        noSlots?.classList.remove("hidden");
        return;
    }
    noSlots?.classList.add("hidden");

    slotsGrid.innerHTML = allSlots.map(slot => {
        // Dart: isBooked = _bookedSlots.contains(timeSlot)
        const isBooked   = bookedSlots.includes(slot);
        const isSelected = selectedTime === slot;
        const cls = `slot-chip${isBooked ? " booked" : isSelected ? " selected" : ""}`;
        return `<div class="${cls}" data-slot="${slot}">${isBooked ? "Booked" : slot}</div>`;
    }).join("");

    // Slot click — Dart: onTap: isBooked ? null : setState(() => _selectedTime = timeSlot)
    slotsGrid.querySelectorAll(".slot-chip:not(.booked)").forEach(chip => {
        chip.addEventListener("click", () => {
            selectedTime = chip.dataset.slot;
            slotsGrid.querySelectorAll(".slot-chip").forEach(c => c.classList.remove("selected"));
            chip.classList.add("selected");
        });
    });
}

// ── REVIEWS STREAM ────────────────────────────────────
// Dart _buildReviewsSection — StreamBuilder on reviews where providerId==id
// Sorted by date descending
function startReviewsStream() {
    if (unsubReviews) unsubReviews();
    const providerId = providerData.uid || providerData.id || "";
    if (!providerId) return;

    const q = query(
        collection(db, "reviews"),
        where("providerId", "==", providerId)
    );

    unsubReviews = onSnapshot(q, (snap) => {
        const reviewsList = document.getElementById("reviewsList");
        const reviewsTitle = document.getElementById("reviewsTitle");
        if (!reviewsList) return;

        if (snap.empty) {
            reviewsList.innerHTML = `<p class="no-reviews">No reviews yet. Book a session to be the first!</p>`;
            return;
        }

        // Dart: reviews.sort((a,b) => t2.compareTo(t1)) — newest first
        const docs = [...snap.docs].sort((a, b) => {
            const t1 = a.data().date?.toMillis?.() ?? 0;
            const t2 = b.data().date?.toMillis?.() ?? 0;
            return t2 - t1;
        });

        if (reviewsTitle) reviewsTitle.textContent = `Reviews (${docs.length})`;

        reviewsList.innerHTML = docs.map(docSnap => {
            const r = docSnap.data();
            // Dart fields: parentName, rating, comment, date
            const name    = escHtml(r.parentName || "Anonymous");
            const rating  = parseInt(r.rating || 0, 10);
            const comment = escHtml(r.comment || "");
            const dateStr = r.date
                ? new Date(r.date.toMillis()).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
                : "Recently";

            const stars = [1,2,3,4,5].map(i =>
                `<span class="material-symbols-outlined${i <= rating ? "" : " empty"}">star</span>`
            ).join("");

            return `
                <div class="review-card">
                    <div class="review-header">
                        <span class="review-name">${name}</span>
                        <span class="review-date">${dateStr}</span>
                    </div>
                    <div class="review-stars">${stars}</div>
                    ${comment ? `<p class="review-comment">${comment}</p>` : ""}
                </div>`;
        }).join("");
    }, (err) => console.error("Reviews stream error:", err));
}

// ── BOOKING SUBMISSION ────────────────────────────────
// Dart _submitBooking(providerName, {required bool isMonthly})
async function submitBooking(isMonthly) {
    // Dart validation: selectedDate == null || selectedTime.isEmpty
    if (!selectedDate || !selectedTime) {
        alert("Please select a valid date and time slot!");
        return;
    }
    if (isBooking) return;
    isBooking = true;

    const bookBtn     = document.getElementById("bookSessionBtn");
    const monthlyBtn  = document.getElementById("subscribeMonthlyBtn");
    if (bookBtn)    { bookBtn.disabled    = true; bookBtn.textContent    = "Booking..."; }
    if (monthlyBtn) { monthlyBtn.disabled = true; }

    try {
        const providerId  = providerData.uid || providerData.id || "";
        const parentId    = currentUser.uid;

        if (!providerId || !parentId) throw new Error("User or Provider ID is missing.");

        // Dart: Read parent doc → fullName, phone, profileImage/parentImage, childImage
        const parentSnap = await getDoc(doc(db, "users", parentId));
        const pData      = parentSnap.exists() ? parentSnap.data() : {};

        const parentName  = pData.fullName     || "Unknown Parent";
        const parentPhone = pData.phone        || "No Phone";
        const parentImage = pData.profileImage || pData.parentImage || "";
        const childImage  = pData.childImage   || "";

        // Dart: DateFormat('yyyy-MM-dd').format(_selectedDate)
        const formattedDate = formatDate(selectedDate);
        // Dart: DateFormat('E').format(_selectedDate) → "Mon"
        const dayName = selectedDate.toLocaleDateString("en-US", { weekday: "short" });

        const providerTitle = providerData.title    || "";
        const providerName  = providerData.fullName || "Unknown Provider";
        const job           = providerData.job      || "";

        // Dart serviceCategory mapping:
        // Doctor|Nurse → Medical, Teacher → Educational, Coach → Sports
        let serviceCategory = "General";
        if (job === "Doctor" || job === "Nurse")  serviceCategory = "Medical";
        else if (job === "Teacher")               serviceCategory = "Educational";
        else if (job === "Coach")                 serviceCategory = "Sports";

        // Dart: price = isMonthly ? monthlyPrice : price
        const price = isMonthly
            ? (parseFloat(providerData.monthlyPrice) || 0)
            : (parseFloat(providerData.price)        || 0);

        const bookingType = isMonthly ? "monthly" : "session";

        // Dart bookingData map — exact field names
        const bookingData = {
            providerId,
            providerName,
            providerTitle,
            serviceCategory,
            parentId,
            parentName,
            parentPhone,
            parentImage,
            childImage,
            price,
            date:      formattedDate,
            dayName,
            time:      selectedTime,
            status:    "confirmed",   // Dart: auto-confirm
            type:      bookingType,
            createdAt: serverTimestamp(),
        };

        // Dart: if isMonthly → endDate = selectedDate + 30 days
        if (isMonthly) {
            const endDate = new Date(selectedDate);
            endDate.setDate(endDate.getDate() + 30);
            bookingData.endDate = formatDate(endDate);
        }

        // Write booking document
        await addDoc(collection(db, "bookings"), bookingData);

        // Dart: notification 1 → parent (Booking Confirmed ✅)
        const dateLabel = selectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        await addDoc(collection(db, "notifications"), {
            userId:    parentId,
            title:     "Booking Confirmed ✅",
            body:      `Your ${bookingType} booking with ${providerTitle} ${providerName} on ${dateLabel} at ${selectedTime} has been confirmed automatically.`,
            createdAt: serverTimestamp(),
            isRead:    false,
            type:      "booking",
        });

        // Dart: notification 2 → provider (New Booking Alert 📅)
        await addDoc(collection(db, "notifications"), {
            userId:    providerId,
            title:     "New Booking Alert 📅",
            body:      `You have a new ${bookingType} booking with ${parentName} on ${dateLabel} at ${selectedTime}.`,
            createdAt: serverTimestamp(),
            isRead:    false,
            type:      "booking",
        });

        // Dart: showDialog → Booking Confirmed success modal
        showSuccessModal(providerTitle, providerName, dateLabel, selectedTime);

    } catch (err) {
        console.error("submitBooking error:", err);
        alert(`Booking failed: ${err.message}`);
    } finally {
        isBooking = false;
        if (bookBtn)    { bookBtn.disabled    = false; bookBtn.innerHTML    = '<span class="material-symbols-outlined">event_available</span> Book Session'; }
        if (monthlyBtn) { monthlyBtn.disabled = false; }
    }
}

// ── SUCCESS MODAL ─────────────────────────────────────
function showSuccessModal(title, name, dateLabel, time) {
    const modal   = document.getElementById("successModal");
    const msgEl   = document.getElementById("successMsg");
    if (msgEl) {
        msgEl.textContent =
            `Your booking for ${dateLabel} at ${time} with ${title} ${name} has been successfully confirmed. See you then!`;
    }
    if (modal) modal.classList.remove("hidden");
}

// ── NOTIFICATION BADGE ────────────────────────────────
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
        if (count > 0) {
            badge.textContent = count > 99 ? "99+" : count;
            badge.classList.remove("hidden");
        } else {
            badge.classList.add("hidden");
        }
    });
}

// ── UTILITIES ─────────────────────────────────────────

// Format Date → "yyyy-MM-dd" — Dart: DateFormat('yyyy-MM-dd').format(date)
function formatDate(date) {
    const y  = date.getFullYear();
    const m  = String(date.getMonth() + 1).padStart(2, "0");
    const d  = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
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
