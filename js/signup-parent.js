import { auth, db } from "./firebase-config.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

document.addEventListener("DOMContentLoaded", () => {
    const parentForm = document.getElementById('signupParentForm');
    const phoneInput = document.getElementById('phone');

    if (phoneInput) {
        phoneInput.addEventListener('input', function() { 
            this.value = this.value.replace(/[^0-9]/g, ''); 
        });
    }

    if (parentForm) {
        parentForm.addEventListener('submit', async function(e) {
            e.preventDefault(); 
            hideError();

            const name = document.getElementById('fullName').value.trim();
            const email = document.getElementById('email').value.trim();
            const phone = document.getElementById('phone').value.trim();
            const gov = document.getElementById('governorate').value;
            const pass = document.getElementById('password').value;
            const confirmPass = document.getElementById('confirmPassword').value;

            // --- المراجعة ---
            if (!name || !email || !phone || !pass || !confirmPass) return showError("Please fill all required fields (*).");
            if (/[0-9]/.test(name)) return showError("Name cannot contain numbers.");
            if (phone.length !== 11 || !phone.startsWith("01")) return showError("Please enter a valid 11-digit Egyptian phone number.");
            if (pass.length < 8) return showError("Password must be at least 8 characters long.");
            if (pass !== confirmPass) return showError("Passwords do not match.");

            // --- بدء التسجيل ---
            const btn = document.querySelector('.btn-create');
            const originalBtnText = btn.innerHTML;
            btn.innerHTML = "Creating Account... ⏳"; 
            btn.disabled = true;

            try {
                // 1. إنشاء الحساب
                const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
                const user = userCredential.user;
                
                // 2. حفظ البيانات
                await setDoc(doc(db, "users", user.uid), {
                    fullName: name,
                    email: email,
                    phone: phone,
                    governorate: gov || "Not specified",
                    role: "parent",
                    createdAt: new Date().toISOString()
                });

                // 3. النقل بهدوء
                const redirectUrl = sessionStorage.getItem('redirectAfterLogin');
                if (redirectUrl) {
                    sessionStorage.removeItem('redirectAfterLogin');
                    window.location.href = redirectUrl;
                } else {
                    window.location.href = "account-created.html";
                }

            } catch (error) {
                console.error(error);
                let errorMsg = "An error occurred. Please try again.";
                
                if (error.code === 'auth/email-already-in-use') {
                    errorMsg = "This email is already registered. Please log in.";
                } else if (error.code === 'auth/invalid-email') {
                    errorMsg = "Invalid email format.";
                }

                showError(errorMsg);
                btn.innerHTML = originalBtnText;
                btn.disabled = false;
            }
        });
    }
});

function showError(msg) {
    const errDiv = document.getElementById('errorMessage');
    if (errDiv) {
        errDiv.innerHTML = `<span class="material-symbols-outlined">error</span> ${msg}`;
        errDiv.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function hideError() { 
    const errDiv = document.getElementById('errorMessage');
    if (errDiv) errDiv.classList.add('hidden'); 
}
