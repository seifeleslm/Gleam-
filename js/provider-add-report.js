import { auth, db, storage } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { doc, getDoc, collection, query, where, getDocs, writeBatch, serverTimestamp, onSnapshot, addDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

let _currentUser = null;
let _userData = {};
let _patientsList = [];
let _selectedPatient = null;
let _selectedTeamIds = new Set();
let _scheduledAt = null;
let _attachedFile = null;

onAuthStateChanged(auth, async (user) => {
    if (user) {
        _currentUser = user;
        await fetchUserData(user.uid);
        setupNotificationsListener(user.uid);
        await loadMyPatients(user.uid);
        
        setupInputListeners();
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
        const fullName = _userData.fullName || 'Provider';
        const title = _userData.title || 'Specialist';
        const initial = fullName.charAt(0).toUpperCase();

        document.getElementById('navName').textContent = fullName;
        document.getElementById('navTitle').textContent = title;
        document.getElementById('previewSenderName').textContent = fullName;
        document.getElementById('previewSenderTitle').textContent = title;
        
        const avatarEl = document.getElementById('navAvatar');
        const prevAvatarEl = document.getElementById('previewSenderAvatar');

        if (_userData.profileImage) {
            avatarEl.style.backgroundImage = `url(${_userData.profileImage})`;
            avatarEl.style.backgroundSize = 'cover';
            avatarEl.style.backgroundPosition = 'center';
            avatarEl.textContent = '';
            
            prevAvatarEl.style.backgroundImage = `url(${_userData.profileImage})`;
            prevAvatarEl.style.backgroundSize = 'cover';
            prevAvatarEl.style.backgroundPosition = 'center';
            prevAvatarEl.textContent = '';
        } else {
            avatarEl.textContent = initial;
            prevAvatarEl.textContent = initial;
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

// ── PATIENT SELECTION ──
async function loadMyPatients(uid) {
    try {
        const q = query(collection(db, "bookings"), where("providerId", "==", uid));
        const snap = await getDocs(q);
        
        const uniqueMap = new Map();
        snap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.parentId && !uniqueMap.has(data.parentId)) {
                uniqueMap.set(data.parentId, {
                    parentId: data.parentId,
                    parentName: data.parentName || 'Client',
                    parentPhone: data.parentPhone || 'N/A'
                });
            }
        });
        
        _patientsList = Array.from(uniqueMap.values());
        renderPatientsModal(_patientsList);
        
    } catch (err) {
        console.error("Error loading patients:", err);
        document.getElementById('patientList').innerHTML = '<p style="color:#ef4444;text-align:center;">Failed to load patients.</p>';
    }
}

function renderPatientsModal(list) {
    const container = document.getElementById('patientList');
    container.innerHTML = '';
    
    if (list.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">No patients found.</p>';
        return;
    }
    
    list.forEach(p => {
        const initial = p.parentName.charAt(0).toUpperCase();
        
        const item = document.createElement('div');
        item.className = 'patient-list-item';
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '12px';
        item.style.padding = '12px';
        item.style.borderBottom = '1px solid var(--border)';
        item.style.cursor = 'pointer';
        item.style.transition = 'background 0.2s';
        
        item.onmouseover = () => item.style.background = 'var(--green-ghost)';
        item.onmouseout = () => item.style.background = 'transparent';
        
        item.onclick = () => selectPatient(p.parentId, p.parentName, p.parentPhone, initial);
        
        item.innerHTML = `
            <div style="width:36px; height:36px; border-radius:50%; background:var(--green-dark); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:bold;">${initial}</div>
            <div style="flex:1;">
                <div style="font-weight:600; font-size:0.95rem; color:var(--text-dark);">${p.parentName}</div>
                <div style="font-size:0.8rem; color:var(--text-muted);">&#128222; ${p.parentPhone}</div>
            </div>
            <span style="color:var(--text-muted);">&#8250;</span>
        `;
        container.appendChild(item);
    });
}

window.openPatientModal = function() {
    document.getElementById('patientSearch').value = '';
    renderPatientsModal(_patientsList);
    document.getElementById('patientModal').classList.add('open');
}

window.closePatientModal = function() {
    document.getElementById('patientModal').classList.remove('open');
}

window.filterPatients = function(val) {
    const q = val.toLowerCase();
    const filtered = _patientsList.filter(p => p.parentName.toLowerCase().includes(q));
    renderPatientsModal(filtered);
}

window.selectPatient = function(parentId, name, phone, initial) {
    _selectedPatient = { parentId, name, phone, initial };
    
    const btn = document.getElementById('patientSelectorBtn');
    const text = document.getElementById('patientSelectorText');
    
    btn.style.borderColor = 'var(--green-dark)';
    btn.style.background = 'var(--green-pale)';
    text.style.color = 'var(--green-dark)';
    text.style.fontWeight = '600';
    text.textContent = `${name}  ·  ${phone}`;
    
    document.getElementById('previewPatient').textContent = name;
    closePatientModal();
    
    fetchCareTeam(parentId);
}

// ── CARE TEAM ──
async function fetchCareTeam(parentId) {
    const body = document.getElementById('careTeamBody');
    body.innerHTML = '<p style="padding:15px; color:var(--text-muted);">Loading care team...</p>';
    _selectedTeamIds.clear();
    updatePreviewTeam();
    
    try {
        const q = query(collection(db, "bookings"), where("parentId", "==", parentId));
        const snap = await getDocs(q);
        
        const teamMap = new Map();
        snap.forEach(docSnap => {
            const data = docSnap.data();
            // Group other providers (skip self)
            if (data.providerId && data.providerId !== _currentUser.uid) {
                if (!teamMap.has(data.providerId)) {
                    teamMap.set(data.providerId, {
                        providerId: data.providerId,
                        providerName: data.providerName || 'Provider',
                        providerTitle: data.providerTitle || 'Specialist'
                    });
                }
            }
        });
        
        const teamArray = Array.from(teamMap.values());
        
        if (teamArray.length === 0) {
            body.innerHTML = '<div class="care-team-empty" style="text-align:center; padding:20px;"><span>&#128101;</span><p style="color:var(--text-muted); font-size:0.9rem;">No other care team members found for this patient.</p></div>';
            return;
        }
        
        body.innerHTML = '';
        teamArray.forEach(m => {
            const initial = m.providerName.charAt(0).toUpperCase();
            
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '12px';
            row.style.padding = '10px 0';
            row.style.borderBottom = '1px solid var(--border)';
            
            row.innerHTML = `
                <div style="width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg,var(--green-light),var(--green-dark)); color:#fff; display:flex; align-items:center; justify-content:center; font-size:0.8rem; font-weight:bold;">${initial}</div>
                <div style="flex:1;">
                    <div style="font-weight:600; font-size:0.9rem; color:var(--text-dark);">${m.providerName}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted);">${m.providerTitle}</div>
                </div>
                <input type="checkbox" style="width:18px; height:18px; cursor:pointer;" value="${m.providerId}" onchange="toggleTeamMember(this, '${m.providerName}')">
            `;
            body.appendChild(row);
        });
        
    } catch (err) {
        console.error("Error fetching care team:", err);
        body.innerHTML = '<p style="color:#ef4444;">Failed to load care team.</p>';
    }
}

window.toggleTeamMember = function(checkbox, name) {
    if (checkbox.checked) {
        _selectedTeamIds.add(checkbox.value);
    } else {
        _selectedTeamIds.delete(checkbox.value);
    }
    updatePreviewTeam();
}

function updatePreviewTeam() {
    const el = document.getElementById('previewTeam');
    if (_selectedTeamIds.size === 0) {
        el.textContent = 'None selected';
    } else {
        el.textContent = `${_selectedTeamIds.size} provider(s) selected`;
    }
}

// ── REPORT TYPE & FIELDS ──
window.selectReportType = function(radio) {
    document.querySelectorAll('.report-type-option').forEach(o => o.classList.remove('active'));
    radio.closest('.report-type-option').classList.add('active');
    
    const label = radio.value.charAt(0).toUpperCase() + radio.value.slice(1);
    document.getElementById('previewType').textContent = label;
}

function setupInputListeners() {
    const notesEl = document.getElementById('reportNotes');
    const recsEl = document.getElementById('reportRecs');
    
    if (notesEl) notesEl.addEventListener('input', () => {
        document.getElementById('notesCount').textContent = `${notesEl.value.length} / 1000`;
    });
    
    if (recsEl) recsEl.addEventListener('input', () => {
        document.getElementById('recsCount').textContent = `${recsEl.value.length} / 1000`;
    });
    
    const sd = document.getElementById('scheduleDate');
    if (sd) sd.min = new Date().toISOString().split('T')[0];
}

// ── FILE UPLOAD (DRAG & DROP) ──
window.onDragOver = function(e) {
    e.preventDefault();
    document.getElementById('fileDropZone').classList.add('drag-over');
}
window.onFileDrop = function(e) {
    e.preventDefault();
    document.getElementById('fileDropZone').classList.remove('drag-over');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFile(e.dataTransfer.files[0]);
    }
}
window.onFileSelected = function(input) {
    if (input.files && input.files[0]) {
        handleFile(input.files[0]);
    }
}

function handleFile(file) {
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
        showSnackbar('File is too large. Max 10MB.');
        return;
    }
    
    _attachedFile = file;
    const sizeMB = (file.size / 1024 / 1024).toFixed(2);
    
    document.getElementById('fileDropZone').style.display = 'none';
    const attached = document.getElementById('fileAttached');
    attached.style.display = 'flex';
    attached.style.alignItems = 'center';
    attached.style.gap = '10px';
    attached.style.padding = '15px';
    attached.style.background = 'var(--green-ghost)';
    attached.style.border = '1px solid var(--green-light)';
    attached.style.borderRadius = '8px';
    
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent = sizeMB + ' MB';
    document.getElementById('previewFile').textContent = file.name;
}

