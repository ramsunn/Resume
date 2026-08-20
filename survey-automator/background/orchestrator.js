// ─── SurveyBot Orchestrator (Background Daemon) ──────────────────────────────
// Manages the survey queue, copilot auto-loop, one-at-a-time execution lock,
// and local persistence of survey QA transcripts (survey_YYYYMMDD_HHMMSS.json).

const Orchestrator = (function () {
  const QUEUE_KEY = 'surveyQueue';
  const ANSWERS_LOG_KEY = 'answersLog';
  const COMPLETED_URLS_KEY = 'completedSurveyUrls';

  let isProcessing = false;
  let activeTabId = null;

  async function getQueue() {
    const data = await chrome.storage.local.get(QUEUE_KEY);
    return Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
  }

  async function setQueue(queue) {
    await chrome.storage.local.set({ [QUEUE_KEY]: queue });
    broadcastQueueUpdate();
  }

  async function enqueueSurveys(urls, sourceDashboard = '') {
    if (!Array.isArray(urls) || urls.length === 0) return { added: 0 };
    const queue = await getQueue();
    const data = await chrome.storage.local.get(COMPLETED_URLS_KEY);
    const completedUrls = new Set(data[COMPLETED_URLS_KEY] || []);

    let addedCount = 0;
    for (const rawUrl of urls) {
      const url = typeof rawUrl === 'string' ? rawUrl.trim() : rawUrl?.url?.trim();
      const title = typeof rawUrl === 'object' ? rawUrl.title : '';
      if (!url || !/^https?:\/\//i.test(url)) continue;

      // Avoid duplicates in queue and already completed surveys
      const alreadyInQueue = queue.some(item => item.url === url);
      if (!alreadyInQueue && !completedUrls.has(url)) {
        queue.push({
          id: `survey_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          url,
          title: title || cleanDomainName(url),
          sourceDashboard,
          status: 'queued',
          addedAt: new Date().toISOString(),
        });
        addedCount++;
      }
    }

    if (addedCount > 0) {
      await setQueue(queue);
    }
    return { added: addedCount, totalInQueue: queue.length };
  }

  async function popNextSurvey() {
    const queue = await getQueue();
    const pendingIdx = queue.findIndex(item => item.status === 'queued');
    if (pendingIdx === -1) return null;

    const nextItem = queue[pendingIdx];
    nextItem.status = 'running';
    nextItem.startedAt = new Date().toISOString();
    await setQueue(queue);
    return nextItem;
  }

  async function markSurveyFinished(url, status = 'completed') {
    const queue = await getQueue();
    const item = queue.find(q => q.url === url || (activeTabId && q.status === 'running'));
    if (item) {
      item.status = status;
      item.finishedAt = new Date().toISOString();
      await setQueue(queue);
    }

    // Add to completed list so we don't re-take it
    if (url) {
      const data = await chrome.storage.local.get(COMPLETED_URLS_KEY);
      const completed = data[COMPLETED_URLS_KEY] || [];
      if (!completed.includes(url)) {
        completed.push(url);
        if (completed.length > 500) completed.shift();
        await chrome.storage.local.set({ [COMPLETED_URLS_KEY]: completed });
      }
    }
  }

  async function clearQueue() {
    await setQueue([]);
    isProcessing = false;
    activeTabId = null;
  }

  // ─── Answer Transcript Persistence ──────────────────────────────────────────
  async function storeSurveyAnswers(surveyData) {
    if (!surveyData) return null;

    const timestamp = new Date();
    const dateStr = timestamp.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
    const domain = cleanDomainName(surveyData.url || 'unknown');
    const filename = `survey_${dateStr}_${domain}.json`;

    const logEntry = {
      id: `log_${Date.now()}`,
      filename,
      timestamp: timestamp.toISOString(),
      url: surveyData.url || '',
      title: surveyData.title || documentTitleFromUrl(surveyData.url),
      platform: surveyData.platform || 'generic',
      profileUsed: surveyData.profile || 'Default',
      questionsAnswered: surveyData.questionsAnswered || (surveyData.log?.length || 0),
      durationSeconds: surveyData.durationSeconds || 0,
      answers: surveyData.log || [],
    };

    const data = await chrome.storage.local.get(ANSWERS_LOG_KEY);
    const logs = Array.isArray(data[ANSWERS_LOG_KEY]) ? data[ANSWERS_LOG_KEY] : [];
    logs.unshift(logEntry);

    // Keep last 200 completed survey transcripts locally
    if (logs.length > 200) logs.length = 200;
    await chrome.storage.local.set({ [ANSWERS_LOG_KEY]: logs });

    console.log(`[Orchestrator] 💾 Stored survey QA answers: ${filename}`);
    return logEntry;
  }

  async function getStoredLogs() {
    const data = await chrome.storage.local.get(ANSWERS_LOG_KEY);
    return Array.isArray(data[ANSWERS_LOG_KEY]) ? data[ANSWERS_LOG_KEY] : [];
  }

  async function clearStoredLogs() {
    await chrome.storage.local.set({ [ANSWERS_LOG_KEY]: [] });
  }

  // ─── Single-Survey Execution Lock & Copilot Runner ──────────────────────────
  async function runNextInQueue(tabIdToReuse = null) {
    if (isProcessing) {
      console.log('[Orchestrator] ⚠️ Another survey is already running (1 at a time lock active).');
      return { ok: false, reason: 'Survey already running' };
    }

    const nextSurvey = await popNextSurvey();
    if (!nextSurvey) {
      isProcessing = false;
      activeTabId = null;
      console.log('[Orchestrator] 🏁 Queue is empty. Copilot idle.');
      return { ok: true, status: 'queue_empty' };
    }

    isProcessing = true;
    console.log(`[Orchestrator] 🚀 Launching survey: ${nextSurvey.url}`);

    try {
      let targetTabId = tabIdToReuse;

      if (targetTabId) {
        try {
          await chrome.tabs.update(targetTabId, { url: nextSurvey.url, active: true });
        } catch (e) {
          targetTabId = null;
        }
      }

      if (!targetTabId) {
        const tab = await chrome.tabs.create({ url: nextSurvey.url, active: true });
        targetTabId = tab.id;
      }

      activeTabId = targetTabId;
      return { ok: true, survey: nextSurvey, tabId: targetTabId };
    } catch (err) {
      console.error('[Orchestrator] Failed to launch survey tab:', err);
      await markSurveyFinished(nextSurvey.url, 'error');
      isProcessing = false;
      activeTabId = null;
      return { ok: false, error: err.message };
    }
  }

  async function handleSurveyFinished(surveyData, senderTabId) {
    isProcessing = false;
    const currentUrl = surveyData?.url || '';

    // 1. Store answers log
    const savedLog = await storeSurveyAnswers(surveyData);

    // 2. Mark queue item as completed
    await markSurveyFinished(currentUrl, 'completed');

    // 3. Check settings for Continuous Copilot Mode
    const data = await chrome.storage.local.get(['settings']);
    const settings = data.settings || {};
    const isCopilot = settings.continuous !== false;

    if (isCopilot) {
      // Speed delay between surveys (slow=4s, normal=2s, fast=0.8s, or custom speedLimit)
      let delayMs = 2000;
      if (settings.speed === 'slow') delayMs = 4000;
      else if (settings.speed === 'fast') delayMs = 800;
      if (typeof settings.speedLimit === 'number' && settings.speedLimit > 0) {
        delayMs = settings.speedLimit * 1000;
      }

      console.log(`[Orchestrator] ⏱️ Waiting ${delayMs}ms before launching next survey...`);
      setTimeout(async () => {
        const queue = await getQueue();
        const hasMore = queue.some(q => q.status === 'queued');

        if (hasMore) {
          await runNextInQueue(senderTabId);
        } else if (settings.dashboardUrl) {
          // If queue is empty, navigate back to dashboard to discover new surveys
          console.log('[Orchestrator] 🔄 Queue finished. Returning to dashboard:', settings.dashboardUrl);
          if (senderTabId) {
            chrome.tabs.update(senderTabId, { url: settings.dashboardUrl }).catch(() => {});
          }
        }
      }, delayMs);
    }

    return savedLog;
  }

  function broadcastQueueUpdate() {
    chrome.runtime.sendMessage({ type: 'QUEUE_UPDATED' }).catch(() => {});
  }

  function cleanDomainName(url) {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '').replace(/[^a-zA-Z0-9]/g, '_');
    } catch (e) {
      return 'survey';
    }
  }

  function documentTitleFromUrl(url) {
    try {
      const u = new URL(url);
      return u.pathname.split('/').filter(Boolean).pop() || u.hostname;
    } catch (e) {
      return 'Online Survey';
    }
  }

  return {
    getQueue,
    enqueueSurveys,
    popNextSurvey,
    clearQueue,
    storeSurveyAnswers,
    getStoredLogs,
    clearStoredLogs,
    runNextInQueue,
    handleSurveyFinished,
    getStatus: () => ({ isProcessing, activeTabId }),
  };
})();

// Export globally for service worker
if (typeof self !== 'undefined') {
  self.Orchestrator = Orchestrator;
}
