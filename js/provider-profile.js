import { auth, db, storage } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs, writeBatch, serverTimestamp, onSnapshot, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

let _currentUser = null;
let _userData = {};

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

onAuthStateChanged(auth, async (user) => {
    if (user) {
        _currentUser = user;
        await fetchUserData(user.uid);
        setupNotificationsListener(user.uid);
        
        buildScheduleGrid();
        populateProfileForm();
    } else {
        window.location.href = "index.html";
    }
});

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await signOut(auth);
});

// ── USER DETAILS ──
async function fetchUserData(uid) {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
        _userData = userDoc.data();
        updateNavProfile();
    }
}

function updateNavProfile() {
    const fullName = _userData.fullName || 'Provider';
    const title = _userData.title || 'Specialist';
    const initial = fullName.charAt(0).toUpperCase();

    document.getElementById('navName').textContent = fullName;
    document.getElementById('navTitle').textContent = title;
    
    const avatarEl = document.getElementById('navAvatar');
    const profAvatarLg = document.getElementById('profAvatarLg');
    const profInit = document.getElementById('profAvatarInit');

    if (_userData.profileImage) {
        avatarEl.style.backgroundImage = `url(${_userData.profileImage})`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        avatarEl.textContent = '';
        
        profAvatarLg.style.backgroundImage = `url(${_userData.profileImage})`;
        profAvatarLg.style.backgroundSize = 'cover';
        profAvatarLg.style.backgroundPosition = 'center';
        if(profInit) profInit.style.display = 'none';
    } else {
        avatarEl.textContent = initial;
        if(profInit) {
            profInit.style.display = 'block';
            profInit.textContent = initial;
        }
    }
}

// ── NOTIFICATIONS LISTENER ──
function setupNotificationsListener(uid) {
    const qNotif = query(collection(db, "notifications"), where("userId", "==", uid), where("isRead", "==", false));
    onSnapshot(qNotif, (snapshot) => {
        const unreadCount = snapshot.size;
        const badges = [document.getElementById('notifBadge'), document.getElementById('navbarNotifCount')];
        badges.forEach(badge => {
            if (badge) {
                if (unreadCount > 0) {
                    badge.style.display = 'flex';
                    badge.textContent = unreadCount > 9 ? '9+' : unreadCount;
                } else {
                    badge.style.display = 'none';
                }
            }
        });
    });
}

// ── LIVE FORM SYNC ──
window.syncProfileName = function() {
    const val = document.getElementById('pfFullName').value || 'Provider';
    document.getElementById('navName').textContent = val;
    const initEl = document.getElementById('profAvatarInit');
    if (initEl && !_userData.profileImage) {
        initEl.textContent = val.charAt(0).toUpperCase();
        document.getElementById('navAvatar').textContent = val.charAt(0).toUpperCase();
    }
}
window.syncProfileTitle = function() {
    document.getElementById('navTitle').textContent = document.getElementById('pfTitle').value || 'Specialist';
}

function populateProfileForm() {
    document.getElementById('pfFullName').value = _userData.fullName || '';
    document.getElementById('pfTitle').value = _userData.title || '';
    document.getElementById('pfSpecialty').value = _userData.specialty || '';
    document.getElementById('pfPhone').value = _userData.phone || '';
    document.getElementById('pfCity').value = _userData.governorate || '';
    document.getElementById('pfBio').value = _userData.bio || '';
    document.getElementById('pfSessionPrice').value = _userData.price || '';
    document.getElementById('pfMonthlyPrice').value = _userData.monthlyPrice || '';
}

// ── 1. AVATAR UPLOAD & CROSS-SYNC ──
window.previewAvatar = async function(input) {
    if (!input.files || !input.files[0] || !_currentUser) return;
    
    const file = input.files[0];
    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
        showSnackbar("Image must be smaller than 5MB");
        return;
    }

    // Local Preview
    const reader = new FileReader();
    reader.onload = function(e) {
        const profLg = document.getElementById('profAvatarLg');
        profLg.style.backgroundImage = `url(${e.target.result})`;
        profLg.style.backgroundSize = 'cover';
        profLg.style.backgroundPosition = 'center';
        const initEl = document.getElementById('profAvatarInit');
        if(initEl) initEl.style.display = 'none';
    };
    reader.readAsDataURL(file);

    try {
        showSnackbar('Uploading profile picture...');
        const fileRef = ref(storage, `profile_images/provider_${_currentUser.uid}_${Date.now()}.jpg`);
        await uploadBytes(fileRef, file);
        const downloadUrl = await getDownloadURL(fileRef);
        
        // Batch sync across collections
        showSnackbar('Syncing image across database...');
        const batch = writeBatch(db);
        
        batch.update(doc(db, "users", _currentUser.uid), { profileImage: downloadUrl });
        
        // Sync Bookings
        const qBookings = query(collection(db, "bookings"), where("providerId", "==", _currentUser.uid));
        const snapBookings = await getDocs(qBookings);
        snapBookings.forEach(docSnap => batch.update(docSnap.ref, { providerImage: downloadUrl }));
        
        await batch.commit();
        
        _userData.profileImage = downloadUrl;
        updateNavProfile();
        showSnackbar('Profile picture successfully updated everywhere!');
        
    } catch (err) {
        console.error("Upload error:", err);
        showSnackbar("Error uploading image.");
    }
}

