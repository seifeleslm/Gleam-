// استيراد الأدوات من الفايربيز
import { auth, db } from "./firebase-config.js?v=3";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// أول ما الصفحة تحمل، نبدأ نراقب
document.addEventListener("DOMContentLoaded", () => {
    
    // مراقبة حالة تسجيل الدخول
    auth.onAuthStateChanged((user) => {
        if (user) {
            console.log("Monitoring approval status for user:", user.uid);

            // "المراقب الذكي" - بيسمع أي تغيير بيحصل في بيانات اليوزر في الـ Firestore
            const userDocRef = doc(db, "users", user.uid);
            
            onSnapshot(userDocRef, (docSnap) => {
                if (docSnap.exists()) {
                    const userData = docSnap.data();
                    
                    // لو الحالة اتغيرت لـ true في أي لحظة.. حوّل فوراً
                    if (userData.isApproved === true) {
                        console.log("Approval granted! Redirecting...");
                        window.location.href = "approved-welcome.html";
                    }
                }
            }, (error) => {
                console.error("Error monitoring status:", error);
            });

        } else {
            // لو مفيش يوزر مسجل (مثلاً دخل الصفحة يدوي بالـ URL) رجعه للـ login
            console.log("No user found, redirecting to login.");
            window.location.href = "login.html";
        }
    });
});
