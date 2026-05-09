import { getFirestore, collection, getDocs, doc, getDoc, query, where, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

// -- PWA INSTALL PROMPT --
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const banner = document.getElementById('install-banner');
  if (banner) banner.style.display = 'flex';
});
document.getElementById('install-btn')?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  const banner = document.getElementById('install-banner');
  if (banner) banner.style.display = 'none';
});
document.getElementById('install-dismiss')?.addEventListener('click', () => {
  const banner = document.getElementById('install-banner');
  if (banner) banner.style.display = 'none';
});
window.addEventListener('appinstalled', () => {
  const banner = document.getElementById('install-banner');
  if (banner) banner.style.display = 'none';
  deferredInstallPrompt = null;
});

// -- SW UPDATE NOTIFICATION --
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.ready.then(reg => {
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      if (!newSW) return;
      newSW.addEventListener('statechange', () => {
        if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
          const banner = document.getElementById('update-banner');
          if (banner) banner.style.display = 'flex';
        }
      });
    });
  });
}

const firebaseConfig = {
  apiKey: "AIzaSyBCKEixrTah-fLAkflpb3aJJ6faU93gAiQ",
  authDomain: "donahack.firebaseapp.com",
  projectId: "donahack",
  storageBucket: "donahack.firebasestorage.app",
  messagingSenderId: "1004439535740",
  appId: "1:1004439535740:web:8a23ce54f2a1eec29549f9"
};

const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

// ── BOT CONFIG (update BOT_PHONE to match your WhatsApp Business number) ──────
const BOT_PHONE = '15551483471';
const WA_LINKS = {
  verify:     () => `https://wa.me/${BOT_PHONE}?text=${encodeURIComponent('verify')}`,
  loanMatch:  () => `https://wa.me/${BOT_PHONE}?text=${encodeURIComponent(t('loan_wa_msg'))}`,
  logSale:    () => `https://wa.me/${BOT_PHONE}?text=${encodeURIComponent('Hi BizBuddy! I want to log my first sale')}`,
  logExpense: () => `https://wa.me/${BOT_PHONE}?text=${encodeURIComponent('Hi BizBuddy! I want to log an expense')}`,
};

// ── CLIENT-SIDE PARSE HELPERS (mirror credit.js) ─────────────────────────────
function parseMonthlyRevenue(str) {
    if (!str) return 0;
    const s = String(str).toLowerCase().replace(/,/g, '');
    const rangeMatch = s.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
    if (rangeMatch) return (parseFloat(rangeMatch[1]) + parseFloat(rangeMatch[2])) / 2;
    const kMatch = s.match(/(\d+(?:\.\d+)?)k/);
    if (kMatch) return parseFloat(kMatch[1]) * 1000;
    const plain = s.match(/(\d+(?:\.\d+)?)/);
    return plain ? parseFloat(plain[1]) : 0;
}
function parseBizAgeMonths(str) {
    if (!str) return 0;
    const s = String(str).toLowerCase();
    const numMatch = s.match(/(\d+(?:\.\d+)?)/);
    const num = numMatch ? parseFloat(numMatch[1]) : 0;
    if (!num) return 0;
    if (s.includes('year') || s.includes('tahun')) return Math.round(num * 12);
    if (s.includes('month') || s.includes('bulan')) return Math.round(num);
    return Math.round(num * 12);
}

// -- XSS SANITIZATION --
function esc(str) {
  if (str === null || str === undefined) return '-';
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(String(str)));
  return d.innerHTML;
}

let currentView = 'mobile';
let currentUser = null;
let allUsers = [];
let salesChartInstance = null;
let _salesPage = 0;
let _recentPage = 0;
let _activeRecentTab = 'sales';
let _currentUserData = null;
let currentMobileExpenses = [];
const SALES_PER_PAGE = 6;
let portfolioChartInstance = null;
let revenueChartInstance = null;
let scoreHistoryChartInstance = null;
let sparklineChartInstance = null;
let allApplications = [];

// -- INIT --
function showLoginScreen() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}
setTimeout(showLoginScreen, 3000);
window.addEventListener('load', async () => {
  await new Promise(r => setTimeout(r, 800));
  showLoginScreen();
});

// -- PAGE DETECTION --
const IS_BANK_PAGE = window.__BANK_PAGE__ === true;

// -- LOGIN --
window.selectLoginView = (v) => {
  const tabMsme = document.getElementById('tab-msme');
  const tabBank = document.getElementById('tab-bank');
  if(tabMsme) tabMsme.classList.toggle('active', v==='msme');
  if(tabBank) tabBank.classList.toggle('active', v==='bank');
  const msmeSection = document.getElementById('msme-login-section');
  const bankSection = document.getElementById('bank-login-section');
  if(msmeSection) msmeSection.style.display = v==='msme'?'block':'none';
  if(bankSection) bankSection.style.display = v==='bank'?'block':'none';
};

// Bank page standalone login
window.handleBankLogin = async () => {
  const err = document.getElementById('login-error');
  if(err) err.style.display = 'none';
  const loginBtn = document.querySelector('.login-card .btn-primary');
  const code = document.getElementById('bank-code-input')?.value.trim();
  if (!code) {
    if(err){ err.textContent = 'Please enter access code'; err.style.display = 'block'; }
    return;
  }
  if(loginBtn){ loginBtn.classList.add('btn-loading'); loginBtn.textContent = 'Connecting...'; }
  try {
    const resp = await fetch('/api/bank-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_code: code }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      if(err){ err.textContent = data.error || 'Invalid access code'; err.style.display = 'block'; }
      if(loginBtn){ loginBtn.classList.remove('btn-loading'); loginBtn.textContent = 'Access Bank Portal ->'; }
      return;
    }
    sessionStorage.setItem('bank_api_key', data.bank_key);
    showApp('bank');
    loadBankView();
  } catch(e) {
    if(err){ err.textContent = 'Connection error. Please try again.'; err.style.display = 'block'; }
  }
  if(loginBtn){ loginBtn.classList.remove('btn-loading'); loginBtn.textContent = 'Access Bank Portal ->'; }
};

window.bankLogout = () => {
  sessionStorage.removeItem('bank_api_key');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  const inp = document.getElementById('bank-code-input');
  if(inp) inp.value = '';
};

window.handleLogin = async () => {
  const err = document.getElementById('login-error');
  if(err) err.style.display = 'none';
  const loginBtn = document.querySelector('.login-card .btn-primary');
  const tabMsme = document.getElementById('tab-msme');
  const isMsme = !tabMsme || tabMsme.classList.contains('active');

  // Loading state
  loginBtn.classList.add('btn-loading');
  loginBtn.textContent = 'Connecting...';

  if (isMsme) {
    const phone = document.getElementById('phone-input').value.trim().replace(/\s/g,'');
    if (!phone) { showError('Please enter your WhatsApp number'); loginBtn.classList.remove('btn-loading'); loginBtn.textContent='Access Dashboard ->'; return; }
    try {
      const userDoc = await getDoc(doc(db, 'users', phone));
      if (!userDoc.exists()) { showError('No account found. Please register via WhatsApp first.'); loginBtn.classList.remove('btn-loading'); loginBtn.textContent='Access Dashboard ->'; return; }
      currentUser = { ...userDoc.data(), phone };
      loginBtn.classList.remove('btn-loading'); loginBtn.textContent='Access Dashboard ->';
      showApp('mobile');
      loadMobileView(currentUser);
    } catch(e) { showError('Connection error. Please try again.'); loginBtn.classList.remove('btn-loading'); loginBtn.textContent='Access Dashboard ->'; }
  } else {
    const code = document.getElementById('bank-code-input').value.trim();
    try {
      const resp = await fetch('/api/bank-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: code }),
      });
      const data = await resp.json();
      if (!resp.ok) { showError(data.error || 'Invalid access code'); loginBtn.classList.remove('btn-loading'); loginBtn.textContent='Access Dashboard ->'; return; }
      sessionStorage.setItem('bank_api_key', data.bank_key);
    } catch(e) { showError('Connection error. Please try again.'); loginBtn.classList.remove('btn-loading'); loginBtn.textContent='Access Dashboard ->'; return; }
    loginBtn.classList.remove('btn-loading'); loginBtn.textContent='Access Dashboard ->';
    showApp('bank');
    loadBankView();
  }
};

function showError(msg) {
  const err = document.getElementById('login-error');
  err.textContent = msg;
  err.style.display = 'block';
}

function showApp(view) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  const viewToggle = document.getElementById('view-toggle');
  if(viewToggle) viewToggle.style.display = 'none';
  if (view === 'bank') {
    const dn = document.getElementById('drawer-user-name');
    const db2 = document.getElementById('drawer-user-biz');
    if(dn) dn.textContent = 'Bank Portal';
    if(db2) db2.textContent = 'Portfolio Management';
    switchView('desktop');
  } else {
    switchView('mobile');
  }
}

window.switchView = (v) => {
  currentView = v;
  document.getElementById('vt-mobile')?.classList.toggle('active', v==='mobile');
  document.getElementById('vt-desktop')?.classList.toggle('active', v==='desktop');
  const mv = document.getElementById('mobile-view');
  const dv = document.getElementById('desktop-view');
  if(mv) mv.style.display = v==='mobile'?'flex':'none';
  if(dv) dv.style.display = v==='desktop'?'block':'none';
};

window.logout = () => {
  currentUser = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  const phoneInp = document.getElementById('phone-input');
  if(phoneInp) phoneInp.value = '';
};

window.refreshData = async () => {
  // Show pull indicator as refreshing
  const pullEl = document.getElementById('pull-indicator');
  if(pullEl){pullEl.classList.add('visible','refreshing');}
  try {
    if (currentView === 'mobile' && currentUser) {
      const userDoc = await getDoc(doc(db, 'users', currentUser.phone));
      currentUser = { ...userDoc.data(), phone: currentUser.phone };
      loadMobileView(currentUser);
    } else {
      await loadBankView();
    }
    updateLastUpdated();
  } catch(e){console.error(e);}
  setTimeout(()=>{if(pullEl){pullEl.classList.remove('visible','refreshing');}},600);
};

// -- PULL TO REFRESH --
(function initPullToRefresh(){
  let startY=0, pulling=false;
  const mobileView = document.getElementById('mobile-view');
  document.addEventListener('touchstart',(e)=>{
    if(window.scrollY===0 && document.getElementById('app').style.display!=='none'){
      startY=e.touches[0].clientY; pulling=true;
    }
  },{passive:true});
  document.addEventListener('touchmove',(e)=>{
    if(!pulling)return;
    const dy=e.touches[0].clientY-startY;
    const pullEl=document.getElementById('pull-indicator');
    if(dy>40 && dy<160 && pullEl){
      pullEl.classList.add('visible');
      pullEl.querySelector('.pull-arrow').style.transform=dy>80?'rotate(180deg)':'';
    }
  },{passive:true});
  document.addEventListener('touchend',(e)=>{
    if(!pulling)return;
    pulling=false;
    const pullEl=document.getElementById('pull-indicator');
    if(pullEl && pullEl.classList.contains('visible')){
      window.refreshData();
    }
  },{passive:true});
})();

function updateLastUpdated() {
  const el = document.getElementById('last-updated');
  if (!el) return;
  const now = new Date();
  el.textContent = (currentLang === 'bm' ? 'Dikemaskini ' : 'Updated ') + now.toLocaleTimeString('en-MY', {hour:'2-digit',minute:'2-digit'});
}

// Auto-refresh removed - only refresh on login, manual refresh button, or pull-to-refresh

window.toggleTheme = () => {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('nc-theme', isLight ? 'light' : 'dark');
  updateThemeDrawer(isLight);
};
function updateThemeDrawer(isLight) {
  const di = document.getElementById('drawer-theme-icon');
  const dl = document.getElementById('drawer-theme-label');
  if(di) di.textContent = isLight ? '🌙' : '☀️';
  if(dl) dl.textContent = isLight ? t('switch_dark') : t('switch_light');
}
if (localStorage.getItem('nc-theme') === 'light') {
  document.body.classList.add('light-mode');
  document.addEventListener('DOMContentLoaded', () => {
    updateThemeDrawer(true);
  });
}
// Default dark mode drawer label on load
document.addEventListener('DOMContentLoaded', () => {
  if(!document.body.classList.contains('light-mode')) updateThemeDrawer(false);
});

