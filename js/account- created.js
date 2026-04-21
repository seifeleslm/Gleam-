import { auth, db } from "./firebase-config.js?v=3";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {
    
    // 1. تشغيل تأثير الاحتفال أول ما الصفحة تفتح
    createConfetti();

    // 2. جلب بيانات الأب من الفايربيز للترحيب به
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            try {
                const userDoc = await getDoc(doc(db, "users", user.uid));
                if (userDoc.exists()) {
                    const data = userDoc.data();
                    
                    const nameDisplay = document.getElementById('parentNameDisplay');
                    if (nameDisplay) {
                        const firstName = data.fullName.split(' ')[0];
                        nameDisplay.innerText = firstName;
                    }
                }
            } catch (error) {
                console.error("Error fetching user data:", error);
            }
        } else {
            // لو مش مسجل دخول، اطرده على صفحة الدخول
            window.location.href = "login.html";
        }
    });

    // 3. ربط زرار (Go to Home)
    const goHomeBtn = document.getElementById('btn-go-home');
    if (goHomeBtn) {
        goHomeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            window.location.href = "parent-home.html"; 
        });
    }
});

// ==========================================
function createConfetti() {
    const container = document.getElementById("confetti");
    if (!container) return;

    const colors = ['#39CB69', '#16807A', '#F59E0B', '#F8FAF9'];

    for (let i = 0; i < 40; i++) {
        const conf = document.createElement('div');
        conf.classList.add('confetti');

        conf.style.left = Math.random() * 100 + '%';
        conf.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        conf.style.animation = `fall ${(Math.random() * 2) + 1.5}s linear forwards`;
        conf.style.animationDelay = `${Math.random() * 1}s`;

        container.appendChild(conf);
    }

    const style = document.createElement('style');
    style.innerHTML = "@keyframes fall { 0% { transform: translateY(-30px) rotate(0deg); opacity: 1; } 100% { transform: translateY(400px) rotate(360deg); opacity: 0; } }";
    document.head.appendChild(style);
}
