window.onerror = function(msg, url, line) {
  alert("JS Error:\n" + msg + "\nLine: " + line);
  return true;
};

console.log("App starting...");
// ==================== FIREBASE CONFIG ====================
const firebaseConfig = {
    apiKey: "AIzaSyCmBNCZ7T3VUkerNH7xwuhJxNWRIOxQAy0",
    authDomain: "huntx-bd-app.firebaseapp.com",
    projectId: "huntx-bd-app",
    storageBucket: "huntx-bd-app.firebasestorage.app",
    messagingSenderId: "684817560300",
    appId: "1:684817560300:web:ec6c4e6debf8a49d782bc9",
    measurementId: "G-3YFGGCKZFM"
};

// Firebase init
let db = null;
let firebaseReady = false;

try {
    if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY") {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        firebaseReady = true;
        console.log("Firebase connected");
    } else {
        console.warn("Firebase config missing — using localStorage fallback (single device only)");
    }
} catch (e) {
    console.error("Firebase init error:", e);
}

// ==================== DATA LAYER (Cloud + local fallback) ====================
const CACHE = {
    users: [],
    matches: [],
    joins: [],
    transactions: [],
    matchResults: [],
    settings: null,
    categories: null,
    modeRules: null
};

const LocalDB = {
    get(key, def = null) {
        try {
            const val = localStorage.getItem('khelo_' + key);
            return val ? JSON.parse(val) : def;
        } catch { return def; }
    },
    set(key, val) {
        localStorage.setItem('khelo_' + key, JSON.stringify(val));
    }
};

// Generic helpers
async function cloudGetAll(collection) {
    if (!firebaseReady) return LocalDB.get(collection, []);
    const snap = await db.collection(collection).get();
    return snap.docs.map(d => ({ id: isNaN(d.id) ? d.id : (Number(d.id) || d.id), ...d.data(), _docId: d.id }));
}

async function cloudGetDoc(collection, id) {
    if (!firebaseReady) {
        const arr = LocalDB.get(collection, []);
        return arr.find(x => String(x.id) === String(id)) || null;
    }
    const docId = String(id);
    const snap = await db.collection(collection).doc(docId).get();
    if (!snap.exists) return null;
    return { id: isNaN(snap.id) ? snap.id : (Number(snap.id) || snap.id), ...snap.data(), _docId: snap.id };
}

async function cloudSet(collection, id, data) {
    const docId = String(id);
    const payload = { ...data };
    delete payload._docId;
    if (!firebaseReady) {
        let arr = LocalDB.get(collection, []);
        const idx = arr.findIndex(x => String(x.id) === docId);
        if (idx >= 0) arr[idx] = { ...arr[idx], ...payload, id: data.id ?? id };
        else arr.push({ ...payload, id: data.id ?? id });
        LocalDB.set(collection, arr);
        return;
    }
    await db.collection(collection).doc(docId).set(payload, { merge: true });
}

async function cloudDelete(collection, id) {
    const docId = String(id);
    if (!firebaseReady) {
        let arr = LocalDB.get(collection, []);
        arr = arr.filter(x => String(x.id) !== docId);
        LocalDB.set(collection, arr);
        return;
    }
    await db.collection(collection).doc(docId).delete();
}

async function cloudGetConfig(key, def = null) {
    if (!firebaseReady) return LocalDB.get(key, def);
    const snap = await db.collection('config').doc(key).get();
    if (!snap.exists) return def;
    return snap.data().value !== undefined ? snap.data().value : snap.data();
}

async function cloudSetConfig(key, value) {
    if (!firebaseReady) {
        LocalDB.set(key, value);
        return;
    }
    await db.collection('config').doc(key).set({ value });
}