// -- NAV DRAWER --
window.openDrawer = () => {
  document.getElementById('nav-drawer-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
};
window.closeDrawer = () => {
  document.getElementById('nav-drawer-overlay').classList.remove('open');
  document.body.style.overflow = '';
};

// -- MOBILE VIEW --
// -- ANIMATE COUNT --
function animateCount(id, from, to, duration, prefix, suffix) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = performance.now();
  function update(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(from + (to - from) * eased);
    el.textContent = prefix + current.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

async function loadMobileView(user) {
  document.getElementById('user-badge').textContent = user.owner_name || user.business_name || 'User';
  const dn = document.getElementById('drawer-user-name');
  const db2 = document.getElementById('drawer-user-biz');
  if(dn) dn.textContent = user.owner_name || 'User';
  if(db2) db2.textContent = user.business_name || '-';

  const sales = user.sales || [];
  const expenses = user.expenses || [];
  currentMobileExpenses = expenses;
  const total = sales.reduce((s,x) => s + (Number(x.amount)||0), 0);
  const count = sales.length;
  const totalExpenses = expenses.reduce((s,x) => s + (Number(x.amount)||0), 0);
  const netProfit = total - totalExpenses;
  const score = user.credit_score || 0;

  // Score arc - animated
  const arc = document.getElementById('score-arc');
  const circumference = 427.3; // 2 * π * 68 (160px SVG, r=68)
  const offset = circumference - (score/100) * circumference;
  arc.style.strokeDashoffset = circumference;
  document.getElementById('score-num').textContent = '0';
  setTimeout(() => {
    arc.style.strokeDashoffset = offset;
    if (score > 0) animateCount('score-num', 0, score, 1200, '', '');
    else document.getElementById('score-num').innerHTML = '<span style="font-size:20px;color:#5a6785">N/A</span>';
  }, 300);

  // Score color
  let scoreColor, badgeText;
  if (score >= 70) { scoreColor = '#06d6a0'; badgeText = t('loan_ready'); }
  else if (score >= 50) { scoreColor = '#ffd166'; badgeText = t('in_progress'); }
  else if (score > 0) { scoreColor = '#ff6b6b'; badgeText = t('building'); }
  else { scoreColor = '#5a6785'; badgeText = t('not_scored'); }
  arc.style.stroke = scoreColor;
  document.getElementById('score-badge').textContent = badgeText;
  document.getElementById('score-badge').style.color = scoreColor;
  document.getElementById('score-badge').style.borderColor = scoreColor + '40';
  document.getElementById('score-badge').style.background = scoreColor + '15';

  document.getElementById('user-name').textContent = user.owner_name || '-';
  document.getElementById('user-biz').textContent = user.business_name || '-';

  // Stats - animated counters
  const cur = getCur(user);
  if (total > 0) animateCount('stat-revenue', 0, total, 1000, cur, '');
  else document.getElementById('stat-revenue').textContent = cur + '0';
  if (count > 0) animateCount('stat-txn', 0, count, 800, '', '');
  else document.getElementById('stat-txn').textContent = '0';
  if (totalExpenses > 0) animateCount('stat-expenses', 0, totalExpenses, 900, cur, '');
  else document.getElementById('stat-expenses').textContent = cur + '0';
  const profitEl = document.getElementById('stat-profit');
  if (profitEl) {
    profitEl.classList.toggle('positive', netProfit >= 0);
    profitEl.classList.toggle('negative', netProfit < 0);
    profitEl.textContent = (netProfit < 0 ? '-' : '') + cur + Math.abs(netProfit).toLocaleString();
  }

  // Sync sections
  buildSalesChart(sales, null, expenses);
  buildScoreBreakdown(user, sales);
  buildGrowthTrends(sales, expenses);
  buildRoadmap(user, sales);
  _recentPage = 0;
  _activeRecentTab = 'sales';
  renderRecent(user, 'sales', 0);
  buildCertificate(user, score);
  buildScoreHistory(user);
  buildVerificationStatus(user);
  buildLoanAgentCTA(user);

  // Apply translations
  applyTranslations();

  // Async sections: load in parallel
  try {
    const [programs, apps] = await Promise.all([
      loadLoanPrograms(user),
      loadMyApplications(user.phone),
    ]);
    buildLoanCards(programs, user);
    buildApplicationsList(apps, cur);
  } catch(e) {
    console.error('[loadMobileView async]', e);
    const loanList = document.getElementById('loan-rec-list');
    if (loanList) loanList.innerHTML = '<div class="loan-empty">Could not load loan programs.</div>';
    const appList = document.getElementById('applications-list');
    if (appList) appList.innerHTML = '';
  }
}

let currentMobileSales = [];
let currentChartPeriod = '7d';

window.switchChartPeriod = (period, btn) => {
  currentChartPeriod = period;
  document.querySelectorAll('.chart-tab').forEach(t=>t.classList.remove('active'));
  if(btn) btn.classList.add('active');
  buildSalesChart(currentMobileSales, period, currentMobileExpenses);
};

function buildSalesChart(sales, period, expenses) {
  currentMobileSales = sales;
  if (expenses !== undefined) currentMobileExpenses = expenses;
  const exp = currentMobileExpenses || [];
  if(!period) period = currentChartPeriod;
  const ctx = document.getElementById('sales-chart').getContext('2d');
  if (salesChartInstance) salesChartInstance.destroy();

  let salesPoints = [];
  let expPoints = [];
  let labels = [];

  if (period === 'all' && sales.length > 0) {
    const salesMap = {};
    sales.forEach(s => { if(s.date) salesMap[s.date] = (salesMap[s.date]||0) + (s.amount||0); });
    const expMap = {};
    exp.forEach(e => { if(e.date) expMap[e.date] = (expMap[e.date]||0) + (e.amount||0); });
    const sortedDates = Object.keys(salesMap).sort().slice(-30);
    sortedDates.forEach(d => {
      labels.push(new Date(d+'T00:00:00').toLocaleDateString('en-MY',{month:'short',day:'numeric'}));
      salesPoints.push(salesMap[d] || 0);
      expPoints.push(expMap[d] || 0);
    });
    if(sortedDates.length === 0) { labels = ['No data']; salesPoints = [0]; expPoints = [0]; }
  } else {
    const days = period === '30d' ? 30 : 7;
    for (let i=days-1; i>=0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      labels.push(days <= 7
        ? d.toLocaleDateString('en-MY',{weekday:'short'})
        : d.toLocaleDateString('en-MY',{month:'short',day:'numeric'}));
      salesPoints.push(sales.filter(s=>s.date===dateStr).reduce((a,s)=>a+(s.amount||0),0));
      expPoints.push(exp.filter(e=>e.date===dateStr).reduce((a,e)=>a+(e.amount||0),0));
    }
  }

  const hasExpenses = expPoints.some(v => v > 0);
  salesChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: t('sales'),
          data: salesPoints,
          backgroundColor: salesPoints.map(v => v > 0 ? 'rgba(0,212,170,0.65)' : 'rgba(90,103,133,0.15)'),
          borderColor: salesPoints.map(v => v > 0 ? '#00d4aa' : 'transparent'),
          borderWidth: 1,
          borderRadius: 4,
        },
        ...(hasExpenses ? [{
          label: t('expenses'),
          data: expPoints,
          backgroundColor: expPoints.map(v => v > 0 ? 'rgba(255,107,107,0.55)' : 'rgba(90,103,133,0.08)'),
          borderColor: expPoints.map(v => v > 0 ? '#ff6b6b' : 'transparent'),
          borderWidth: 1,
          borderRadius: 4,
        }] : []),
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          display: hasExpenses,
          position: 'top',
          align: 'end',
          labels: { color: '#a0aec0', font: { size: 11 }, usePointStyle: true, boxWidth: 8, padding: 12 }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#5a6785', font: { size: 10 }, maxRotation:45, autoSkip:true, maxTicksLimit:10 } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5a6785', font: { size: 11 }, callback: v => (currentUser ? getCur(currentUser) : 'RM')+v } }
      }
    }
  });
}

function buildRoadmap(user, sales) {
  const items = [
    { done: !!(user.owner_name), label: t('profile_created'), desc: t('profile_desc') },
    { done: sales.length > 0, label: t('first_sale'), desc: t('first_sale_desc') },
    { done: sales.length >= 10, label: t('ten_txn'), desc: `${sales.length}/10 ${t('transactions').toLowerCase()}` },
    { done: !!(user.has_bank_account && user.has_bank_account.toLowerCase().includes('y')), label: t('bank_account'), desc: t('bank_desc') },
    { done: !!(user.has_ssm && user.has_ssm.toLowerCase().includes('y')), label: t('ssm_reg'), desc: t('ssm_desc') },
    { done: (user.credit_score||0) >= 60, label: t('score_60'), desc: `${t('credit_score_label')}: ${user.credit_score || '-'}` },
  ];

  const done = items.filter(i=>i.done).length;
  const pct = Math.round((done/items.length)*100);
  document.getElementById('roadmap-pct').textContent = pct + '%';
  document.getElementById('roadmap-bar').style.width = pct + '%';

  document.getElementById('roadmap-items').innerHTML = items.map(item => `
    <div class="roadmap-item">
      <div class="roadmap-check ${item.done ? 'check-done' : 'check-pending'}">${item.done ? '✓' : '○'}</div>
      <div class="roadmap-text">
        <strong style="color:${item.done ? 'var(--text)' : 'var(--muted)'}">${item.label}</strong>
        <span>${item.desc}</span>
      </div>
    </div>
  `).join('');
}

function renderRecent(userData, tab, page) {
  if (userData) _currentUserData = userData;
  else userData = _currentUserData;
  if (!userData) return;
  if (tab !== undefined) _activeRecentTab = tab;
  else tab = _activeRecentTab;
  if (page !== undefined) _recentPage = page;
  else page = _recentPage;

  const items = tab === 'expenses' ? (userData.expenses || []) : (userData.sales || []);
  const sorted = [...items].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const totalPages = Math.ceil(sorted.length / SALES_PER_PAGE);
  const pageItems = sorted.slice(page * SALES_PER_PAGE, (page + 1) * SALES_PER_PAGE);
  const cur = getCur(userData);
  const isExpense = tab === 'expenses';

  // Update tab buttons with counts
  document.querySelectorAll('#recent-tabs .recent-tab').forEach(btn => {
    const btnTab = btn.dataset.tab;
    const cnt = btnTab === 'expenses' ? (userData.expenses||[]).length : (userData.sales||[]).length;
    btn.textContent = t(btnTab === 'expenses' ? 'expenses_tab' : 'sales_tab') + ' (' + cnt + ')';
    btn.classList.toggle('active', btnTab === tab);
  });

  const listHtml = pageItems.length === 0
    ? `<div class="empty-hero">
        <div class="empty-hero-icon">${isExpense ? '💸' : '🚀'}</div>
        <h3>${t(isExpense ? 'no_expenses_title' : 'empty_title')}</h3>
        <p>${t(isExpense ? 'no_expenses_desc' : 'empty_desc')}</p>
        <a href="${isExpense ? WA_LINKS.logExpense() : WA_LINKS.logSale()}" target="_blank" class="empty-hero-cta">
          ${t(isExpense ? 'log_first_expense' : 'empty_cta')}
        </a>
      </div>`
    : `<div class="recent-sales-list">${pageItems.map(item => `
        <div class="sale-row">
          <div class="sale-row-left">
            <span class="sale-item-name">${esc(item.item || (isExpense ? 'Expense' : 'Sale'))}</span>
            <span class="sale-date">${esc(item.date || '')} ${item.source === 'screenshot' ? '📸' : '💬'}</span>
          </div>
          <span class="sale-amount ${isExpense ? 'expense' : 'sale'}">${isExpense ? '-' : ''}${cur}${(Number(item.amount) || 0).toLocaleString()}</span>
        </div>`).join('')}
      </div>`;

  const paginationHtml = totalPages > 1
    ? `<div class="sales-pagination">
        <button class="sales-page-btn" onclick="window.changeSalesPage(${page - 1})" ${page === 0 ? 'disabled' : ''}>${t('prev_page')}</button>
        <span class="sales-page-indicator">${page + 1} / ${totalPages}</span>
        <button class="sales-page-btn" onclick="window.changeSalesPage(${page + 1})" ${page >= totalPages - 1 ? 'disabled' : ''}>${t('next_page')}</button>
      </div>`
    : '';

  const container = document.getElementById('recent-sales-container');
  if (container) container.innerHTML = listHtml + paginationHtml;
}

window.switchRecentTab = function(tab) {
  _activeRecentTab = tab;
  _recentPage = 0;
  renderRecent(_currentUserData, tab, 0);
};

window.changeSalesPage = function(newPage) {
  _recentPage = newPage;
  renderRecent(_currentUserData, _activeRecentTab, _recentPage);
};

function buildCertificate(user, score) {
  document.getElementById('cert-score').textContent = score > 0 ? score + '/100' : '-';
  let stars = '-', status = t('cert_generate');
  if (score >= 85) { stars = '⭐⭐⭐⭐⭐'; status = '✅ ' + t('excellent'); }
  else if (score >= 70) { stars = '⭐⭐⭐⭐'; status = '✅ ' + t('good'); }
  else if (score >= 50) { stars = '⭐⭐⭐'; status = '🔄 ' + t('fair'); }
  else if (score > 0) { stars = '⭐⭐'; status = '📈 ' + t('needs_improvement'); }
  document.getElementById('cert-stars').textContent = stars;
  document.getElementById('cert-status').textContent = status;
  const date = user.score_date || new Date().toISOString().split('T')[0];
  const phone = user.phone || '0000';
  document.getElementById('cert-id').textContent = `NC-${phone.slice(-4)}-${date.replace(/-/g,'')}`;
}

// ==============================================
// -- BILINGUAL SYSTEM (EN / BM) --
// ==============================================
let currentLang = localStorage.getItem('nc-lang') || 'en';

// ASEAN Country Config - matches app.py COUNTRY_CONFIG
const COUNTRY_CONFIG = {
  MY: { currency: 'RM', registration: 'SSM', loan: 'TEKUN', flag: '🇲🇾', name: 'Malaysia' },
  ID: { currency: 'Rp', registration: 'NIB', loan: 'KUR', flag: '🇮🇩', name: 'Indonesia' },
  PH: { currency: '₱', registration: 'DTI', loan: 'SB Corp', flag: '🇵🇭', name: 'Philippines' },
};
function getUserCountry(user) { return COUNTRY_CONFIG[user?.country || 'MY'] || COUNTRY_CONFIG.MY; }
function getCur(user) { return getUserCountry(user).currency; }
function getReg(user) { return getUserCountry(user).registration; }

