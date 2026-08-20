// ─── SurveyBot Content Script v3 ──────────────────────────────────────────────
// Includes robust retry logic, verifies if filling actually worked before moving on,
// and doesn't blindly click "Next" if required fields remain empty.

var SurveyBot = window.SurveyBot || {};

SurveyBot.Controller = (function () {

  let state = {
    status: 'idle',
    platform: null,
    detector: null,
    questions: [],
    currentIdx: 0,
    totalAnswered: 0,
    pageNum: 1,
    profile: null,
    settings: null,
    reviewAnswers: null,
    surveyUrl: window.location.href,
    surveyTitle: document.title,
    startTime: null,
    log: [],
    errorMessage: '',
  };

  const DETECTORS = [];

  function registerDetectors() {
    DETECTORS.length = 0;
    const candidates = [
      SurveyBot.Detectors?.GoogleForms,
      SurveyBot.Detectors?.SurveyMonkey,
      SurveyBot.Detectors?.Typeform,
      SurveyBot.Detectors?.Generic,
    ];
    for (const d of candidates) {
      if (d && typeof d.detect === 'function') DETECTORS.push(d);
    }
  }

  function tryDetect() {
    registerDetectors();
    for (const detector of DETECTORS) {
      try {
        if (detector.detect()) {
          state.detector = detector;
          state.platform = detector.name;
          return true;
        }
      } catch (e) {
        console.warn('[SurveyBot] Detector error:', detector?.name, e);
      }
    }
    return false;
  }

  function init() {
    registerDetectors();
    tryDetect();

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      handleMessage(msg, sendResponse);
      return true;
    });

    observeDynamicSPA();
    checkAutoStart();
    broadcastState();
  }

  function observeDynamicSPA() {
    let lastUrl = window.location.href;
    
    // Check URL changes periodically (for React Router / SPA navigation)
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        state.surveyUrl = lastUrl;
        state.surveyTitle = document.title;
        console.log('[SurveyBot] 🔄 Route change detected:', lastUrl);
        tryDetect();
        checkAutoStart();
      }
    }, 1000);

    // Also observe DOM mutations to catch newly rendered question cards
    const observer = new MutationObserver(() => {
      if (state.status === 'idle') {
        if (tryDetect()) {
          checkAutoStart();
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  async function checkAutoStart() {
    try {
      const data = await chrome.storage.local.get(['profiles', 'settings', 'activeProfileId']);
      const settings = data.settings || {};
      const profiles = data.profiles || [];
      const activeProfile = profiles.find(p => p.id === data.activeProfileId) || profiles[0];

      if (settings.autoStart !== false && activeProfile && state.status === 'idle') {
        if (!state.detector) tryDetect();
        if (state.detector) {
          console.log('[SurveyBot] 🚀 Auto-Start enabled! Launching survey in 1.2s...');
          broadcastState({ message: 'Auto-pilot launching in 1.2s…' });
          setTimeout(() => {
            if (state.status === 'idle') {
              startAutomation(activeProfile, settings);
            }
          }, 1200);
        } else {
          // Check if this is a survey dashboard page with survey links
          scanAndEnqueueDashboard(settings);
        }
      }
    } catch (e) {
      console.warn('[SurveyBot] Auto-start check error:', e);
    }
  }

  async function scanAndEnqueueDashboard(settings) {
    try {
      const generic = SurveyBot.Detectors?.Generic;
      if (!generic || typeof generic.findDashboardLinks !== 'function') return;

      const links = generic.findDashboardLinks();
      if (links && links.length > 0) {
        console.log(`[SurveyBot] 📋 Found ${links.length} survey link(s) on page:`, links);
        chrome.runtime.sendMessage({
          type: 'ENQUEUE_SURVEYS',
          urls: links,
          sourceDashboard: window.location.href,
        }, (res) => {
          if (res?.ok && res.added > 0 && settings?.continuous !== false) {
            console.log(`[SurveyBot] 🎯 Enqueued ${res.added} new surveys. Requesting next survey...`);
            chrome.runtime.sendMessage({ type: 'START_NEXT_SURVEY' });
          }
        });
      }
    } catch (e) {
      console.warn('[SurveyBot] Dashboard scan error:', e);
    }
  }

  function handleMessage(msg, sendResponse) {
    switch (msg.type) {
      case 'GET_STATUS': sendResponse({ state: getPublicState() }); break;
      case 'START': startAutomation(msg.profile, msg.settings); sendResponse({ ok: true }); break;
      case 'PAUSE_TOGGLE':
        if (state.status === 'running') state.status = 'paused';
        else if (state.status === 'paused') { state.status = 'running'; runLoop(); }
        broadcastState(); sendResponse({ ok: true }); break;
      case 'STOP': state.status = 'stopped'; broadcastState(); sendResponse({ ok: true }); break;
      case 'CONFIRM_REVIEW': state.reviewAnswers = msg.answers; state.status = 'running'; runLoop(); sendResponse({ ok: true }); break;
      default: sendResponse({ ok: false });
    }
  }

  async function startAutomation(profile, settings) {
    if (!state.detector) tryDetect();
    if (!state.detector) {
      if (window !== window.top) {
        // Child frame without inputs — do not overwrite main frame state
        return;
      }
      state.status = 'error';
      state.errorMessage = 'No survey inputs found. Make sure the survey is loaded.';
      broadcastState();
      return;
    }

    state.errorMessage = '';
    state.profile = profile;
    state.settings = settings;
    state.status = 'running';
    state.startTime = Date.now();
    state.totalAnswered = 0;
    state.log = [];
    state.pageNum = 1;
    state.errorMessage = '';

    SurveyBot.Filler.setSpeed(settings?.speed || 'normal');
    broadcastState();

    try { await runLoop(); }
    catch (err) {
      console.error('[SurveyBot] Automation error:', err);
      state.status = 'error';
      state.errorMessage = err.message || 'Unknown error';
      broadcastState();
    }
  }

  async function runLoop() {
    while (state.status === 'running') {
      try {
        if (state.detector.isComplete()) { await onComplete(); return; }
      } catch (e) {}

      try { state.questions = state.detector.parseQuestions(); }
      catch (e) { state.questions = []; }

      if (state.questions.length === 0) {
        await SurveyBot.Filler.sleep(1500);
        try { state.questions = state.detector.parseQuestions(); }
        catch (e) { state.questions = []; }

        if (state.questions.length === 0) {
          if (state.detector.hasNextPage()) {
            broadcastState({ message: 'Clicking next…' });
            state.detector.clickNext();
            await waitForNavigation();
            state.pageNum++;
            continue;
          } else if (state.detector.hasSubmit()) {
            if (state.settings?.autoSubmit !== false) {
              broadcastState({ message: 'Submitting survey…' });
              await SurveyBot.Filler.sleep(800);
              state.detector.clickSubmit();
              await waitForNavigation();
              continue;
            } else {
              state.status = 'done';
              broadcastState({ status: 'pre-submit', message: 'Ready to submit.' });
              return;
            }
          } else if (state.settings?.continuous && state.detector.clickDashboardSurvey && state.detector.clickDashboardSurvey()) {
            broadcastState({ message: 'Found new survey link! Starting...' });
            await waitForNavigation();
            continue;
          } else {
            break;
          }
        }
      }

      const resolvedAnswers = await resolveAllAnswers(state.questions);


      if (state.settings?.reviewMode && !state.reviewAnswers) {
        state.status = 'review';
        broadcastState({ status: 'review', reviewData: resolvedAnswers });
        return;
      }

      const answersToUse = state.reviewAnswers || resolvedAnswers;
      state.reviewAnswers = null;

      let allFilledSuccessfully = true;

      for (let i = 0; i < state.questions.length; i++) {
        if (state.status !== 'running') return;
        const question = state.questions[i];
        const resolved = answersToUse[i];

        state.currentIdx = i;
        broadcastState({
          message: `Answering: "${question.text.substring(0, 50)}…"`,
          progress: computeProgress(i, state.questions.length),
        });

        try {
          const success = await SurveyBot.Filler.fill(question, resolved.answer);
          if (!success) {
            console.warn('[SurveyBot] Failed to fill question:', question.text);
            allFilledSuccessfully = false;
          } else {
            state.totalAnswered++;
            state.log.push({
              page: state.pageNum,
              questionText: question.text,
              answer: resolved.answer,
              confidence: resolved.confidence,
              source: resolved.source,
            });
          }
        } catch (e) {
          console.warn('[SurveyBot] Fill error:', e);
          allFilledSuccessfully = false;
        }

        await SurveyBot.Filler.sleepRandom(SurveyBot.Filler.getConfig().stepDelay);
      }

      await SurveyBot.Filler.sleep(1000);

      // Verify that there are no empty required fields visible
      const emptyRequiredInputs = Array.from(document.querySelectorAll('input[required]:not([type="hidden"]), select[required]'))
        .filter(el => !el.value && el.offsetWidth > 0 && el.offsetHeight > 0);
      
      if (emptyRequiredInputs.length > 0) {
         console.warn('[SurveyBot] Still seeing empty required inputs!', emptyRequiredInputs);
         state.status = 'error';
         state.errorMessage = 'Failed to fill required fields on this page. Paused to prevent loop.';
         broadcastState();
         return; // Pause the bot so user can manually fix or inspect
      }

      if (state.detector.hasNextPage()) {
        broadcastState({ message: 'Going to next page…' });
        state.detector.clickNext();
        await waitForNavigation();
        state.pageNum++;
      } else if (state.detector.hasSubmit()) {
        if (state.settings?.autoSubmit !== false) {
          broadcastState({ message: 'Submitting survey…' });
          await SurveyBot.Filler.sleep(800);
          state.detector.clickSubmit();
          await waitForNavigation();
        } else {
          state.status = 'done';
          broadcastState({ status: 'pre-submit', message: 'Ready to submit.' });
          return;
        }
      } else if (state.settings?.continuous && state.detector.clickDashboardSurvey && state.detector.clickDashboardSurvey()) {
        broadcastState({ message: 'Found new survey link! Starting...' });
        await waitForNavigation();
      } else {
        break;
      }
    }

    if (state.status === 'running') await onComplete(true);
  }

  async function resolveAllAnswers(questions) {
    const resolved = [];
    for (const q of questions) {
      try {
        const result = await SurveyBot.AnswerEngine.resolve(q, state.profile, state.settings);
        resolved.push(result);
      } catch (e) {
        resolved.push({ answer: '', confidence: 0, source: 'error' });
      }
    }
    return resolved;
  }

  async function onComplete(wasContinuousLoop = false) {
    if (!wasContinuousLoop && state.totalAnswered > 0) {
      const elapsed = Math.round((Date.now() - state.startTime) / 1000);
      try {
        chrome.runtime.sendMessage({
          type: 'LOG_SURVEY',
          data: {
            url: state.surveyUrl,
            title: state.surveyTitle,
            platform: state.platform,
            questionsAnswered: state.totalAnswered,
            pagesCompleted: state.pageNum,
            durationSeconds: elapsed,
            profile: state.profile?.name || 'Unknown',
            log: state.log,
          },
        });
        chrome.runtime.sendMessage({ type: 'NOTIFY', title: 'Survey Complete! ✅', message: `Answered ${state.totalAnswered} questions.` });
      } catch (e) {}
    }

    if (state.settings?.continuous && state.detector.clickDashboardSurvey && state.detector.clickDashboardSurvey()) {
      broadcastState({ message: 'Survey completed. Searching for next survey in dashboard...' });
      await waitForNavigation();
      state.status = 'running';
      state.totalAnswered = 0;
      state.pageNum = 1;
      state.errorMessage = '';
      broadcastState();
      try { await runLoop(); } catch (e) {}
    } else {
      state.status = 'idle';
      state.message = 'Idle';
      broadcastState();
    }
  }

  function waitForNavigation() {
    return new Promise(resolve => {
      let settled = false;
      const observer = new MutationObserver(() => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        setTimeout(resolve, 800);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(); }, 4000);
    });
  }

  function isAuthorizedTestOrigin(settings) {
    const allowed = Array.isArray(settings?.allowedTestOrigins) ? settings.allowedTestOrigins : [];
    return allowed.includes(window.location.origin);
  }

  function computeProgress(current, total) { return total > 0 ? Math.round((current / total) * 100) : 0; }
  function broadcastState(overrides = {}) {
    try { chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: { ...getPublicState(), ...overrides } }).catch(() => {}); } catch(e) {}
  }
  function getPublicState() {
    return { status: state.status, platform: state.platform, platformLabel: state.detector?.label || null, currentIdx: state.currentIdx, totalInPage: state.questions.length, totalAnswered: state.totalAnswered, pageNum: state.pageNum, message: state.errorMessage || '', log: state.log };
  }

  try { init(); } catch (e) { console.error('[SurveyBot] Init failed:', e); }

  return { getPublicState };
})();

window.SurveyBot = SurveyBot;
