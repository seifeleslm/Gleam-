import { auth, db } from "./firebase-config.js?v=3";
import {
    doc, getDoc, collection, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

/** Raw provider list fetched from Firestore (all docs for this category) */
let allProviders = [];

/** Active filter values — mirrors Dart _selectedLocation / _selectedPriceSort */
let selectedLocation  = "";   // "" means All Locations (Dart: null)
let selectedPriceSort = "";   // "" | "low" | "high"  (Dart: null | 'Low to High' | 'High to Low')

/** Category read from URL — passed in as ?category=Doctor|Nurse|Teacher|Coach */
let category = "";

/** Real-time unsubscribe handle */
let unsubscribeProviders = null;

// ─────────────────────────────────────────────
// PAGE INFO MAP — Dart _getPageInfo()
// ─────────────────────────────────────────────
const PAGE_INFO = {
    Doctor:  { title: "Doctors",        subtitle: "Find the right specialist for your child" },
    Nurse:   { title: "Nurses",         subtitle: "Book professional nurses for child care & vaccinations" },
    Teacher: { title: "Teachers",       subtitle: "Find educational specialists for your child" },
    Coach:   { title: "Sports Coaches", subtitle: "Find sports coaches for your child" },
};

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

    // 1. Read category from URL
    const params = new URLSearchParams(window.location.search);
    category = params.get("category") || "";

    if (!category) {
        // No category → send back
        window.location.href = "parent-home.html";
        return;
    }

    // 2. Set page title and subtitle — matches Dart _getPageInfo()
    const info = PAGE_INFO[category] || { title: category + "s", subtitle: "Browse verified providers" };
    const titleEl    = document.getElementById("pageTitle");
    const subtitleEl = document.getElementById("pageSubtitle");
    if (titleEl)    titleEl.textContent    = info.title;
    if (subtitleEl) subtitleEl.textContent = info.subtitle;
    document.title = `Gleam | ${info.title}`;

    // 3. Auth guard
    auth.onAuthStateChanged(async (user) => {
        if (!user) { window.location.href = "login.html"; return; }

        // Populate header avatar
        setupHeaderUI(user.uid);
        // Monitor notification badge
        monitorNotifications(user.uid);
        // Start real-time provider stream
        startProviderStream(category);
    });

    // 4. Back button
    const backBtn = document.getElementById("backBtn");
    if (backBtn) backBtn.addEventListener("click", () => history.back());

    // 5. Profile click
    const profileClick = document.getElementById("profileClick");
    if (profileClick) profileClick.addEventListener("click", () => { window.location.href = "profile.html"; });

    // 6. Filter listeners — re-render on change (client-side, matches Dart setState)
    const locationFilter = document.getElementById("locationFilter");
    const priceFilter    = document.getElementById("priceFilter");

    if (locationFilter) {
        locationFilter.addEventListener("change", () => {
            selectedLocation = locationFilter.value; // "" = all
            renderProviders();
        });
    }
    if (priceFilter) {
        priceFilter.addEventListener("change", () => {
            selectedPriceSort = priceFilter.value; // "" | "low" | "high"
            renderProviders();
        });
    }
});

// ─────────────────────────────────────────────
// HEADER UI
// ─────────────────────────────────────────────
async function setupHeaderUI(uid) {
    try {
        const userSnap = await getDoc(doc(db, "users", uid));
        if (!userSnap.exists()) return;
        const data = userSnap.data();
        const avatar = data.profileImage || data.parentImage || "";
        if (avatar) {
            const img = document.getElementById("userImg");
            if (img) img.src = avatar;
        }
    } catch (err) {
        console.warn("setupHeaderUI error:", err);
    }
}

// ─────────────────────────────────────────────
// NOTIFICATION BADGE
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// REAL-TIME PROVIDER STREAM
// Dart: StreamBuilder on users where job == category
// ─────────────────────────────────────────────
function startProviderStream(cat) {
    // Unsubscribe previous listener if any
    if (unsubscribeProviders) unsubscribeProviders();

    const q = query(
        collection(db, "users"),
        where("job", "==", cat)
    );

    unsubscribeProviders = onSnapshot(q, (snap) => {
        // Dart: extract doc.id as uid and merge into data object
        allProviders = snap.docs.map(docSnap => {
            const data = { ...docSnap.data() };
            data.uid = docSnap.id; // Dart: data['uid'] = doc.id
            return data;
        });

        renderProviders();
    }, (err) => {
        console.error("Provider stream error:", err);
        showEmptyState(`Error loading data: ${err.message}`);
    });
}

