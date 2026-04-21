import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, writeBatch, onSnapshot, orderBy, arrayRemove } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let _currentUser = null;
let _reports = [];

onAuthStateChanged(auth, async (user) => {
    if (user) {
        _currentUser = user;
        fetchUserData(user.uid);
        setupNotificationsListener(user.uid);
        fetchTeamReports(user.uid);
    } else {
        window.location.href = "index.html";
    }
});

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await signOut(auth);
});

async function fetchUserData(uid) {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
        const _userData = userDoc.data();
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

function fetchTeamReports(uid) {
    const qReports = query(
        collection(db, "reports"),
        where("sharedWithProviderIds", "array-contains", uid),
        orderBy("createdAt", "desc")
    );
    
    onSnapshot(qReports, (snapshot) => {
        _reports = [];
        snapshot.forEach(docSnap => {
            _reports.push({ id: docSnap.id, ...docSnap.data() });
        });
        renderReports();
    }, (error) => {
        console.error("Error fetching reports:", error);
        document.getElementById('reportsList').innerHTML = '<p style="color:#ef4444; text-align:center;">Failed to load reports.</p>';
    });
}

function renderReports() {
    const list = document.getElementById('reportsList');
    list.innerHTML = '';
    
    if (_reports.length === 0) {
        list.innerHTML = `
            <div style="padding: 60px 20px; text-align: center;">
                <div style="font-size: 3rem; margin-bottom: 10px; opacity:0.5;">&#128101;</div>
                <h3 style="color: var(--text-dark); margin-bottom: 5px;">No Reports Yet</h3>
                <p style="color: var(--text-muted);">When other care team members share a report with you, it will appear here.</p>
            </div>`;
        return;
    }
    
    _reports.forEach(r => {
        const timeStr = r.createdAt ? new Date(r.createdAt.toDate()).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : 'Recently';
        const senderInitial = (r.senderName || 'P').charAt(0).toUpperCase();
        const typeStr = r.type ? (r.type.charAt(0).toUpperCase() + r.type.slice(1)) : 'General';
        
        const card = document.createElement('div');
        card.className = 'report-card';
        
        let html = `
            <div class="rc-header">
                <div class="rc-sender">
                    <div class="rc-avatar">${senderInitial}</div>
                    <div>
                        <div class="rc-title">${r.senderName || 'Care Team Member'}</div>
                        <div class="rc-sub">${r.senderTitle || 'Specialist'}</div>
                    </div>
                </div>
                <div class="rc-date">${timeStr}<br><strong style="color:var(--text-dark);">${typeStr} Report</strong><br><span style="color:var(--green-dark);">Patient: ${r.receiverName || 'Unknown'}</span></div>
            </div>
            <div class="rc-body">
        `;
        
        if (r.notes) {
            html += `<span class="rc-section-title">Observations / Notes</span><p style="margin-bottom:12px;">${r.notes}</p>`;
        }
        
        if (r.recommendations) {
            html += `<span class="rc-section-title">Recommendations</span><p>${r.recommendations}</p>`;
        }
        
        if (r.fileUrl) {
            html += `
                <a href="${r.fileUrl}" target="_blank" class="rc-file">
                    &#128206; View Attached File
                </a>
            `;
        }
        
        if (!r.notes && !r.recommendations && !r.fileUrl) {
            html += `<p style="font-style:italic; color:var(--text-muted);">No additional content provided.</p>`;
        }
        
        html += `</div>`;
        card.innerHTML = html;
        list.appendChild(card);
    });
}

window.clearAllReports = async function() {
    if (_reports.length === 0) return;
    if (!confirm('Are you sure you want to clear these reports from your view?')) return;
    
    const btn = document.querySelector('.tab-header button');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Clearing...';
    btn.disabled = true;
    
    try {
        const batch = writeBatch(db);
        _reports.forEach(r => {
            batch.update(doc(db, "reports", r.id), {
                sharedWithProviderIds: arrayRemove(_currentUser.uid)
            });
        });
        await batch.commit();
        showSnackbar('Reports cleared successfully.');
    } catch(err) {
        console.error("Error clearing reports:", err);
        showSnackbar('Error clearing reports.');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

window.toggleSidebar = function() {
    document.getElementById('sidebar').classList.toggle('open');
}

let _snackTimer = null;
function showSnackbar(msg) {
    const sb = document.getElementById('snackbar');
    if (!sb) return;
    sb.textContent = msg;
    sb.classList.add('show');
    clearTimeout(_snackTimer);
    _snackTimer = setTimeout(() => sb.classList.remove('show'), 3000);
}
