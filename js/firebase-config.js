// استيراد المكتبات من سيرفرات جوجل المباشرة
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

// مفاتيحك الصحيحة 100%
const firebaseConfig = {
  apiKey: "AIzaSyBrZWYiKmg-tS0tj1SdoUXUDx-bCvEtL-c",
  authDomain: "gleam-976ac.firebaseapp.com",
  projectId: "gleam-976ac",
  storageBucket: "gleam-976ac.firebasestorage.app",
  messagingSenderId: "922040201312",
  appId: "1:922040201312:web:e8b21feeda79dcf62b5305",
  measurementId: "G-RBHVFTWXJ1"
};

// تشغيل الفايربيز
const app = initializeApp(firebaseConfig);

// تصدير الأدوات عشان ملف التسجيل يقدر يستخدمهم
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

console.log("Firebase is ready! 🚀");