// ── 2. SAVE PROFILE & CROSS-SYNC ──
window.saveProfileData = async function() {
    const btn = document.getElementById('btnSaveProfile');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    
    const fullName = document.getElementById('pfFullName').value.trim();
    const title = document.getElementById('pfTitle').value.trim();
    
    const updates = {
        fullName: fullName,
        title: title,
        specialty: document.getElementById('pfSpecialty').value.trim(),
        phone: document.getElementById('pfPhone').value.trim(),
        governorate: document.getElementById('pfCity').value.trim(),
        bio: document.getElementById('pfBio').value.trim(),
        price: parseInt(document.getElementById('pfSessionPrice').value) || 0,
        monthlyPrice: parseInt(document.getElementById('pfMonthlyPrice').value) || 0,
        updatedAt: serverTimestamp()
    };
    
    try {
        const batch = writeBatch(db);
        
        // Update user
        batch.update(doc(db, "users", _currentUser.uid), updates);
        
        // Check if name or title changed to sync across DB
        if (fullName !== _userData.fullName || title !== _userData.title) {
            
            // Sync Bookings
            const qBookings = query(collection(db, "bookings"), where("providerId", "==", _currentUser.uid));
            const snapBookings = await getDocs(qBookings);
            snapBookings.forEach(docSnap => {
                batch.update(docSnap.ref, { 
                    providerName: fullName, 
                    providerTitle: title 
                });
            });
            
            // Sync Reports
            const qReports = query(collection(db, "reports"), where("senderId", "==", _currentUser.uid));
            const snapReports = await getDocs(qReports);
            snapReports.forEach(docSnap => {
                batch.update(docSnap.ref, { 
                    senderName: fullName, 
                    senderTitle: title 
                });
            });
        }
        
        await batch.commit();
        
        _userData = { ..._userData, ...updates };
        updateNavProfile();
        showSnackbar('Profile details updated and synced!');
        
    } catch(err) {
        console.error("Save error:", err);
        showSnackbar('Error saving profile details.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Profile Details';
    }
}

// ── SCHEDULE GRID BUILDER ──
function buildScheduleGrid() {
    const grid = document.getElementById('scheduleGrid');
    grid.innerHTML = '';
    
    const userSched = _userData.schedule || {};
    
    DAYS_OF_WEEK.forEach(day => {
        let isOff = true;
        let start = "09:00";
        let end = "17:00";
        
        if (userSched[day] && userSched[day] !== "Off") {
            isOff = false;
            const parts = userSched[day].split(' - ');
            if (parts.length === 2) {
                start = convert12to24(parts[0]);
                end = convert12to24(parts[1]);
            }
        }
        
        const card = document.createElement('div');
        card.className = `sched-day ${isOff ? 'off' : ''}`;
        card.dataset.day = day;
        
        card.innerHTML = `
            <div style="display:flex; align-items:center; gap:12px;">
                <label class="toggle-switch">
                    <input type="checkbox" class="sched-toggle-input" ${!isOff ? 'checked' : ''} onchange="toggleDay(this)">
                    <span class="toggle-slider"></span>
                </label>
                <span class="sched-day-name">${day.substring(0,3)}</span>
            </div>
            
            <div class="sched-time-container" style="flex:1; display:flex; justify-content:center;">
                ${isOff 
                  ? `<span class="sched-off-label">Off / Closed</span>` 
                  : `
                    <div class="sched-time-row">
                        <input type="time" class="sched-time-input t-start" value="${start}">
                        <span class="sched-time-sep">to</span>
                        <input type="time" class="sched-time-input t-end" value="${end}">
                    </div>
                  `
                }
            </div>
        `;
        
        grid.appendChild(card);
    });
}

window.toggleDay = function(checkbox) {
    const card = checkbox.closest('.sched-day');
    const container = card.querySelector('.sched-time-container');
    
    if (checkbox.checked) {
        card.classList.remove('off');
        container.innerHTML = `
            <div class="sched-time-row">
                <input type="time" class="sched-time-input t-start" value="09:00">
                <span class="sched-time-sep">to</span>
                <input type="time" class="sched-time-input t-end" value="17:00">
            </div>
        `;
    } else {
        card.classList.add('off');
        container.innerHTML = `<span class="sched-off-label">Off / Closed</span>`;
    }
}

// ── 3. SMART SCHEDULE SAVE & CONFLICT RESOLUTION ──
window.saveScheduleData = async function() {
    const btn = document.getElementById('btnSaveSchedule');
    btn.disabled = true;
    btn.textContent = 'Updating...';
    
    const newSchedule = {};
    const days = document.querySelectorAll('.sched-day');
    
    days.forEach(card => {
        const day = card.dataset.day;
        const isOff = card.classList.contains('off');
        
        if (isOff) {
            newSchedule[day] = "Off";
        } else {
            const tStart = card.querySelector('.t-start').value || "09:00";
            const tEnd = card.querySelector('.t-end').value || "17:00";
            newSchedule[day] = `${formatTime(tStart)} - ${formatTime(tEnd)}`;
        }
    });
    
    try {
        const batch = writeBatch(db);
        
        // 1. Update User Schedule
        batch.update(doc(db, "users", _currentUser.uid), { schedule: newSchedule });
        
        // 2. Fetch Future Confirmed Bookings
        const today = new Date();
        const todayStr = today.getFullYear() + "-" + String(today.getMonth()+1).padStart(2,'0') + "-" + String(today.getDate()).padStart(2,'0');
        
        const qFuture = query(
            collection(db, "bookings"),
            where("providerId", "==", _currentUser.uid),
            where("date", ">=", todayStr),
            where("status", "==", "confirmed")
        );
        
        const snapFuture = await getDocs(qFuture);
        let conflictCount = 0;
        
        snapFuture.forEach(docSnap => {
            const data = docSnap.data();
            const bDate = new Date(data.date);
            const dayOfWeek = DAYS_OF_WEEK[bDate.getDay()];
            
            const schedConfig = newSchedule[dayOfWeek];
            let isConflict = false;
            
            if (schedConfig === "Off") {
                isConflict = true;
            } else if (data.time) {
                // Check if time falls out of bounds
                const bTime24 = convert12to24(data.time);
                const bounds = schedConfig.split(' - ');
                const start24 = convert12to24(bounds[0]);
                const end24 = convert12to24(bounds[1]);
                
                if (bTime24 < start24 || bTime24 >= end24) {
                    isConflict = true;
                }
            }
            
            if (isConflict) {
                conflictCount++;
                batch.update(docSnap.ref, { status: 'cancelled', updatedAt: serverTimestamp() });
                
                // Notify parent of system cancellation
                const notifRef = doc(collection(db, "notifications"));
                batch.set(notifRef, {
                    userId: data.parentId,
                    title: "Booking Cancelled (Schedule Change) ⚠️",
                    body: `Your booking on ${data.date} was cancelled because Dr. ${_userData.fullName} has updated their working hours. Please rebook an available slot.`,
                    isRead: false,
                    createdAt: serverTimestamp(),
                    type: "system_cancellation"
                });
            }
        });
        
        await batch.commit();
        
        _userData.schedule = newSchedule;
        
        let msg = 'Schedule updated successfully!';
        if (conflictCount > 0) {
            msg = `Schedule updated. ${conflictCount} conflicting appointment(s) were automatically cancelled.`;
        }
        showSnackbar(msg);
        
    } catch(err) {
        console.error("Schedule update error:", err);
        showSnackbar('Error updating schedule.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Update Schedule';
    }
}

// ── TIME UTILS ──
function convert12to24(time12h) {
    if(!time12h) return "00:00";
    const parts = time12h.split(' ');
    if (parts.length !== 2) return time12h; // already 24h or unknown
    let [hours, minutes] = parts[0].split(':');
    const modifier = parts[1];
    
    if (hours === '12') hours = '00';
    if (modifier === 'PM' || modifier === 'pm') hours = parseInt(hours, 10) + 12;
    return `${hours.toString().padStart(2, '0')}:${minutes}`;
}

function formatTime(t) {
    const [h, m] = t.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')} ${suffix}`;
}

// ── SNACKBAR ──
let _snackTimer = null;
function showSnackbar(msg) {
    const sb = document.getElementById('snackbar');
    if (!sb) return;
    sb.textContent = msg;
    sb.classList.add('show');
    clearTimeout(_snackTimer);
    _snackTimer = setTimeout(() => sb.classList.remove('show'), 4000);
}
