// ─── Popup Script (v2) ────────────────────────────────────────────────────────
// Fixed: crash on null sibling, better error display, re-poll on tab focus

const SPEED_LABELS = ['Slow', 'Normal', 'Fast'];
const SPEED_KEYS   = ['slow', 'normal', 'fast'];

const PLATFORM_ICONS = {
  'google-forms':  '📋',
  'surveymonkey':  '🐒',
  'typeform':      '✍️',
  'generic':       '📝',
};

const PLATFORM_LABELS = {
  'google-forms':  'Google Forms',
  'surveymonkey':  'SurveyMonkey',
  'typeform':      'Typeform',
  'generic':       'HTML Form',
};

let currentState = null;
let profiles = [];
let settings = {};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  renderProfiles();
  bindEvents();
  await pollCurrentTabState();
  await updateHistoryCount();

  // Re-poll every 2 seconds to catch late detections (React/SPA apps)
  setInterval(pollCurrentTabState, 2000);
});

async function loadData() {
  const data = await chrome.storage.local.get(['profiles', 'settings', 'activeProfileId']);
  profiles  = data.profiles  || [];
  settings  = data.settings  || {};

  // Restore active profile selection
  const activeId = data.activeProfileId || (profiles[0] ? profiles[0].id : '');
  if (activeId) {
    setTimeout(() => {
      document.getElementById('profileSelect').value = activeId;
      document.getElementById('warningBanner').style.display = 'none';
    }, 50);
  }

  // Restore speed
  const speedIdx = SPEED_KEYS.indexOf(settings.speed || 'normal');
  document.getElementById('speedSlider').value = speedIdx >= 0 ? speedIdx : 1;
  document.getElementById('speedValue').textContent = SPEED_LABELS[speedIdx >= 0 ? speedIdx : 1];
}

function renderProfiles() {
  const sel = document.getElementById('profileSelect');
  sel.innerHTML = '<option value="">— Select a profile —</option>';
  profiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name || 'Unnamed Profile';
    sel.appendChild(opt);
  });

  // Show warning if no profiles
  document.getElementById('warningBanner').style.display =
    profiles.length === 0 ? 'block' : 'none';
}

// ─── Events ───────────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btnStart').addEventListener('click', onStart);
  document.getElementById('btnPause').addEventListener('click', onPause);
  document.getElementById('btnStop').addEventListener('click', onStop);

  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('goCreateProfile').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  document.getElementById('profileSelect').addEventListener('change', async (e) => {
    await chrome.storage.local.set({ activeProfileId: e.target.value });
    document.getElementById('warningBanner').style.display =
      e.target.value ? 'none' : 'block';
  });

  document.getElementById('speedSlider').addEventListener('input', async (e) => {
    const idx = parseInt(e.target.value);
    const label = SPEED_LABELS[idx];
    const key   = SPEED_KEYS[idx];
    document.getElementById('speedValue').textContent = label;
    settings.speed = key;
    await chrome.storage.local.set({ settings });
  });

  // Listen for state updates from content script (via service worker)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'STATE_UPDATE' && msg.state) {
      applyState(msg.state);
    }
  });
}

// ─── Script Injection Helper ──────────────────────────────────────────────────
async function ensureScriptsInjected(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [
        'content/detectors/google-forms.js',
        'content/detectors/surveymonkey.js',
        'content/detectors/typeform.js',
        'content/detectors/generic.js',
        'content/answer-engine.js',
        'content/filler.js',
        'content/content.js'
      ]
    });
    return true;
  } catch (e) {
    console.warn('[SurveyBot] Dynamic script injection failed:', e);
    return false;
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function onStart() {
  const profileId = document.getElementById('profileSelect').value;
  if (!profileId) {
    document.getElementById('warningBanner').style.display = 'block';
    return;
  }

  const profile = profiles.find(p => p.id === profileId);
  if (!profile) return;

  const speedIdx = parseInt(document.getElementById('speedSlider').value);
  const mergedSettings = {
    ...settings,
    speed: SPEED_KEYS[speedIdx],
  };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Clear previous error state immediately
  applyState({
    status: 'running',
    message: 'Starting automation…',
    platform: currentState?.platform || null,
  });

  chrome.tabs.sendMessage(tab.id, {
    type: 'START',
    profile,
    settings: mergedSettings,
  }, (resp) => {
    if (chrome.runtime.lastError) {
      console.log('[SurveyBot] Injecting content script into tab...');
      ensureScriptsInjected(tab.id).then((ok) => {
        if (ok) {
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, {
              type: 'START',
              profile,
              settings: mergedSettings,
            });
          }, 250);
        } else {
          applyState({
            status: 'error',
            platform: null,
            message: 'Cannot inject into this page. Refresh and try again.',
          });
        }
      });
    }
  });
}

