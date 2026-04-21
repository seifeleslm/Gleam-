import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, where, getDocs, addDoc, serverTimestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let _currentUser = null;
let _userData = {};
let _currentMonth = new Date();
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

let _allBookings = [];
let _currentFilter = 'all';

onAuthStateChanged(auth, async (user) => {
    if (user) {
        _currentUser = user;
        await fetchUserData(user.uid);
        setupNotificationsListener(user.uid);
        
        updateMonthDisplay();
        fetchSubscriptions(user.uid);
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
        document.getElementById('navName').textContent = _userData.fullName || 'Provider';
        document.getElementById('navTitle').textContent = _userData.title || 'Specialist';
        
        const avatarEl = document.getElementById('navAvatar');
        if (_userData.profileImage) {
            avatarEl.style.backgroundImage = `url(${_userData.profileImage})`;
            avatarEl.style.backgroundSize = 'cover';
            avatarEl.style.backgroundPosition = 'center';
            avatarEl.textContent = '';
        } else {
            avatarEl.textContent = (_userData.fullName || 'P').charAt(0).toUpperCase();
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

// ── MONTH SELECTOR ──
function updateMonthDisplay() {
    document.getElementById('monthDisplay').textContent = MONTH_NAMES[_currentMonth.getMonth()] + ' ' + _currentMonth.getFullYear();
}

window.changeMonth = function(dir) {
    _currentMonth = new Date(_currentMonth.getFullYear(), _currentMonth.getMonth() + dir, 1);
    updateMonthDisplay();
    renderData();
}

// ── FETCH SUBSCRIPTIONS & REVENUE ──
async function fetchSubscriptions(uid) {
    const list = document.getElementById('subCardsList');
    list.innerHTML = '<p style="padding:20px; text-align:center; color:var(--text-muted);">Loading subscriptions...</p>';
    
    try {
        const q = query(collection(db, "bookings"), where("providerId", "==", uid));
        const snap = await getDocs(q);
        
        _allBookings = [];
        snap.forEach(docSnap => {
            _allBookings.push({ id: docSnap.id, ...docSnap.data() });
        });
        
        renderData();
        
    } catch(err) {
        console.error("Error fetching subscriptions:", err);
        list.innerHTML = '<p style="padding: 20px; text-align: center; color: #ef4444;">Error loading data.</p>';
    }
}

function renderData() {
    calculateRevenue();
    renderSubscriptionsList();
}

function calculateRevenue() {
    let grossMonthly = 0;
    let grossSession = 0;
    let totalSubsCount = 0;
    let expiringCount = 0;
    
    const targetMonth = _currentMonth.getMonth() + 1;
    const targetYear = _currentMonth.getFullYear();
    const today = new Date();
    today.setHours(0,0,0,0);

    _allBookings.forEach(booking => {
        // Parse date for revenue month checking
        let bMonth = 0;
        let bYear = 0;
        
        if (booking.date) {
            const parts = booking.date.split('-'); // YYYY-MM-DD
            if (parts.length === 3) {
                bYear = parseInt(parts[0]);
                bMonth = parseInt(parts[1]);
            }
        } else if (booking.startDate) {
            const parts = booking.startDate.split('-');
            if (parts.length === 3) {
                bYear = parseInt(parts[0]);
                bMonth = parseInt(parts[1]);
            }
        }
        
        // If booking matches current selected month
        if (bYear === targetYear && bMonth === targetMonth && booking.status !== 'cancelled') {
            const price = parseFloat(booking.price || 0);
            if (booking.type === 'monthly') {
                grossMonthly += price;
            } else {
                grossSession += price;
            }
        }
        
        // Stats for Monthly Plans (any month, but active/expiring right now)
        if (booking.type === 'monthly') {
            totalSubsCount++;
            
            const subState = getSubscriptionState(booking, today);
            if (subState === 'ending') {
                expiringCount++;
            }
        }
    });
    
    const grossTotal = grossMonthly + grossSession;
    const netMonthly = grossMonthly * 0.9;
    const netSession = grossSession * 0.9;
    const netTotal = grossTotal * 0.9;
    
    // Update Stats UI
    document.getElementById('statTotalSubs').textContent = totalSubsCount;
    document.getElementById('statExpiring').textContent = expiringCount;
    document.getElementById('statNetProfit').textContent = netTotal.toLocaleString(undefined, {minimumFractionDigits:0, maximumFractionDigits:2});
    
    // Update Breakdown Panel
    document.getElementById('rbGross').textContent = grossTotal.toLocaleString() + ' EGP';
    document.getElementById('rbMonthly').textContent = netMonthly.toLocaleString() + ' EGP';
    document.getElementById('rbSessions').textContent = netSession.toLocaleString() + ' EGP';
    document.getElementById('rbTotalNet').textContent = netTotal.toLocaleString() + ' EGP';
}

function getSubscriptionState(booking, today) {
    if (booking.status === 'paused') return 'paused';
    if (booking.status === 'cancelled') return 'cancelled';
    
    if (booking.endDate) {
        const endParts = booking.endDate.split('-');
        const endDate = new Date(endParts[0], endParts[1] - 1, endParts[2]);
        endDate.setHours(23,59,59,999);
        
        if (endDate < today) {
            return 'expired';
        }
        
        const diffTime = endDate - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays <= 7) {
            return 'ending';
        }
    }
    return 'active';
}

function getDaysRemaining(endDateStr, today) {
    if(!endDateStr) return 30;
    const endParts = endDateStr.split('-');
    const endDate = new Date(endParts[0], endParts[1] - 1, endParts[2]);
    const diffTime = endDate - today;
    return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

function renderSubscriptionsList() {
    const list = document.getElementById('subCardsList');
    const empty = document.getElementById('subEmpty');
    list.innerHTML = '';
    
    const targetMonth = _currentMonth.getMonth() + 1;
    const targetYear = _currentMonth.getFullYear();
    const today = new Date();
    today.setHours(0,0,0,0);
    
    let visibleCount = 0;
    
    _allBookings.forEach(booking => {
        if (booking.type !== 'monthly') return; // Only show monthly subscriptions
        
        // Month filtering logic (does the subscription span the selected month?)
        let matchesMonth = false;
        if(booking.startDate && booking.endDate) {
            const startParts = booking.startDate.split('-');
            const endParts = booking.endDate.split('-');
            const sDate = new Date(startParts[0], startParts[1]-1, 1);
            const eDate = new Date(endParts[0], endParts[1]-1, 1);
            const selectedDate = new Date(targetYear, targetMonth-1, 1);
            if (selectedDate >= sDate && selectedDate <= eDate) matchesMonth = true;
        } else if (booking.date) {
            const parts = booking.date.split('-');
            if(parseInt(parts[0]) === targetYear && parseInt(parts[1]) === targetMonth) matchesMonth = true;
        }
        
        if (!matchesMonth) return;
        
        const subState = getSubscriptionState(booking, today);
        if (_currentFilter !== 'all' && subState !== _currentFilter) return;
        if (subState === 'cancelled') return; // Hide cancelled from this view entirely
        
        visibleCount++;
        
        const parentName = booking.parentName || 'Client';
        const initial = parentName.charAt(0).toUpperCase();
        const price = booking.price || 0;
        
        let daysLeft = getDaysRemaining(booking.endDate, today);
        let progressPct = 100;
        if (booking.startDate && booking.endDate) {
            const startParts = booking.startDate.split('-');
            const sDate = new Date(startParts[0], startParts[1]-1, startParts[2]);
            const endParts = booking.endDate.split('-');
            const eDate = new Date(endParts[0], endParts[1]-1, endParts[2]);
            const totalDays = Math.max(1, Math.ceil((eDate - sDate)/(1000*60*60*24)));
            progressPct = Math.min(100, Math.max(0, 100 - ((daysLeft / totalDays) * 100)));
        }
        
        // Formatted dates
        const formatD = (dStr) => {
            if(!dStr) return '';
            const p = dStr.split('-');
            return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'});
        };
        const dateRangeStr = `${formatD(booking.startDate)} &rarr; ${formatD(booking.endDate)}`;

        let cardHtml = `
        <div class="sub-card ${subState === 'ending' ? 'ending-soon' : (subState === 'paused' ? 'paused-card' : (subState === 'expired' ? 'expired-card' : ''))}" data-id="${booking.id}">
          <div class="sub-card-top">
            <div class="sub-avatars">
              <div class="sub-avatar-parent">${initial}</div>
              <div class="sub-avatar-child">&#128118;</div>
            </div>
            <div class="sub-info">
              <div class="sub-parent-name">${parentName}</div>
              <div class="sub-phone">&#128222; ${booking.parentPhone || 'N/A'}</div>
            </div>
            <div class="sub-price-tag">${price.toLocaleString()} <span>EGP</span></div>
            <span class="sub-status-badge ${subState === 'ending' ? 'ending' : subState}">${subState === 'ending' ? 'Ending Soon' : subState.charAt(0).toUpperCase() + subState.slice(1)}</span>
          </div>
          <div class="sub-progress-section">
            <div class="sub-progress-label">`;
            
        if (subState === 'paused') {
            cardHtml += `<span>Subscription paused</span><span class="sub-dates">${dateRangeStr}</span></div>
            <div class="sub-progress-track"><div class="sub-progress-fill paused" style="width:${progressPct}%"></div></div>`;
        } else if (subState === 'expired') {
            cardHtml += `<span>Subscription ended</span><span class="sub-dates">${dateRangeStr}</span></div>
            <div class="sub-progress-track"><div class="sub-progress-fill expired" style="width:100%"></div></div>`;
        } else {
            cardHtml += `<span ${subState === 'ending' ? 'class="urgent"' : ''}>${subState === 'ending' ? '&#9888;&#65039; ' : ''}${daysLeft} days remaining</span>
            <span class="sub-dates">${dateRangeStr}</span></div>
            <div class="sub-progress-track"><div class="sub-progress-fill ${subState === 'ending' ? 'ending' : 'active'}" style="width:${progressPct}%"></div></div>`;
        }
        
        cardHtml += `</div><div class="sub-card-actions">`;
        
        // Actions
        if (subState === 'active' || subState === 'ending') {
            cardHtml += `<button class="sub-action-btn orange" onclick="updateSubscriptionStatus('${booking.id}', 'paused', this)">&#9646;&#9646; Pause</button>`;
            if (subState === 'ending') {
                cardHtml += `<button class="sub-action-btn green" onclick="sendReminder('${booking.parentId}', '${parentName}', this)">&#128276; Send Reminder</button>`;
            }
        } else if (subState === 'paused') {
            cardHtml += `<button class="sub-action-btn green" onclick="updateSubscriptionStatus('${booking.id}', 'active', this)">&#9654; Resume</button>`;
        } else if (subState === 'expired') {
            cardHtml += `<button class="sub-action-btn blue" onclick="sendRenewRequest('${booking.parentId}', '${parentName}', this)">&#128260; Ask to Renew</button>`;
        }
        
        cardHtml += `</div></div>`;
        list.innerHTML += cardHtml;
    });
    
    if (visibleCount === 0) {
        list.style.display = 'none';
        empty.style.display = 'flex';
    } else {
        list.style.display = 'flex';
        empty.style.display = 'none';
    }
}

// ── FILTERING ──
window.filterSubs = function(status, btn) {
    document.querySelectorAll('.sub-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _currentFilter = status;
    renderSubscriptionsList();
}

window.toggleRevenueBreakdown = function() {
    const rb = document.getElementById('revenueBreakdown');
    if (rb.style.display === 'none') {
        rb.style.display = 'block';
    } else {
        rb.style.display = 'none';
    }
}

// ── ACTION BUTTONS (FIREBASE UPDATES) ──
window.updateSubscriptionStatus = async function(bookingId, newStatus, btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Wait...';
    btn.disabled = true;
    
    try {
        await updateDoc(doc(db, "bookings", bookingId), {
            status: newStatus,
            updatedAt: serverTimestamp()
        });
        
        // Update local array and re-render
        const bIdx = _allBookings.findIndex(b => b.id === bookingId);
        if (bIdx > -1) {
            _allBookings[bIdx].status = newStatus;
        }
        
        showSnackbar(`Subscription successfully ${newStatus}!`);
        renderData();
        
    } catch(err) {
        console.error("Error updating status:", err);
        showSnackbar("Error updating subscription status.");
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

window.sendReminder = async function(parentId, parentName, btn) {
    btn.innerHTML = 'Sending...';
    btn.disabled = true;
    try {
        await addDoc(collection(db, "notifications"), {
            userId: parentId,
            title: "Subscription Ending Soon \u23f2\ufe0f",
            body: `Hi ${parentName}, your subscription with Dr. ${_userData.fullName} is ending in less than 7 days. Please renew to continue care.`,
            isRead: false,
            createdAt: serverTimestamp(),
            type: "reminder"
        });
        btn.innerHTML = '&#10003; Sent!';
        showSnackbar('Reminder sent successfully!');
    } catch(err) {
        console.error(err);
        showSnackbar('Error sending reminder.');
        btn.disabled = false;
    }
}

window.sendRenewRequest = async function(parentId, parentName, btn) {
    btn.innerHTML = 'Sending...';
    btn.disabled = true;
    try {
        await addDoc(collection(db, "notifications"), {
            userId: parentId,
            title: "Subscription Expired \u26a0\ufe0f",
            body: `Hi ${parentName}, your subscription with Dr. ${_userData.fullName} has expired. Tap here to renew and resume your child's sessions.`,
            isRead: false,
            createdAt: serverTimestamp(),
            type: "renewal_request"
        });
        btn.innerHTML = '&#10003; Request Sent!';
        showSnackbar('Renewal request sent successfully!');
    } catch(err) {
        console.error(err);
        showSnackbar('Error sending request.');
        btn.disabled = false;
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
