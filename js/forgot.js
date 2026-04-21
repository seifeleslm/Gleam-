import { auth } from "./firebase-config.js?v=3";
import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

document.addEventListener("DOMContentLoaded", () => {
    const forgotForm = document.getElementById('forgotForm');
    const requestSection = document.getElementById('request-section');
    const successSection = document.getElementById('success-section');
    const emailDisplay = document.getElementById('user-email-display');

    if (forgotForm) {
        forgotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const btn = forgotForm.querySelector('.btn-submit');
            const originalText = btn.innerText;

            btn.disabled = true;
            btn.innerText = "Sending... ⏳";

            try {
                // إرسال لينك استعادة الباسورد من جوجل
                await sendPasswordResetEmail(auth, email);
                
                // إخفاء فورم الطلب وإظهار رسالة النجاح الشيك بتاعتك
                requestSection.classList.add('hidden');
                successSection.classList.remove('hidden');
                
                // عرض الإيميل اللي اتبعتله اللينك
                if (emailDisplay) {
                    emailDisplay.innerText = email;
                }

            } catch (error) {
                console.error(error);
                let errorMsg = "Failed to send reset link.";
                if (error.code === 'auth/invalid-email') {
                    errorMsg = "Invalid email format.";
                }
                alert(errorMsg);
                btn.disabled = false;
                btn.innerText = originalText;
            }
        });
    }
});
