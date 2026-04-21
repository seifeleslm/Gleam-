import { auth, db } from "./firebase-config.js?v=3";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

function getProviderType() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('type') || 'doctor';
}

document.addEventListener("DOMContentLoaded", () => {
    const providerType = getProviderType();
    
    populateDynamicSections(providerType);
    updateTitlesText(providerType);
    setupAvailabilityLogic();

    document.getElementById('phone').addEventListener('input', function(e) { this.value = this.value.replace(/[^0-9]/g, ''); });
    document.getElementById('sessionPrice').addEventListener('input', function(e) { this.value = this.value.replace(/[^0-9]/g, ''); });
    document.getElementById('monthlyPrice').addEventListener('input', function(e) { this.value = this.value.replace(/[^0-9]/g, ''); });

    const signupForm = document.getElementById('signupProviderForm');
    if (signupForm) {
        signupForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            hideError();

            const licenseNumber = document.getElementById('licenseNumber').value.trim();
            if (!licenseNumber) {
                return showError("Please enter your Professional License or ID Number.");
            }

            const btn = document.querySelector('.btn-finish');
            const originalText = btn.innerHTML;
            btn.innerHTML = "Creating Account... ⏳";
            btn.disabled = true;

            try {
                // تجميع البيانات من الفورم
                const email = document.getElementById('email').value.trim();
                const pass = document.getElementById('password').value;
                
                // تجميع مواعيد العمل
                const availability = {};
                document.querySelectorAll('.time-slot-row').forEach(row => {
                    const day = row.id.replace('time-row-', '');
                    const fromTime = row.querySelector('input[type="time"]:first-of-type').value;
                    const toTime = row.querySelector('input[type="time"]:last-of-type').value;
                    availability[day] = { from: fromTime, to: toTime };
                });

                // 1. إنشاء الحساب في Auth
                const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
                const user = userCredential.user;

                // Capitalize provider type for the 'job' field
                const jobTitle = providerType.charAt(0).toUpperCase() + providerType.slice(1);

                // 2. حفظ البيانات في Firestore
                await setDoc(doc(db, "users", user.uid), {
                    uid: user.uid,
                    fullName: document.getElementById('fullName').value.trim(),
                    email: email,
                    phone: document.getElementById('phone').value.trim(),
                    governorate: document.getElementById('governorate').value,
                    gender: document.getElementById('gender').value,
                    providerType: providerType,
                    job: jobTitle,
                    experience: document.getElementById('experience').value,
                    bio: document.getElementById('bio').value.trim(),
                    sessionPrice: document.getElementById('sessionPrice').value,
                    monthlyPrice: document.getElementById('monthlyPrice').value,
                    address: document.getElementById('address').value.trim(),
                    licenseNumber: licenseNumber,
                    availability: availability,
                    role: "provider",
                    isApproved: false,
                    createdAt: new Date().toISOString()
                });

                window.location.href = 'pending-approval.html';

            } catch (error) {
                console.error(error);
                showError("Firebase Error: " + error.message);
                btn.innerHTML = originalText;
                btn.disabled = false;
            }
        });
    }
});

