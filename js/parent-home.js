import { auth, db } from "./firebase-config.js?v=3";
import {
    doc, getDoc,
    collection, query, where, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// ─── Arabic translation map ────────────────────────────────────────────────
const AR = {
    // Nav
    "Home": "الرئيسية",
    "Bookings": "الحجوزات",
    "Reports": "التقارير",
    "Profile": "الملف الشخصي",
    // Hero
    "Welcome back!": "!مرحباً بعودتك",
    "Empowering Your Child's": "تمكين مستقبل",
    "Bright Future.": "طفلك المشرق.",
    "Specialized care and education providers at your fingertips.": "مقدمو الرعاية والتعليم المتخصص في متناول يدك.",
    "Explore Services": "استكشف الخدمات",
    // Schedule bar
    "Checking your schedule...": "جارٍ التحقق من جدولك...",
    "Your schedule is clear. Ready to book your first session?": "جدولك خالٍ. هل أنت مستعد لحجز جلستك الأولى؟",
    "Book Now": "احجز الآن",
    "You have upcoming sessions! Check your Bookings tab.": "لديك جلسات قادمة! تحقق من تبويب الحجوزات.",
    "View Details": "عرض التفاصيل",
    // Services
    "Choose the care your child deserves": "اختر الرعاية التي يستحقها طفلك",
    "Medical": "طبي",
    "Doctors & Nurses": "أطباء وممرضون",
    "Doctor": "طبيب",
    "Nurse": "ممرضة",
    "Educational": "تعليمي",
    "Specialized Teachers": "معلمون متخصصون",
    "Sports": "رياضة",
    "Professional Coaches": "مدربون محترفون",
    // Testimonials
    "What Parents Say": "ماذا يقول الآباء",
    // Footer
    "Services": "الخدمات",
    "Doctors": "أطباء",
    "Nurses": "ممرضون",
    "Teachers": "معلمون",
    "Coaches": "مدربون",
    "Platform": "المنصة",
    "How it works": "كيف تعمل",
    "Subscriptions": "الاشتراكات",
    "My Bookings": "حجوزاتي",
    "Connect with us": "تواصل معنا",
    // Drawer
    "Notifications": "الإشعارات",
    "Reports & Files": "التقارير والملفات",
    "My Profile": "ملفي الشخصي",
    "Dark Mode": "الوضع الداكن",
    "العربية / Arabic": "English / الإنجليزية",
    "Sign Out": "تسجيل الخروج",
    // Drawer user
    "Parent": "ولي أمر",
    "Loading...": "جارٍ التحميل...",
};

// Reverse map (Arabic → English) for toggling back
const EN = Object.fromEntries(Object.entries(AR).map(([k, v]) => [v, k]));

let isArabic = false;
let isDark   = false;

// ─── DOM READY ───────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

    // ── 1. Auth guard ─────────────────────────────────────────────────────
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            await setupUI(user.uid);
            checkSchedule(user.uid);
            loadTestimonials();
            monitorNotifications(user.uid);
        } else {
            window.location.href = "login.html";
        }
    });

    // ── 2. Drawer open/close ──────────────────────────────────────────────
    const menuToggle = document.getElementById("menuToggle");
    const closeDrawer = document.getElementById("closeDrawer");
    const sideDrawer  = document.getElementById("sideDrawer");
    const overlay     = document.getElementById("mainOverlay");

    function openDrawer() {
        sideDrawer?.classList.add("open");
        overlay?.classList.add("show");
    }

    function closeDrawerFn() {
        sideDrawer?.classList.remove("open");
        overlay?.classList.remove("show");
    }

    menuToggle?.addEventListener("click", openDrawer);
    closeDrawer?.addEventListener("click", closeDrawerFn);
    overlay?.addEventListener("click", closeDrawerFn);

    // ── 3. Dark Mode ──────────────────────────────────────────────────────
    const darkCheck = document.getElementById("darkModeCheck");

    // Restore saved preference
    if (localStorage.getItem("gleam_dark") === "1") {
        enableDark();
        darkCheck.checked = true;
    }

    darkCheck?.addEventListener("change", () => {
        if (darkCheck.checked) { enableDark(); }
        else                   { disableDark(); }
    });

    function enableDark() {
        document.documentElement.classList.add("dark-mode");
        localStorage.setItem("gleam_dark", "1");
        isDark = true;
    }

    function disableDark() {
        document.documentElement.classList.remove("dark-mode");
        localStorage.setItem("gleam_dark", "0");
        isDark = false;
    }

    // ── 4. Arabic translation ─────────────────────────────────────────────
    const translateCheck = document.getElementById("translateCheck");

    // Restore saved preference
    if (localStorage.getItem("gleam_lang") === "ar") {
        applyArabic();
        translateCheck.checked = true;
    }

    translateCheck?.addEventListener("change", () => {
        if (translateCheck.checked) { applyArabic(); }
        else                        { applyEnglish(); }
    });

    function applyArabic() {
        document.documentElement.setAttribute("lang", "ar");
        document.documentElement.setAttribute("dir", "rtl");
        translateAll(AR);
        localStorage.setItem("gleam_lang", "ar");
        isArabic = true;
    }

    function applyEnglish() {
        document.documentElement.setAttribute("lang", "en");
        document.documentElement.setAttribute("dir", "ltr");
        translateAll(EN);
        localStorage.setItem("gleam_lang", "en");
        isArabic = false;
    }

    // Walk the visible text nodes and swap content
    function translateAll(map) {
        const selectors = [
            ".main-nav .nav-item",
            ".greeting-line",
            ".spotify-style",
            ".hero-sub",
            ".btn-main",
            ".section-heading",
            ".card-info h3",
            ".card-info p",
            ".sub-btn",
            ".testimonials-section .section-heading",
            ".link-col h4",
            ".link-col a",
            ".footer-social h4",
            ".drawer-item span:not(.material-symbols-outlined)",
            ".drawer-role",
            ".drawer-logout-btn",
            "#drawerName"
        ];
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                const txt = el.innerText?.trim();
                if (txt && map[txt]) el.innerText = map[txt];
            });
        });
        // Schedule bar may be dynamic — translate its buttons too
        document.querySelectorAll(".btn-book-now").forEach(el => {
            const txt = el.innerText?.trim();
            if (txt && map[txt]) el.innerText = map[txt];
        });
    }

    // ── 5. Notification bell → notifications page ─────────────────────────
    document.getElementById("notifBtn")?.addEventListener("click", () => {
        window.location.href = "notifications.html";
    });

    // ── 6. Profile avatar click ───────────────────────────────────────────
    document.getElementById("profileClick")?.addEventListener("click", () => {
        window.location.href = "profile.html";
    });

    // ── 7. Logout ─────────────────────────────────────────────────────────
    document.getElementById("logoutRequest")?.addEventListener("click", () => {
        const msg = isArabic
            ? "هل أنت متأكد أنك تريد تسجيل الخروج من Gleam؟"
            : "Are you sure you want to sign out from Gleam?";
        if (confirm(msg)) {
            auth.signOut().then(() => window.location.href = "login.html");
        }
    });

    // ── 8. Scroll to services ─────────────────────────────────────────────
    window.scrollToServices = () => {
        document.getElementById("servicesSection")?.scrollIntoView({ behavior: "smooth" });
    };

    // ── 9. Service navigation helpers ─────────────────────────────────────
    window.openMedical = () => goToProviders("Doctor");
    window.goToProviders = (category) => {
        window.location.href = `providers-list.html?category=${category}`;
    };
});

