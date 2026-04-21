// ═══════════════════════════════════════════════════════
//  Gleam Landing — main.js
//  Firebase: Auth state + Firestore (read-only)
// ═══════════════════════════════════════════════════════
import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  doc, getDoc,
  collection, query, where, getDocs, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ── Module-level state ─────────────────────────────────
let currentUser     = null;   // Firebase user object
let currentUserData = null;   // Firestore users/{uid} doc
let allProviders    = [];     // cached provider list for client-side filter
let activeFilter    = "all";  // current filter pill selection
let currentReportType = "health"; // selected report type in mockup

// ═══════════════════════════════════════════════════════
//  1. BOOT — wait for DOM, then init Firebase listener
// ═══════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", () => {

  // Scroll-shadow on navbar
  window.addEventListener("scroll", () => {
    document.getElementById("navbar")
      .classList.toggle("scrolled", window.scrollY > 20);
  });

  // Scroll-reveal observer
  const observer = new IntersectionObserver(
    entries => entries.forEach(e => {
      if (e.isIntersecting) e.target.classList.add("visible");
    }),
    { threshold: 0.12 }
  );
  document.querySelectorAll(".reveal").forEach(el => observer.observe(el));

  // Close modal on backdrop click
  document.getElementById("modal").addEventListener("click", function (e) {
    if (e.target === this) closeModal();
  });

  // ── Firebase Auth state ──────────────────────────────
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser = user;
      // Fetch role from Firestore
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) currentUserData = snap.data();
      } catch (e) {
        console.error("Error fetching user doc:", e);
      }
    } else {
      currentUser     = null;
      currentUserData = null;
    }

    updateNavUI();           // always update navbar
    loadProviders();         // always load provider cards
    if (currentUserData?.role === "provider") {
      loadDashboard();       // only fill dashboard stats for providers
    }
  });
});

// ═══════════════════════════════════════════════════════
//  2. NAVBAR — show chip + logout OR login + signup
// ═══════════════════════════════════════════════════════
function updateNavUI() {
  const area = document.getElementById("nav-user-area");

  if (currentUser && currentUserData) {
    const role = currentUserData.role || "User";
    area.innerHTML = `
      <div class="user-chip">
        <div class="dot"></div>
        ${capitalise(role)}
      </div>
      <button class="btn-outline" id="nav-logout-btn">Log Out</button>`;

    document.getElementById("nav-logout-btn").addEventListener("click", handleLogout);
  } else {
    area.innerHTML = `
      <button class="btn-outline" onclick="window.location.href='login.html'">Login</button>
      <button class="btn-solid"  onclick="window.location.href='signup.html'">Sign Up</button>`;
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    // onAuthStateChanged fires → updateNavUI() resets automatically
  } catch (e) {
    console.error("Logout error:", e);
  }
}

// ═══════════════════════════════════════════════════════
//  3. PROVIDERS — Firestore query → render cards
//  Query: users where role in [doctor,nurse,teacher,coach]
//         AND status == "approved", ordered by rating desc, limit 6
// ═══════════════════════════════════════════════════════
async function loadProviders() {
  const grid = document.getElementById("providers-grid");
  grid.innerHTML = `<div class="loading-row" style="grid-column:span 3">
    <span class="spinner"></span>Loading providers…</div>`;

  try {
    const roles = ["doctor", "nurse", "teacher", "coach"];
    const q = query(
      collection(db, "users"),
      where("role",   "in",  roles),
      where("status", "==",  "approved"),
      limit(6)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      grid.innerHTML = `<div class="loading-row" style="grid-column:span 3">
        No verified providers yet.</div>`;
      return;
    }

    allProviders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderProviderCards(allProviders);

    // Show filter bar now that data is loaded
    document.getElementById("filter-bar").style.display = "flex";

  } catch (e) {
    console.error("Error loading providers:", e);
    grid.innerHTML = `<div class="loading-row" style="grid-column:span 3">
      Could not load providers.</div>`;
  }
}

function renderProviderCards(list) {
  const grid = document.getElementById("providers-grid");

  if (list.length === 0) {
    grid.innerHTML = `<div class="loading-row" style="grid-column:span 3">
      No providers match this filter.</div>`;
    return;
  }

  grid.innerHTML = list.map(p => {
    const name    = p.fullName  || p.name || "Provider";
    const role    = capitalise(p.role || "");
    const rating  = p.rating   || 5;
    const price   = p.price    || p.sessionPrice || "—";
    const tags    = Array.isArray(p.specializations) ? p.specializations.slice(0, 3) : [];
    const initial = name.charAt(0).toUpperCase();
    const stars   = "★".repeat(Math.round(rating)) + "☆".repeat(5 - Math.round(rating));
    const avatarHTML = p.profileImage
      ? `<img src="${p.profileImage}" alt="${name}">`
      : initial;

    return `
      <div class="provider-card">
        <div class="provider-top">
          <div class="provider-avatar">${avatarHTML}</div>
          <div class="provider-info">
            <h4>${name}</h4>
            <div class="role">${role}</div>
          </div>
        </div>
        <div class="provider-rating">
          <span class="stars">${stars}</span>
          <span>${rating.toFixed(1)}</span>
        </div>
        ${tags.length ? `<div class="provider-tags">
          ${tags.map(t => `<span class="tag">${t}</span>`).join("")}
        </div>` : ""}
        <div class="provider-price">
          <div class="price">${price} <span>EGP/session</span></div>
          <button class="btn-book" onclick="window.location.href='signup.html'">Book</button>
        </div>
      </div>`;
  }).join("");
}

