import { auth, db } from "./firebase-config.js?v=3";
import {
    doc, getDoc, collection, query, where,
    getDocs, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
    getStorage, ref as storageRef, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

// ── STATE ──────────────────────────────────────────────
let currentUser     = null;
let parentImageUrl  = "";   // Dart: _parentImageUrl
let childImageUrl   = "";   // Dart: _childImageUrl
let isUploadingImage = false; // Dart: _isUploadingImage
let isSaving        = false;  // Dart: _isSaving

const storage = getStorage();

// ── BOOT ───────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {

    // Auth guard
    auth.onAuthStateChanged(async (user) => {
        if (!user) { window.location.href = "login.html"; return; }
        currentUser = user;
        monitorNotifications(user.uid);
        await fetchUserData(user.uid);  // Dart: _fetchUserData()
    });

    // Back button
    document.getElementById("backBtn")?.addEventListener("click", () => history.back());

    // Parent photo — camera button triggers file input
    document.getElementById("parentCameraBtn")?.addEventListener("click", () => {
        if (!isUploadingImage) document.getElementById("parentFileInput")?.click();
    });
    document.getElementById("parentFileInput")?.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (file) pickAndUploadImage(file, true); // isParentImage = true
    });

    // Child photo
    document.getElementById("childCameraBtn")?.addEventListener("click", () => {
        if (!isUploadingImage) document.getElementById("childFileInput")?.click();
    });
    document.getElementById("childFileInput")?.addEventListener("change", (e) => {
        const file = e.target.files?.[0];
        if (file) pickAndUploadImage(file, false); // isParentImage = false
    });

    // Save button
    document.getElementById("saveBtn")?.addEventListener("click", () => {
        if (!isSaving) saveProfile(); // Dart: _saveProfile()
    });
});

// ── FETCH USER DATA ────────────────────────────────────
// Dart: _fetchUserData()
// Collection: users / doc: uid
// Fields: fullName, phone, childName, childAge, childNotes,
//         profileImage/parentImage, childImage
async function fetchUserData(uid) {
    try {
        const userSnap = await getDoc(doc(db, "users", uid));
        if (!userSnap.exists()) { window.location.href = "login.html"; return; }

        const data = userSnap.data();

        // Role guard — only parents
        if (data.role !== "parent") { window.location.href = "login.html"; return; }

        // Populate form fields — Dart: _parentNameController.text = data['fullName'] ?? ''
        setValue("fullNameInput",   data.fullName   || "");
        setValue("phoneInput",      data.phone      || "");
        setValue("childNameInput",  data.childName  || "");
        setValue("childAgeInput",   data.childAge   || "");
        setValue("childNotesInput", data.childNotes || "");

        // Dart: _parentImageUrl = data['profileImage'] ?? data['parentImage'] ?? ''
        parentImageUrl = data.profileImage || data.parentImage || "";
        // Dart: _childImageUrl = data['childImage'] ?? ''
        childImageUrl  = data.childImage  || "";

        // Update avatar previews
        if (parentImageUrl) setAvatar("parentAvatarImg", parentImageUrl);
        if (childImageUrl)  setAvatar("childAvatarImg",  childImageUrl);

    } catch (err) {
        console.error("fetchUserData error:", err);
        showToast("Failed to load profile.", "#EF4444");
    } finally {
        // Hide loading, show form — Dart: setState(() => _isLoading = false)
        document.getElementById("fullLoading")?.classList.add("hidden");
        document.getElementById("profileMain")?.classList.remove("hidden");
    }
}

// ── IMAGE UPLOAD ───────────────────────────────────────
// Dart: _pickAndUploadImage(bool isParentImage)
// Firebase Storage path: profile_images/parent_{uid}.jpg or child_{uid}.jpg
async function pickAndUploadImage(file, isParentImage) {
    if (!currentUser) return;
    isUploadingImage = true;

    // Show upload status — Dart: setState(() => _isUploadingImage = true)
    const statusId = isParentImage ? "parentUploadStatus" : "childUploadStatus";
    const btnId    = isParentImage ? "parentCameraBtn"    : "childCameraBtn";
    document.getElementById(statusId)?.classList.remove("hidden");
    const camBtn = document.getElementById(btnId);
    if (camBtn) camBtn.disabled = true;

    try {
        // Dart: fileName = isParentImage ? 'parent_$uid.jpg' : 'child_$uid.jpg'
        const fileName = isParentImage
            ? `parent_${currentUser.uid}.jpg`
            : `child_${currentUser.uid}.jpg`;

        // Dart: ref = FirebaseStorage.instance.ref().child('profile_images/$fileName')
        const imageRef = storageRef(storage, `profile_images/${fileName}`);

        // Dart: UploadTask → getDownloadURL
        const snapshot = await uploadBytes(imageRef, file);
        const downloadUrl = await getDownloadURL(snapshot.ref);

        // Dart: setState(() { if isParentImage → _parentImageUrl = url else _childImageUrl = url })
        if (isParentImage) {
            parentImageUrl = downloadUrl;
            setAvatar("parentAvatarImg", downloadUrl);
        } else {
            childImageUrl = downloadUrl;
            setAvatar("childAvatarImg", downloadUrl);
        }

        showToast("Image uploaded successfully! ✅", "#39CB69");

    } catch (err) {
        console.error("Image upload error:", err);
        showToast(`Error uploading image: ${err.message}`, "#EF4444");
    } finally {
        isUploadingImage = false;
        document.getElementById(statusId)?.classList.add("hidden");
        if (camBtn) camBtn.disabled = false;
    }
}

