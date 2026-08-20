// ─── Options Page Script ──────────────────────────────────────────────────────

let profiles = [];
let settings = {};
let editingProfileId = null;

const AI_MODELS = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  gemini: ['gemini-2.0-flash', 'gemini-3.5-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'],
};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  bindNavigation();
  bindProfileEvents();
  bindSettingsEvents();
  bindHistoryEvents();
  bindListEvents(); // New event delegation for dynamically generated lists
  renderProfileList();
  renderSettings();
  renderHistory();
});

async function loadData() {
  const data = await chrome.storage.local.get(['profiles', 'settings', 'history', 'activeProfileId']);
  profiles = data.profiles || [];
  if (profiles.length === 0) {
    profiles = [{
      id: 'profile_default_australia',
      name: 'Alex Taylor',
      age: 28,
      dateOfBirth: '1998-06-15',
      birthYear: '1998',
      gender: 'Male',
      maritalStatus: 'Single',
      occupation: 'Software Engineer',
      education: "Bachelor's Degree",
      ethnicity: 'White / Caucasian',
      politics: 'Moderate / Independent',
      employment: 'Employed Full-Time',
      household: '2',
      language: 'English',
      country: 'Australia',
      state: 'New South Wales',
      city: 'Sydney',
      postcode: '2000',
      postalCode: '2000',
      location: 'Sydney, Australia',
      income: '$80k–$100k',
      email: 'alex.taylor@example.com',
      phone: '+61 400 123 456',
      interests: ['Technology', 'Gaming', 'Travel', 'Outdoor Activities'],
      bio: 'Lives in Sydney, Australia. Works as a full-time software developer. Enjoys hiking, travel, and smart home technology.',
      customQA: [],
      updatedAt: new Date().toISOString(),
    }];
    await chrome.storage.local.set({ profiles, activeProfileId: 'profile_default_australia' });
  }

  settings = data.settings || {
    speed: 'normal',
    speedLimit: 2,
    dashboardUrl: '',
    autoStart: true,
    autoSubmit: true,
    continuous: true,
    reviewMode: false,
    aiProvider: '',
    aiApiKey: '',
    aiModel: '',
    fallback: 'first',
  };
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function bindNavigation() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tabId = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(`tab-${tabId}`).classList.add('active');
    });
  });
}

// ─── Profile List ─────────────────────────────────────────────────────────────
function renderProfileList() {
  const list = document.getElementById('profileList');

  if (profiles.length === 0) {
    list.innerHTML = '<div class="empty-state">No profiles yet. Click "New Profile" to create one.</div>';
    return;
  }

  list.innerHTML = profiles.map(p => `
    <div class="profile-card" data-id="${p.id}">
      <div class="profile-avatar">${getInitials(p.name)}</div>
      <div class="profile-info">
        <div class="profile-name">${escHtml(p.name || 'Unnamed')}</div>
        <div class="profile-meta">${buildProfileMeta(p)}</div>
      </div>
      <div class="profile-actions">
        <button class="btn-outline btn-export" data-id="${p.id}">Export</button>
        <button class="btn-outline btn-edit" data-id="${p.id}">Edit</button>
        <button class="btn-outline btn-delete" style="color:var(--red);border-color:rgba(244,63,94,0.3);" data-id="${p.id}">Delete</button>
      </div>
    </div>
  `).join('');
}

// ─── Event Delegation for Dynamic Elements ────────────────────────────────────
function bindListEvents() {
  document.getElementById('profileList').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    
    const id = btn.getAttribute('data-id');
    if (btn.classList.contains('btn-export')) exportProfile(id);
    else if (btn.classList.contains('btn-edit')) editProfile(id);
    else if (btn.classList.contains('btn-delete')) deleteProfile(id);
  });

  document.getElementById('customQAList').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove-qa');
    if (btn) btn.closest('.qa-row').remove();
  });
}

