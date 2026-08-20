// SurveyBot Service Worker — Background Script
// Handles: AI API calls, Orchestrator queue, Copilot execution, notifications

try {
  importScripts('orchestrator.js');
} catch (e) {
  console.warn('[ServiceWorker] Could not import orchestrator.js:', e);
}

// ─── State ───────────────────────────────────────────────────────────────────
const tabStates = {}; // tabId → { status, progress, platform }

// ─── Message Handler ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (msg.type) {
    case 'AI_QUERY':
      handleAIQuery(msg, sendResponse);
      return true; // async

    case 'STATE_UPDATE':
      if (tabId) tabStates[tabId] = { ...tabStates[tabId], ...msg.state };
      // Forward to popup if open
      chrome.runtime.sendMessage({ type: 'STATE_UPDATE', tabId, state: msg.state }).catch(() => {});
      sendResponse({ ok: true });
      break;

    case 'LOG_SURVEY':
      handleSurveyCompletion(msg.data, tabId, sendResponse);
      return true;

    case 'ENQUEUE_SURVEYS':
      if (self.Orchestrator) {
        self.Orchestrator.enqueueSurveys(msg.urls, msg.sourceDashboard)
          .then(res => sendResponse({ ok: true, ...res }))
          .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
      }
      sendResponse({ ok: false, error: 'Orchestrator not loaded' });
      break;

    case 'START_NEXT_SURVEY':
      if (self.Orchestrator) {
        self.Orchestrator.runNextInQueue(tabId)
          .then(res => sendResponse(res))
          .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;
      }
      sendResponse({ ok: false, error: 'Orchestrator not loaded' });
      break;

    case 'GET_QUEUE':
      if (self.Orchestrator) {
        self.Orchestrator.getQueue().then(queue => {
          sendResponse({ queue, status: self.Orchestrator.getStatus() });
        });
        return true;
      }
      sendResponse({ queue: [], status: {} });
      break;

    case 'CLEAR_QUEUE':
      if (self.Orchestrator) {
        self.Orchestrator.clearQueue().then(() => sendResponse({ ok: true }));
        return true;
      }
      sendResponse({ ok: false });
      break;

    case 'GET_ANSWER_LOGS':
      if (self.Orchestrator) {
        self.Orchestrator.getStoredLogs().then(logs => sendResponse({ ok: true, logs }));
        return true;
      }
      sendResponse({ ok: false, logs: [] });
      break;

    case 'CLEAR_ANSWER_LOGS':
      if (self.Orchestrator) {
        self.Orchestrator.clearStoredLogs().then(() => sendResponse({ ok: true }));
        return true;
      }
      sendResponse({ ok: false });
      break;

    case 'GET_STATE':
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        sendResponse({ state: tabStates[tab?.id] || null });
      });
      return true;

    case 'NOTIFY':
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'assets/icons/icon48.png',
        title: msg.title || 'SurveyBot',
        message: msg.message,
      });
      sendResponse({ ok: true });
      break;

    default:
      sendResponse({ ok: false, error: 'Unknown message type' });
  }
});

async function handleSurveyCompletion(data, tabId, sendResponse) {
  try {
    // 1. Log to history
    await logCompletedSurvey(data);

    // 2. Delegate to orchestrator for persistence & next-in-queue auto-dispatch
    let savedLog = null;
    if (self.Orchestrator) {
      savedLog = await self.Orchestrator.handleSurveyFinished(data, tabId);
    }

    sendResponse({ ok: true, savedLog });
  } catch (err) {
    console.error('[ServiceWorker] Error handling survey completion:', err);
    sendResponse({ ok: false, error: err.message });
  }
}