// ==================== INIT DEFAULTS ====================
async function initDB() {
    // Settings
    let settings = await cloudGetConfig('settings', null);
    if (!settings) {
        settings = {
            supportTelegram: 'https://t.me/huntxbd',
            appName: 'HuntX BD',
            payments: {
                bKash: { number: '01700000000', type: 'Personal' },
                Nagad: { number: '01700000000', type: 'Personal' }
            },
            showJoinedPlayers: true,
            notice: '',
            popupNotice: '',
            referralMinDeposit: 100,
            referralBonus: 10
        };
        await cloudSetConfig('settings', settings);
    }
    if (!settings.payments) {
        settings.payments = {
            bKash: { number: '01700000000', type: 'Personal' },
            Nagad: { number: '01700000000', type: 'Personal' }
        };
    }
    CACHE.settings = settings;

    // Categories — only seed defaults on FIRST install (empty DB)
    // If admin deletes a mode, it must NOT come back automatically
    const DEFAULT_MODES = {
        'br-match': { title: 'BR MATCHES', name: 'BR Match', color: 'linear-gradient(135deg, #1a237e, #0d47a1)' },
        'br-survival': { title: 'BR SURVIVAL', name: 'BR Survival', color: 'linear-gradient(135deg, #e65100, #ff6f00)' },
        'clash-squad': { title: 'CLASH SQUAD', name: 'Clash Squad', color: 'linear-gradient(135deg, #4a148c, #7b1fa2)' },
        'cs-2vs2': { title: 'CS 2 VS 2', name: 'CS 2VS2', color: 'linear-gradient(135deg, #004d40, #00796b)' },
        'lone-wolf': { title: 'LONE WOLF', name: 'Lone Wolf', color: 'linear-gradient(135deg, #b71c1c, #d32f2f)' },
        'free-match': { title: 'FREE MATCH', name: 'Free Match', color: 'linear-gradient(135deg, #1b5e20, #388e3c)' }
    };
    let categories = await cloudGetConfig('categories', null);
    if (!categories || typeof categories !== 'object' || !Object.keys(categories).length) {
        categories = { ...DEFAULT_MODES };
        await cloudSetConfig('categories', categories);
    }
    CACHE.categories = categories;

    // Category display order — respect admin list; do not re-add deleted modes
    const defaultOrder = ['br-match', 'br-survival', 'clash-squad', 'cs-2vs2', 'lone-wolf', 'free-match'];
    let categoryOrder = await cloudGetConfig('categoryOrder', null);
    if (!Array.isArray(categoryOrder) || !categoryOrder.length) {
        categoryOrder = defaultOrder.filter(k => categories[k]);
        Object.keys(categories).forEach(k => {
            if (!categoryOrder.includes(k)) categoryOrder.push(k);
        });
        await cloudSetConfig('categoryOrder', categoryOrder);
    } else {
        // drop keys that no longer exist in categories
        categoryOrder = categoryOrder.filter(k => categories[k]);
        Object.keys(categories).forEach(k => {
            if (!categoryOrder.includes(k)) categoryOrder.push(k);
        });
        await cloudSetConfig('categoryOrder', categoryOrder);
    }
    CACHE.categoryOrder = categoryOrder;

    // Mode rules
    let modeRules = await cloudGetConfig('modeRules', null);
    if (!modeRules) {
        modeRules = {
            'br-match': '<p>BR Match এর নিয়মাবলী এখানে লিখুন। অ্যাডমিন প্যানেল থেকে এডিট করতে পারবেন।</p>',
            'br-survival': '<p>BR Survival এর নিয়মাবলী এখানে লিখুন।</p>',
            'clash-squad': '<p>Clash Squad এর নিয়মাবলী এখানে লিখুন।</p>',
            'cs-2vs2': '<p>CS 2VS2 এর নিয়মাবলী এখানে লিখুন।</p>',
            'lone-wolf': '<p>Lone Wolf এর নিয়মাবলী এখানে লিখুন।</p>',
            'free-match': '<p>Free Match এর নিয়মাবলী এখানে লিখুন।</p>'
        };
        await cloudSetConfig('modeRules', modeRules);
    }
    CACHE.modeRules = modeRules;

    // Ensure default admin exists
    const users = await cloudGetAll('users');
    CACHE.users = users;
    if (!users.find(u => u.username === 'admin')) {
        const adminUser = {
            id: 1,
            username: 'admin',
            password: 'admin123',
            phone: '01700000000',
            email: 'admin@huntxbd.com',
            nickname: 'Admin',
            photo: '',
            balance: 0,
            isAdmin: true,
            matchesJoined: 0,
            totalWins: 0,
            referralCode: 'ADMIN0001',
            referredBy: null,
            referralRewarded: false,
            banned: false,
            createdAt: new Date().toISOString()
        };
        await cloudSet('users', 1, adminUser);
        CACHE.users = [adminUser];
    }

    // Load other collections into cache (parallel = faster splash)
    const [matchesArr, joinsArr, txsArr, resultsArr] = await Promise.all([
        cloudGetAll('matches'),
        cloudGetAll('joins'),
        cloudGetAll('transactions'),
        cloudGetAll('matchResults')
    ]);
    CACHE.matches = matchesArr;
    CACHE.joins = dedupeById(joinsArr);
    CACHE.transactions = dedupeById(txsArr);
    CACHE.matchResults = dedupeById(resultsArr || []);

    // Real-time listeners — optimized for many concurrent users (less reads)
    if (firebaseReady) {
        const _debounce = (fn, ms) => {
            let t = null;
            return (...args) => {
                clearTimeout(t);
                t = setTimeout(() => fn(...args), ms);
            };
        };
        const refreshMatchUI = _debounce(() => {
            try {
                if (currentCategory) renderMatches(currentCategory);
                updateCategoryCounts();
            } catch (e) { console.error(e); }
        }, 280);

        db.collection('matches').onSnapshot(snap => {
            CACHE.matches = snap.docs.map(d => ({ id: isNaN(d.id) ? d.id : (Number(d.id) || d.id), ...d.data(), _docId: d.id }));
            refreshMatchUI();
        });
        db.collection('joins').onSnapshot(snap => {
            const joins = snap.docs.map(d => ({ id: isNaN(d.id) ? d.id : (Number(d.id) || d.id), ...d.data(), _docId: d.id }));
            const byId = dedupeById(joins);
            const seenUM = new Set();
            CACHE.joins = byId.filter(j => {
                const k = String(j.userId) + '_' + String(j.matchId);
                if (seenUM.has(k)) return false;
                seenUM.add(k);
                return true;
            });
            refreshMatchUI();
        });

        // IMPORTANT: do NOT listen to entire users collection (kills free tier at scale).
        // Only current user doc is watched after login via watchCurrentUser().
        // Admin loads full users list only when opening Users panel.

        db.collection('config').doc('settings').onSnapshot(snap => {
            if (snap.exists) {
                CACHE.settings = snap.data().value !== undefined ? snap.data().value : snap.data();
                renderHomeNotice();
            }
        });
        db.collection('config').doc('categories').onSnapshot(snap => {
            if (snap.exists) {
                const raw = snap.data().value !== undefined ? snap.data().value : snap.data();
                if (raw && typeof raw === 'object' && Object.keys(raw).length) {
                    CACHE.categories = raw;
                }
                renderPlayCategories();
            }
        });
        db.collection('config').doc('categoryOrder').onSnapshot(snap => {
            if (snap.exists) {
                const v = snap.data().value !== undefined ? snap.data().value : snap.data();
                if (Array.isArray(v)) {
                    CACHE.categoryOrder = v;
                    renderPlayCategories();
                }
            }
        });
        db.collection('config').doc('modeRules').onSnapshot(snap => {
            if (snap.exists) {
                CACHE.modeRules = snap.data().value !== undefined ? snap.data().value : snap.data();
            }
        });
        // transactions: no global listener — admin fetches on demand
        db.collection('matchResults').onSnapshot(snap => {
            CACHE.matchResults = dedupeById(snap.docs.map(d => ({ id: isNaN(d.id) ? d.id : (Number(d.id) || d.id), ...d.data(), _docId: d.id })));
            const rp = document.getElementById('results-page');
            if (rp && !rp.classList.contains('hidden')) loadResults();
        });
    }
}