window.removeFile = function() {
    _attachedFile = null;
    document.getElementById('fileInput').value = '';
    document.getElementById('fileDropZone').style.display = 'block';
    document.getElementById('fileAttached').style.display = 'none';
    document.getElementById('previewFile').textContent = 'None';
}

// ── SCHEDULE MODAL ──
window.openScheduleModal = function() { document.getElementById('scheduleModal').classList.add('open'); }
window.closeScheduleModal = function() { document.getElementById('scheduleModal').classList.remove('open'); }
window.confirmSchedule = function() {
    const date = document.getElementById('scheduleDate').value;
    const time = document.getElementById('scheduleTime').value;
    if (!date || !time) {
        showSnackbar('Please select both date and time.');
        return;
    }
    _scheduledAt = `${date} ${time}`;
    document.getElementById('previewSchedule').textContent = _scheduledAt;
    closeScheduleModal();
    showSnackbar(`Report scheduled for ${_scheduledAt}`);
}

// ── SUBMIT REPORT ──
window.submitReport = async function() {
    if (!_selectedPatient) {
        showSnackbar('Please select a patient first.');
        return;
    }
    
    const notes = document.getElementById('reportNotes').value.trim();
    const recs = document.getElementById('reportRecs').value.trim();
    const typeRadio = document.querySelector('input[name="reportType"]:checked');
    const type = typeRadio ? typeRadio.value : 'health';
    
    if (!notes && !_attachedFile) {
        showSnackbar('Please provide notes or attach a file.');
        return;
    }
    
    const btn = document.getElementById('btnSendNow');
    const text = document.getElementById('sendBtnText');
    const loader = document.getElementById('sendBtnLoader');
    
    btn.disabled = true;
    text.style.display = 'none';
    loader.style.display = 'inline-block';
    
    try {
        let fileUrl = "";
        
        // 1. Upload File if attached
        if (_attachedFile) {
            showSnackbar('Uploading file...');
            const fileRef = ref(storage, `reports/${_currentUser.uid}_${Date.now()}_${_attachedFile.name}`);
            await uploadBytes(fileRef, _attachedFile);
            fileUrl = await getDownloadURL(fileRef);
        }
        
        // 2. Add Report to Firestore
        showSnackbar('Saving report...');
        const reportData = {
            senderId: _currentUser.uid,
            senderName: _userData.fullName || 'Provider',
            senderTitle: _userData.title || 'Specialist',
            senderImage: _userData.profileImage || '',
            receiverId: _selectedPatient.parentId,
            parentId: _selectedPatient.parentId,
            receiverName: _selectedPatient.name,
            type: type,
            serviceCategory: type,
            notes: notes,
            recommendations: recs,
            fileUrl: fileUrl,
            attachedFileName: _attachedFile ? _attachedFile.name : "",
            sharedWithProviderIds: Array.from(_selectedTeamIds),
            scheduledAt: _scheduledAt,
            createdAt: serverTimestamp()
        };
        
        const docRef = await addDoc(collection(db, "reports"), reportData);
        
        // 3. Batch Notifications to Parent & Care Team
        showSnackbar('Notifying recipients...');
        const batch = writeBatch(db);
        
        // Notify Parent
        const parentNotifRef = doc(collection(db, "notifications"));
        batch.set(parentNotifRef, {
            userId: _selectedPatient.parentId,
            title: "New Report Received &#128196;",
            body: `Dr. ${_userData.fullName} has shared a new ${type} report for ${_selectedPatient.name}.`,
            isRead: false,
            createdAt: serverTimestamp(),
            type: "report",
            reportId: docRef.id
        });
        
        // Notify Selected Care Team Members
        _selectedTeamIds.forEach(teamProviderId => {
            const teamNotifRef = doc(collection(db, "notifications"));
            batch.set(teamNotifRef, {
                userId: teamProviderId,
                title: "Team Report Shared &#128101;",
                body: `Dr. ${_userData.fullName} has shared a ${type} report regarding ${_selectedPatient.name}.`,
                isRead: false,
                createdAt: serverTimestamp(),
                type: "team_report",
                reportId: docRef.id
            });
        });
        
        await batch.commit();
        
        showSnackbar(`Report successfully ${_scheduledAt ? 'scheduled' : 'sent'}!`);
        resetReportForm();
        
    } catch(err) {
        console.error("Error submitting report:", err);
        showSnackbar("Failed to submit report.");
    } finally {
        btn.disabled = false;
        text.style.display = 'inline-block';
        loader.style.display = 'none';
    }
}