// ─────────────────────────────────────────────
// CLIENT-SIDE FILTER + SORT + RENDER
// Exact port of Dart filter/sort logic inside StreamBuilder builder
// ─────────────────────────────────────────────
function renderProviders() {
    const grid        = document.getElementById("providersGrid");
    const emptyState  = document.getElementById("emptyState");
    const resultCount = document.getElementById("resultCount");

    if (!grid) return;

    // Start with full list
    let providers = [...allProviders];

    // ── Location filter — Dart: providers.where((p) => p['governorate'] == _selectedLocation)
    if (selectedLocation) {
        providers = providers.filter(p => p.governorate === selectedLocation);
    }

    // ── Price sort — Dart: sort by price field
    if (selectedPriceSort === "low") {
        // Dart: providers.sort((a, b) => (a['price'] ?? 0).compareTo(b['price'] ?? 0))
        providers.sort((a, b) => (a.price || 0) - (b.price || 0));
    } else if (selectedPriceSort === "high") {
        // Dart: providers.sort((a, b) => (b['price'] ?? 0).compareTo(a['price'] ?? 0))
        providers.sort((a, b) => (b.price || 0) - (a.price || 0));
    }

    // ── Result count
    if (resultCount) {
        resultCount.textContent = providers.length > 0
            ? `${providers.length} found`
            : "";
    }

    // ── Empty state — Dart: "No matches found for your filters."
    if (providers.length === 0) {
        grid.innerHTML = "";
        showEmptyState(
            allProviders.length === 0
                ? `No ${PAGE_INFO[category]?.title || category + "s"} found yet.`
                : "No matches found for your filters."
        );
        return;
    }

    // ── Hide empty state, render cards
    if (emptyState) emptyState.classList.add("hidden");
    grid.innerHTML = providers.map(p => buildProviderCardHTML(p)).join("");

    // Attach click handlers after rendering
    grid.querySelectorAll(".provider-card").forEach(card => {
        card.addEventListener("click", () => {
            const uid = card.dataset.uid;
            const provider = allProviders.find(p => p.uid === uid);
            if (provider) navigateToDetails(provider);
        });
    });
}

// ─────────────────────────────────────────────
// PROVIDER CARD HTML
// Dart _buildProviderCard — exact field mapping
// Fields: fullName, specialty|title, profileImage,
//         exactLocation (fallback: governorate),
//         averageRating, totalReviews, price
// ─────────────────────────────────────────────
function buildProviderCardHTML(data) {
    // Dart: name = data['fullName'] ?? 'Unknown'
    const name = escHtml(data.fullName || "Unknown");

    // Dart: specialty = data['specialty'] ?? data['title'] ?? widget.category
    const specialty = escHtml(data.specialty || data.title || category);

    // Dart: imageUrl = data['profileImage']
    const imageUrl = data.profileImage || "";

    // Dart: exactLocation = data['exactLocation'] ?? governorate
    const location = escHtml(data.exactLocation || data.governorate || "Location not set");

    // Dart: rating = (data['averageRating'] ?? 0.0).toDouble()
    //        reviewsCount = data['totalReviews'] ?? 0
    const totalReviews = data.totalReviews || 0;
    const avgRating    = parseFloat(data.averageRating) || 0;

    // Dart: reviewsCount > 0 ? rating.toStringAsFixed(1) : 'New'
    const ratingDisplay = totalReviews > 0 ? avgRating.toFixed(1) : "New";
    const isNew = totalReviews === 0;

    // Price display
    const priceDisplay = (data.price && data.price > 0) ? `${data.price} EGP / session` : "";

    // Image block
    const imageBlock = imageUrl
        ? `<img src="${escHtml(imageUrl)}" alt="${name}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
           <div class="card-placeholder" style="display:none;"><span class="material-symbols-outlined">person</span></div>`
        : `<div class="card-placeholder"><span class="material-symbols-outlined">person</span></div>`;

    return `
        <div class="provider-card" data-uid="${escHtml(data.uid || "")}" tabindex="0" role="button"
             aria-label="View ${name} profile">
            <div class="card-image-wrap">
                ${imageBlock}
                <div class="card-rating${isNew ? " is-new" : ""}">
                    <span class="material-symbols-outlined star-icon">star</span>
                    <span>${ratingDisplay}</span>
                </div>
            </div>
            <div class="card-body">
                <div class="card-name">${name}</div>
                <div class="card-specialty">${specialty}</div>
                ${priceDisplay ? `<div class="card-price">${priceDisplay}</div>` : ""}
                <div class="card-location">
                    <span class="material-symbols-outlined">location_on</span>
                    <span>${location}</span>
                </div>
            </div>
        </div>`;
}

// ─────────────────────────────────────────────
// NAVIGATE TO PROVIDER DETAILS
// We pass provider data via sessionStorage so the details
// page can read it without an extra Firestore query.
// ─────────────────────────────────────────────
function navigateToDetails(providerData) {
    try {
        sessionStorage.setItem("selectedProvider", JSON.stringify(providerData));
    } catch (e) {
        console.warn("sessionStorage error:", e);
    }
    window.location.href = `provider-details.html?uid=${encodeURIComponent(providerData.uid || "")}`;
}

// ─────────────────────────────────────────────
// EMPTY STATE HELPER
// ─────────────────────────────────────────────
function showEmptyState(message = "No providers found.") {
    const emptyState = document.getElementById("emptyState");
    const emptyMsg   = document.getElementById("emptyMsg");
    const grid       = document.getElementById("providersGrid");

    if (grid)       grid.innerHTML = "";
    if (emptyMsg)   emptyMsg.textContent = message;
    if (emptyState) emptyState.classList.remove("hidden");
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────
function escHtml(str) {
    if (typeof str !== "string") return str;
    const d = document.createElement("div");
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
}