// Watch only logged-in user document (balance updates without loading all users)
let _unsubCurrentUser = null;
function watchCurrentUser() {
    if (!firebaseReady || !currentUser) return;
    try { if (_unsubCurrentUser) _unsubCurrentUser(); } catch (e) {}
    const docId = String(currentUser._docId || currentUser.id);
    _unsubCurrentUser = db.collection('users').doc(docId).onSnapshot(snap => {
        if (!snap.exists) return;
        const fresh = { id: isNaN(snap.id) ? snap.id : (Number(snap.id) || snap.id), ...snap.data(), _docId: snap.id };
        currentUser = fresh;
        // keep CACHE.users entry in sync if present
        const idx = (CACHE.users || []).findIndex(u => String(u.id) === String(fresh.id));
        if (idx >= 0) CACHE.users[idx] = fresh;
        else {
            if (!CACHE.users) CACHE.users = [];
            CACHE.users.push(fresh);
        }
        try { updateProfileUI(); } catch (e) {}
    }, err => console.warn('user watch', err));
}

async function loadAllUsersForAdmin() {
    if (!currentUser?.isAdmin) return [];
    const list = await cloudGetAll('users');
    CACHE.users = list;
    return list;
}


// ==================== STATE ====================
let currentUser = null;
let currentCategory = null;
let currentMatchId = null;
let currentDepositMethod = 'bKash';