// ── SAVE PROFILE ───────────────────────────────────────
// Dart: _saveProfile()
// Uses WriteBatch:
//  1. users.doc(uid).update(...) — all profile fields
//  2. For each booking where parentId==uid → batch.update(parentName, parentPhone, parentImage, childImage)
//  3. batch.commit()
async function saveProfile() {
    if (!currentUser) return;
    isSaving = true;

    const saveBtn = document.getElementById("saveBtn");
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="material-symbols-outlined spin">autorenew</span> Saving...';
    }

    try {
        const uid = currentUser.uid;

        // Read form values
        const fullName   = getValue("fullNameInput");
        const phone      = getValue("phoneInput");
        const childName  = getValue("childNameInput");
        const childAge   = getValue("childAgeInput");
        const childNotes = getValue("childNotesInput");

        // Dart: WriteBatch batch = FirebaseFirestore.instance.batch()
        const batch = writeBatch(db);

        // Dart step 2: batch.update(userRef, { fullName, phone, childName, childAge, childNotes, profileImage, parentImage, childImage })
        const userRef = doc(db, "users", uid);
        batch.update(userRef, {
            fullName,
            phone,
            childName,
            childAge,
            childNotes,
            profileImage: parentImageUrl,
            parentImage:  parentImageUrl,   // Dart: both fields updated
            childImage:   childImageUrl,
        });

        // Dart step 3: query bookings where parentId==uid → batch.update each doc
        const bookingsSnap = await getDocs(
            query(collection(db, "bookings"), where("parentId", "==", uid))
        );

        bookingsSnap.docs.forEach(bookingDoc => {
            // Dart: batch.update(doc.reference, { parentName, parentPhone, parentImage, childImage })
            batch.update(bookingDoc.ref, {
                parentName:  fullName,
                parentPhone: phone,
                parentImage: parentImageUrl,
                childImage:  childImageUrl,
            });
        });

        // Dart step 4: batch.commit()
        await batch.commit();

        showToast("Profile updated successfully everywhere! ✅", "#39CB69");

    } catch (err) {
        console.error("saveProfile error:", err);
        showToast(`Error saving profile: ${err.message}`, "#EF4444");
    } finally {
        isSaving = false;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<span class="material-symbols-outlined">save</span> Save Profile Changes';
        }
    }
}

// ── NOTIFICATION BADGE ─────────────────────────────────
function monitorNotifications(uid) {
    const q = query(
        collection(db, "notifications"),
        where("userId", "==", uid),
        where("isRead", "==", false)
    );
    onSnapshot(q, (snap) => {
        const badge = document.getElementById("notifCount");
        if (!badge) return;
        const count = snap.docs.length;
        if (count > 0) { badge.textContent = count > 99 ? "99+" : count; badge.classList.remove("hidden"); }
        else badge.classList.add("hidden");
    });
}

// ── UTILITIES ──────────────────────────────────────────
function getValue(id) {
    return document.getElementById(id)?.value.trim() || "";
}
function setValue(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val;
}
function setAvatar(id, url) {
    const el = document.getElementById(id);
    if (el) { el.src = url; el.onerror = () => { el.src = "assets/images/app_logo.png"; }; }
}
function showToast(msg, color = "#0D524F") {
    const t = document.createElement("div");
    t.style.cssText = `position:fixed;bottom:30px;left:50%;transform:translateX(-50%);
        background:${color};color:white;padding:13px 26px;border-radius:30px;
        font-size:14px;font-weight:700;z-index:9999;box-shadow:0 8px 24px rgba(0,0,0,0.2);
        white-space:nowrap;`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}