window.resetReportForm = function() {
    _selectedPatient = null;
    _selectedTeamIds.clear();
    _scheduledAt = null;
    
    // UI Resets
    const btn = document.getElementById('patientSelectorBtn');
    const text = document.getElementById('patientSelectorText');
    btn.style.borderColor = 'var(--border)';
    btn.style.background = '#fff';
    text.style.color = 'var(--text-muted)';
    text.style.fontWeight = '500';
    text.textContent = 'Tap to select a patient...';
    
    document.getElementById('reportNotes').value = '';
    document.getElementById('reportRecs').value = '';
    document.getElementById('notesCount').textContent = '0 / 1000';
    document.getElementById('recsCount').textContent = '0 / 1000';
    
    document.querySelector('input[name="reportType"][value="health"]').checked = true;
    document.querySelectorAll('.report-type-option').forEach(o => o.classList.remove('active'));
    document.getElementById('rtype-health').classList.add('active');
    
    removeFile();
    
    document.getElementById('careTeamBody').innerHTML = '<div class="care-team-empty" style="text-align:center; padding:20px;"><span>&#128272;</span><p style="color:var(--text-muted); font-size:0.9rem;">Select a patient to load their assigned care team members.</p></div>';
    
    document.getElementById('previewPatient').textContent = 'Not selected';
    document.getElementById('previewType').textContent = 'Health';
    document.getElementById('previewTeam').textContent = 'None selected';
    document.getElementById('previewSchedule').textContent = 'Send immediately';
    
    document.getElementById('scheduleDate').value = '';
    document.getElementById('scheduleTime').value = '';
}

// ── SIDEBAR TOGGLE ──
window.toggleSidebar = function() {
    document.getElementById('sidebar').classList.toggle('open');
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