function buildProfileMeta(p) {
  const parts = [];
  if (p.age)        parts.push(`${p.age} yrs`);
  if (p.gender)     parts.push(p.gender);
  if (p.occupation) parts.push(p.occupation);
  if (p.location)   parts.push(p.location);
  return parts.join(' · ') || 'No details added';
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// ─── Profile Editor ───────────────────────────────────────────────────────────
function bindProfileEvents() {
  document.getElementById('btnNewProfile').addEventListener('click', () => openEditor(null));
  document.getElementById('btnCloseEditor').addEventListener('click', closeEditor);
  document.getElementById('btnCancelEdit').addEventListener('click', closeEditor);
  document.getElementById('btnSaveProfile').addEventListener('click', saveProfile);
  document.getElementById('btnAddQA').addEventListener('click', addQARow);

  // Import profile via file
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeEditor();
  });
}

function openEditor(profileId) {
  editingProfileId = profileId;
  const editor = document.getElementById('profileEditor');
  editor.style.display = 'block';
  editor.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (profileId) {
    const p = profiles.find(pr => pr.id === profileId);
    if (!p) return;
    document.getElementById('editorTitle').textContent = 'Edit Profile';
    document.getElementById('fName').value       = p.name         || '';
    document.getElementById('fAge').value        = p.age          || '';
    document.getElementById('fDOB').value        = p.dateOfBirth  || '';
    document.getElementById('fGender').value     = p.gender       || '';
    document.getElementById('fMarital').value    = p.maritalStatus|| '';
    document.getElementById('fOccupation').value = p.occupation   || '';
    document.getElementById('fEducation').value   = p.education     || '';
    document.getElementById('fEthnicity').value   = p.ethnicity     || '';
    document.getElementById('fPolitics').value    = p.politics      || '';
    document.getElementById('fEmployment').value  = p.employment    || '';
    document.getElementById('fHousehold').value   = p.household     || '';
    document.getElementById('fLanguage').value    = p.language      || '';
    document.getElementById('fCountry').value     = p.country       || 'Australia';
    document.getElementById('fState').value       = p.state         || 'New South Wales';
    document.getElementById('fCity').value        = p.city          || 'Sydney';
    document.getElementById('fPostcode').value    = p.postcode      || p.postalCode || '2000';
    document.getElementById('fLocation').value    = p.location      || 'Sydney, Australia';
    document.getElementById('fIncome').value      = p.income        || '';
    document.getElementById('fEmail').value       = p.email         || '';
    document.getElementById('fPhone').value       = p.phone         || '';
    document.getElementById('fInterests').value   = Array.isArray(p.interests) ? p.interests.join(', ') : (p.interests || '');
    document.getElementById('fBio').value         = p.bio           || '';
    renderQARows(p.customQA || []);
  } else {
    document.getElementById('editorTitle').textContent = 'New Profile';
    clearForm();
    if (document.getElementById('fCountry')) document.getElementById('fCountry').value = 'Australia';
    if (document.getElementById('fState')) document.getElementById('fState').value = 'New South Wales';
    if (document.getElementById('fCity')) document.getElementById('fCity').value = 'Sydney';
    if (document.getElementById('fPostcode')) document.getElementById('fPostcode').value = '2000';
    renderQARows([]);
  }
}

function closeEditor() {
  document.getElementById('profileEditor').style.display = 'none';
  editingProfileId = null;
}

