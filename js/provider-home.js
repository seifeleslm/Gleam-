import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, where, getDocs, writeBatch, serverTimestamp, onSnapshot, orderBy } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let _currentUser = null;
let _userData = {};
let _cancelTargetCard = null;
let _selectedDate = null;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        _currentUser = user;
        await fetchUserData(user.uid);
        setupNotificationsListener(user.uid);
        
        buildDateStrip();
        setHeaderDate();
        
        const today = new Date();
        const todayStr = today.getFullYear() + "-" + String(today.getMonth()+1).padStart(2,'0') + "-" + String(today.getDate()).padStart(2,'0');
        _selectedDate = todayStr;
        
        fetchAppointmentsForDate(todayStr);
        fetchRatingsData(user.uid);
        fetchQuickStats(user.uid);
    } else {
        window.location.href = "index.html";
    }
});

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await signOut(auth);
});

// ── USER DETAILS & STATUS ──
async function fetchUserData(uid) {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
        _userData = userDoc.data();
        document.getElementById('navName').textContent = _userData.fullName || 'Provider';
        document.getElementById('navTitle').textContent = _userData.title || 'Specialist';
        document.getElementById('welcomeTitle').textContent = _userData.fullName || 'Provider';
        
        const avatarEl = document.getElementById('navAvatar');
        if (_userData.profileImage) {
            avatarEl.style.backgroundImage = `url(${_userData.profileImage})`;
            avatarEl.style.backgroundSize = 'cover';
            avatarEl.style.backgroundPosition = 'center';
            avatarEl.textContent = '';
        } else {
            avatarEl.textContent = (_userData.fullName || 'P').charAt(0).toUpperCase();
        }

        const onlineToggle = document.getElementById('onlineToggle');
        if (onlineToggle) {
            onlineToggle.checked = _userData.isOnline !== false;
            updateStatusUI(onlineToggle.checked);
        }
    }
}

window.toggleOnlineStatus = async function(input) {
    const isOnline = input.checked;
    updateStatusUI(isOnline);
    if(_currentUser) {
       await updateDoc(doc(db, "users", _currentUser.uid), { isOnline: isOnline });
       showSnackbar(isOnline ? "You are now online." : "You are now offline.");
    }
}

function updateStatusUI(isOnline) {
    const dot = document.getElementById('statusDot');
    const label = document.getElementById('statusLabel');
    if (isOnline) {
        dot.classList.remove('offline');
        label.textContent = 'Online';
        label.style.color = 'var(--green-dark)';
    } else {
        dot.classList.add('offline');
        label.textContent = 'Offline';
        label.style.color = 'var(--text-muted)';
    }
}

// ── NOTIFICATIONS LISTENER ──
function setupNotificationsListener(uid) {
    const qNotif = query(
        collection(db, "notifications"), 
        where("userId", "==", uid),
        where("isRead", "==", false)
    );
    
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

// ── TAB SWITCHING ──
window.switchContentTab = function(panelId, el) {
    document.querySelectorAll('.content-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.content-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('panel-' + panelId).classList.add('active');
    el.classList.add('active');
}

window.toggleSidebar = function() {
    document.getElementById('sidebar').classList.toggle('open');
}

// ── APPOINTMENTS TAB ──
function buildDateStrip() {
    const strip = document.getElementById('dateStrip');
    if (!strip) return;
    const today = new Date();
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    
    for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        
        const dateStr = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,'0') + "-" + String(d.getDate()).padStart(2,'0');
        const chip = document.createElement('div');
        chip.className = 'date-chip' + (i === 0 ? ' active' : '');
        chip.dataset.date = dateStr;
        chip.innerHTML = `
            <span class="dc-day">${days[d.getDay()]}</span>
            <span class="dc-num">${d.getDate()}</span>
            <span class="dc-mon">${months[d.getMonth()]}</span>
        `;
        
        chip.addEventListener('click', function() {
            document.querySelectorAll('.date-chip').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            _selectedDate = dateStr;
            fetchAppointmentsForDate(dateStr);
        });
        
        strip.appendChild(chip);
    }
}