async function onPause() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'PAUSE_TOGGLE' }, () => {
    if (chrome.runtime.lastError) return;
  });
}

async function onStop() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, { type: 'STOP' }, () => {
    if (chrome.runtime.lastError) return;
  });
}

// ─── State Rendering ──────────────────────────────────────────────────────────
async function pollCurrentTabState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' }, (resp) => {
      if (chrome.runtime.lastError) {
        // Automatically inject content scripts if tab hasn't loaded them yet
        ensureScriptsInjected(tab.id);
        return;
      }
      if (resp?.state) applyState(resp.state);
    });
  } catch (e) { /* content script not available */ }
}

function applyState(state) {
  currentState = state;

  // Platform badge
  const icon  = PLATFORM_ICONS[state.platform]  || '🔍';
  const label = state.platform
    ? (PLATFORM_LABELS[state.platform] || state.platformLabel || state.platform)
    : 'Scanning page…';
  document.getElementById('platformIcon').textContent = icon;
  document.getElementById('platformName').textContent = label;

  if (state.platform) {
    document.getElementById('detectionCard').classList.add('detected');
  } else {
    document.getElementById('detectionCard').classList.remove('detected');
  }

  // Status dot + text
  const dot = document.getElementById('statusDot');
  dot.className = 'status-dot ' + (state.status || 'idle');

  const statusMap = {
    idle:      'Idle',
    running:   'Running',
    paused:    'Paused',
    stopped:   'Stopped',
    done:      'Complete ✅',
    error:     'Error ❌',
    review:    'Review Mode',
    'pre-submit': 'Manual Review Required',
  };
  document.getElementById('statusText').textContent = statusMap[state.status] || state.status || 'Idle';

  // Progress
  const totalInPage = state.totalInPage || 0;
  const currentIdx  = state.currentIdx  || 0;
  const pct = totalInPage > 0 ? Math.round(((currentIdx + 1) / totalInPage) * 100) : 0;

  document.getElementById('progressBar').style.width = (state.status === 'done' ? 100 : pct) + '%';
  document.getElementById('progressPct').textContent = (state.status === 'done' ? 100 : pct) + '%';

  // Message line — show error message or status message
  const msgLine = document.getElementById('messageLine');
  msgLine.textContent = state.message || '';
  msgLine.style.color = state.status === 'error' ? '#f43f5e' : '';

  document.getElementById('progressLabel').textContent =
    state.status === 'running' ? `Question ${currentIdx + 1} of ${totalInPage}` :
    state.status === 'done'    ? 'QA run complete' :
    state.status === 'pre-submit' ? 'Review final page manually' :
    state.status === 'paused'  ? 'Paused' :
    state.status === 'review'  ? 'Awaiting your review…' :
    state.status === 'error'   ? 'Error occurred' :
    'Waiting to start';

  // Stats
  document.getElementById('statAnswered').textContent = state.totalAnswered || 0;
  document.getElementById('statPage').textContent     = state.pageNum       || 1;

  // Button states
  const isRunning = state.status === 'running';
  const isPaused  = state.status === 'paused';
  const isActive  = isRunning || isPaused;
  const isDone    = state.status === 'done' || state.status === 'stopped';

  document.getElementById('btnStart').disabled = isActive;
  document.getElementById('btnPause').disabled = !isActive;
  document.getElementById('btnStop').disabled  = !isActive;

  // Update pause button label safely
  updatePauseLabel(isPaused);
}

function updatePauseLabel(isPaused) {
  const btn = document.getElementById('btnPause');
  // Find and update the text node after the SVG
  const nodes = btn.childNodes;
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].nodeType === Node.TEXT_NODE) {
      nodes[i].textContent = isPaused ? '\n      Resume' : '\n      Pause';
      break;
    }
  }
}

async function updateHistoryCount() {
  const data = await chrome.storage.local.get(['history', 'answersLog']);
  const count = (data.answersLog?.length || 0) || (data.history?.length || 0);
  document.getElementById('statHistory').textContent = count;
}