// ═══════════════════════════════════════════════════════
//  4. FILTER — client-side, no extra Firestore reads
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
//  4. FILTER — client-side, no extra Firestore reads
// ═══════════════════════════════════════════════════════
window.filterProviders = function (type) {
  activeFilter = type;

  // Update pill styles
  document.querySelectorAll(".filter-pill").forEach(pill => {
    pill.classList.toggle("active", pill.textContent.toLowerCase().includes(
      type === "all" ? "all" : type
    ));
  });

  // Scroll to providers section
  document.getElementById("providers").scrollIntoView({ behavior: "smooth" });

  // Filter cached list
  const filtered = type === "all"
    ? allProviders
    : allProviders.filter(p => p.role === type);

  renderProviderCards(filtered);
};

// ═══════════════════════════════════════════════════════
//  4B. DYNAMIC PREVIEW — Firestore Fetch (STEP A)
// ═══════════════════════════════════════════════════════
window.fetchAndShowProviders = async function (category) {
  const section = document.getElementById("dynamic-preview-section");
  const grid = document.getElementById("dp-grid");
  const title = document.getElementById("dp-title");
  
  // Show section and set loading
  section.style.display = "block";
  // Reset animation state
  section.style.opacity = "0";
  section.style.transform = "translateY(30px)";
  
  // Trigger reflow to restart animation
  void section.offsetWidth; 
  
  section.style.opacity = "1";
  section.style.transform = "translateY(0)";
  
  title.textContent = `${category}s`;
  grid.innerHTML = `<div class="loading-row" style="grid-column:span 4"><span class="spinner"></span>Finding the best ${category}s...</div>`;
  
  // Scroll to the preview section smoothly
  setTimeout(() => {
    section.scrollIntoView({ behavior: "smooth", block: "center" });
  }, 100);

  try {
    // Query users where job == category, order by averageRating desc, limit 4
    const q = query(
      collection(db, "users"),
      where("job", "==", category),
      orderBy("averageRating", "desc"),
      limit(4)
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      grid.innerHTML = `<div class="loading-row" style="grid-column:span 4">No ${category}s found at the moment. Please check back later!</div>`;
      return;
    }

    const providers = snap.docs.map(d => {
      const data = d.data();
      data.uid = d.id;
      return data;
    });

    grid.innerHTML = providers.map(p => {
      const name = p.fullName || p.name || "Provider";
      const title = p.specialty || p.title || category;
      const rating = parseFloat(p.averageRating) || 0;
      const totalReviews = p.totalReviews || 0;
      const ratingDisplay = totalReviews > 0 ? rating.toFixed(1) : "New";
      const initial = name.charAt(0).toUpperCase();
      const stars = "★".repeat(Math.round(rating)) + "☆".repeat(5 - Math.round(rating));
      
      const avatarHTML = p.profileImage
        ? `<img src="${p.profileImage}" alt="${name}">`
        : initial;

      return `
        <div class="provider-card" style="cursor:pointer;" onclick="navigateToProviderDetails('${p.uid}', '${encodeURIComponent(JSON.stringify(p))}')">
          <div class="provider-top">
            <div class="provider-avatar">${avatarHTML}</div>
            <div class="provider-info">
              <h4>${name}</h4>
              <div class="role">${title}</div>
            </div>
          </div>
          <div class="provider-rating ${totalReviews === 0 ? 'is-new' : ''}">
            <span class="stars" style="color:var(--orange);">${stars}</span>
            <span>${ratingDisplay}</span>
          </div>
          <div class="provider-price" style="margin-top:auto; padding-top:16px;">
            <button class="btn-book" style="width:100%;">View Profile</button>
          </div>
        </div>`;
    }).join("");

  } catch (e) {
    console.error("Error fetching dynamic providers:", e);
    // If it fails (e.g. missing index), fallback to simple query without orderBy
    try {
      console.warn("Falling back to simple query without orderBy (requires index)");
      const fallbackQ = query(
        collection(db, "users"),
        where("job", "==", category),
        limit(4)
      );
      const fallbackSnap = await getDocs(fallbackQ);
      if (fallbackSnap.empty) {
        grid.innerHTML = `<div class="loading-row" style="grid-column:span 4">No ${category}s found at the moment.</div>`;
        return;
      }
      
      const providers = fallbackSnap.docs.map(d => {
        const data = d.data();
        data.uid = d.id;
        return data;
      });
      
      grid.innerHTML = providers.map(p => {
        const name = p.fullName || p.name || "Provider";
        const title = p.specialty || p.title || category;
        const rating = parseFloat(p.averageRating) || 0;
        const totalReviews = p.totalReviews || 0;
        const ratingDisplay = totalReviews > 0 ? rating.toFixed(1) : "New";
        const initial = name.charAt(0).toUpperCase();
        
        const avatarHTML = p.profileImage
          ? `<img src="${p.profileImage}" alt="${name}">`
          : initial;

        return `
          <div class="provider-card" style="cursor:pointer;" onclick="navigateToProviderDetails('${p.uid}', '${encodeURIComponent(JSON.stringify(p))}')">
            <div class="provider-top">
              <div class="provider-avatar">${avatarHTML}</div>
              <div class="provider-info">
                <h4>${name}</h4>
                <div class="role">${title}</div>
              </div>
            </div>
            <div class="provider-rating ${totalReviews === 0 ? 'is-new' : ''}">
              <span class="stars" style="color:var(--orange);">★</span>
              <span>${ratingDisplay}</span>
            </div>
            <div class="provider-price" style="margin-top:auto; padding-top:16px;">
              <button class="btn-book" style="width:100%;">View Profile</button>
            </div>
          </div>`;
      }).join("");
      
    } catch (fallbackError) {
      grid.innerHTML = `<div class="loading-row" style="grid-column:span 4">Could not load preview.</div>`;
    }
  }
};