const translations = {
  en: {
    credit_readiness: 'Credit Readiness Score',
    total_revenue: 'Total Revenue',
    transactions: 'Transactions',
    avg_per_sale: 'Avg per Sale',
    best_sale: 'Best Sale',
    sales_activity: 'Sales Activity',
    loan_roadmap: 'Loan Readiness Roadmap',
    recent_sales: 'Recent Sales',
    credit_cert: '⭐ Credit Certificate',
    save_cert: '📥 Save Certificate as Image',
    score_breakdown: 'Score Breakdown',
    ai_scored: 'AI Scored',
    prequal_title: "You're Pre-Qualified!",
    prequal_desc: 'Your BizBuddy credit score meets the threshold for micro-loan assessment. Review your details and submit to a partner bank.',
    request_assessment: '📋 Request Loan Assessment',
    prequal_modal_title: 'Loan Pre-Qualification',
    prequal_modal_sub: 'Review your details before submitting to the bank',
    credit_score_label: 'Credit Score',
    verified_sales: 'Verified Sales',
    sharing_with_bank: "You'll be sharing:",
    pq_item1: 'Business name & owner name',
    pq_item2: 'Credit score & breakdown',
    pq_item3: 'Revenue history & verification rate',
    pq_item4: 'BizBuddy certificate ID',
    send_to_bank: 'Send to Partner Bank via WhatsApp',
    pq_note: 'Your data is protected under PDPA Malaysia. The bank will contact you within 2-3 business days.',
    share_score: 'Share Credit Score via WhatsApp',
    cert_generate: 'Generate credit score via WhatsApp to get your certificate',
    excellent: 'Excellent - Highly Loan Ready',
    good: 'Good - Loan Ready',
    fair: 'Fair - In Progress',
    needs_improvement: 'Needs Improvement',
    loan_ready: '✅ Loan Ready',
    in_progress: '🔄 In Progress',
    building: '📈 Building Profile',
    not_scored: '⏳ Not Yet Scored',
    vs_last_week: 'vs last week',
    no_change: 'No change',
    profile_created: 'Profile Created',
    profile_desc: 'Personal & business info registered',
    first_sale: 'First Sale Recorded',
    first_sale_desc: 'Start building your transaction history',
    ten_txn: '10+ Transactions',
    bank_account: 'Business Bank Account',
    bank_desc: 'Linked to credit profile',
    ssm_reg: 'SSM Registration',
    ssm_desc: 'Official business registration',
    score_60: 'Credit Score 60+',
    txn_consistency: 'Transaction Consistency',
    rev_volume: 'Revenue Volume',
    biz_registration: 'Business Registration',
    bank_linked: 'Bank Account Linked',
    txn_frequency: 'Transaction Frequency',
    biz_age: 'Business Age',
    expense_discipline: 'Expense Discipline',
    empty_title: "Let's get started!",
    empty_desc: 'Log your first sale via WhatsApp to see your dashboard come alive. Every transaction builds your credit history.',
    empty_cta: 'Log First Sale via WhatsApp',
    settings: 'Settings',
    refresh_data: 'Refresh Data',
    switch_light: 'Switch to Light',
    switch_dark: 'Switch to Dark',
    logout: 'Logout',
    lang_label: 'Bahasa Melayu',
    bank_dashboard: 'BizBuddy Bank Dashboard',
    export_report: 'Export Report',
    total_msmes: 'Total MSMEs',
    growing_portfolio: '^ Growing portfolio',
    loan_ready_70: 'Loan Ready (70+)',
    avg_credit_score: 'Avg Credit Score',
    portfolio_avg: 'Portfolio average',
    total_tracked_rev: 'Total Tracked Revenue',
    verified_txn: 'Verified transactions',
    msme_portfolio: 'MSME Portfolio',
    all_status: 'All Status',
    th_name: 'Name',
    th_business: 'Business',
    th_country: 'Country',
    th_product: 'Product',
    th_revenue: 'Revenue',
    th_score: 'Score',
    th_status: 'Status',
    score_dist: 'Score Distribution',
    portfolio_breakdown: 'Portfolio Breakdown',
    revenue_trends: 'Revenue Trends',
    loan_pipeline: 'Loan Pipeline',
    msme_map: 'MSME Distribution Map - ASEAN',
    legend_ready: 'Loan Ready (70+)',
    legend_progress: 'In Progress (50-69)',
    legend_building: 'Building (<50)',
    legend_unscored: 'Unscored',
    score_history: 'Score History',
    availableLoans: 'Available Loan Programs',
    verificationStatus: 'Verification Status',
    loanAgentTitle: 'Need a loan?',
    loanAgentDesc: 'Our AI agent matches you to the best-fit loan from 5+ partner banks in 2 minutes.',
    loanAgentBtn: 'Start Loan Match →',
    myApplications: 'My Applications',
    impact_metrics: 'Impact Metrics',
    impact_onboarded: 'MSMEs Onboarded',
    impact_total_txn: 'Total Transactions Tracked',
    impact_loan_eligible: 'Loan-Eligible MSMEs',
    impact_countries: 'ASEAN Countries Reached',
    impact_inclusion: 'Financial Inclusion Progress',
    impact_country_breakdown: 'Country Breakdown',
    // verification
    verified_label: '✅ Verified',
    unverified_label: '⚠️ Unverified',
    not_registered_label: '❌ Not registered',
    bank_account_label: 'Business Bank',
    verify_cta_msg: '💡 Send your {reg} cert or bank statement to BizBuddy to earn +20 score points.',
    open_wa: 'Open WhatsApp →',
    // loan cards
    no_loans_found: 'No loan programs found for your country.',
    eligible_count: '{n}/{total} eligible',
    apply_wa: 'Apply via WhatsApp →',
    to_unlock: 'To unlock:',
    loan_up_to: 'Up to',
    loan_rate: 'Rate',
    loan_eligible_badge: '✅ Eligible',
    loan_locked_badge: '🔒 Locked',
    gap_score_pts: '+{n} score pts',
    gap_monthly_rev: '+{n} monthly revenue',
    gap_months_op: '+{n} months operating',
    // applications
    no_apps: 'No applications yet.',
    start_loan_match: 'Start Loan Match',
    more_apps: 'Start more applications',
    find_loan: 'Find a Loan →',
    loan_wa_msg: 'I want a loan',
    // time ago
    time_just_now: 'just now',
    time_mins_ago: '{n}m ago',
    time_hours_ago: '{n}h ago',
    time_days_ago: '{n}d ago',
    // status labels
    status_pending_review: 'Under Review',
    status_approved: 'Approved',
    status_rejected: 'Not Approved',
    status_needs_info: 'More Info Needed',
    // recent sales pagination
    records_count: '{n} records',
    prev_page: '← Prev',
    next_page: 'Next →',
    // stats
    total_expenses: 'Total Expenses',
    net_profit: 'Net Profit',
    // recent activity tabs
    recent_activity: 'Recent Activity',
    sales_tab: 'Sales',
    expenses_tab: 'Expenses',
    no_expenses_title: 'No expenses yet',
    no_expenses_desc: 'Log your expenses on WhatsApp to track profit margin and improve your credit score.',
    log_first_expense: 'Log Expense via WhatsApp',
    no_sales_yet: 'No sales yet',
    // sales / expenses chart
    sales: 'Sales',
    expenses: 'Expenses',
    // score breakdown next action
    action_consistency: 'Log sales daily — consistency drives the biggest score gains.',
    action_revenue: 'Log all your sales (not just big ones) so revenue history reflects reality.',
    action_age: 'Keep using BizBuddy — your business age grows automatically over time.',
    action_formal: 'Send your SSM cert + bank statement on WhatsApp to verify and unlock +20 pts.',
    action_volume: 'Aim for 30+ recorded sales — more records strengthen your credit profile.',
    action_expenses: 'Start logging business expenses too — banks reward expense discipline.',
    next_best_action: 'Next best move',
    score_excellent: "Excellent score — you're fully loan-ready.",
  },
  bm: {
    credit_readiness: 'Skor Kesediaan Kredit',
    total_revenue: 'Jumlah Pendapatan',
    transactions: 'Transaksi',
    avg_per_sale: 'Purata Jualan',
    best_sale: 'Jualan Terbaik',
    sales_activity: 'Aktiviti Jualan',
    loan_roadmap: 'Peta Kesediaan Pinjaman',
    recent_sales: 'Jualan Terkini',
    credit_cert: '⭐ Sijil Kredit',
    save_cert: '📥 Simpan Sijil sebagai Imej',
    score_breakdown: 'Pecahan Skor',
    ai_scored: 'Skor AI',
    prequal_title: 'Anda Layak!',
    prequal_desc: 'Skor BizBuddy anda memenuhi syarat untuk penilaian pinjaman mikro. Semak butiran anda dan hantar kepada bank rakan kongsi.',
    request_assessment: '📋 Mohon Penilaian Pinjaman',
    prequal_modal_title: 'Pra-Kelayakan Pinjaman',
    prequal_modal_sub: 'Semak butiran anda sebelum menghantar kepada bank',
    credit_score_label: 'Skor Kredit',
    verified_sales: 'Jualan Disahkan',
    sharing_with_bank: 'Anda akan berkongsi:',
    pq_item1: 'Nama perniagaan & nama pemilik',
    pq_item2: 'Skor kredit & pecahan',
    pq_item3: 'Sejarah pendapatan & kadar pengesahan',
    pq_item4: 'ID sijil BizBuddy',
    send_to_bank: 'Hantar kepada Bank via WhatsApp',
    pq_note: 'Data anda dilindungi di bawah PDPA Malaysia. Bank akan menghubungi anda dalam 2-3 hari bekerja.',
    share_score: 'Kongsi Skor Kredit via WhatsApp',
    cert_generate: 'Jana skor kredit melalui WhatsApp untuk mendapatkan sijil anda',
    excellent: 'Cemerlang - Sangat Layak Pinjaman',
    good: 'Baik - Layak Pinjaman',
    fair: 'Sederhana - Dalam Proses',
    needs_improvement: 'Perlu Peningkatan',
    loan_ready: '✅ Layak Pinjaman',
    in_progress: '🔄 Dalam Proses',
    building: '📈 Membina Profil',
    not_scored: '⏳ Belum Dinilai',
    vs_last_week: 'vs minggu lepas',
    no_change: 'Tiada perubahan',
    profile_created: 'Profil Dicipta',
    profile_desc: 'Maklumat peribadi & perniagaan didaftarkan',
    first_sale: 'Jualan Pertama Direkod',
    first_sale_desc: 'Mula membina sejarah transaksi anda',
    ten_txn: '10+ Transaksi',
    bank_account: 'Akaun Bank Perniagaan',
    bank_desc: 'Disambung ke profil kredit',
    ssm_reg: 'Pendaftaran SSM',
    ssm_desc: 'Pendaftaran perniagaan rasmi',
    score_60: 'Skor Kredit 60+',
    txn_consistency: 'Konsistensi Transaksi',
    rev_volume: 'Jumlah Pendapatan',
    biz_registration: 'Pendaftaran Perniagaan',
    bank_linked: 'Akaun Bank Disambung',
    txn_frequency: 'Kekerapan Transaksi',
    biz_age: 'Usia Perniagaan',
    expense_discipline: 'Disiplin Perbelanjaan',
    empty_title: 'Jom mula!',
    empty_desc: 'Rekod jualan pertama anda melalui WhatsApp untuk melihat papan pemuka anda. Setiap transaksi membina sejarah kredit anda.',
    empty_cta: 'Rekod Jualan Pertama via WhatsApp',
    settings: 'Tetapan',
    refresh_data: 'Muat Semula Data',
    switch_light: 'Tukar ke Cerah',
    switch_dark: 'Tukar ke Gelap',
    logout: 'Log Keluar',
    lang_label: 'English',
    bank_dashboard: 'Papan Pemuka Bank BizBuddy',
    export_report: 'Eksport Laporan',
    total_msmes: 'Jumlah MSME',
    growing_portfolio: '^ Portfolio berkembang',
    loan_ready_70: 'Layak Pinjaman (70+)',
    avg_credit_score: 'Purata Skor Kredit',
    portfolio_avg: 'Purata portfolio',
    total_tracked_rev: 'Jumlah Hasil Direkod',
    verified_txn: 'Transaksi disahkan',
    msme_portfolio: 'Portfolio MSME',
    all_status: 'Semua Status',
    th_name: 'Nama',
    th_business: 'Perniagaan',
    th_country: 'Negara',
    th_product: 'Produk',
    th_revenue: 'Hasil',
    th_score: 'Skor',
    th_status: 'Status',
    score_dist: 'Taburan Skor',
    portfolio_breakdown: 'Pecahan Portfolio',
    revenue_trends: 'Trend Hasil',
    loan_pipeline: 'Saluran Pinjaman',
    msme_map: 'Peta Taburan MSME - ASEAN',
    legend_ready: 'Layak Pinjaman (70+)',
    legend_progress: 'Dalam Proses (50-69)',
    legend_building: 'Membina (<50)',
    legend_unscored: 'Belum Dinilai',
    score_history: 'Sejarah Skor',
    availableLoans: 'Program Pinjaman',
    verificationStatus: 'Status Pengesahan',
    loanAgentTitle: 'Perlu pinjaman?',
    loanAgentDesc: 'Agen AI kami padankan awak ke pinjaman terbaik dari 5+ bank rakan dalam 2 minit.',
    loanAgentBtn: 'Mula Padanan Pinjaman →',
    myApplications: 'Permohonan Saya',
    impact_metrics: 'Metrik Impak',
    impact_onboarded: 'MSME Didaftarkan',
    impact_total_txn: 'Jumlah Transaksi Direkod',
    impact_loan_eligible: 'MSME Layak Pinjaman',
    impact_countries: 'Negara ASEAN Dicapai',
    impact_inclusion: 'Kemajuan Rangkuman Kewangan',
    impact_country_breakdown: 'Pecahan Negara',
    // verification
    verified_label: '✅ Disahkan',
    unverified_label: '⚠️ Belum Disahkan',
    not_registered_label: '❌ Belum Daftar',
    bank_account_label: 'Akaun Bank',
    verify_cta_msg: '💡 Hantar sijil {reg} atau penyata bank ke BizBuddy untuk dapat +20 mata skor.',
    open_wa: 'Buka WhatsApp →',
    // loan cards
    no_loans_found: 'Tiada program pinjaman dijumpai.',
    eligible_count: '{n}/{total} layak',
    apply_wa: 'Mohon via WhatsApp →',
    to_unlock: 'Untuk buka:',
    loan_up_to: 'Sehingga',
    loan_rate: 'Kadar',
    loan_eligible_badge: '✅ Layak',
    loan_locked_badge: '🔒 Terkunci',
    gap_score_pts: '+{n} mata skor',
    gap_monthly_rev: '+{n} hasil bulanan',
    gap_months_op: '+{n} bulan beroperasi',
    // applications
    no_apps: 'Tiada permohonan lagi.',
    start_loan_match: 'Mula Padanan Pinjaman',
    more_apps: 'Mulakan lebih banyak permohonan',
    find_loan: 'Cari Pinjaman →',
    loan_wa_msg: 'Saya nak pinjaman',
    // time ago
    time_just_now: 'baru sahaja',
    time_mins_ago: '{n}m lalu',
    time_hours_ago: '{n}j lalu',
    time_days_ago: '{n}h lalu',
    // status labels
    status_pending_review: 'Dalam Semakan',
    status_approved: 'Diluluskan',
    status_rejected: 'Tidak Diluluskan',
    status_needs_info: 'Perlu Maklumat',
    // recent sales pagination
    records_count: '{n} rekod',
    prev_page: '← Sebelum',
    next_page: 'Seterus →',
    // stats
    total_expenses: 'Jumlah Belanja',
    net_profit: 'Keuntungan Bersih',
    // recent activity tabs
    recent_activity: 'Aktiviti Terkini',
    sales_tab: 'Jualan',
    expenses_tab: 'Belanja',
    no_expenses_title: 'Belum ada belanja',
    no_expenses_desc: 'Rekod belanja perniagaan di WhatsApp untuk jejak margin keuntungan dan tingkatkan skor kredit.',
    log_first_expense: 'Rekod Belanja via WhatsApp',
    no_sales_yet: 'Belum ada jualan',
    // sales / expenses chart
    sales: 'Jualan',
    expenses: 'Belanja',
    // score breakdown next action
    action_consistency: 'Rekod jualan setiap hari — konsistensi naikkan skor paling banyak.',
    action_revenue: 'Rekod semua jualan (bukan yang besar saja) supaya sejarah hasil betul-betul terkesan.',
    action_age: 'Terus guna BizBuddy — umur perniagaan akan naik secara automatik.',
    action_formal: 'Hantar sijil SSM + penyata bank ke WhatsApp untuk sahkan dan dapat +20 mata.',
    action_volume: 'Sasarkan 30+ rekod jualan — lebih banyak rekod kuatkan profil kredit.',
    action_expenses: 'Mula rekod belanja perniagaan juga — bank hargai disiplin kewangan.',
    next_best_action: 'Langkah seterusnya',
    score_excellent: 'Skor cemerlang — awak sedia sepenuhnya untuk pinjaman.',
  }
};