function showError(msg) {
    const errDiv = document.getElementById('errorMessage');
    errDiv.innerHTML = `<span class="material-symbols-outlined">error</span> ${msg}`;
    errDiv.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function hideError() { document.getElementById('errorMessage').classList.add('hidden'); }

// --- الـ Validation القوي بتاعك زي ما هو ---
window.validateAndProceed = function(currentStep, nextStep) {
    hideError();
    
    if (currentStep === 1) {
        const gender = document.getElementById('gender').value;
        const name = document.getElementById('fullName').value.trim();
        const gov = document.getElementById('governorate').value;
        const phone = document.getElementById('phone').value.trim();
        const email = document.getElementById('email').value.trim();
        const pass = document.getElementById('password').value;
        const confirmPass = document.getElementById('confirmPassword').value;

        if (!gender || !name || !gov || !email || !pass || !confirmPass) return showError("Please fill all required fields (*).");
        if (/[0-9]/.test(name)) return showError("Name cannot contain numbers.");
        
        // التحقق من صحة الإيميل
        if (!email.includes('@') || !email.includes('.')) return showError("Please enter a valid email address.");

        if (phone && (phone.length !== 11 || !phone.startsWith("01"))) return showError("Please enter a valid 11-digit Egyptian phone number.");
        
        const passRegex = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
        if (!passRegex.test(pass)) return showError("Password must be at least 8 characters long, contain 1 uppercase letter and 1 number.");
        
        if (pass !== confirmPass) return showError("Passwords do not match. Please check again.");
    }
    
    if (currentStep === 2) {
        const exp = document.getElementById('experience').value;
        if (!exp) return showError("Please select your years of experience.");
    }

    if (currentStep === 3) {
        const sPrice = document.getElementById('sessionPrice').value;
        const mPrice = document.getElementById('monthlyPrice').value;
        const selectedDays = document.querySelectorAll('.day-chip.selected');
        
        if (!sPrice || !mPrice) return showError("Please set both session and monthly prices.");
        if (selectedDays.length === 0) return showError("Please select at least one available working day.");
    }

    goToStep(nextStep);
}

// --- الـ Stepper وتغيير الألوان ---
window.goToStep = function(stepNumber) {
    document.querySelectorAll('.step-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`step-${stepNumber}`).classList.add('active');
    
    document.querySelectorAll('.step-item').forEach((item, index) => {
        item.classList.remove('active', 'completed');
        const stepNum = index + 1;
        if (stepNum === stepNumber) item.classList.add('active');
        else if (stepNum < stepNumber) item.classList.add('completed');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateTitlesText(type) {
    const titleText = document.getElementById('formMainTitle');
    const capitalizedType = type.charAt(0).toUpperCase() + type.slice(1);
    titleText.innerHTML = `${capitalizedType} Registration`;
}

function setupAvailabilityLogic() {
    const days = document.querySelectorAll('.day-chip');
    const container = document.getElementById('timeSlotsContainer');

    days.forEach(day => {
        day.addEventListener('click', function() {
            this.classList.toggle('selected');
            const dayName = this.getAttribute('data-day').toUpperCase();
            const rowId = `time-row-${dayName}`;

            if (this.classList.contains('selected')) {
                const row = document.createElement('div');
                row.className = 'time-slot-row';
                row.id = rowId;
                row.innerHTML = `
                    <span>${dayName}</span>
                    <div class="time-input-group">
                        <label style="font-size:12px; color:#666;">From:</label>
                        <input type="time" required>
                    </div>
                    <div class="time-input-group">
                        <label style="font-size:12px; color:#666;">To:</label>
                        <input type="time" required>
                    </div>
                `;
                container.appendChild(row);
            } else {
                const row = document.getElementById(rowId);
                if (row) row.remove();
            }
        });
    });
}

function populateDynamicSections(type) {
    const specContainer = document.getElementById('dynamic-specialization-section');
    const workContainer = document.getElementById('dynamic-workplace-section');
    const uploadsContainer = document.getElementById('verification-uploads-container');
    
    let specHtml = ''; let workHtml = ''; let uploadHtml = '';

    const medicalWorkplace = `
        <div class="input-group">
            <label>Where do you work? *</label>
            <div class="radio-cards-grid">
                <label class="radio-card"><input type="radio" name="workplace" value="clinic" required><span>Clinic</span></label>
                <label class="radio-card"><input type="radio" name="workplace" value="hospital"><span>Hospital</span></label>
                <label class="radio-card"><input type="radio" name="workplace" value="both"><span>Both</span></label>
            </div>
        </div>
    `;

    if (type === 'doctor') {
        specHtml = `<div class="input-group"><label for="doctorSpecialty">Medical Specialization *</label><select id="doctorSpecialty" required><option value="" disabled selected>Select Medical Specialty...</option><option value="pediatrics">Pediatrics (طب أطفال)</option><option value="child_neurology">Child Neurology (مخ وأعصاب أطفال)</option><option value="psychiatry">Child Psychiatry (طب نفسي أطفال)</option><option value="dentistry">Pediatric Dentistry (أسنان أطفال)</option><option value="nutrition">Clinical Nutrition (تغذية علاجية)</option><option value="orthopedics">Orthopedics (عظام)</option><option value="dermatology">Dermatology (جلدية)</option><option value="general">General Medicine (ممارس عام)</option></select></div>`;
        workHtml = medicalWorkplace;
        uploadHtml = `<div class="grid-2-cols"><div class="file-upload-item"><label>National ID Card</label><div class="file-upload-zone"><span class="material-symbols-outlined">badge</span><span class="upload-text">Upload ID</span><input type="file" required></div></div><div class="file-upload-item"><label>Medical License</label><div class="file-upload-zone"><span class="material-symbols-outlined">description</span><span class="upload-text">Upload License</span><input type="file" required></div></div></div>`;
    } 
    else if (type === 'teacher') {
        specHtml = `<div class="input-group"><label for="teacherSpecialty">Education Specialization *</label><select id="teacherSpecialty" required><option value="" disabled selected>Select Education Specialty...</option><option value="shadow">Shadow Teacher (مدرس ظل)</option><option value="special_ed">Special Needs Educator (تربية خاصة)</option><option value="speech">Speech Therapist (أخصائي تخاطب)</option><option value="behavioral">Behavioral Therapist (تعديل سلوك)</option><option value="montessori">Montessori Guide (مونتيسوري)</option><option value="autism">Autism Specialist (أخصائي توحد)</option><option value="academic">Academic Tutor (تأسيس / مواد)</option></select></div>`;
        workHtml = `<div class="input-group"><label>Work Type *</label><div class="radio-cards-grid"><label class="radio-card"><input type="radio" name="workplace" value="center" required><span>Center/School</span></label><label class="radio-card"><input type="radio" name="workplace" value="home"><span>Home Visits</span></label><label class="radio-card"><input type="radio" name="workplace" value="both"><span>Both</span></label></div></div>`;
        uploadHtml = `<div class="grid-2-cols"><div class="file-upload-item"><label>National ID</label><div class="file-upload-zone"><span class="material-symbols-outlined">badge</span><span class="upload-text">Upload ID</span><input type="file" required></div></div><div class="file-upload-item"><label>Degree / Certificate</label><div class="file-upload-zone"><span class="material-symbols-outlined">school</span><span class="upload-text">Upload Degree</span><input type="file" required></div></div></div>`;
    }
    else if (type === 'coach') {
        specHtml = `<div class="input-group"><label>Sports Categories</label><div class="checkbox-grid"><label class="choice-chip"><input type="checkbox" value="football"> Football</label><label class="choice-chip"><input type="checkbox" value="basketball"> Basketball</label><label class="choice-chip"><input type="checkbox" value="swimming"> Swimming</label></div></div>`;
        workHtml = `<div class="input-group"><label>Work Type *</label><div class="radio-cards-grid"><label class="radio-card"><input type="radio" name="workplace" value="club" required><span>Club/Academy</span></label><label class="radio-card"><input type="radio" name="workplace" value="private"><span>Private Coach</span></label><label class="radio-card"><input type="radio" name="workplace" value="both"><span>Both</span></label></div></div>`;
        uploadHtml = `<div class="grid-2-cols"><div class="file-upload-item"><label>National ID</label><div class="file-upload-zone"><span class="material-symbols-outlined">badge</span><span class="upload-text">Upload ID</span><input type="file" required></div></div><div class="file-upload-item"><label>Coaching License</label><div class="file-upload-zone"><span class="material-symbols-outlined">sports_score</span><span class="upload-text">Upload License</span><input type="file" required></div></div></div>`;
    }
    else { // Nurse
        specHtml = `<div class="input-group"><label for="nurseSpecialty">Nursing Specialization *</label><select id="nurseSpecialty" required><option value="" disabled selected>Select Nursing Specialty...</option><option value="home_care">Home Care</option></select></div>`;
        workHtml = medicalWorkplace;
        uploadHtml = `<div class="grid-2-cols"><div class="file-upload-item"><label>National ID</label><div class="file-upload-zone"><span class="material-symbols-outlined">badge</span><span class="upload-text">Upload ID</span><input type="file" required></div></div><div class="file-upload-item"><label>Nursing License</label><div class="file-upload-zone"><span class="material-symbols-outlined">medical_information</span><span class="upload-text">Upload License</span><input type="file" required></div></div></div>`;
    }

    specContainer.innerHTML = specHtml;
    workContainer.innerHTML = workHtml; 
    uploadsContainer.innerHTML = uploadHtml;
}