window.navigateToProviderDetails = function(uid, encodedData) {
  try {
    const data = JSON.parse(decodeURIComponent(encodedData));
    sessionStorage.setItem("selectedProvider", JSON.stringify(data));
    window.location.href = `provider-details.html?uid=${uid}`;
  } catch (e) {
    console.error("Navigation error:", e);
    window.location.href = `provider-details.html?uid=${uid}`;
  }
};

// ═══════════════════════════════════════════════════════
//  5. DASHBOARD MOCKUP — Firestore reads (provider only)
//  Reads: subscriptions (clients, active subs, earnings)
//         reports (count sent)
// ═══════════════════════════════════════════════════════
window.loadDashboard = async function () {
  if (!currentUser || currentUserData?.role !== "provider") return;
  const uid = currentUser.uid;

  // Reset to loading state
  ["dash-clients", "dash-earnings", "dash-reports", "dash-subs"].forEach(id => {
    document.getElementById(id).textContent = "…";
  });

  try {
    // Parallel reads
    const [subsSnap, reportsSnap] = await Promise.all([
      getDocs(query(collection(db, "subscriptions"), where("providerId", "==", uid))),
      getDocs(query(collection(db, "reports"),       where("providerId", "==", uid)))
    ]);

    const subs      = subsSnap.docs.map(d => d.data());
    const totalSubs = subs.filter(s => s.status === "active").length;
    const earnings  = subs
      .filter(s => s.status === "active")
      .reduce((sum, s) => sum + (s.price || 0), 0);

    document.getElementById("dash-clients").textContent  = subsSnap.size;
    document.getElementById("dash-earnings").textContent = earnings.toLocaleString("en-EG");
    document.getElementById("dash-reports").textContent  = reportsSnap.size;
    document.getElementById("dash-subs").textContent     = totalSubs;

  } catch (e) {
    console.error("Dashboard load error:", e);
    ["dash-clients","dash-earnings","dash-reports","dash-subs"].forEach(id => {
      document.getElementById(id).textContent = "—";
    });
  }
};

// ═══════════════════════════════════════════════════════
//  6. MODAL — open / close
// ═══════════════════════════════════════════════════════
window.openModal = function (mode) {
  document.querySelectorAll(".modal-step").forEach(s => s.classList.remove("active"));
  const stepMap = { report: "step-report" };
  const stepId  = stepMap[mode] || "step-report";
  document.getElementById(stepId).classList.add("active");
  document.getElementById("modal").classList.add("open");
  document.body.style.overflow = "hidden";
};

window.closeModal = function () {
  document.getElementById("modal").classList.remove("open");
  document.body.style.overflow = "";
};

// ═══════════════════════════════════════════════════════
//  7. REPORT TYPE SELECTOR (mockup UI only)
// ═══════════════════════════════════════════════════════
window.setReportType = function (el, type) {
  currentReportType = type;
  document.querySelectorAll(".report-type-item")
    .forEach(item => item.classList.remove("active"));
  el.classList.add("active");

  // Mirror selection into modal dropdown if open
  const sel = document.getElementById("rpt-type");
  if (sel) sel.value = type;
};

// ═══════════════════════════════════════════════════════
//  UTILITY
// ═══════════════════════════════════════════════════════
function capitalise(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}
