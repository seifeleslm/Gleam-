/**
 * parent-notifications-ui.js
 * Handles the header / drawer / profile UI for the parent notifications page.
 * The actual notification data logic lives in notifications.js.
 */
import { auth, db } from "./firebase-config.js?v=3";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {

    // ── Auth guard + load profile ──────────────────────────
    auth.onAuthStateChanged(async (user) => {
        if (!user) { window.location.href = "login.html"; return; }
        await loadProfile(user.uid);
    });

    // ── Side drawer toggle ──────────────────────────────────
    const menuToggle = document.getElementById("menuToggle");
    const closeDrawer = document.getElementById("closeDrawer");
    const sideDrawer  = document.getElementById("sideDrawer");
    const overlay     = document.getElementById("mainOverlay");

    function toggleDrawer() {
        sideDrawer?.classList.toggle("open");
        overlay?.classList.toggle("show");
    }

    menuToggle?.addEventListener("click", toggleDrawer);
    closeDrawer?.addEventListener("click", toggleDrawer);
    overlay?.addEventListener("click", toggleDrawer);

    // ── Notification bell → current page (no-op, already here) ──
    document.getElementById("notifBtn")?.addEventListener("click", () => {
        window.location.href = "notifications.html";
    });

    // ── Profile avatar click ────────────────────────────────
    document.getElementById("profileClick")?.addEventListener("click", () => {
        window.location.href = "profile.html";
    });

    // ── Logout ─────────────────────────────────────────────
    document.getElementById("logoutRequest")?.addEventListener("click", () => {
        if (confirm("Are you sure you want to sign out from Gleam?")) {
            auth.signOut().then(() => window.location.href = "login.html");
        }
    });
});

// ── Load user profile into header + drawer ────────────────
async function loadProfile(uid) {
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists()) return;
        const data = snap.data();

        const avatar = data.profileImage || data.parentImage || null;

        // Header avatar
        const userImg = document.getElementById("userImg");
        if (avatar && userImg) userImg.src = avatar;

        // Drawer
        const drawerAvatar = document.getElementById("drawerAvatar");
        if (avatar && drawerAvatar) drawerAvatar.src = avatar;

        const drawerName = document.getElementById("drawerName");
        if (drawerName) drawerName.textContent = data.name || data.parentName || "Parent";

    } catch (err) {
        console.error("loadProfile error:", err);
    }
}