// ---- Anti-duplicate (requests / pending / notifications) ----
const _recentRequestKeys = new Map();
function claimRequest(key, windowMs = 3000) {
    const now = Date.now();
    // cleanup old
    for (const [k, t] of _recentRequestKeys) {
        if (now - t > 15000) _recentRequestKeys.delete(k);
    }
    const prev = _recentRequestKeys.get(key);
    if (prev && (now - prev) < windowMs) return false;
    _recentRequestKeys.set(key, now);
    return true;
}

function dedupeById(arr) {
    const seen = new Set();
    const out = [];
    for (const item of (arr || [])) {
        const id = String(item.id);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(item);
    }
    return out;
}

function cachePushUnique(listName, item) {
    if (!CACHE[listName]) CACHE[listName] = [];
    if ((CACHE[listName] || []).some(x => String(x.id) === String(item.id))) return false;
    if (listName === 'transactions') CACHE.transactions.unshift(item);
    else CACHE[listName].push(item);
    return true;
}

/** Admin textarea: show rules as editable plain lines (keep emojis & spacing) */
function rulesToEditable(html) {
    if (!html) return '';
    return String(html)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<p[^>]*>/gi, '')
        .replace(/<div[^>]*>/gi, '')
        .replace(/<\/div>/gi, '\n')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\n{3,}/g, '\n\n');
}

/** Display rules: preserve line breaks, emojis, and spacing exactly as typed */
function formatRulesHtml(raw) {
    if (!raw) return '';
    let s = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // Already full HTML with many tags — only fix bare newlines
    if (/<(p|div|ul|ol|li|h[1-6])\b/i.test(s)) {
        return s.replace(/\n/g, '<br>');
    }
    // Plain text / emoji lines → safe HTML with line breaks
    s = s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    // Keep multiple spaces
    s = s.replace(/  /g, ' &nbsp;');
    s = s.replace(/\n/g, '<br>');
    return s;
}

// ==================== UTILS ====================
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }


