import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, writeBatch, onSnapshot, orderBy, updateDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let _currentUser = null;
let _notifications = [];

onAuthStateChanged(auth, async (user) => {
    if (user) {
        _currentUser = user;
        fetchUserData(user.uid);
        setupNotificationsListener(user.uid);
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
    const qNotif = query(
        collection(db, "notifications"), 
        where("userId", "==", uid)
    );
    
    onSnapshot(qNotif, (snapshot) => {
        _notifications = [];
        let unreadCount = 0;
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            _notifications.push({ id: docSnap.id, ...data });
            if (!data.isRead) unreadCount++;
        });
        
        // Sort manually to avoid needing a Firestore composite index
        _notifications.sort((a, b) => {
            const tA = a.createdAt && typeof a.createdAt.toMillis === 'function' ? a.createdAt.toMillis() : 0;
            const tB = b.createdAt && typeof b.createdAt.toMillis === 'function' ? b.createdAt.toMillis() : 0;
            return tB - tA;
        });
        
        // Update badges
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
        
        renderNotifications();
    });
}

function renderNotifications() {
    const list = document.getElementById('notificationsList');
    list.innerHTML = '';
    
    if (_notifications.length === 0) {
        list.innerHTML = `
            <div style="padding: 60px 20px; text-align: center;">
                <div style="font-size: 3rem; margin-bottom: 10px; opacity:0.5;">&#128276;</div>
                <h3 style="color: var(--text-dark); margin-bottom: 5px;">All Caught Up</h3>
                <p style="color: var(--text-muted);">You don't have any notifications.</p>
            </div>`;
        return;
    }
    
    _notifications.forEach(n => {
        const isUnread = !n.isRead;
        const timeStr = n.createdAt ? new Date(n.createdAt.toDate()).toLocaleString('en-GB') : 'Just now';
        
        // Create element directly to attach click listener securely
        const div = document.createElement('div');
        div.className = `notif-item ${isUnread ? 'unread' : ''}`;
        div.style.cursor = 'pointer';
        
        div.innerHTML = `
            <div class="notif-dot ${!isUnread ? 'read' : ''}"></div>
            <div class="notif-body">
                <p class="notif-title">${n.title}</p>
                <p class="notif-sub">${n.body}</p>
            </div>
            <span class="notif-time">${timeStr}</span>
        `;
        
        div.onclick = () => handleNotificationClick(n.id, n.type, isUnread);
        list.appendChild(div);
    });
}

async function handleNotificationClick(id, type, isUnread) {
    // 1. Mark as read
    if (isUnread) {
        try {
            await updateDoc(doc(db, "notifications", id), { isRead: true });
        } catch(err) {
            console.error("Error marking read", err);
        }
    }
    
    // 2. Redirect based on type
    if (type === 'team_report') {
        window.location.href = 'provider-team-reports.html';
    } else {
        // Just acknowledging it
        showSnackbar("Notification marked as read.");
    }
}

window.clearAllNotifications = async function() {
    if (_notifications.length === 0) return;
    if (!confirm('Are you sure you want to delete all notifications?')) return;
    
    const btn = document.querySelector('.tab-header button');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Clearing...';
    btn.disabled = true;
    
    try {
        const batch = writeBatch(db);
        _notifications.forEach(n => {
            batch.delete(doc(db, "notifications", n.id));
        });
        await batch.commit();
        showSnackbar('All notifications cleared successfully.');
    } catch(err) {
        console.error("Error clearing notifications:", err);
        showSnackbar('Error clearing notifications.');
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