function setHeaderDate() {
    const el = document.getElementById('headerDate');
    if (el) el.textContent = new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

async function fetchAppointmentsForDate(dateStr) {
    if(!_currentUser) return;
    
    const list = document.getElementById('appointmentsList');
    list.innerHTML = '<p style="padding: 20px; text-align: center; color: var(--text-muted);">Loading appointments...</p>';
    
    try {
        const q = query(
            collection(db, "bookings"), 
            where("providerId", "==", _currentUser.uid), 
            where("date", "==", dateStr)
        );
        const snap = await getDocs(q);
        
        if (snap.empty) {
            list.innerHTML = `
                <div style="padding: 40px; text-align: center;">
                    <div style="font-size: 3rem; margin-bottom: 10px;">&#128197;</div>
                    <h3 style="color: var(--text-dark); margin-bottom: 5px;">No Appointments</h3>
                    <p style="color: var(--text-muted);">You have no appointments scheduled for this date.</p>
                </div>`;
            return;
        }
        
        list.innerHTML = '';
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const isCancelled = data.status === 'cancelled';
            const statusClass = isCancelled ? 'cancelled' : (data.status === 'pending' ? 'pending' : 'confirmed');
            const typeClass = data.type === 'monthly' ? 'monthly' : 'session';
            const parentName = data.parentName || 'Client';
            const initial = parentName.charAt(0).toUpperCase();
            
            list.innerHTML += `
            <div class="appointment-card ${isCancelled ? 'cancelled-card' : ''}" 
                 data-id="${docSnap.id}" 
                 data-parentid="${data.parentId}" 
                 data-date="${data.date}" 
                 data-time="${data.time}"
                 data-parentname="${parentName}">
                <div class="appt-time-col">
                    <span class="appt-time">${data.time || 'TBD'}</span>
                    <span class="appt-type-badge ${typeClass}">${data.type || 'Session'}</span>
                </div>
                <div class="appt-divider"></div>
                <div class="appt-details">
                    <div class="appt-parent">
                        <div class="appt-avatar">${initial}</div>
                        <div>
                            <div class="appt-name">${parentName}</div>
                            <div class="appt-phone">&#128222; ${data.parentPhone || 'N/A'}</div>
                        </div>
                    </div>
                    <span class="appt-status ${statusClass}">${(data.status || 'confirmed').toUpperCase()}</span>
                </div>
                ${!isCancelled ? `<button class="btn-cancel" onclick="showCancelDialog(this)">Cancel</button>` : `<button class="btn-cancel" disabled>Cancelled</button>`}
            </div>`;
        });
        
    } catch(err) {
        console.error("Error fetching appointments:", err);
        list.innerHTML = '<p style="padding: 20px; text-align: center; color: #ef4444;">Error loading appointments.</p>';
    }
}

window.showCancelDialog = function(btn) {
    _cancelTargetCard = btn.closest('.appointment-card');
    document.getElementById('cancelModal').classList.add('open');
}

window.closeModal = function() {
    document.getElementById('cancelModal').classList.remove('open');
    _cancelTargetCard = null;
}

window.confirmCancel = async function() {
    if (!_cancelTargetCard || !_currentUser) return;
    
    const bookingId = _cancelTargetCard.dataset.id;
    const parentId = _cancelTargetCard.dataset.parentid;
    const date = _cancelTargetCard.dataset.date;
    const time = _cancelTargetCard.dataset.time;
    
    const btnCancel = document.querySelector('#cancelModal .modal-btn-danger');
    const originalText = btnCancel.textContent;
    btnCancel.textContent = 'Cancelling...';
    btnCancel.disabled = true;

    try {
        const batch = writeBatch(db);
        
        // 1. Update Booking Status
        batch.update(doc(db, "bookings", bookingId), { 
            status: 'cancelled',
            updatedAt: serverTimestamp()
        });
        
        // 2. Create Apology Notification
        const notifRef = doc(collection(db, "notifications"));
        batch.set(notifRef, {
            userId: parentId,
            title: 'Appointment Cancelled ⚠️',
            body: `We apologize, but Dr. ${_userData.fullName} had to cancel your appointment on ${date} at ${time}.`,
            createdAt: serverTimestamp(),
            isRead: false,
            type: 'system',
            bookingId: bookingId
        });
        
        await batch.commit();
        
        // Update UI
        const statusEl = _cancelTargetCard.querySelector('.appt-status');
        const cardBtn = _cancelTargetCard.querySelector('.btn-cancel');
        
        statusEl.className = 'appt-status cancelled';
        statusEl.textContent = 'CANCELLED';
        cardBtn.textContent = 'Cancelled';
        cardBtn.disabled = true;
        _cancelTargetCard.classList.add('cancelled-card');
        
        showSnackbar("Booking successfully cancelled and parent notified.");
        
    } catch(err) {
        console.error("Error cancelling booking:", err);
        showSnackbar("Error cancelling booking. Please try again.");
    } finally {
        btnCancel.textContent = originalText;
        btnCancel.disabled = false;
        closeModal();
    }
}