function t(key, vars = {}) {
  let str = (translations[currentLang] && translations[currentLang][key]) || translations.en[key] || key;
  Object.entries(vars).forEach(([k, v]) => { str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v); });
  return str;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (val) el.textContent = val;
  });
  // Update drawer labels
  const dl = document.getElementById('drawer-lang-label');
  if(dl) dl.textContent = t('lang_label');
  const settingsH = document.querySelector('.nav-drawer-header h3');
  if(settingsH) settingsH.textContent = t('settings');
  // Update drawer items text
  const refreshBtn = document.querySelector('.drawer-item:nth-child(2)');
  // Re-apply theme label
  updateThemeDrawer(document.body.classList.contains('light-mode'));
}

window.toggleLang = () => {
  currentLang = currentLang === 'en' ? 'bm' : 'en';
  localStorage.setItem('nc-lang', currentLang);
  applyTranslations();
  updateLastUpdated();
  // Update drawer language button label
  const langLabel = document.getElementById('drawer-lang-label');
  if (langLabel) langLabel.textContent = currentLang === 'en' ? 'Bahasa Melayu' : 'English';
  // Update bank portal badge
  if (document.getElementById('desktop-view').style.display !== 'none') {
    document.getElementById('user-badge').textContent = currentLang === 'bm' ? 'Portal Bank' : 'Bank Portal';
  }
  // Re-render dynamic content if user is loaded
  if (currentUser) {
    loadMobileView(currentUser).catch(console.error);
  }
  // Re-render bank view if visible
  if (allUsers.length > 0 && document.getElementById('desktop-view').style.display !== 'none') {
    renderBankView(allUsers);
  }
};

// Apply on load
document.addEventListener('DOMContentLoaded', () => {
  if (currentLang !== 'en') applyTranslations();
});

// ==============================================
// -- SCORE BREAKDOWN --
// ==============================================
function buildScoreBreakdown(user, sales) {
  const score = user.credit_score || 0;
  const container = document.getElementById('breakdown-rows');
  const card = document.getElementById('score-breakdown-card');
  if (!container || !card) return;

  if (score === 0) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';

  const bd = user.score_breakdown || {};
  const count = sales.length;
  const total = sales.reduce((s,x) => s + (x.amount||0), 0);
  const hasSSM = !!(user.has_ssm && user.has_ssm.toLowerCase().includes('y'));
  const hasBank = !!(user.has_bank_account && user.has_bank_account.toLowerCase().includes('y'));
  const cc = getUserCountry(user);

  // Use REAL stored breakdown from backend (calculate_credit_score in app.py)
  const factors = [
    {
      icon: '📊', key: 'txn_consistency', max: 25,
      value: bd.consistency || 0,
      color: '#00d4aa',
      sub: count >= 10 ? count + ' transactions ✓' : count + '/10 ' + t('transactions').toLowerCase()
    },
    {
      icon: '💰', key: 'rev_volume', max: 20,
      value: bd.revenue || 0,
      color: '#6c63ff',
      sub: getCur(user) + total.toLocaleString()
    },
    {
      icon: '📅', key: 'biz_age', max: 15,
      value: bd.age || 0,
      color: '#a29bfe',
      sub: user.biz_age || (user.score_date ? 'Since ' + user.score_date : '-')
    },
    {
      icon: '📋', key: 'biz_registration', max: 20,
      value: bd.formalization || 0,
      color: '#ffd166',
      sub: (hasSSM ? cc.registration + ' ✓' : cc.registration + ' pending') + ' · ' + (hasBank ? t('bank_account') + ' ✓' : 'No bank')
    },
    {
      icon: '🔢', key: 'txn_frequency', max: 10,
      value: bd.volume || 0,
      color: '#ff9f43',
      sub: count + ' records'
    },
    {
      icon: '💸', key: 'expense_discipline', max: 10,
      value: bd.expenses || 0,
      color: '#06d6a0',
      sub: (user.expenses || []).length + ' expense records'
    },
  ];

  // Find weakest factor by % of max
  let weakest = null;
  let weakestPct = 101;
  for (const f of factors) {
    const pct = f.max > 0 ? (f.value / f.max) * 100 : 0;
    if (pct < weakestPct) { weakestPct = pct; weakest = f; }
  }

  const actionKeys = {
    txn_consistency:  'action_consistency',
    rev_volume:       'action_revenue',
    biz_age:          'action_age',
    biz_registration: 'action_formal',
    txn_frequency:    'action_volume',
    expense_discipline: 'action_expenses',
  };

  const ctaHtml = (weakest && score < 80)
    ? `<div class="next-action"><div class="next-action-label">⚡ ${t('next_best_action')}</div><div class="next-action-text">${t(actionKeys[weakest.key] || weakest.key)}</div></div>`
    : `<div class="next-action excellent">🎉 ${t('score_excellent')}</div>`;

  container.innerHTML = factors.map(f => {
    const pct = f.max > 0 ? Math.round((f.value / f.max) * 100) : 0;
    return `
    <div class="breakdown-row">
      <div class="breakdown-icon">${f.icon}</div>
      <div class="breakdown-info">
        <div class="breakdown-label">${t(f.key)}</div>
        <div class="breakdown-sublabel">${esc(f.sub)}</div>
        <div class="breakdown-bar-bg">
          <div class="breakdown-bar-fill" style="width:0%;background:${f.color};" data-target="${pct}"></div>
        </div>
      </div>
      <div style="text-align:right;">
        <div class="breakdown-value" style="color:${f.color};">${f.value}/${f.max}</div>
      </div>
    </div>`;
  }).join('') + ctaHtml;

  // Animate bars
  setTimeout(() => {
    container.querySelectorAll('.breakdown-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.target + '%';
    });
  }, 200);
}

// ==============================================
// -- LOAN CTA + PRE-QUAL MODAL --
// ==============================================
// ==============================================
// -- VERIFICATION STATUS --
// ==============================================
function buildVerificationStatus(user) {
    const grid = document.getElementById('verification-grid');
    const ctaEl = document.getElementById('verify-cta');
    if (!grid) return;
    const cc = getUserCountry(user);
    const ssmRaw = String(user.has_ssm || '').toLowerCase();
    const bankRaw = String(user.has_bank_account || '').toLowerCase();
    const ssmYes = ssmRaw.startsWith('y') || ssmRaw.startsWith('a') || ssmRaw === 'ada';
    const bankYes = bankRaw.startsWith('y') || bankRaw.startsWith('a') || bankRaw === 'ada';

    function verifyStatus(hasDoc, isVerified) {
        if (isVerified) return { cls: 'verified', label: t('verified_label') };
        if (hasDoc) return { cls: 'unverified', label: t('unverified_label') };
        return { cls: 'missing', label: t('not_registered_label') };
    }
    const ssmSt = verifyStatus(ssmYes, !!user.ssm_verified);
    const bankSt = verifyStatus(bankYes, !!user.bank_verified);

    grid.innerHTML = `
        <div class="verify-item ${ssmSt.cls}">
            <div class="verify-icon">📋</div>
            <div class="verify-content">
                <div class="verify-label">${esc(cc.registration)}</div>
                <div class="verify-status">${ssmSt.label}</div>
            </div>
        </div>
        <div class="verify-item ${bankSt.cls}">
            <div class="verify-icon">🏦</div>
            <div class="verify-content">
                <div class="verify-label">${t('bank_account_label')}</div>
                <div class="verify-status">${bankSt.label}</div>
            </div>
        </div>`;

    if (ctaEl) {
        if (!user.ssm_verified || !user.bank_verified) {
            const msg = t('verify_cta_msg', { reg: cc.registration });
            ctaEl.innerHTML = `${msg} <a href="${WA_LINKS.verify()}" class="btn-link">${t('open_wa')}</a>`;
            ctaEl.style.display = 'block';
        } else {
            ctaEl.style.display = 'none';
        }
    }
}

// ==============================================
// -- LOAN AGENT CTA BANNER --
// ==============================================
function buildLoanAgentCTA(user) {
    const btn = document.getElementById('loan-agent-compact-btn');
    if (!btn) return;
    btn.href = WA_LINKS.loanMatch();
}

// ==============================================
// -- LOAN PROGRAMS (Firestore) --
// ==============================================
async function loadLoanPrograms(userData) {
    const country = userData.country || 'MY';
    const score = userData.credit_score || 0;
    const monthlyRev = parseMonthlyRevenue(userData.monthly_revenue);
    const bizAgeMonths = parseBizAgeMonths(userData.biz_age);

    const snap = await getDocs(
        query(
            collection(db, 'loan_products'),
            where('active', '==', true),
            where('countries', 'array-contains', country)
        )
    );

    const products = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    return products.map(p => {
        const eligible =
            score >= (p.min_credit_score || 0) &&
            monthlyRev >= (p.min_monthly_revenue || 0) &&
            bizAgeMonths >= (p.min_business_age_months || 0);
        const gapData = [];
        if (score < (p.min_credit_score || 0))
            gapData.push({ key: 'gap_score_pts', n: p.min_credit_score - score });
        if (monthlyRev < (p.min_monthly_revenue || 0))
            gapData.push({ key: 'gap_monthly_rev', n: (p.min_monthly_revenue - monthlyRev).toLocaleString() });
        if (bizAgeMonths < (p.min_business_age_months || 0))
            gapData.push({ key: 'gap_months_op', n: p.min_business_age_months - bizAgeMonths });
        return { ...p, eligible, gapData };
    }).sort((a, b) => {
        if (a.eligible && !b.eligible) return -1;
        if (!a.eligible && b.eligible) return 1;
        return (a.min_credit_score || 0) - (b.min_credit_score || 0);
    });
}