// ─── AI Query ────────────────────────────────────────────────────────────────
async function handleAIQuery(msg, sendResponse) {
  const { question, options, profile, provider, apiKey, model } = msg;
  const type = msg.questionType || msg.type;

  let persona = buildPersonaString(profile);
  if (profile?.bio) {
    persona += `\nPersonal Opinions, Bio & Preferences: ${profile.bio}`;
  }
  if (profile?.customQA?.length) {
    const qaList = profile.customQA.map(q => `• When asked about "${q.question}" -> "${q.answer}"`).join('\n');
    persona += `\nSpecific Established Views:\n${qaList}`;
  }

  const optionsStr = options?.length
    ? `Available Options:\n${options.map((o, i) => `[${i + 1}] ${o}`).join('\n')}`
    : '';

  let prompt = `You are a real respondent accurately completing an online survey as this persona:
---
${persona}
---

SURVEY QUESTION & CONTEXT:
"${question}"

${optionsStr}

INSTRUCTIONS FOR ANSWERING:
1. Context & Negative Phrasing: Pay close attention to negative phrasing (e.g. "Which of these have you NOT done?"), rating scales (e.g. 1=Poor, 5=Excellent), and specific sub-item labels.
2. Specific Demographic & Open Formats:
   - If asked for "Birth Year" / "What year were you born", output ONLY the 4-digit year (e.g. 1998), NEVER the full date of birth.
   - If asked for "Birth Month", output the month name or number.
   - If asked for "Country of Residence" / "Which country", output "Australia" (or the country in the persona).
   - If asked for "State", output "New South Wales" (or NSW if options list abbreviations).
   - If asked for "City", output "Sydney".
   - If asked for "Age", output only the exact age number.
   - If asked for "Brands" / "Products" / "Items" (e.g. smart home security brands), output a well-known real brand or product name (e.g. "Ring", "Google Nest", "Arlo", "SimpliSafe").
   - VERY IMPORTANT: If the question includes an item number (e.g., "[1.]" or "(Item 2)"), provide a uniquely different, distinct answer for that specific number so that all items in the list get different responses.
3. Attention Trap Recognition: If the question prompt contains an instructional quality check or demand (e.g. "To verify you are reading, select 'Disagree'"), follow that exact demand above all else.
4. Persona Consistency: Answer naturally and consistently with the persona's stated demographics, background, and opinions.`;

  if (type === 'checkbox') {
    prompt += `\n5. Format: This is a multiple-choice checkbox question. Select 2 to 3 of the most relevant options from the list above. Return ONLY the exact option text separated with a pipe character (|). Do not include numbers, prefixes, or explanations.`;
  } else if (options?.length) {
    prompt += `\n5. Format: Select the single best matching option. Return ONLY the exact verbatim text of that option. Do not include option numbers, quotes, prefixes, or explanations.`;
  } else {
    prompt += `\n5. Format: Write a direct, natural, concise response (a single brand name if asked for a brand, or 1 short sentence if asked for an opinion/feedback). Return ONLY the answer text without surrounding quotes or preamble.`;
  }

  try {
    let answer;
    if (provider === 'openai') {
      answer = await queryOpenAI(apiKey, model || 'gpt-4o-mini', prompt);
    } else if (provider === 'gemini') {
      answer = await queryGemini(apiKey, model || 'gemini-2.0-flash', prompt);
    } else {
      throw new Error('No AI provider configured');
    }
    sendResponse({ ok: true, answer });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

async function queryOpenAI(apiKey, model, prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(`OpenAI ${res.status}: ${errBody?.error?.message || res.statusText}`);
  }
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function queryGemini(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 150, temperature: 0.3 },
    }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const errMsg = errBody?.error?.message || res.statusText;
    throw new Error(`Gemini ${res.status}: ${errMsg}`);
  }
  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (!candidate) throw new Error('Gemini returned no candidates');
  return (candidate.content?.parts?.[0]?.text || '').trim();
}

function buildPersonaString(profile) {
  if (!profile) return 'an anonymous survey respondent living in Australia';
  const parts = [];
  if (profile.name)       parts.push(`Name: ${profile.name}`);
  if (profile.age)        parts.push(`Age: ${profile.age} years old`);

  let birthYear = profile.birthYear;
  if (!birthYear && profile.dateOfBirth) {
    const m = String(profile.dateOfBirth).match(/(\d{4})/);
    if (m) birthYear = m[1];
  }
  if (!birthYear && profile.age) {
    birthYear = String(new Date().getFullYear() - parseInt(profile.age, 10));
  }
  if (birthYear) parts.push(`Birth Year: ${birthYear}`);
  if (profile.dateOfBirth) parts.push(`Full Date of Birth: ${profile.dateOfBirth}`);

  if (profile.gender)     parts.push(`Gender: ${profile.gender}`);
  if (profile.maritalStatus) parts.push(`Marital Status: ${profile.maritalStatus}`);
  if (profile.occupation) parts.push(`Occupation: ${profile.occupation}`);
  if (profile.education)  parts.push(`Education: ${profile.education}`);
  if (profile.employment) parts.push(`Employment Status: ${profile.employment}`);
  if (profile.income)     parts.push(`Annual Income: ${profile.income}`);
  if (profile.household)  parts.push(`Household Size: ${profile.household}`);
  if (profile.ethnicity)  parts.push(`Ethnicity/Race: ${profile.ethnicity}`);
  if (profile.politics)   parts.push(`Political Affiliation: ${profile.politics}`);

  const country = profile.country || (profile.location && /australia/i.test(profile.location) ? 'Australia' : 'Australia');
  const state = profile.state || (profile.location && /sydney/i.test(profile.location) ? 'New South Wales' : 'New South Wales');
  const city = profile.city || 'Sydney';
  const postcode = profile.postcode || profile.postalCode || '2000';

  parts.push(`Country of Residence: ${country}`);
  parts.push(`State/Territory: ${state}`);
  parts.push(`City/Suburb: ${city}`);
  parts.push(`Postal/Zip Code: ${postcode}`);
  if (profile.location)   parts.push(`Full Location: ${profile.location}`);
  if (profile.interests?.length) parts.push(`Interests/Hobbies: ${profile.interests.join(', ')}`);
  if (profile.language) parts.push(`Preferred Language: ${profile.language}`);
  return parts.join('\n');
}

// ─── Survey History Logging ───────────────────────────────────────────────────
async function logCompletedSurvey(data) {
  const { history = [] } = await chrome.storage.local.get('history');
  history.unshift({
    ...data,
    completedAt: new Date().toISOString(),
    id: Date.now().toString(),
  });
  if (history.length > 100) history.splice(100);
  await chrome.storage.local.set({ history });
}

// ─── Keyboard Shortcuts ───────────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const messageMap = {
    'start-automation': 'START',
    'pause-automation': 'PAUSE_TOGGLE',
    'stop-automation': 'STOP',
  };

  const type = messageMap[command];
  if (type) {
    chrome.tabs.sendMessage(tab.id, { type }).catch(() => {});
  }
});

// ─── Tab Cleanup ──────────────────────────────────────────────────────────────
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabStates[tabId];
});
