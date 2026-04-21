import { auth, db } from "./firebase-config.js?v=3";
import { doc, getDoc, collection, query, where, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {
    
    // 1. التأكد من حالة تسجيل الدخول أول ما الصفحة تفتح
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            setupUI(user.uid);
            checkSchedule(user.uid);
            loadTestimonials(); 
            monitorNotifications(user.uid);
        } else {
            window.location.href = "login.html";
        }
    });

    // 2. دوال القائمة الجانبية (Drawer)
    const menuToggle = document.getElementById('menuToggle');
    const closeDrawer = document.getElementById('closeDrawer');
    const sideDrawer = document.getElementById('sideDrawer');
    const overlay = document.getElementById('mainOverlay');

    function toggleDrawer() {
        sideDrawer.classList.toggle('open');
        overlay.classList.toggle('show');
    }

    if(menuToggle) menuToggle.addEventListener('click', toggleDrawer);
    if(closeDrawer) closeDrawer.addEventListener('click', toggleDrawer);
    if(overlay) overlay.addEventListener('click', toggleDrawer);

    // 3. تأكيد تسجيل الخروج
    const logoutBtn = document.getElementById('logoutRequest');
    if(logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            const confirmLogout = confirm("Are you sure you want to sign out from Gleam?");
            if (confirmLogout) {
                auth.signOut().then(() => window.location.href = "login.html");
            }
        });
    }

    // 4. السكرول التلقائي للكروت
    window.scrollToServices = () => {
        const servicesSection = document.getElementById('servicesSection');
        if(servicesSection) {
            servicesSection.scrollIntoView({ behavior: 'smooth' });
        }
    };

    // 5. دالة فتح قسم الدكاترة
    window.openMedical = () => {
        // ممكن مستقبلاً نعملها تفتح قائمة منسدلة (Doctor/Nurse)، بس حالياً هنوجهه للدكاترة كافتراضي
        goToProviders('Doctor');
    };

    // 6. التوجيه لصفحة مقدمي الخدمة مع إرسال التخصص في الرابط
    window.goToProviders = (category) => {
        window.location.href = `providers-list.html?category=${category}`;
    };

    // 7. توجيه صورة البروفايل
    const profileClick = document.getElementById('profileClick');
    if(profileClick) {
        profileClick.addEventListener('click', () => {
            window.location.href = "profile.html"; // لما تكودها هنربطها
            console.log("Redirect to profile.html");
        });
    }
});

// ================== الدوال الإضافية (Backend Logic) ==================

// سحب بيانات المستخدم وعرض الصورة والاسم
async function setupUI(uid) {
    try {
        const userDoc = await getDoc(doc(db, "users", uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.role !== "parent") {
                window.location.href = "login.html"; // طرد لو مش أب
                return;
            }
            
            // عرض الصورة
            const avatar = data.profileImage || data.parentImage;
            const imgElement = document.getElementById('userImg');
            if(avatar && imgElement) imgElement.src = avatar;
        }
    } catch (error) {
        console.error("Error fetching user:", error);
    }
}

// مراقبة الإشعارات اللحظية
function monitorNotifications(uid) {
    const q = query(collection(db, "notifications"), where("userId", "==", uid), where("isRead", "==", false));
    onSnapshot(q, (snapshot) => {
        const count = snapshot.docs.length;
        const badge = document.getElementById('notifCount');
        if (badge) {
            if (count > 0) {
                badge.innerText = count > 99 ? '99+' : count;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
    });
}

// فحص الجدول (Upcoming Session)
async function checkSchedule(uid) {
    const bar = document.getElementById('scheduleStatus');
    if(!bar) return;

    try {
        // بنجيب الحجوزات المؤكدة
        const q = query(collection(db, "bookings"), where("parentId", "==", uid), where("status", "==", "confirmed"));
        const snap = await getDocs(q);

        if (snap.empty) {
            bar.innerHTML = `
                <div class="empty-state">
                    <div style="display: flex; align-items: center;">
                        <span class="material-symbols-outlined">event_busy</span>
                        <p>Your schedule is clear. Ready to book your first session?</p>
                    </div>
                    <button onclick="scrollToServices()" class="btn-book-now">Book Now</button>
                </div>
            `;
        } else {
            // لو عنده حجز، هنعرض أقرب حجز (تطوير مستقبلي)
            bar.innerHTML = `
                <div class="empty-state">
                    <div style="display: flex; align-items: center;">
                        <span class="material-symbols-outlined">event_available</span>
                        <p>You have upcoming sessions! Check your Bookings tab.</p>
                    </div>
                    <button class="btn-book-now" onclick="window.location.href='bookings.html'">View Details</button>
                </div>
            `;
        }
    } catch (e) {
        console.error("Error checking schedule:", e);
    }
}

// جلب التقييمات المختارة (Featured) من الآدمن
async function loadTestimonials() {
    const container = document.getElementById('feedbackContainer');
    if(!container) return;

    try {
        const q = query(collection(db, "app_feedback"), where("isFeatured", "==", true));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
            container.innerHTML = ""; // مسح النص الافتراضي
            snap.forEach(doc => {
                const data = doc.data();
                container.innerHTML += `
                    <div class="testimonial-card">
                        <p>"${data.comment}"</p>
                        <h5>- ${data.parentName}</h5>
                    </div>
                `;
            });
        }
    } catch (e) {
        console.error("Error loading testimonials:", e);
    }
}
