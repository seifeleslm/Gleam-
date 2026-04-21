import { auth, db } from "./firebase-config.js?v=3";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {
    
    // 1. التأكد إن اليوزر مسجل دخول عشان نعرف هو مين
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            try {
                // 2. جلب بيانات اليوزر من Firestore
                const userDoc = await getDoc(doc(db, "users", user.uid));
                
                if (userDoc.exists()) {
                    const data = userDoc.data();
                    const nameDisplay = document.getElementById('providerNameDisplay');
                    
                    let title = "";
                    const name = data.fullName;

                    // 3. المنطق الذكي للألقاب (Title Logic)
                    if (data.providerType === 'doctor') {
                        title = "Dr. ";
                    } 
                    else if (data.providerType === 'teacher' || data.providerType === 'coach') {
                        // لو مدرس أو مدرب بنشوف النوع (mr للميل و ms للفيميل)
                        title = (data.gender === 'mr') ? "Mr. " : "Ms. ";
                    } 
                    else if (data.providerType === 'nurse') {
                        title = (data.gender === 'mr') ? "Nurse " : "Nurse "; 
                    }

                    // 4. عرض الاسم النهائي
                    nameDisplay.innerText = `${title}${name}`;
                    
                    // تشغيل تأثيرات البلالين (Confetti) لو حابب
                    startConfetti();

                } else {
                    console.log("No user data found!");
                }
            } catch (error) {
                console.error("Error fetching user data:", error);
            }
        } else {
            // لو دخل الصفحة وهو مش عامل Log in
            window.location.href = "login.html";
        }
    });
});

// دالة بسيطة للكونفيتي (تأثير احتفالي)
function startConfetti() {
    console.log("Confetti effect started! 🎉");
    // هنا ممكن تضيف كود مكتبة confetti لو موجودة عندك
}