function clearForm() {
  ['fName','fAge','fDOB','fGender','fMarital','fOccupation','fEducation',
   'fEthnicity','fPolitics','fEmployment','fHousehold','fLanguage',
   'fCountry','fState','fCity','fPostcode',
   'fLocation','fIncome','fEmail','fPhone','fInterests','fBio']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

async function saveProfile() {
  const name = document.getElementById('fName').value.trim();
  if (!name) {
    document.getElementById('fName').focus();
    document.getElementById('fName').style.borderColor = 'var(--red)';
    return;
  }
  document.getElementById('fName').style.borderColor = '';

  const interestsRaw = document.getElementById('fInterests').value;
  const interests = interestsRaw.split(',').map(s => s.trim()).filter(Boolean);

  const customQA = collectQARows();

  const country = document.getElementById('fCountry')?.value.trim() || 'Australia';
  const state = document.getElementById('fState')?.value.trim() || 'New South Wales';
  const city = document.getElementById('fCity')?.value.trim() || 'Sydney';
  const postcode = document.getElementById('fPostcode')?.value.trim() || '2000';
  const location = document.getElementById('fLocation')?.value.trim() || `${city}, ${country}`;

  const profile = {
    id: editingProfileId || `profile_${Date.now()}`,
    name,
    age:          parseInt(document.getElementById('fAge').value) || null,
    dateOfBirth:  document.getElementById('fDOB').value  || '',
    gender:       document.getElementById('fGender').value     || '',
    maritalStatus:document.getElementById('fMarital').value    || '',
    occupation:   document.getElementById('fOccupation').value || '',
    education:    document.getElementById('fEducation').value  || '',
    ethnicity:    document.getElementById('fEthnicity').value  || '',
    politics:     document.getElementById('fPolitics').value   || '',
    employment:   document.getElementById('fEmployment').value || '',
    household:    document.getElementById('fHousehold').value  || '',
    language:     document.getElementById('fLanguage').value   || '',
    country,
    state,
    city,
    postcode,
    postalCode:   postcode,
    location,
    income:       document.getElementById('fIncome').value     || '',
    email:        document.getElementById('fEmail').value      || '',
    phone:        document.getElementById('fPhone').value      || '',
    interests,
    bio:          document.getElementById('fBio').value        || '',
    customQA,
    updatedAt: new Date().toISOString(),
  };

  if (editingProfileId) {
    const idx = profiles.findIndex(p => p.id === editingProfileId);
    if (idx >= 0) profiles[idx] = profile;
  } else {
    profiles.push(profile);
  }

  await chrome.storage.local.set({ profiles });
  renderProfileList();
  closeEditor();
}

function editProfile(id) { openEditor(id); }

async function deleteProfile(id) {
  if (!confirm('Delete this profile?')) return;
  profiles = profiles.filter(p => p.id !== id);
  await chrome.storage.local.set({ profiles });
  renderProfileList();
}

function exportProfile(id) {
  const p = profiles.find(pr => pr.id === id);
  if (!p) return;
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `surveybot-profile-${p.name.replace(/\s+/g, '-').toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Custom Q&A Rows ──────────────────────────────────────────────────────────
function renderQARows(qaList) {
  const container = document.getElementById('customQAList');
  container.innerHTML = '';
  qaList.forEach(qa => addQARow(qa));
}

function addQARow(qa = {}) {
  const container = document.getElementById('customQAList');
  const row = document.createElement('div');
  row.className = 'qa-row';
  row.innerHTML = `
    <input type="text" class="qa-question" placeholder="If question contains…" value="${escHtml(qa.question || '')}" />
    <input type="text" class="qa-answer" placeholder="Answer with…" value="${escHtml(qa.answer || '')}" />
    <button class="icon-btn btn-remove-qa" title="Remove">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  container.appendChild(row);
}

function collectQARows() {
  const rows = document.querySelectorAll('.qa-row');
  const result = [];
  rows.forEach(row => {
    const question = row.querySelector('.qa-question').value.trim();
    const answer   = row.querySelector('.qa-answer').value.trim();
    if (question && answer) result.push({ question, answer });
  });
  return result;
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('sAiProvider').value = settings.aiProvider || '';
  document.getElementById('sApiKey').value     = settings.aiApiKey   || '';
  if (document.getElementById('sAutoStart'))   document.getElementById('sAutoStart').checked = settings.autoStart !== false;
  if (document.getElementById('sAutoSubmit'))  document.getElementById('sAutoSubmit').checked = settings.autoSubmit !== false;
  if (document.getElementById('sContinuous'))  document.getElementById('sContinuous').checked = settings.continuous !== false;
  if (document.getElementById('sReviewMode'))  document.getElementById('sReviewMode').checked = !!settings.reviewMode;
  document.getElementById('sSpeed').value        = settings.speed || 'normal';
  if (document.getElementById('sSpeedLimit'))   document.getElementById('sSpeedLimit').value = settings.speedLimit !== undefined ? settings.speedLimit : 2;
  if (document.getElementById('sDashboardUrl')) document.getElementById('sDashboardUrl').value = settings.dashboardUrl || '';
  document.getElementById('sFallback').value     = settings.fallback || 'first';

  updateAIProviderUI(settings.aiProvider);
}

function bindSettingsEvents() {
  document.getElementById('sAiProvider').addEventListener('change', (e) => {
    updateAIProviderUI(e.target.value);
  });

  document.getElementById('btnToggleKey').addEventListener('click', () => {
    const input = document.getElementById('sApiKey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);

  document.getElementById('btnTestAI').addEventListener('click', testAIConnection);
}

function updateAIProviderUI(provider) {
  document.getElementById('aiKeyGroup').style.display   = provider ? 'flex' : 'none';
  document.getElementById('aiModelGroup').style.display = provider ? 'flex' : 'none';

  if (provider && AI_MODELS[provider]) {
    const sel = document.getElementById('sAiModel');
    sel.innerHTML = AI_MODELS[provider].map(m =>
      `<option value="${m}" ${settings.aiModel === m ? 'selected' : ''}>${m}</option>`
    ).join('');
  }
}

async function saveSettings() {
  settings = {
    aiProvider:   document.getElementById('sAiProvider').value,
    aiApiKey:     document.getElementById('sApiKey').value.trim(),
    aiModel:      document.getElementById('sAiModel')?.value || '',
    autoStart:    document.getElementById('sAutoStart') ? document.getElementById('sAutoStart').checked : true,
    autoSubmit:   document.getElementById('sAutoSubmit') ? document.getElementById('sAutoSubmit').checked : true,
    continuous:   document.getElementById('sContinuous') ? document.getElementById('sContinuous').checked : true,
    reviewMode:   document.getElementById('sReviewMode') ? document.getElementById('sReviewMode').checked : false,
    speed:        document.getElementById('sSpeed').value,
    speedLimit:   parseInt(document.getElementById('sSpeedLimit')?.value, 10) || 0,
    dashboardUrl: document.getElementById('sDashboardUrl')?.value.trim() || '',
    fallback:     document.getElementById('sFallback').value,
  };
  await chrome.storage.local.set({ settings });

  const indicator = document.getElementById('saveIndicator');
  indicator.textContent = '✓ Saved';
  indicator.classList.add('visible');
  setTimeout(() => indicator.classList.remove('visible'), 2000);
}

function isValidOrigin(value) {
  try { return new URL(value).origin === value; } catch (_) { return false; }
}

async function testAIConnection() {
  const provider = document.getElementById('sAiProvider').value;
  const apiKey   = document.getElementById('sApiKey').value.trim();
  const model    = document.getElementById('sAiModel').value;
  const result   = document.getElementById('aiTestResult');

  if (!provider || !apiKey) {
    result.textContent = '⚠ Fill in provider and key first.';
    result.className   = 'ai-test-result error';
    return;
  }

  result.textContent = 'Testing…';
  result.className   = 'ai-test-result';

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'AI_QUERY',
      question: 'What is 2+2?',
      options: [],
      profile: { name: 'Test' },
      provider,
      apiKey,
      model,
    });

    if (resp?.ok) {
      result.textContent = `✓ Connected! Response: "${resp.answer}"`;
      result.className   = 'ai-test-result success';
    } else {
      result.textContent = `✕ Error: ${resp?.error}`;
      result.className   = 'ai-test-result error';
    }
  } catch (e) {
    result.textContent = `✕ ${e.message}`;
    result.className   = 'ai-test-result error';
  }
}

// ─── History & Saved Answers ──────────────────────────────────────────────────
async function renderHistory() {
  const data = await chrome.storage.local.get(['answersLog', 'history']);
  const logs = Array.isArray(data.answersLog) && data.answersLog.length > 0
    ? data.answersLog
    : (data.history || []).map(h => ({
        id: h.id || `log_${Date.now()}`,
        filename: `survey_${(h.completedAt || new Date().toISOString()).replace(/[-:T]/g, '').slice(0, 14)}.json`,
        timestamp: h.completedAt,
        url: h.url,
        title: h.title,
        platform: h.platform,
        profileUsed: h.profile,
        questionsAnswered: h.questionsAnswered,
        durationSeconds: h.durationSeconds,
        answers: h.log || [],
      }));

  const list = document.getElementById('historyList');

  if (!logs.length) {
    list.innerHTML = '<div class="empty-state">No surveys completed yet.</div>';
    return;
  }

  list.innerHTML = logs.map((item, idx) => {
    const filename = item.filename || `survey_${idx + 1}.json`;
    const qaItems = Array.isArray(item.answers) ? item.answers : [];

    const qaListHtml = qaItems.length > 0
      ? `<div class="qa-transcript" id="qa_${item.id}" style="display:none;margin-top:12px;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;font-size:12px;">
          <div style="font-weight:600;margin-bottom:6px;color:var(--text-main);">Answered Questions (${qaItems.length}):</div>
          ${qaItems.map(q => `
            <div style="margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:6px;">
              <div style="color:var(--text-muted);">Q: ${escHtml(q.questionText || q.text || 'Question')}</div>
              <div style="color:var(--primary,#38bdf8);font-weight:500;">A: ${escHtml(q.answer || '—')}</div>
            </div>
          `).join('')}
        </div>`
      : '';

    return `
      <div class="history-card" style="padding:16px;border-radius:12px;margin-bottom:12px;background:var(--card-bg,rgba(255,255,255,0.02));border:1px solid rgba(255,255,255,0.08);">
        <div class="history-top" style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div class="history-title" style="font-weight:600;font-size:15px;color:var(--text-main);" title="${escHtml(item.url)}">${escHtml(item.title || item.url)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">📁 ${escHtml(filename)} · ${formatDate(item.timestamp)}</div>
          </div>
          <div style="display:flex;gap:6px;">
            ${qaItems.length > 0 ? `<button class="btn-outline btn-toggle-qa" data-target="qa_${item.id}" style="padding:4px 10px;font-size:12px;">View Q&amp;A</button>` : ''}
            <button class="btn-primary btn-download-log" data-id="${item.id}" style="padding:4px 10px;font-size:12px;">Download JSON</button>
          </div>
        </div>
        <div class="history-meta" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          <span class="history-badge" style="padding:2px 8px;border-radius:4px;font-size:11px;background:rgba(255,255,255,0.05);">${platformLabel(item.platform)}</span>
          <span class="history-badge" style="padding:2px 8px;border-radius:4px;font-size:11px;background:rgba(255,255,255,0.05);">${item.questionsAnswered || qaItems.length} questions</span>
          <span class="history-badge" style="padding:2px 8px;border-radius:4px;font-size:11px;background:rgba(255,255,255,0.05);">${item.durationSeconds || 0}s</span>
          <span class="history-badge" style="padding:2px 8px;border-radius:4px;font-size:11px;background:rgba(255,255,255,0.05);">Profile: ${escHtml(item.profileUsed || '—')}</span>
        </div>
        ${qaListHtml}
      </div>
    `;
  }).join('');
}

function bindHistoryEvents() {
  document.getElementById('btnClearHistory').addEventListener('click', async () => {
    if (!confirm('Clear all survey history and stored answer files?')) return;
    await chrome.storage.local.set({ history: [], answersLog: [] });
    renderHistory();
  });

  document.getElementById('btnExportAllHistory').addEventListener('click', async () => {
    const data = await chrome.storage.local.get(['answersLog', 'history']);
    const logs = data.answersLog || data.history || [];
    if (!logs.length) {
      alert('No survey records to export.');
      return;
    }
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `surveybot_all_surveys_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('historyList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    if (btn.classList.contains('btn-toggle-qa')) {
      const targetId = btn.getAttribute('data-target');
      const el = document.getElementById(targetId);
      if (el) {
        const isHidden = el.style.display === 'none';
        el.style.display = isHidden ? 'block' : 'none';
        btn.textContent = isHidden ? 'Hide Q&A' : 'View Q&A';
      }
    } else if (btn.classList.contains('btn-download-log')) {
      const id = btn.getAttribute('data-id');
      const data = await chrome.storage.local.get(['answersLog', 'history']);
      const logs = data.answersLog || data.history || [];
      const item = logs.find(l => l.id === id) || logs[0];
      if (!item) return;

      const filename = item.filename || `survey_${Date.now()}.json`;
      const blob = new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
         ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function platformLabel(p) {
  const map = { 'google-forms': 'Google Forms', surveymonkey: 'SurveyMonkey', typeform: 'Typeform', generic: 'HTML Form' };
  return map[p] || p || 'Unknown';
}