/** Open URL / Telegram — Chrome + AppGeyser Android WebView */
function openExternalLink(url) {
    if (!url) return;
    url = String(url).trim();
    if (!url) return;
    if (url.startsWith('t.me/')) url = 'https://' + url;
    if (url.startsWith('@')) url = 'https://t.me/' + url.slice(1);
    if (!/^https?:\/\//i.test(url) && !/^tg:/i.test(url) && !/^intent:/i.test(url)) {
        url = 'https://t.me/' + url.replace(/^\/+/, '');
    }

    var httpsUrl = url;
    var domain = null;
    var m = url.match(/t\.me\/([A-Za-z0-9_]+)/i);
    if (m) domain = m[1];

    // AppGeyser / Android WebView: Intent opens Telegram app (or Play Store / browser fallback)
    if (domain) {
        var intentUrl =
            'intent://resolve?domain=' + encodeURIComponent(domain) +
            '#Intent;scheme=tg;package=org.telegram.messenger;' +
            'S.browser_fallback_url=' + encodeURIComponent('https://t.me/' + domain) +
            ';end';
        try {
            // Primary: navigate via intent (WebView must allow external / intent)
            window.location.href = intentUrl;
            return;
        } catch (e0) {}
        try {
            var ai = document.createElement('a');
            ai.href = intentUrl;
            ai.style.display = 'none';
            document.body.appendChild(ai);
            ai.click();
            setTimeout(function () { try { ai.remove(); } catch (e) {} }, 800);
        } catch (e1) {}
        // tg:// deep link
        try { window.location.href = 'tg://resolve?domain=' + domain; } catch (e2) {}
    }

    // Fallback: https in new context
    try {
        var a = document.createElement('a');
        a.setAttribute('href', httpsUrl);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
        a.style.position = 'fixed';
        a.style.left = '-9999px';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { try { a.remove(); } catch (e) {} }, 1500);
    } catch (e3) {}
    try { window.open(httpsUrl, '_blank'); } catch (e4) {}
}

function getSupportTelegramUrl() {
    var settings = CACHE.settings || {};
    return (settings.supportTelegram || 'https://t.me/huntxbd').trim() || 'https://t.me/huntxbd';
}

function toast(msg, duration = 2500) {
    const text = String(msg || '');
    // Success popup ONLY inside Admin Panel
    const adminPage = document.getElementById('admin-page');
    const onAdmin = adminPage && !adminPage.classList.contains('hidden');
    const isSuccess = /saved|সফল|approved|যোগ হয়েছে|চেঞ্জ হয়েছে|uploaded|আপলোড|মুছে|deleted|Approve|সেভ|Success|success|কনফার্ম|Mode saved|স্লাইড|পাসওয়ার্ড/i.test(text);
    if (onAdmin && isSuccess) {
        showSuccessPopup(text, Math.max(duration, 1600));
        return;
    }
    const el = $('#toast');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), duration);
}

function showSuccessPopup(msg, duration = 1800) {
    let box = document.getElementById('success-popup');
    if (!box) {
        box = document.createElement('div');
        box.id = 'success-popup';
        box.className = 'success-popup';
        document.body.appendChild(box);
    }
    box.innerHTML = `
        <div class="success-popup-card">
            <div class="success-check"><i class="fas fa-check"></i></div>
            <p>${String(msg || 'সফল হয়েছে')}</p>
        </div>`;
    box.classList.add('show');
    clearTimeout(box._hideTimer);
    box._hideTimer = setTimeout(() => box.classList.remove('show'), duration);
}

function formatMoney(n) {
    return 'BDT ' + Number(n || 0).toLocaleString('en-BD');
}

function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString('en-BD', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: true
    });
}


/** Match time: shows EXACTLY the time the admin typed (same on every phone/PC).
 *  New matches store startLocal = "YYYY-MM-DDTHH:MM" (raw admin input).
 *  Old matches (no startLocal) fall back to Asia/Dhaka conversion. */
function formatMatchTime(m) {
    if (!m) return '';
    var raw = m.startLocal;
    if (raw && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
        var y = raw.slice(0, 4), mo = raw.slice(5, 7), d = raw.slice(8, 10);
        var h = parseInt(raw.slice(11, 13), 10), mi = raw.slice(14, 16);