function buildLoanCards(products, user) {
    const list = document.getElementById('loan-rec-list');
    const badge = document.getElementById('loan-rec-badge');
    const cc = getUserCountry(user);
    const cur = cc.currency;
    if (!list) return;

    if (products.length === 0) {
        list.innerHTML = `<div class="loan-empty">${t('no_loans_found')}</div>`;
        if (badge) badge.textContent = '0';
        return;
    }

    const eligible = products.filter(p => p.eligible).length;
    if (badge) badge.textContent = t('eligible_count', { n: eligible, total: products.length });

    list.innerHTML = products.map(p => {
        const maxAmt = p.max_amount ? `${cur}${Number(p.max_amount).toLocaleString()}` : '-';
        const rate = p.interest_rate != null ? `${p.interest_rate}%` : '-';
        return `
        <div class="loan-card ${p.eligible ? 'eligible' : 'locked'}">
            <div class="loan-card-header">
                <div class="loan-card-bank">${esc(p.bank_name || '-')}</div>
                ${p.eligible
                    ? `<span class="loan-badge eligible">${t('loan_eligible_badge')}</span>`
                    : `<span class="loan-badge locked">${t('loan_locked_badge')}</span>`}
            </div>
            <div class="loan-card-product">${esc(p.product_name || '-')}</div>
            <div class="loan-card-stats">
                <div class="loan-stat">
                    <div class="loan-stat-label">${t('loan_up_to')}</div>
                    <div class="loan-stat-value">${maxAmt}</div>
                </div>
                <div class="loan-stat">
                    <div class="loan-stat-label">${t('loan_rate')}</div>
                    <div class="loan-stat-value">${rate}</div>
                </div>
            </div>
            ${p.eligible
                ? `<a href="https://wa.me/${BOT_PHONE}?text=${encodeURIComponent('5')}" class="loan-card-cta">${t('apply_wa')}</a>`
                : `<div class="loan-card-gaps">
                       <div class="loan-gaps-label">${t('to_unlock')}</div>
                       <ul>${p.gapData.map(g => `<li>${esc(t(g.key, { n: g.n }))}</li>`).join('')}</ul>
                   </div>`}
        </div>`;
    }).join('');
}

// ==============================================
// -- MY LOAN APPLICATIONS --
// ==============================================
async function loadMyApplications(phone) {
    if (!phone) return [];
    const snap = await getDocs(
        query(
            collection(db, 'loan_applications'),
            where('user_id', '==', phone),
            limit(10)
        )
    );
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
            const aT = a.submitted_at?.toMillis?.() || 0;
            const bT = b.submitted_at?.toMillis?.() || 0;
            return bT - aT;
        });
}

function statusEmoji(s) {
    return ({ pending_review: '⏳', approved: '✅', rejected: '❌', needs_info: '📝' })[s] || '⏳';
}
function statusLabel(s) {
    const keyMap = { pending_review: 'status_pending_review', approved: 'status_approved', rejected: 'status_rejected', needs_info: 'status_needs_info' };
    return t(keyMap[s] || 'status_pending_review');
}
function formatTimeAgo(ts) {
    if (!ts) return '-';
    const ms = ts?.toMillis?.() || (typeof ts === 'number' ? ts : Date.parse(ts));
    if (!ms) return '-';
    const diff = Math.floor((Date.now() - ms) / 1000);
    if (diff < 60) return t('time_just_now');
    if (diff < 3600) return t('time_mins_ago', { n: Math.floor(diff/60) });
    if (diff < 86400) return t('time_hours_ago', { n: Math.floor(diff/3600) });
    return t('time_days_ago', { n: Math.floor(diff/86400) });
}

function formatDate(ts) {
    if (!ts) return '-';
    const ms = ts?.toMillis?.() || (typeof ts === 'number' ? ts : Date.parse(ts));
    if (!ms) return '-';
    return new Date(ms).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}
function scoreTier(score) {
    if (score >= 80) return { label: 'Excellent', color: '#06d6a0' };
    if (score >= 70) return { label: 'Good', color: '#00d4aa' };
    if (score >= 50) return { label: 'Fair', color: '#ffd166' };
    if (score > 0)   return { label: 'Building', color: '#ff6b6b' };
    return { label: 'N/A', color: '#5a6785' };
}
function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function showToast(msg, type = 'success') {
    let toast = document.getElementById('bb-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'bb-toast';
        toast.className = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = `toast ${type}`;
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    setTimeout(() => toast.classList.remove('show'), 3000);
}

function buildApplicationsList(apps, cur) {
    const list = document.getElementById('applications-list');
    const badge = document.getElementById('applications-badge');
    if (!list) return;
    if (badge) badge.textContent = apps.length;

    if (apps.length === 0) {
        list.innerHTML = `
            <div class="app-empty">
                <div class="app-empty-icon">🚀</div>
                <p>${t('no_apps')}</p>
                <a href="${WA_LINKS.loanMatch()}" class="btn-primary-sm">${t('start_loan_match')}</a>
            </div>`;
        return;
    }

    const rowsHtml = apps.map(app => {
        const status = app.status || 'pending_review';
        const emoji = statusEmoji(status);
        const label = statusLabel(status);
        const amt = app.amount ? `${cur}${Number(app.amount).toLocaleString()}` : '-';
        return `
            <div class="app-row ${status}">
                <div class="app-row-main">
                    <div class="app-bank">${esc(app.bank_name || '-')}</div>
                    <div class="app-amount">${amt}</div>
                </div>
                <div class="app-row-meta">
                    <span class="app-status ${status}">${emoji} ${label}</span>
                    <span class="app-date">${formatTimeAgo(app.submitted_at)}</span>
                </div>
                <div class="app-ref">Ref: ${esc(app.id)}</div>
            </div>`;
    }).join('');

    const fillCta = apps.length < 3 ? `
        <div class="apps-fill-cta">
            <div class="apps-fill-inner">
                <div class="apps-fill-icon">🚀</div>
                <p>${t('more_apps')}</p>
                <a href="${WA_LINKS.loanMatch()}" class="apps-fill-btn">${t('find_loan')}</a>
            </div>
        </div>` : '';

    list.innerHTML = `<div class="apps-list">${rowsHtml}${fillCta}</div>`;
}

// ==============================================
// -- GROWTH / TREND INDICATORS --
// ==============================================
function buildGrowthTrends(sales, expenses) {
  const exp = expenses || [];
  const now = new Date();

  function weekFilter(items, weekOffset) {
    return items.filter(x => {
      if (!x.date) return false;
      const diff = (now - new Date(x.date + 'T00:00:00')) / (1000*60*60*24);
      return diff >= weekOffset * 7 && diff < (weekOffset + 1) * 7;
    });
  }

  const thisWeekSales = weekFilter(sales, 0);
  const lastWeekSales = weekFilter(sales, 1);
  const thisWeekExp   = weekFilter(exp, 0);
  const lastWeekExp   = weekFilter(exp, 1);

  const thisRev = thisWeekSales.reduce((a,x) => a + (x.amount||0), 0);
  const lastRev = lastWeekSales.reduce((a,x) => a + (x.amount||0), 0);
  const thisTxn = thisWeekSales.length;
  const lastTxn = lastWeekSales.length;
  const thisExpTotal = thisWeekExp.reduce((a,x) => a + (x.amount||0), 0);
  const lastExpTotal = lastWeekExp.reduce((a,x) => a + (x.amount||0), 0);
  const thisProfit = thisRev - thisExpTotal;
  const lastProfit = lastRev - lastExpTotal;

  function trendHTML(current, previous) {
    if (previous === 0 && current === 0) return `<span class="trend-neutral">${t('no_change')}</span>`;
    if (previous === 0 && current > 0) return `<span class="trend-up">^ ${t('vs_last_week')}</span>`;
    const pct = Math.round(((current - previous) / previous) * 100);
    if (pct > 0) return `<span class="trend-up">^ ${pct}% ${t('vs_last_week')}</span>`;
    if (pct < 0) return `<span class="trend-down">↓ ${Math.abs(pct)}% ${t('vs_last_week')}</span>`;
    return `<span class="trend-neutral">${t('no_change')}</span>`;
  }

  const tRev = document.getElementById('trend-revenue');
  const tTxn = document.getElementById('trend-txn');
  const tExp = document.getElementById('trend-expenses');
  const tPrf = document.getElementById('trend-profit');

  if (tRev) tRev.innerHTML = trendHTML(thisRev, lastRev);
  if (tTxn) tTxn.innerHTML = trendHTML(thisTxn, lastTxn);
  if (tExp) tExp.innerHTML = trendHTML(thisExpTotal, lastExpTotal);
  if (tPrf) tPrf.innerHTML = trendHTML(thisProfit, lastProfit);
}

// ==============================================
// -- SCORE HISTORY (MSME Mobile View) --
// ==============================================
function buildScoreHistory(user) {
  const card = document.getElementById('score-history-card');
  const badge = document.getElementById('score-history-badge');
  if (!card) return;

  const history = user.score_history || [];
  const currentScore = user.credit_score || 0;
  const currentDate = user.score_date || '';

  // Build data: combine history + current score
  let dataPoints = [];
  history.forEach(h => {
    dataPoints.push({ date: h.date, score: h.score });
  });
  // Add current score if not already the last entry
  if (currentScore > 0 && currentDate) {
    const lastEntry = dataPoints[dataPoints.length - 1];
    if (!lastEntry || lastEntry.date !== currentDate || lastEntry.score !== currentScore) {
      dataPoints.push({ date: currentDate, score: currentScore });
    }
  }

  // Need at least 2 data points to show chart
  if (dataPoints.length < 2) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';

  // Calculate change
  const first = dataPoints[0].score;
  const last = dataPoints[dataPoints.length - 1].score;
  const change = last - first;
  if (change > 0) {
    badge.textContent = '^ +' + change + ' pts';
    badge.style.color = 'var(--green)';
  } else if (change < 0) {
    badge.textContent = '↓ ' + change + ' pts';
    badge.style.color = 'var(--warn)';
  } else {
    badge.textContent = '-> ' + t('no_change');
    badge.style.color = 'var(--muted)';
  }

  const ctx = document.getElementById('score-history-chart').getContext('2d');
  if (scoreHistoryChartInstance) scoreHistoryChartInstance.destroy();

  const labels = dataPoints.map(d => {
    const dt = new Date(d.date + 'T00:00:00');
    return dt.toLocaleDateString('en-MY', { month: 'short', day: 'numeric' });
  });
  const scores = dataPoints.map(d => d.score);

  scoreHistoryChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: scores,
        borderColor: '#6c63ff',
        backgroundColor: 'rgba(108,99,255,0.08)',
        borderWidth: 2.5,
        pointBackgroundColor: scores.map((s,i) => i === scores.length - 1 ? '#6c63ff' : 'rgba(108,99,255,0.5)'),
        pointRadius: scores.map((s,i) => i === scores.length - 1 ? 6 : 4),
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        fill: true,
        tension: 0.35,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ctx.parsed.y + '/100'
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#5a6785', font: { size: 10 } } },
        y: {
          min: Math.max(0, Math.min(...scores) - 10),
          max: Math.min(100, Math.max(...scores) + 10),
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#5a6785', font: { size: 11 }, stepSize: 10 }
        }
      }
    }
  });
}

// ==============================================
// -- IMPACT METRICS (Bank Desktop View) --
// ==============================================
function buildImpactMetrics(users) {
  const card = document.getElementById('impact-metrics-card');
  if (!card) return;

  const totalOnboarded = users.length;
  const totalTxn = users.reduce((s, u) => s + (u.sales || []).length + (u.expenses || []).length, 0);
  const loanEligible = users.filter(u => (u.credit_score || 0) >= 60).length;
  const countries = new Set(users.map(u => u.country || 'MY'));

  animateCount('impact-onboarded', 0, totalOnboarded, 800, '', '');
  animateCount('impact-txn-total', 0, totalTxn, 1000, '', '');
  animateCount('impact-referrals', 0, loanEligible, 900, '', '');
  animateCount('impact-countries', 0, countries.size, 600, '', '');

  // Financial Inclusion Progress bars
  const scored = users.filter(u => (u.credit_score || 0) > 0).length;
  const banked = users.filter(u => u.has_bank_account && u.has_bank_account.toLowerCase().startsWith('y')).length;
  const registered = users.filter(u => u.has_ssm && u.has_ssm.toLowerCase().startsWith('y')).length;
  const withExpenses = users.filter(u => (u.expenses || []).length > 0).length;

  const inclusionBars = document.getElementById('impact-inclusion-bars');
  if (inclusionBars) {
    const metrics = [
      { label: currentLang === 'bm' ? 'Dinilai kredit' : 'Credit Scored', count: scored, color: '#06d6a0' },
      { label: currentLang === 'bm' ? 'Ada akaun bank' : 'Banked', count: banked, color: '#6c63ff' },
      { label: currentLang === 'bm' ? 'Berdaftar rasmi' : 'Formally Registered', count: registered, color: '#ffd166' },
      { label: currentLang === 'bm' ? 'Rekod perbelanjaan' : 'Tracking Expenses', count: withExpenses, color: '#ff9f43' },
    ];
    inclusionBars.innerHTML = metrics.map(m => {
      const pct = totalOnboarded > 0 ? Math.round((m.count / totalOnboarded) * 100) : 0;
      return `<div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
          <span style="font-size:12px;color:var(--text);">${m.label}</span>
          <span style="font-size:12px;font-weight:700;color:${m.color};">${m.count}/${totalOnboarded} (${pct}%)</span>
        </div>
        <div style="height:6px;background:var(--surface);border-radius:100px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${m.color};border-radius:100px;transition:width 1s ease;"></div>
        </div>
      </div>`;
    }).join('');
  }

  // Country Breakdown
  const countryList = document.getElementById('impact-country-list');
  if (countryList) {
    const countryData = {};
    users.forEach(u => {
      const code = u.country || 'MY';
      if (!countryData[code]) countryData[code] = { count: 0, sales: 0, loanReady: 0, states: new Set() };
      countryData[code].count++;
      countryData[code].sales += (u.sales || []).reduce((a, x) => a + (x.amount || 0), 0);
      if ((u.credit_score || 0) >= 70) countryData[code].loanReady++;
      if (u.user_state) countryData[code].states.add(u.user_state);
    });
    countryList.innerHTML = Object.entries(countryData).map(([code, data]) => {
      const cc = COUNTRY_CONFIG[code] || COUNTRY_CONFIG.MY;
      return `<div style="background:var(--surface);border-radius:10px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:16px;display:inline;">${cc.flag}</div>
          <span style="font-size:13px;font-weight:600;margin-left:6px;">${cc.name}</span>
          <div style="font-size:11px;color:var(--muted);margin-top:2px;">${data.count} MSMEs · ${data.states.size} ${currentLang === 'bm' ? 'negeri' : 'states'}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:var(--green);">${data.loanReady} ✅</div>
          <div style="font-size:10px;color:var(--muted);">${currentLang === 'bm' ? 'layak pinjaman' : 'loan ready'}</div>
        </div>
      </div>`;
    }).join('');
  }
}