// ─── SETUP UI (fetch name + avatar) ─────────────────────────────────────────
async function setupUI(uid) {
    try {
        const userDoc = await getDoc(doc(db, "users", uid));
        if (!userDoc.exists()) return;

        const data = userDoc.data();
        if (data.role !== "parent") { window.location.href = "login.html"; return; }

        // Header avatar
        const avatar = data.profileImage || data.parentImage;
        const imgEl  = document.getElementById("userImg");
        if (avatar && imgEl) imgEl.src = avatar;

        // Drawer avatar + name
        const drawerAvatar = document.getElementById("drawerAvatar");
        if (avatar && drawerAvatar) drawerAvatar.src = avatar;

        const drawerName = document.getElementById("drawerName");
        if (drawerName) drawerName.textContent = data.name || data.parentName || "Parent";

    } catch (err) {
        console.error("setupUI error:", err);
    }
}

// ─── MONITOR NOTIFICATIONS (badge) ──────────────────────────────────────────
function monitorNotifications(uid) {
    const q = query(
        collection(db, "notifications"),
        where("userId", "==", uid),
        where("isRead", "==", false)
    );

    onSnapshot(q, (snap) => {
        const count = snap.docs.length;

        // Header badge
        const badge = document.getElementById("notifCount");
        if (badge) {
            if (count > 0) {
                badge.innerText = count > 99 ? "99+" : count;
                badge.classList.remove("hidden");
            } else {
                badge.classList.add("hidden");
            }
        }

        // Drawer badge
        const drawerBadge = document.getElementById("drawerNotifBadge");
        if (drawerBadge) {
            if (count > 0) {
                drawerBadge.innerText = count > 99 ? "99+" : count;
                drawerBadge.classList.remove("hidden");
            } else {
                drawerBadge.classList.add("hidden");
            }
        }
    });
}

// ─── CHECK UPCOMING SCHEDULE ─────────────────────────────────────────────────
async function checkSchedule(uid) {
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
                    <div style="display:flex; align-items:center; gap:12px;">
                        <span class="material-symbols-outlined">event_busy</span>
                        <p>Your schedule is clear. Ready to book your first session?</p>
                    </div>
                    <button onclick="scrollToServices()" class="btn-book-now">Book Now</button>
                </div>`;
        } else {
            bar.innerHTML = `
                <div class="empty-state">
                    <div style="display:flex; align-items:center; gap:12px;">
                        <span class="material-symbols-outlined">event_available</span>
                        <p>You have upcoming sessions! Check your Bookings tab.</p>
                    </div>
                    <button class="btn-book-now" onclick="window.location.href='bookings.html'">View Details</button>
                </div>`;
        }
    } catch (e) {
        console.error("checkSchedule error:", e);
    }
}

// ─── LOAD TESTIMONIALS ────────────────────────────────────────────────────────
async function loadTestimonials() {
    const container = document.getElementById("feedbackContainer");
    if (!container) return;

    try {
        const q    = query(collection(db, "app_feedback"), where("isFeatured", "==", true));
        const snap = await getDocs(q);

        if (!snap.empty) {
            container.innerHTML = "";
            snap.forEach(d => {
                const data = d.data();
                container.innerHTML += `
                    <div class="testimonial-card">
                        <p>"${data.comment}"</p>
                        <h5>- ${data.parentName}</h5>
                    </div>`;
            });
        }
    } catch (e) {
        console.error("loadTestimonials error:", e);
    }
}
