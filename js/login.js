import { auth, db } from "./firebase-config.js?v=3";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {
    
    // 1. تشغيل زرار إظهار/إخفاء الباسورد (العين)
    const togglePass = document.getElementById('togglePass');
    const passwordInput = document.getElementById('password');
    
    if (togglePass && passwordInput) {
        togglePass.addEventListener('click', () => {
            const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
            passwordInput.setAttribute('type', type);
            // تغيير أيقونة العين
            togglePass.innerText = type === 'password' ? 'visibility_off' : 'visibility';
        });
    }

    // 2. منطق تسجيل الدخول
    const loginForm = document.getElementById('loginForm');

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value.trim();
            const pass = passwordInput.value;
            const btn = loginForm.querySelector('.btn-submit');
            const originalText = btn.innerText;

            btn.disabled = true;
            btn.innerText = "Checking... ⏳";

            try {
                // تسجيل الدخول في Auth
                const userCredential = await signInWithEmailAndPassword(auth, email, pass);
                const user = userCredential.user;

                // جلب بيانات المستخدم من Firestore
                const userDoc = await getDoc(doc(db, "users", user.uid));

                if (userDoc.exists()) {
                    const data = userDoc.data();

                    // التوجيه الذكي بناءً على الدور والحالة
                    if (data.role === "parent") {
                        const redirectUrl = sessionStorage.getItem('redirectAfterLogin');
                        if (redirectUrl) {
                            sessionStorage.removeItem('redirectAfterLogin');
                            window.location.href = redirectUrl;
                        } else {
                            window.location.href = "parent-home.html"; // ولي الأمر يروح الرئيسية
                        }
                    } 
                    else if (data.role === "provider") {
                        if (data.isApproved === true) {
                            window.location.href = "provider-home.html"; // مقدم الخدمة المقبول
                        } else {
                            window.location.href = "pending-approval.html"; // مقدم الخدمة قيد الانتظار
                        }
                    }
                } else {
                    alert("Account found but user data is missing in database.");
                    btn.disabled = false;
                    btn.innerText = originalText;
                }

            } catch (error) {
                console.error(error);
                // رسائل خطأ مخصصة عشان اليوزر يفهم
                let errorMsg = "Login Failed. Please try again.";
                if (error.code === 'auth/invalid-credential') {
                    errorMsg = "Incorrect email or password.";
                } else if (error.code === 'auth/too-many-requests') {
                    errorMsg = "Too many failed attempts. Please reset your password or try later.";
                }
                
                alert(errorMsg);
                btn.disabled = false;
                btn.innerText = originalText;
            }
        });
    }
});