// -- BANK VIEW --
async function loadBankView() {
  document.getElementById('user-badge').textContent = currentLang === 'bm' ? 'Portal Bank' : 'Bank Portal';
  const tbody = document.getElementById('msme-table-body');
  if(tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#5a6785;padding:32px;"><div class="loader-ring" style="margin:0 auto 12px;width:28px;height:28px;border-width:2px;"></div>Loading portfolio data...</td></tr>';
  try {
    const [usersSnap, appsSnap] = await Promise.all([
      getDocs(collection(db, 'users')),
      getDocs(collection(db, 'loan_applications')),
    ]);
    allUsers = [];
    usersSnap.forEach(d => allUsers.push({ ...d.data(), phone: d.id }));
    allApplications = [];
    appsSnap.forEach(d => allApplications.push({ id: d.id, ...d.data() }));
    allApplications.sort((a, b) => (b.submitted_at?.toMillis?.() || 0) - (a.submitted_at?.toMillis?.() || 0));
    renderBankView(allUsers);
    renderLoanApplications(allApplications);
    updateLastUpdated();
  } catch(e) {
    console.error(e);
    if(tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#ff6b6b;padding:32px;">Failed to load data. Please try again.</td></tr>';
  }
}


// Currency conversion rates (approximate, for display purposes)
const EXCHANGE_RATES = {
  RM: { RM: 1, Rp: 3500, '₱': 13 },
  Rp: { RM: 1/3500, Rp: 1, '₱': 1/270 },
  '₱': { RM: 1/13, Rp: 270, '₱': 1 },
};
let displayCurrency = 'RM';

window.setRevCurrency = (cur) => {
  displayCurrency = cur;
  document.querySelectorAll('.rev-cur-btn').forEach(b => {
    if (b.dataset.cur === cur) {
      b.style.background = 'var(--accent)';
      b.style.color = '#000';
      b.classList.add('rev-cur-active');
    } else {
      b.style.background = 'transparent';
      b.style.color = 'var(--muted)';
      b.classList.remove('rev-cur-active');
    }
  });
  if (allUsers.length > 0) renderBankView(allUsers);
};

function convertToDisplayCurrency(amount, fromCurrency) {
  const from = fromCurrency || 'RM';
  const rate = EXCHANGE_RATES[from]?.[displayCurrency] || 1;
  return Math.round(amount * rate);
}

function renderBankView(users) {
  const total = users.length;
  const loanReady = users.filter(u => (u.credit_score||0) >= 70).length;
  const scores = users.map(u => u.credit_score||0).filter(s => s > 0);
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0;

  // Convert all revenue to display currency
  const totalRev = users.reduce((s,u) => {
    const userCur = getCur(u);
    const rev = (u.sales||[]).reduce((a,x)=>a+(x.amount||0),0);
    return s + convertToDisplayCurrency(rev, userCur);
  }, 0);

  animateCount('d-total-msme', 0, total, 800, '', '');
  animateCount('d-loan-ready', 0, loanReady, 900, '', '');
  document.getElementById('d-loan-pct').textContent = total > 0 ? Math.round(loanReady/total*100) + (currentLang === 'bm' ? '% portfolio' : '% of portfolio') : '-';
  if (avgScore) animateCount('d-avg-score', 0, avgScore, 1000, '', '');
  else document.getElementById('d-avg-score').textContent = '-';
  // Auto-size font for revenue to prevent overflow
  const revEl = document.getElementById('d-total-rev');
  const revStr = displayCurrency + totalRev.toLocaleString();
  if (revStr.length > 14) revEl.style.fontSize = '18px';
  else if (revStr.length > 10) revEl.style.fontSize = '22px';
  else revEl.style.fontSize = '';
  animateCount('d-total-rev', 0, totalRev, 1000, displayCurrency, '');

  // Table
  const tbody = document.getElementById('msme-table-body');
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#5a6785;padding:32px;">' + (currentLang === 'bm' ? 'Tiada MSME berdaftar lagi' : 'No MSMEs registered yet') + '</td></tr>';
  } else {
    const avatarColors = ['#00d4aa','#6c63ff','#ff6b6b','#ffd166','#06d6a0','#ff9f43','#a29bfe','#fd79a8','#00b894','#e17055'];
    tbody.innerHTML = users.map((u, idx) => {
      const uSales = u.sales || [];
      const uRev = uSales.reduce((a,x)=>a+(x.amount||0),0);
      const score = u.credit_score || 0;
      let scoreCls = score >= 70 ? 'score-high' : score >= 50 ? 'score-mid' : 'score-low';
      let statusTxt, statusCls;
      if (score >= 70) { statusTxt = t('loan_ready'); statusCls = 'status-ready'; }
      else if (score >= 50) { statusTxt = t('in_progress'); statusCls = 'status-progress'; }
      else { statusTxt = t('building'); statusCls = 'status-building'; }
      const initial = esc((u.owner_name||'?')[0].toUpperCase());
      const color = avatarColors[idx % avatarColors.length];
      const cc = getUserCountry(u);
      return `<tr style="cursor:pointer;" onclick="openModal('${esc(u.phone)}')" data-name="${esc((u.owner_name||'').toLowerCase())}" data-biz="${esc((u.business_name||'').toLowerCase())}" data-status="${statusCls}">
        <td><div style="display:flex;align-items:center;gap:10px;"><div class="avatar" style="background:${color};">${initial}</div><strong>${esc(u.owner_name)}</strong></div></td>
        <td>${esc(u.business_name)}</td>
        <td><span style="font-size:14px;">${cc.flag}</span> ${esc(cc.name)}</td>
        <td>${esc(u.product)}</td>
        <td>${getCur(u)}${uRev.toLocaleString()}</td>
        <td><span class="score-pill ${scoreCls}">${score||'N/A'}</span></td>
        <td><span class="status-pill ${statusCls}">${statusTxt}</span></td>
      </tr>`;
    }).join('');
  }

  // Apply pagination after table render
  currentPage = 1;
  renderTablePage();

  // Score distribution
  const ranges = [
    { label: '80-100', min:80, max:100, color:'#06d6a0' },
    { label: '60-79',  min:60, max:79,  color:'#00d4aa' },
    { label: '40-59',  min:40, max:59,  color:'#ffd166' },
    { label: '20-39',  min:20, max:39,  color:'#ff9f43' },
    { label: '0-19',   min:0,  max:19,  color:'#ff6b6b' },
  ];
  const maxCount = Math.max(...ranges.map(r => scores.filter(s=>s>=r.min&&s<=r.max).length), 1);
  document.getElementById('dist-bars').innerHTML = ranges.map(r => {
    const cnt = scores.filter(s=>s>=r.min&&s<=r.max).length;
    const w = Math.round(cnt/maxCount*100);
    return `<div class="dist-row">
      <div class="dist-label">${r.label}</div>
      <div class="dist-bar-bg"><div class="dist-bar-fill" style="width:${w}%;background:${r.color}"></div></div>
      <div class="dist-count">${cnt}</div>
    </div>`;
  }).join('');

  // Portfolio pie
  const pCtx = document.getElementById('portfolio-chart').getContext('2d');
  if (portfolioChartInstance) portfolioChartInstance.destroy();
  const rCounts = [
    scores.filter(s=>s>=70).length,
    scores.filter(s=>s>=50&&s<70).length,
    scores.filter(s=>s>0&&s<50).length,
    users.filter(u=>!u.credit_score).length,
  ];
  portfolioChartInstance = new Chart(pCtx, {
    type: 'doughnut',
    data: {
      labels: ['Loan Ready', 'In Progress', 'Building', 'Unscored'],
      datasets: [{ data: rCounts, backgroundColor: ['#06d6a0','#ffd166','#ff6b6b','#2a3248'], borderWidth: 0 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#5a6785', font: { size: 11 }, padding: 12 } }
      },
      cutout: '65%'
    }
  });

  // Revenue chart - convert each user's sales to displayCurrency
  const rCtx = document.getElementById('revenue-chart').getContext('2d');
  if (revenueChartInstance) revenueChartInstance.destroy();
  const last7 = [];
  const rLabels = [];
  for (let i=6; i>=0; i--) {
    const d = new Date(); d.setDate(d.getDate()-i);
    const ds = d.toISOString().split('T')[0];
    rLabels.push(d.toLocaleDateString('en-MY',{weekday:'short'}));
    // Sum each user's daily sales converted to display currency
    let dayTotal = 0;
    users.forEach(u => {
      const userCur = getCur(u);
      const daySales = (u.sales||[]).filter(s=>s.date===ds).reduce((a,s)=>a+(s.amount||0),0);
      dayTotal += convertToDisplayCurrency(daySales, userCur);
    });
    last7.push(dayTotal);
  }
  revenueChartInstance = new Chart(rCtx, {
    type: 'line',
    data: {
      labels: rLabels,
      datasets: [{
        data: last7,
        borderColor: '#00d4aa',
        backgroundColor: 'rgba(0,212,170,0.08)',
        borderWidth: 2,
        pointBackgroundColor: '#00d4aa',
        pointRadius: 4,
        fill: true,
        tension: 0.4,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#5a6785', font: { size: 11 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5a6785', font: { size: 11 }, callback: v => displayCurrency + v.toLocaleString() } }
      }
    }
  });

  // Draw Malaysia map
  setTimeout(() => drawMalaysiaMap(users), 100);
  // Impact Metrics
  buildImpactMetrics(users);
}

// -- LOAN APPLICATIONS PIPELINE --
function renderLoanApplications(apps) {
  const avatarColors = ['#00d4aa','#6c63ff','#ff6b6b','#ffd166','#06d6a0','#ff9f43','#a29bfe','#fd79a8','#00b894','#e17055'];
  const pipeline = document.getElementById('loan-pipeline');
  if (!pipeline) return;
  if (apps.length === 0) {
    pipeline.innerHTML = '<div class="empty-state"><div>📋</div><p>No loan applications submitted yet.</p></div>';
    return;
  }
  pipeline.innerHTML = apps.map((app, idx) => {
    const rawStatus = app.status || 'pending_review';
    const statusCls = rawStatus === 'pending_review' ? 'status-pending' : `status-${rawStatus}`;
    const statusText = { pending_review:'⏳ Pending', approved:'✅ Approved', rejected:'❌ Rejected', needs_info:'📝 More Info' }[rawStatus] || '⏳ Pending';
    const color = avatarColors[idx % avatarColors.length];
    const ini = initials(app.user_name || '?');
    const amt = app.amount ? `RM ${Number(app.amount).toLocaleString()}` : '-';
    const score = app.provisional_score;
    const tier = (typeof score === 'number') ? scoreTier(score) : { color: '#5a6785' };
    return `<div class="app-pipeline-row" onclick="openApplicationReview('${esc(app.id)}')">
      <div class="app-pipeline-avatar" style="background:${color};">${ini}</div>
      <div class="app-pipeline-info">
        <div class="app-pipeline-name">${esc(app.user_name||'Unknown')}</div>
        <div class="app-pipeline-sub">${esc(app.product_name||'Loan')} · ${esc(app.bank_name||'-')}</div>
        <div class="app-pipeline-sub">${formatDate(app.submitted_at)}</div>
      </div>
      <div class="app-pipeline-right">
        <div class="app-pipeline-amount">${amt}</div>
        <div style="font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:${tier.color};margin:2px 0;">${score != null ? score : '-'}</div>
        <div class="status-pill ${statusCls}" style="font-size:10px;padding:2px 8px;display:inline-block;margin-top:2px;">${statusText}</div>
      </div>
    </div>`;
  }).join('');
}

window.openApplicationReview = (appId) => {
  const app = allApplications.find(a => a.id === appId);
  if (!app) return;
  const content = document.getElementById('review-modal-content');
  if (!content) return;
  const score = app.provisional_score || 0;
  const tier = scoreTier(score);
  const currentStatus = app.status || 'pending_review';
  const isPending = currentStatus === 'pending_review';
  const factorLabelMap = {
    consistency:'Transaction Consistency', revenue:'Revenue Strength',
    age:'Business Age', formalization:'Formalization',
    volume:'Record Volume', expenses:'Expense Discipline',
  };
  const factorMaxMap = { consistency:25, revenue:20, age:15, formalization:20, volume:10, expenses:10 };
  const bd = app.score_breakdown && typeof app.score_breakdown === 'object' ? app.score_breakdown : {};
  const hasBd = Object.keys(bd).length > 0;
  const reasoningHtml = hasBd
    ? Object.entries(bd).map(([key, val]) => {
        const maxScore = factorMaxMap[key] || 20;
        const pct = Math.round((val / maxScore) * 100);
        const barColor = pct >= 70 ? '#06d6a0' : pct >= 40 ? '#ffd166' : '#ff6b6b';
        return `<div class="review-factor">
          <div class="review-factor-label">${factorLabelMap[key]||key}</div>
          <div class="review-factor-bar-bg"><div class="review-factor-fill" style="width:${pct}%;background:${barColor};"></div></div>
          <div class="review-factor-score" style="color:${barColor};">${val}/${maxScore}</div>
        </div>`;
      }).join('')
    : `<div style="color:var(--muted);font-size:12px;">${app.score_reasoning || 'No score breakdown available.'}</div>`;
  const docsHtml = (app.documents||[]).length > 0
    ? app.documents.map(d => `<div class="review-doc-item">📄 <span>${esc(d)}</span></div>`).join('')
    : '<div style="color:var(--muted);font-size:12px;">No documents attached.</div>';
  const expressHtml = app.express_loan_data
    ? `<div class="review-section"><div class="review-section-title">Express Loan Details</div>${Object.entries(app.express_loan_data).map(([k,v])=>`<div class="review-factor"><div class="review-factor-label" style="color:var(--text);">${esc(k)}</div><div style="font-size:12px;">${esc(String(v))}</div></div>`).join('')}</div>` : '';
  const bannerColors = { pending_review:'rgba(255,209,102,0.08)', approved:'rgba(6,214,160,0.1)', rejected:'rgba(255,107,107,0.1)', needs_info:'rgba(108,99,255,0.1)' };
  const bannerTexts = { pending_review:'⏳ Pending Review', approved:'✅ Approved', rejected:'❌ Rejected', needs_info:'📝 More Info Requested' };
  const disAttr = isPending ? '' : 'disabled';
  content.innerHTML = `
    <div style="margin-bottom:20px;">
      <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;">${esc(app.user_name||'Applicant')}</div>
      <div style="font-size:13px;color:var(--muted);margin-top:2px;">${esc(app.product_name||'-')} · ${esc(app.bank_name||'-')}</div>
    </div>
    <div style="background:${bannerColors[currentStatus]||bannerColors.pending_review};border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600;margin-bottom:16px;">${bannerTexts[currentStatus]||bannerTexts.pending_review}</div>
    <div class="modal-stats" style="grid-template-columns:1fr 1fr 1fr 1fr;margin-bottom:20px;">
      <div class="modal-stat"><div class="modal-stat-val" style="color:${tier.color};">${score||'N/A'}</div><div class="modal-stat-label">Credit Score</div></div>
      <div class="modal-stat"><div class="modal-stat-val">RM ${Number(app.amount||0).toLocaleString()}</div><div class="modal-stat-label">Amount</div></div>
      <div class="modal-stat"><div class="modal-stat-val" style="font-size:14px;">${esc(app.purpose||'-')}</div><div class="modal-stat-label">Purpose</div></div>
      <div class="modal-stat"><div class="modal-stat-val" style="font-size:13px;">${formatDate(app.submitted_at)}</div><div class="modal-stat-label">Submitted</div></div>
    </div>
    <div class="review-section"><div class="review-section-title">Score Breakdown</div>${reasoningHtml}</div>
    <div class="review-section"><div class="review-section-title">Documents</div>${docsHtml}</div>
    ${expressHtml}
    ${app.reviewer_notes ? `<div class="review-section"><div class="review-section-title">Reviewer Notes</div><div style="font-size:13px;background:var(--surface2);border-radius:8px;padding:10px 14px;">${esc(app.reviewer_notes)}</div></div>` : ''}
    <div class="review-actions">
      <button class="review-btn approve" onclick="reviewApplication('${esc(app.id)}','approved')" ${disAttr}>✅ Approve</button>
      <button class="review-btn reject" onclick="reviewApplication('${esc(app.id)}','rejected')" ${disAttr}>❌ Reject</button>
      <button class="review-btn info" onclick="toggleReviewNotes()" id="review-info-btn" ${disAttr}>📝 Request Info</button>
    </div>
    <div class="review-notes-area" id="review-notes-area">
      <textarea id="review-notes-input" placeholder="Describe what additional information is needed..."></textarea>
      <button class="review-notes-confirm" onclick="reviewApplicationWithNote('${esc(app.id)}')">Send Request →</button>
    </div>`;
  document.getElementById('app-review-modal').classList.add('open');
};

window.closeApplicationReview = () => {
  document.getElementById('app-review-modal').classList.remove('open');
};
document.getElementById('app-review-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('app-review-modal')) window.closeApplicationReview();
});

window.toggleReviewNotes = () => {
  const area = document.getElementById('review-notes-area');
  if (area) area.style.display = area.style.display === 'block' ? 'none' : 'block';
};

window.reviewApplication = async (appId, status) => {
  const bankKey = sessionStorage.getItem('bank_api_key');
  if (!bankKey) { showToast('Session expired. Please log in again.', 'error'); return; }
  const allBtns = document.querySelectorAll('.review-btn');
  allBtns.forEach(b => { b.disabled = true; });
  try {
    const res = await fetch('/notify_user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bank-key': bankKey },
      body: JSON.stringify({ application_id: appId, status }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    const app = allApplications.find(a => a.id === appId);
    if (app) app.status = status;
    showToast(status === 'approved' ? '✅ Application approved!' : '❌ Application rejected.', status === 'approved' ? 'success' : 'error');
    window.closeApplicationReview();
    renderLoanApplications(allApplications);
  } catch(e) {
    showToast('Error: ' + e.message, 'error');
    allBtns.forEach(b => { b.disabled = false; });
  }
};

window.reviewApplicationWithNote = async (appId) => {
  const bankKey = sessionStorage.getItem('bank_api_key');
  if (!bankKey) { showToast('Session expired. Please log in again.', 'error'); return; }
  const notes = document.getElementById('review-notes-input')?.value.trim();
  if (!notes) { showToast('Please enter a note first.', 'info'); return; }
  const confirmBtn = document.querySelector('.review-notes-confirm');
  if (confirmBtn) { confirmBtn.disabled = true; }
  try {
    const res = await fetch('/notify_user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bank-key': bankKey },
      body: JSON.stringify({ application_id: appId, status: 'needs_info', reviewer_notes: notes }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    const app = allApplications.find(a => a.id === appId);
    if (app) { app.status = 'needs_info'; app.reviewer_notes = notes; }
    showToast('📝 Info request sent!', 'info');
    window.closeApplicationReview();
    renderLoanApplications(allApplications);
  } catch(e) {
    showToast('Error: ' + e.message, 'error');
    if (confirmBtn) confirmBtn.disabled = false;
  }
};

window.refreshLoanPipeline = async () => {
  const btn = document.getElementById('pipeline-refresh-btn');
  if (btn) { btn.classList.add('btn-loading'); btn.disabled = true; }
  try {
    const snap = await getDocs(collection(db, 'loan_applications'));
    allApplications = [];
    snap.forEach(d => allApplications.push({ id: d.id, ...d.data() }));
    allApplications.sort((a, b) => (b.submitted_at?.toMillis?.() || 0) - (a.submitted_at?.toMillis?.() || 0));
    renderLoanApplications(allApplications);
    showToast('Pipeline refreshed', 'success');
  } catch(e) {
    showToast('Refresh failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.classList.remove('btn-loading'); btn.disabled = false; }
  }
};

// Allow Enter key on inputs
document.getElementById('phone-input')?.addEventListener('keydown', e => { if(e.key==='Enter') window.handleLogin(); });
document.getElementById('bank-code-input')?.addEventListener('keydown', e => { if(e.key==='Enter') window.handleBankLogin?.(); });

// -- MODAL --
window.openModal = (phone) => {
  const u = allUsers.find(x => x.phone === phone);
  if (!u) return;
  const avatarColors = ['#00d4aa','#6c63ff','#ff6b6b','#ffd166','#06d6a0','#ff9f43','#a29bfe','#fd79a8','#00b894','#e17055'];
  const idx = allUsers.indexOf(u);
  const color = avatarColors[idx % avatarColors.length];
  const initial = (u.owner_name||'?')[0].toUpperCase();
  const score = u.credit_score || 0;
  const sales = u.sales || [];
  const rev = sales.reduce((a,x)=>a+(x.amount||0),0);
  let statusTxt, statusColor;
  if (score >= 70) { statusTxt = t('loan_ready'); statusColor = '#06d6a0'; }
  else if (score >= 50) { statusTxt = t('in_progress'); statusColor = '#ffd166'; }
  else if (score > 0) { statusTxt = t('building'); statusColor = '#ff6b6b'; }
  else { statusTxt = t('not_scored'); statusColor = '#5a6785'; }

  document.getElementById('modal-avatar').style.background = color;
  document.getElementById('modal-avatar').textContent = initial;
  document.getElementById('modal-name').textContent = u.owner_name || '-';
  document.getElementById('modal-biz').textContent = u.business_name || '-';
  document.getElementById('modal-product').textContent = u.product || '-';
  document.getElementById('modal-score').textContent = score || 'N/A';
  document.getElementById('modal-score').style.color = statusColor;
  document.getElementById('modal-rev').textContent = getCur(u) + rev.toLocaleString();
  document.getElementById('modal-txn').textContent = sales.length;
  document.getElementById('modal-status').textContent = statusTxt;
  document.getElementById('modal-status').style.color = statusColor;

  const recent = [...sales].reverse().slice(0, 5);
  document.getElementById('modal-sales').innerHTML = recent.length > 0
    ? recent.map(s => `<div class="modal-sale-item"><span>${esc(s.item||'Sale')} · ${esc(s.date)}</span><span style="color:var(--accent);font-weight:600;">${getCur(u)}${(s.amount||0).toLocaleString()}</span></div>`).join('')
    : '<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px;">No sales recorded yet</div>';

  document.getElementById('modal-phone-row').textContent = `📱 WhatsApp: +${u.phone}`;

  // Verification badges
  const badgesEl = document.getElementById('modal-verify-badges');
  if (badgesEl) {
    const ssmBadge = u.ssm_verified
      ? `<span class="verify-badge verified">✓ SSM Verified</span>`
      : `<span class="verify-badge unverified">SSM Unverified</span>`;
    const bankBadge = u.bank_verified
      ? `<span class="verify-badge verified">✓ Bank Verified</span>`
      : `<span class="verify-badge unverified">Bank Unverified</span>`;
    badgesEl.innerHTML = ssmBadge + bankBadge;
  }

  // Score sparkline
  const scoreHistory = u.score_history || [];
  const sparklineWrap = document.getElementById('modal-sparkline-wrap');
  if (sparklineWrap) {
    if (scoreHistory.length >= 2) {
      sparklineWrap.style.display = 'block';
      if (sparklineChartInstance) { sparklineChartInstance.destroy(); sparklineChartInstance = null; }
      const sCtx = document.getElementById('modal-sparkline').getContext('2d');
      sparklineChartInstance = new Chart(sCtx, {
        type: 'line',
        data: {
          labels: scoreHistory.map(h => h.date || ''),
          datasets: [{ data: scoreHistory.map(h => h.score || 0), borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,0.08)', borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#00d4aa', fill: true, tension: 0.4 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { display: false },
            y: { display: true, min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5a6785', font: { size: 10 }, stepSize: 25 } }
          }
        }
      });
    } else {
      sparklineWrap.style.display = 'none';
    }
  }

  document.getElementById('msme-modal').classList.add('open');
};

window.closeModal = () => {
  document.getElementById('msme-modal').classList.remove('open');
};

document.getElementById('msme-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('msme-modal')) closeModal();
});

// -- SEARCH, FILTER & PAGINATION --
let currentPage = 1;
let pageSize = 10;

window.filterTable = () => {
  currentPage = 1;
  renderTablePage();
};

window.changePageSize = (size) => {
  pageSize = parseInt(size);
  currentPage = 1;
  renderTablePage();
};

window.goToPage = (page) => {
  currentPage = page;
  renderTablePage();
};

function renderTablePage() {
  const search = (document.getElementById('msme-search')?.value || '').toLowerCase();
  const filter = document.getElementById('msme-filter')?.value || 'all';
  const rows = Array.from(document.querySelectorAll('#msme-table-body tr[data-name]'));

  // Filter
  let visible = rows.filter(row => {
    const name = row.dataset.name || '';
    const biz = row.dataset.biz || '';
    const status = row.dataset.status || '';
    const matchSearch = !search || name.includes(search) || biz.includes(search);
    const matchFilter = filter === 'all'
      || (filter === 'ready' && status === 'status-ready')
      || (filter === 'progress' && status === 'status-progress')
      || (filter === 'building' && status === 'status-building');
    return matchSearch && matchFilter;
  });

  const totalFiltered = visible.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = startIdx + pageSize;

  // Show/hide rows
  rows.forEach(row => row.style.display = 'none');
  visible.forEach((row, i) => {
    row.style.display = (i >= startIdx && i < endIdx) ? '' : 'none';
  });

  // Update info text
  const infoEl = document.getElementById('pg-info');
  if (infoEl) {
    const showStart = totalFiltered === 0 ? 0 : startIdx + 1;
    const showEnd = Math.min(endIdx, totalFiltered);
    infoEl.textContent = `Showing ${showStart}-${showEnd} of ${totalFiltered}`;
  }

  // Render page buttons
  const btnsEl = document.getElementById('pg-btns');
  if (btnsEl) {
    let html = `<button class="pg-btn" onclick="goToPage(${currentPage-1})" ${currentPage<=1?'disabled':''}>‹</button>`;
    // Smart page range
    let pages = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages = [1];
      if (currentPage > 3) pages.push('...');
      for (let i = Math.max(2, currentPage-1); i <= Math.min(totalPages-1, currentPage+1); i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    pages.forEach(p => {
      if (p === '...') {
        html += `<span style="color:var(--muted);padding:0 4px;">…</span>`;
      } else {
        html += `<button class="pg-btn ${p===currentPage?'active':''}" onclick="goToPage(${p})">${p}</button>`;
      }
    });
    html += `<button class="pg-btn" onclick="goToPage(${currentPage+1})" ${currentPage>=totalPages?'disabled':''}>›</button>`;
    btnsEl.innerHTML = html;
  }
}


window.exportPDF = () => {
  const users = allUsers;
  const total = users.length;
  const loanReady = users.filter(u=>(u.credit_score||0)>=70).length;
  const scores = users.map(u=>u.credit_score||0).filter(s=>s>0);
  const avgScore = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0;
  const totalRev = users.reduce((s,u) => {
    const userCur = getCur(u);
    const rev = (u.sales||[]).reduce((a,x)=>a+(x.amount||0),0);
    return s + convertToDisplayCurrency(rev, userCur);
  }, 0);
  const date = new Date().toLocaleDateString('en-MY',{year:'numeric',month:'long',day:'numeric'});
  const rows = users.map(u => {
    const rev = (u.sales||[]).reduce((a,x)=>a+(x.amount||0),0);
    const score = u.credit_score||0;
    const status = score>=70?'Loan Ready':score>=50?'In Progress':'Building';
    return `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:8px 12px;">${esc(u.owner_name)}</td>
      <td style="padding:8px 12px;">${esc(u.business_name)}</td>
      <td style="padding:8px 12px;">${getUserCountry(u).flag} ${esc(u.user_state||getUserCountry(u).name)}</td>
      <td style="padding:8px 12px;">${esc(u.product)}</td>
      <td style="padding:8px 12px;">${getCur(u)}${rev.toLocaleString()}</td>
      <td style="padding:8px 12px;font-weight:700;color:${score>=70?'#00a67e':score>=50?'#e6a817':'#e55353'}">${score||'N/A'}</td>
      <td style="padding:8px 12px;">${status}</td>
    </tr>`;
  }).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>BizBuddy Portfolio Report</title>
<style>body{font-family:Arial,sans-serif;padding:40px;color:#1a2234;}h1{color:#00b894;font-size:24px;margin-bottom:4px;}.subtitle{color:#7a8aaa;font-size:13px;margin-bottom:32px;}.stats{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;margin-bottom:32px;}.stat{background:#f0f4f8;border-radius:12px;padding:16px;border-left:4px solid #00b894;}.stat-val{font-size:28px;font-weight:800;}.stat-label{font-size:12px;color:#7a8aaa;margin-top:4px;}table{width:100%;border-collapse:collapse;font-size:13px;}th{background:#f0f4f8;padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#7a8aaa;}.footer{margin-top:40px;font-size:11px;color:#7a8aaa;text-align:center;border-top:1px solid #eee;padding-top:16px;}</style>
</head><body>
<h1>BizBuddy</h1><div class="subtitle">Portfolio Report - Generated ${date}</div>
<div class="stats">
  <div class="stat"><div class="stat-val">${total}</div><div class="stat-label">Total MSMEs</div></div>
  <div class="stat" style="border-left-color:#06d6a0;"><div class="stat-val" style="color:#00a67e;">${loanReady}</div><div class="stat-label">Loan Ready (70+)</div></div>
  <div class="stat" style="border-left-color:#ffd166;"><div class="stat-val" style="color:#e6a817;">${avgScore||'-'}</div><div class="stat-label">Avg Credit Score</div></div>
  <div class="stat" style="border-left-color:#00d4aa;"><div class="stat-val">${displayCurrency}${totalRev.toLocaleString()}</div><div class="stat-label">Total Revenue Tracked</div></div>
</div>
<table><thead><tr><th>Name</th><th>Business</th><th>Location</th><th>Product</th><th>Revenue</th><th>Score</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="footer">Powered by BizBuddy AI · Confidential Portfolio Report · ${date}</div>
</body${'>'}</html>`;
  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 500);
};
// ASEAN MAP - HiDPI SUPPORT
function drawMalaysiaMap(users) {
  const canvas = document.getElementById('malaysia-map');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const displayW = canvas.offsetWidth || 900;
  const displayH = 400;
  canvas.width = displayW * dpr;
  canvas.height = displayH * dpr;
  canvas.style.width = displayW + 'px';
  canvas.style.height = displayH + 'px';
  ctx.scale(dpr, dpr);
  const W = displayW, H = displayH;
  ctx.clearRect(0,0,W,H);
  const isLight = document.body.classList.contains('light-mode');
  ctx.fillStyle = isLight ? '#e8edf5' : '#161b27';
  ctx.fillRect(0,0,W,H);
  const sX=W/900, sY=H/400;
  function sp(x,y){return [x*sX,y*sY];}
  function drawShape(pts, fc, sc) {
    ctx.beginPath();
    pts.forEach(function(p,i){ if(i===0) ctx.moveTo(sp(p[0],p[1])[0],sp(p[0],p[1])[1]); else ctx.lineTo(sp(p[0],p[1])[0],sp(p[0],p[1])[1]); });
    ctx.closePath(); ctx.fillStyle=fc; ctx.fill(); ctx.strokeStyle=sc; ctx.lineWidth=1.2; ctx.stroke();
  }
  // Philippines
  drawShape([[680,30],[700,25],[715,35],[720,60],[725,90],[720,120],[710,140],[695,150],[680,145],[670,125],[665,100],[668,70],[672,45],[680,30]],'rgba(108,99,255,0.08)','rgba(108,99,255,0.4)');
  drawShape([[650,100],[670,95],[680,110],[675,130],[660,135],[648,120],[650,100]],'rgba(108,99,255,0.08)','rgba(108,99,255,0.4)');
  // Mainland SE Asia
  drawShape([[200,20],[220,15],[235,30],[240,60],[245,90],[250,120],[248,150],[240,170],[235,190],[240,210],[245,220],[240,235],[230,240],[220,235],[215,220],[210,200],[205,180],[200,160],[198,140],[200,120],[198,100],[195,80],[195,50],[200,20]],'rgba(90,103,133,0.06)','rgba(90,103,133,0.25)');
  // Peninsular Malaysia
  drawShape([[320,180],[330,175],[340,180],[345,195],[348,215],[345,235],[340,250],[335,260],[328,265],[320,260],[315,250],[312,235],[310,215],[312,200],[315,190],[320,180]],'rgba(0,212,170,0.12)','rgba(0,212,170,0.5)');
  // Borneo
  drawShape([[400,170],[440,155],[490,148],[540,150],[570,160],[580,175],[575,195],[560,210],[540,220],[510,228],[480,232],[450,230],[425,222],[410,210],[400,195],[398,180],[400,170]],'rgba(0,212,170,0.08)','rgba(0,212,170,0.35)');
  // Sumatra
  drawShape([[220,220],[240,210],[260,215],[270,235],[275,260],[270,290],[260,310],[245,320],[230,315],[220,300],[215,280],[212,260],[215,240],[220,220]],'rgba(255,209,102,0.08)','rgba(255,209,102,0.4)');
  // Java
  drawShape([[330,290],[370,285],[410,282],[450,285],[470,290],[465,300],[440,305],[400,308],[360,305],[335,300],[330,290]],'rgba(255,209,102,0.08)','rgba(255,209,102,0.4)');
  // Sulawesi
  drawShape([[520,250],[540,240],[555,248],[548,270],[555,285],[548,300],[535,295],[525,280],[518,265],[520,250]],'rgba(255,209,102,0.06)','rgba(255,209,102,0.3)');
  // Country labels
  var lc = isLight ? 'rgba(50,60,80,0.6)' : 'rgba(90,103,133,0.7)';
  ctx.fillStyle=lc; ctx.font='bold '+Math.round(11*sX)+'px DM Sans'; ctx.textAlign='center';
  var labels=[['Malaysia',340,275],['Indonesia',400,340],['Philippines',700,160],['Thailand',230,100],['Vietnam',260,55]];
  labels.forEach(function(a){ctx.fillText(a[0],a[1]*sX,a[2]*sY);});
  // Water labels
  ctx.fillStyle=isLight?'rgba(50,60,80,0.25)':'rgba(90,103,133,0.3)'; ctx.font='italic '+Math.round(9*sX)+'px DM Sans';
  var waters=[['South China Sea',480,100],['Indian Ocean',150,350],['Pacific Ocean',800,60],['Java Sea',420,315]];
  waters.forEach(function(a){ctx.fillText(a[0],a[1]*sX,a[2]*sY);});
  // User dots by state (real geographic positions on canvas)
  var statePos = {
    // Malaysia - Peninsular
    'Johor': [340,258], 'Kedah': [318,190], 'Kelantan': [338,190], 'Melaka': [332,252],
    'Negeri Sembilan': [328,245], 'Pahang': [335,218], 'Perak': [322,205], 'Perlis': [315,182],
    'Pulau Pinang': [316,195], 'Selangor': [325,230], 'Terengganu': [342,200],
    'KL': [328,232], 'Putrajaya': [330,234], 'Labuan': [440,170],
    // Malaysia - Borneo
    'Sabah': [510,162], 'Sarawak': [460,185],
    // Indonesia
    'Jakarta': [330,292], 'Jawa Barat': [345,290], 'Jawa Tengah': [370,288],
    'Jawa Timur': [400,286], 'Bali': [425,288], 'Sumatera Utara': [240,235],
    'Sumatera Barat': [238,255], 'Sumatera Selatan': [255,275],
    'Kalimantan': [470,210], 'Sulawesi': [535,255], 'Papua': [620,230],
    'Yogyakarta': [380,292],
    // Philippines
    'Metro Manila': [688,80], 'Cebu': [705,115], 'Davao': [710,140],
    'Calabarzon': [690,88], 'Central Luzon': [685,68], 'Western Visayas': [695,110],
    'Central Visayas': [700,118], 'Northern Mindanao': [705,132],
    'Ilocos': [680,50], 'Bicol': [698,95],
  };
  // Fallback positions per country (for users without state)
  var countryFallback = {
    MY: [328,232], ID: [380,292], PH: [690,80]
  };
  var dots=[];
  users.forEach(function(user,idx){
    var score=user.credit_score||0;
    var color='#5a6785',glow='rgba(90,103,133,0.3)';
    if(score>=70){color='#06d6a0';glow='rgba(6,214,160,0.4)';}
    else if(score>=50){color='#ffd166';glow='rgba(255,209,102,0.4)';}
    else if(score>0){color='#ff6b6b';glow='rgba(255,107,107,0.4)';}
    var cty=user.country||'MY';
    var userState=user.user_state||'';
    var base=statePos[userState]||countryFallback[cty]||countryFallback.MY;
    var ox=(Math.random()-0.5)*10,oy=(Math.random()-0.5)*10;
    var pt=sp(base[0]+ox,base[1]+oy);
    var cx=pt[0],cy=pt[1];
    var grad=ctx.createRadialGradient(cx,cy,0,cx,cy,14*sX);
    grad.addColorStop(0,glow);grad.addColorStop(1,'transparent');
    ctx.beginPath();ctx.arc(cx,cy,14*sX,0,Math.PI*2);ctx.fillStyle=grad;ctx.fill();
    ctx.beginPath();ctx.arc(cx,cy,6*sX,0,Math.PI*2);
    ctx.fillStyle=color;ctx.fill();
    ctx.strokeStyle=isLight?'rgba(240,244,248,0.8)':'rgba(13,17,23,0.8)';ctx.lineWidth=1.5;ctx.stroke();
    dots.push({x:cx,y:cy,user:user,color:color});
  });
  var tooltip=document.getElementById('map-tooltip');
  canvas.onmousemove=function(e){
    var rect=canvas.getBoundingClientRect();
    var mx=(e.clientX-rect.left)*(W/rect.width),my=(e.clientY-rect.top)*(H/rect.height);
    var found=null;
    dots.forEach(function(d){if(Math.sqrt((mx-d.x)*(mx-d.x)+(my-d.y)*(my-d.y))<16)found=d;});
    if(found){
      var u=found.user,sc=u.credit_score||0;
      var rev=(u.sales||[]).reduce(function(a,x){return a+(x.amount||0);},0);
      var cc=getUserCountry(u);
      var st=sc>=70?t('loan_ready'):sc>=50?t('in_progress'):sc>0?t('building'):t('not_scored');
      var uState=u.user_state?(' · '+esc(u.user_state)):'';
      tooltip.innerHTML='<strong>'+esc(u.owner_name)+'</strong><div style="color:#5a6785;font-size:11px;">'+esc(u.business_name)+' · '+cc.flag+' '+esc(cc.name)+uState+'</div><div style="margin-top:6px;color:'+found.color+';font-weight:700;">Score: '+(sc||'N/A')+'/100</div><div style="font-size:11px;color:#5a6785;">Revenue: '+getCur(u)+rev.toLocaleString()+'</div><div style="font-size:11px;margin-top:2px;">'+st+'</div>';
      tooltip.style.display='block';
      tooltip.style.left=(e.clientX-rect.left+14)+'px';
      tooltip.style.top=(e.clientY-rect.top-10)+'px';
      canvas.style.cursor='pointer';
    }else{tooltip.style.display='none';canvas.style.cursor='default';}
  };
  canvas.onmouseleave=function(){tooltip.style.display='none';};
}
window.drawMalaysiaMap=drawMalaysiaMap;

// buildLoanRecommendations replaced by async loadLoanPrograms + buildLoanCards above