// ── RATINGS TAB ──
async function fetchRatingsData(uid) {
    const list = document.getElementById('reviewsList');
    list.innerHTML = '<p style="padding: 20px; text-align: center; color: var(--text-muted);">Loading reviews...</p>';
    
    try {
        const q = query(
            collection(db, "reviews"),
            where("providerId", "==", uid),
            orderBy("createdAt", "desc")
        );
        const snap = await getDocs(q);
        
        if(snap.empty) {
            document.getElementById('ratingBigNum').textContent = "0.0";
            document.getElementById('ratingCountText').textContent = "Based on 0 reviews";
            document.getElementById('ratingBars').innerHTML = '';
            list.innerHTML = `
                <div style="padding: 40px; text-align: center;">
                    <h3 style="color: var(--text-dark); margin-bottom: 5px;">No Reviews Yet</h3>
                    <p style="color: var(--text-muted);">You haven't received any reviews yet.</p>
                </div>`;
            return;
        }

        let totalScore = 0;
        let count = 0;
        const counts = {5:0, 4:0, 3:0, 2:0, 1:0};
        list.innerHTML = '';
        
        snap.forEach(docSnap => {
            const data = docSnap.data();
            const score = data.rating || 5;
            totalScore += score;
            count++;
            if(counts[score] !== undefined) counts[score]++;
            
            const dateStr = data.createdAt ? new Date(data.createdAt.toDate()).toLocaleDateString('en-GB') : 'Recently';
            const initial = (data.parentName || 'U').charAt(0).toUpperCase();
            
            let starsHtml = '';
            for(let i=1; i<=5; i++) {
                starsHtml += i <= score ? '&#9733;' : '<span style="color:var(--border)">&#9733;</span>';
            }
            
            list.innerHTML += `
            <div class="review-card">
                <div class="review-header">
                    <div class="review-avatar">${initial}</div>
                    <div>
                        <div class="review-name">${data.parentName || 'Anonymous'}</div>
                        <div class="review-date">${dateStr}</div>
                    </div>
                    <div class="review-stars">${starsHtml}</div>
                </div>
                <p class="review-text">"${data.comment || 'No comment provided.'}"</p>
            </div>`;
        });
        
        const avg = (totalScore / count).toFixed(1);
        document.getElementById('ratingBigNum').textContent = avg;
        document.getElementById('ratingCountText').textContent = `Based on ${count} review${count !== 1 ? 's' : ''}`;
        
        // Update big stars
        let bigStars = '';
        for(let i=1; i<=5; i++) {
            bigStars += i <= Math.round(avg) ? '&#9733;' : '<span style="color:var(--border)">&#9733;</span>';
        }
        document.getElementById('ratingStarsBig').innerHTML = bigStars;
        
        // Update bars
        let barsHtml = '';
        for(let i=5; i>=1; i--) {
            const pct = count > 0 ? (counts[i] / count) * 100 : 0;
            barsHtml += `
            <div class="rating-bar-row">
                <span>${i}&#9733;</span>
                <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
                <span>${counts[i]}</span>
            </div>`;
        }
        document.getElementById('ratingBars').innerHTML = barsHtml;
        
    } catch(err) {
        console.error("Error fetching ratings:", err);
        list.innerHTML = '<p style="padding: 20px; text-align: center; color: #ef4444;">Error loading reviews.</p>';
    }
}

// ── QUICK STATS ──
async function fetchQuickStats(uid) {
    // 1. Today's Bookings
    const today = new Date();
    const todayStr = today.getFullYear() + "-" + String(today.getMonth()+1).padStart(2,'0') + "-" + String(today.getDate()).padStart(2,'0');
    
    try {
        const qToday = query(collection(db, "bookings"), where("providerId", "==", uid), where("date", "==", todayStr));
        const snapToday = await getDocs(qToday);
        document.getElementById('statTodayBookings').textContent = snapToday.size;
        
        // 2. Active Clients (Unique parents) & Monthly Revenue
        const qAll = query(collection(db, "bookings"), where("providerId", "==", uid));
        const snapAll = await getDocs(qAll);
        
        const uniqueParents = new Set();
        let monthRevenue = 0;
        
        const currentMonth = today.getMonth() + 1;
        const currentYear = today.getFullYear();
        
        snapAll.forEach(docSnap => {
            const d = docSnap.data();
            if(d.parentId) uniqueParents.add(d.parentId);
            
            if(d.date && d.status !== 'cancelled') {
                const parts = d.date.split('-');
                if(parts.length === 3) {
                    if(parseInt(parts[0]) === currentYear && parseInt(parts[1]) === currentMonth) {
                        monthRevenue += (d.price || 0);
                    }
                }
            }
        });
        
        document.getElementById('statActiveClients').textContent = uniqueParents.size;
        document.getElementById('statMonthRevenue').textContent = monthRevenue.toLocaleString();
        
        // Avg Rating is handled in fetchRatingsData, but if we need to sync it to top stats:
        const qRev = query(collection(db, "reviews"), where("providerId", "==", uid));
        const snapRev = await getDocs(qRev);
        if(!snapRev.empty) {
            let tScore = 0;
            snapRev.forEach(d => tScore += (d.data().rating || 5));
            document.getElementById('statAvgRating').textContent = (tScore / snapRev.size).toFixed(1);
        }
        
    } catch(err) {
        console.error("Error fetching quick stats:", err);
    }
}

// ── UTILS ──
let _snackTimer = null;
function showSnackbar(msg) {
    const sb = document.getElementById('snackbar');
    if (!sb) return;
    sb.textContent = msg;
    sb.classList.add('show');
    clearTimeout(_snackTimer);
    _snackTimer = setTimeout(() => sb.classList.remove('show'), 3000);
}
