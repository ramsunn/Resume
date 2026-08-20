// ─── Filler v3 ────────────────────────────────────────────────────────────────
// Battle-tested DOM filling with multiple fallback strategies.
// Uses execCommand('insertText') as primary method (works with React/Vue/Angular).
// Includes fill verification and retry logic.

var SurveyBot = window.SurveyBot || {};

SurveyBot.Filler = (function () {

  const SPEED_CONFIG = {
    slow:   { charDelay: [80, 180],  clickDelay: [600, 1200], stepDelay: [1500, 2500] },
    normal: { charDelay: [30, 80],   clickDelay: [250, 600],  stepDelay: [700, 1400] },
    fast:   { charDelay: [5, 20],    clickDelay: [80, 200],   stepDelay: [200, 500] },
  };

  let currentSpeed = 'normal';

  function setSpeed(speed) { currentSpeed = speed || 'normal'; }
  function getConfig() { return SPEED_CONFIG[currentSpeed] || SPEED_CONFIG.normal; }
  function randomBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function sleepRandom([min, max]) { return sleep(randomBetween(min, max)); }

  function scrollTo(el) {
    if (!el) return;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEXT INPUT — The most critical function. Uses 3 strategies with verification.
  // ═══════════════════════════════════════════════════════════════════════════
  async function typeText(element, text) {
    if (!element || text === undefined || text === null) return false;
    const textStr = String(text);
    const cfg = getConfig();

    scrollTo(element);
    try { element.click?.(); } catch (e) {}
    await sleepRandom(cfg.clickDelay);

    // Clear the field first
    try { element.focus?.(); } catch (e) {}
    await sleep(60);

    // ── Strategy 1: Native prototype setter (React/Vue/Angular controlled inputs) ─────
    try {
      const proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      if (nativeSetter) {
        nativeSetter.call(element, textStr);
      } else {
        element.value = textStr;
      }
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: textStr }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));

      await sleep(60);
      if (getInputValue(element) === textStr) {
        console.log('[SurveyBot] ✓ Filled via nativeSetter:', textStr);
        return true;
      }
    } catch (e) {
      console.warn('[SurveyBot] nativeSetter failed:', e.message);
    }

    // ── Strategy 2: execCommand ──────────────
    try {
      element.select?.();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      await sleep(40);

      document.execCommand('insertText', false, textStr);
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));

      await sleep(60);
      if (getInputValue(element) === textStr) {
        console.log('[SurveyBot] ✓ Filled via execCommand:', textStr);
        return true;
      }
    } catch (e) {
      console.warn('[SurveyBot] execCommand failed:', e.message);
    }

    // ── Strategy 3: Direct value + InputEvent (last resort) ───────────────
    try {
      element.focus?.();
      element.value = textStr;

      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        composed: true,
        cancelable: true,
        inputType: 'insertText',
        data: textStr,
      }));
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));

      await sleep(60);
      if (getInputValue(element) === textStr) {
        console.log('[SurveyBot] ✓ Filled via direct value:', textStr);
        return true;
      }
    } catch (e) {
      console.warn('[SurveyBot] direct value failed:', e.message);
    }

    // ── Strategy 4: Clipboard paste simulation ────────────────────────────
    try {
      element.focus();
      element.select();
      await sleep(50);

      // Use clipboard API to paste
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', textStr);
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });
      element.dispatchEvent(pasteEvent);

      // Also try setting value after paste event
      element.value = textStr;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));

      await sleep(100);
      if (getInputValue(element) === textStr) {
        console.log('[SurveyBot] ✓ Filled via clipboard paste:', textStr);
        return true;
      }
    } catch (e) {
      console.warn('[SurveyBot] clipboard paste failed:', e.message);
    }

    console.error('[SurveyBot] ✗ ALL fill strategies failed for:', textStr, 'Current value:', getInputValue(element));
    return false;
  }

  function getInputValue(element) {
    if (!element) return '';
    return element.value || element.textContent || '';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLICK — Human-like click with full multi-layer event chain
  // ═══════════════════════════════════════════════════════════════════════════
  async function humanClick(element) {
    if (!element) return;
    scrollTo(element);
    await sleepRandom(getConfig().clickDelay);

    try { element.focus(); } catch (e) {}

    const rect = element.getBoundingClientRect();
    const x = rect.width ? rect.left + rect.width / 2 : 10;
    const y = rect.height ? rect.top + rect.height / 2 : 10;
    const eventOpts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };

    if (window.PointerEvent) {
      try { element.dispatchEvent(new PointerEvent('pointerover', eventOpts)); } catch (e) {}
      try { element.dispatchEvent(new PointerEvent('pointerenter', eventOpts)); } catch (e) {}
      try { element.dispatchEvent(new PointerEvent('pointerdown', eventOpts)); } catch (e) {}
    }

    try { element.dispatchEvent(new MouseEvent('mouseover', eventOpts)); } catch (e) {}
    try { element.dispatchEvent(new MouseEvent('mousedown', eventOpts)); } catch (e) {}
    await sleep(randomBetween(25, 60));

    if (window.PointerEvent) {
      try { element.dispatchEvent(new PointerEvent('pointerup', eventOpts)); } catch (e) {}
    }
    try { element.dispatchEvent(new MouseEvent('mouseup', eventOpts)); } catch (e) {}
    try { element.click(); } catch (e) {}
    try { element.dispatchEvent(new MouseEvent('mouseleave', eventOpts)); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FILL ROUTER — Dispatches to the correct fill method by question type
  // ═══════════════════════════════════════════════════════════════════════════
  async function fill(question, answer) {
    if (answer === undefined || answer === null) {
      console.warn('[SurveyBot] No answer for question:', question.text);
      return false;
    }

    scrollTo(question.element || question.container);
    await sleepRandom(getConfig().clickDelay);

    switch (question.type) {
      case 'radio':       return fillRadio(question, answer);
      case 'checkbox':    return fillCheckbox(question, answer);
      case 'select':      return fillSelect(question, answer);
      case 'text':
      case 'number':
      case 'email':
      case 'tel':         return typeText(question.element, answer);
      case 'textarea':    return typeText(question.element, answer);
      case 'scale':
      case 'rating':      return fillScale(question, answer);
      case 'range':       return fillRange(question, answer);
      case 'date':        return fillNativeDate(question, answer);
      case 'date-group':  return fillDateGroup(question, answer);
      default:
        if (question.element?.tagName === 'INPUT' || question.element?.tagName === 'TEXTAREA') {
          return typeText(question.element, answer);
        }
        return false;
    }
  }

  // ─── Radio ─────────────────────────────────────────────────────────────────
  async function fillRadio(question, answer) {
    const target = findBestOption(question.options, answer);
    if (!target) {
      console.warn('[SurveyBot] Could not find matching radio option for answer:', answer, 'in options:', question.options?.map(o => o.text));
      return false;
    }
    
    const targetEl = target.element;
    let inputEl = targetEl.tagName === 'INPUT' ? targetEl : targetEl.querySelector?.('input[type="radio"]');
    let labelEl = targetEl.tagName === 'LABEL' ? targetEl : targetEl.closest?.('label');
    
    if (inputEl && !labelEl && inputEl.id) {
      labelEl = document.querySelector(`label[for="${inputEl.id}"]`);
    }

    const containerEl = targetEl.closest?.('td, [role="gridcell"], [role="radio"], li, .radio, .choice, .option-item, .answer-option') || targetEl.parentElement;
    const visualIcons = containerEl ? Array.from(containerEl.querySelectorAll('svg, [class*="radio"], [class*="check"], [class*="circle"], [class*="dot"], span, div')) : [];

    // 1. Primary Click: Label, Container, or Target
    if (labelEl) {
      await humanClick(labelEl);
    } else if (containerEl && containerEl !== document.body) {
      await humanClick(containerEl);
    } else {
      await humanClick(targetEl);
    }

    // 2. Click any inner visual icons/glyphs (SVGs, styled radio circles)
    for (const icon of visualIcons.slice(0, 4)) {
      if (icon !== labelEl && icon !== containerEl) {
        try { icon.click(); } catch (e) {}
      }
    }

    // 3. For accessible custom widgets (role="radio")
    const roleRadio = targetEl.getAttribute?.('role') === 'radio' ? targetEl : containerEl?.getAttribute?.('role') === 'radio' ? containerEl : null;
    if (roleRadio) {
      try {
        roleRadio.focus?.();
        roleRadio.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true, composed: true }));
        roleRadio.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, bubbles: true, composed: true }));
        roleRadio.setAttribute('aria-checked', 'true');
      } catch (e) {}
    }

    // 4. For native input elements (including React/Vue controlled state)
    if (inputEl) {
      try { inputEl.click(); } catch (e) {}
      try {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
        if (nativeSetter) {
          nativeSetter.call(inputEl, true);
        } else {
          inputEl.checked = true;
        }
      } catch (e) {
        inputEl.checked = true;
      }
      try { inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true })); } catch (e) {}
      try { inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (e) {}
    }

    // 5. Post-click Verification & Retry Loop
    await sleep(60);
    const checked = inputEl ? inputEl.checked : (targetEl.getAttribute?.('aria-checked') === 'true' || containerEl?.getAttribute?.('aria-checked') === 'true');
    if (!checked) {
      try { targetEl.click?.(); } catch (e) {}
      if (containerEl) {
        try { containerEl.click?.(); } catch (e) {}
        Array.from(containerEl.querySelectorAll('*')).forEach(child => { try { child.click?.(); } catch (e) {} });
      }
      if (inputEl) {
        try {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
          if (setter) setter.call(inputEl, true);
          else inputEl.checked = true;
          inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        } catch (e) {}
      }
    }

    return true;
  }

  // ─── Checkbox ──────────────────────────────────────────────────────────────
  async function fillCheckbox(question, answers) {
    const answerList = Array.isArray(answers) ? answers : [answers];
    for (const ans of answerList) {
      const target = findBestOption(question.options, ans);
      if (!target) continue;

      const targetEl = target.element;
      let inputEl = targetEl.tagName === 'INPUT' ? targetEl : targetEl.querySelector?.('input[type="checkbox"]');
      let labelEl = targetEl.tagName === 'LABEL' ? targetEl : targetEl.closest?.('label');
      
      if (inputEl && !labelEl && inputEl.id) {
        labelEl = document.querySelector(`label[for="${inputEl.id}"]`);
      }

      const containerEl = targetEl.closest?.('td, [role="gridcell"], [role="checkbox"], li, .checkbox, .choice, .option-item, .answer-option') || targetEl.parentElement;
      const visualIcons = containerEl ? Array.from(containerEl.querySelectorAll('svg, [class*="checkbox"], [class*="check"], [class*="box"], [class*="square"], span, div')) : [];

      const isChecked = inputEl ? inputEl.checked : (targetEl.getAttribute?.('aria-checked') === 'true' || containerEl?.getAttribute?.('aria-checked') === 'true');

      if (!isChecked) {
        if (labelEl) {
          await humanClick(labelEl);
        } else if (containerEl && containerEl !== document.body) {
          await humanClick(containerEl);
        } else {
          await humanClick(targetEl);
        }

        for (const icon of visualIcons.slice(0, 4)) {
          if (icon !== labelEl && icon !== containerEl) {
            try { icon.click(); } catch (e) {}
          }
        }

        const roleCb = targetEl.getAttribute?.('role') === 'checkbox' ? targetEl : containerEl?.getAttribute?.('role') === 'checkbox' ? containerEl : null;
        if (roleCb) {
          try {
            roleCb.focus?.();
            roleCb.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, bubbles: true, composed: true }));
            roleCb.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, bubbles: true, composed: true }));
            roleCb.setAttribute('aria-checked', 'true');
          } catch (e) {}
        }

        if (inputEl) {
          try { inputEl.click(); } catch (e) {}
          try {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked')?.set;
            if (nativeSetter) {
              nativeSetter.call(inputEl, true);
            } else {
              inputEl.checked = true;
            }
          } catch (e) {
            inputEl.checked = true;
          }
          try { inputEl.dispatchEvent(new Event('input', { bubbles: true, composed: true })); } catch (e) {}
          try { inputEl.dispatchEvent(new Event('change', { bubbles: true, composed: true })); } catch (e) {}
        }
      }
      await sleepRandom([100, 300]);
    }
    return true;
  }

  function isSelected(element, fallbackElement) {
    if (element?.tagName === 'INPUT') return !!element.checked;
    const candidate = element || fallbackElement;
    const nestedInput = candidate?.querySelector?.('input[type="radio"], input[type="checkbox"]');
    if (nestedInput) return !!nestedInput.checked;
    if (candidate?.getAttribute('aria-checked') === 'true' || candidate?.getAttribute('aria-selected') === 'true') return true;
    const control = candidate?.closest?.('[role="radio"], [role="checkbox"], [aria-checked], [aria-selected]');
    return control?.getAttribute('aria-checked') === 'true' || control?.getAttribute('aria-selected') === 'true';
  }

  // ─── Select ────────────────────────────────────────────────────────────────
  async function fillSelect(question, answer) {
    const el = question.element;

    if (el.tagName === 'SELECT') {
      const allSelectOptions = Array.from(el.options).map((opt, i) => ({ text: opt.text.trim(), value: opt.value, index: i, element: opt }));
      const optionsToSearch = question.options?.length ? question.options : allSelectOptions;

      let target = findBestOption(optionsToSearch, answer);

      // Special Country resolution: if answer is Australia, search comprehensively
      if (!target || /australia/i.test(String(answer))) {
        const found = allSelectOptions.find(o => /australia/i.test(o.text) || o.value === 'AU' || o.value === 'AUS' || /commonwealth of australia/i.test(o.text));
        if (found) target = found;
      }

      if (!target) {
        target = allSelectOptions[1] || allSelectOptions[0];
      }
      if (!target) return false;

      scrollTo(el);
      try { el.focus(); } catch (e) {}

      const val = target.value !== undefined ? target.value : target.element?.value;
      const targetIndex = target.index !== undefined ? target.index : Array.from(el.options).findIndex(o => o.value === val || o.text.trim() === target.text);

      if (targetIndex >= 0) {
        el.selectedIndex = targetIndex;
      }
      el.value = val;

      try {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
        if (nativeSetter) nativeSetter.call(el, val);
      } catch (e) {}

      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return true;
    } else {
      // Custom dropdowns (React-Select, Material UI, Select2, Google Forms)
      await humanClick(el);
      await sleep(350);

      const optEls = Array.from(document.querySelectorAll('[role="option"], .quantumWizMenuPaperselectOption, .select2-results__option, .dropdown-item, .menu-item, [role="listbox"] li'));
      if (optEls.length > 0) {
        const customOptions = optEls.map(o => ({ text: o.textContent.trim(), element: o }));
        let targetOpt = findBestOption(customOptions, answer);

        if (!targetOpt && /australia/i.test(String(answer))) {
          targetOpt = customOptions.find(o => /australia/i.test(o.text));
        }

        if (targetOpt?.element) {
          await humanClick(targetOpt.element);
          return true;
        }
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return false;
    }
  }

  // ─── Scale / Rating ────────────────────────────────────────────────────────
  async function fillScale(question, answer) {
    const target = findBestOption(question.options, answer);
    if (target) { await humanClick(target.element); return true; }
    if (typeof answer === 'number' && question.options?.length) {
      const idx = Math.min(Math.max(0, answer - 1), question.options.length - 1);
      await humanClick(question.options[idx].element);
      return true;
    }
    return false;
  }

  // ─── Range ─────────────────────────────────────────────────────────────────
  async function fillRange(question, answer) {
    const el = question.element;
    const min = parseInt(el.min) || 0;
    const max = parseInt(el.max) || 100;
    const val = parseInt(answer) || Math.floor((min + max) / 2);
    el.value = Math.min(Math.max(val, min), max);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // ─── Native Date ───────────────────────────────────────────────────────────
  async function fillNativeDate(question, answer) {
    const { month, day, year } = parseDateAnswer(answer);
    const iso = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return typeText(question.element, iso);
  }

  // ─── Date Group (MM / DD / YYYY) ───────────────────────────────────────────
  async function fillDateGroup(question, answer) {
    const { month, day, year } = parseDateAnswer(answer);
    let success = true;

    const monthStr = String(month).padStart(2, '0');
    const dayStr   = String(day).padStart(2, '0');
    const yearStr  = String(year);

    console.log('[SurveyBot] Filling date-group:', monthStr, '/', dayStr, '/', yearStr);

    if (question.monthEl) {
      const ok = await typeText(question.monthEl, monthStr);
      if (!ok) success = false;
      await sleepRandom([200, 400]);
    }
    if (question.dayEl) {
      const ok = await typeText(question.dayEl, dayStr);
      if (!ok) success = false;
      await sleepRandom([200, 400]);
    }
    if (question.yearEl) {
      const ok = await typeText(question.yearEl, yearStr);
      if (!ok) success = false;
    }

    return success;
  }

  function parseDateAnswer(answer) {
    if (!answer) return defaultDate();
    const str = String(answer).trim();

    // YYYY-MM-DD or YYYY/MM/DD
    let m = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (m) return { year: parseInt(m[1]), month: parseInt(m[2]), day: parseInt(m[3]) };

    // DD/MM/YYYY or DD-MM-YYYY
    m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m) return { day: parseInt(m[1]), month: parseInt(m[2]), year: parseInt(m[3]) };

    // MM/DD/YYYY (US format — check if first number <= 12)
    m = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (m && parseInt(m[1]) <= 12) return { month: parseInt(m[1]), day: parseInt(m[2]), year: parseInt(m[3]) };

    // Just a year like "1998"
    if (/^\d{4}$/.test(str)) return { year: parseInt(str), month: 6, day: 15 };

    // Just an age number like "28"
    if (/^\d{1,3}$/.test(str)) {
      const age = parseInt(str);
      if (age > 0 && age < 130) {
        return { year: new Date().getFullYear() - age, month: 6, day: 15 };
      }
    }

    return defaultDate();
  }

  function defaultDate() {
    return { month: 6, day: 15, year: new Date().getFullYear() - 25 };
  }

  // ─── Semantic Synonym Dictionary ──────────────────────────────────────────
  const SYNONYM_MAP = {
    'male': ['man', 'masculine', 'he/him', 'boy'],
    'female': ['woman', 'feminine', 'she/her', 'girl'],
    'man': ['male'],
    'woman': ['female'],
    'yes': ['definitely', 'agree', 'true', 'certainly', 'yep', 'yeah', 'positive', 'i do', 'always'],
    'no': ['definitely not', 'disagree', 'false', 'never', 'nope', 'nah', 'negative', 'i do not', 'none'],
    'employed full-time': ['full-time', 'full time', 'employed (full-time)', 'working full-time', '30+ hours', 'salaried'],
    'employed part-time': ['part-time', 'part time', 'employed (part-time)', 'working part-time', '<30 hours'],
    'self-employed': ['freelancer', 'business owner', 'contractor', 'independent contractor', 'own business'],
    'unemployed': ['looking for work', 'not working', 'job seeker', 'unemployed and looking'],
    'retired': ['retiree', 'in retirement'],
    'student': ['in school', 'full-time student', 'part-time student', 'university student'],
    'married': ['in a domestic partnership', 'living with partner', 'partnered', 'civil union', 'married or domestic partnership'],
    'single': ['never married', 'unmarried', 'separated', 'divorced', 'widowed', 'not married'],
    "bachelor's degree": ["bachelor's", 'bachelors degree', '4-year college', 'undergraduate', 'bachelor of arts', 'bachelor of science', 'ba', 'bs', 'college graduate'],
    "master's degree": ["master's", 'masters degree', 'graduate degree', 'postgraduate', 'ma', 'ms', 'mba'],
    'doctorate / ph.d.': ['phd', 'doctorate', 'doctoral', 'doctor of philosophy', 'md', 'jd', 'post-graduate'],
    'high school or less': ['high school', 'high school / ged', 'ged', 'secondary school', '12th grade', 'some high school'],
    'some college': ['some college, no degree', 'associate degree', "associate's", 'trade school', 'vocational'],
    'white / caucasian': ['white', 'caucasian', 'european'],
    'black / african american': ['black', 'african american', 'african'],
    'hispanic / latino': ['hispanic', 'latino', 'latina', 'latinx'],
    'asian': ['asian american', 'east asian', 'south asian', 'asian / pacific islander'],
    'very conservative': ['conservative', 'strong conservative', 'right-wing', 'republican'],
    'conservative': ['somewhat conservative', 'right-leaning', 'republican', 'very conservative'],
    'very liberal': ['liberal', 'strong liberal', 'left-wing', 'progressive', 'democrat'],
    'liberal': ['somewhat liberal', 'left-leaning', 'democrat', 'progressive', 'very liberal'],
    'moderate / independent': ['moderate', 'independent', 'centrist', 'middle of the road', 'undecided', 'apolitical'],
    'strongly agree': ['completely agree', '5 - strongly agree', '5 (strongly agree)', '5', 'agree strongly', 'strongly approve'],
    'agree': ['somewhat agree', 'tend to agree', '4 - agree', '4', 'mostly agree', 'somewhat approve'],
    'neutral': ['neither agree nor disagree', 'undecided', 'no opinion', '3 - neutral', '3', 'neutral / no opinion'],
    'disagree': ['somewhat disagree', 'tend to disagree', '2 - disagree', '2', 'mostly disagree', 'somewhat disapprove'],
    'strongly disagree': ['completely disagree', '1 - strongly disagree', '1 (strongly disagree)', '1', 'disagree strongly', 'strongly disapprove'],
    'a great deal': ['a lot', 'very much', 'extremely', 'always', 'high trust', '5', 'completely'],
    'a lot': ['a great deal', 'very much', 'mostly', '4'],
    'a moderate amount': ['somewhat', 'moderately', 'moderate', '3', 'a fair amount'],
    'a little': ['not much', 'slightly', '2', 'a small amount'],
    'not at all': ['never', 'none', 'zero', 'no trust', '1', 'not very much', 'not likely at all']
  };

  // ─── Find best matching option ─────────────────────────────────────────────
  function findBestOption(options, answer) {
    if (!options?.length || answer === undefined || answer === null) return null;
    const ansRaw = String(answer).trim();
    const ansNorm = normalize(ansRaw);
    if (!ansNorm) return options[0] || null;

    let best = null, bestScore = 0;

    for (const opt of options) {
      const optRaw = String(opt.text || opt.value || '').trim();
      const optNorm = normalize(optRaw);
      const optClean = stripNoisePrefix(optNorm);
      const ansClean = stripNoisePrefix(ansNorm);

      let score = 0;

      // 1. Exact match (case/whitespace normalized)
      if (optNorm === ansNorm || optClean === ansClean) {
        score = 1.0;
      }
      // 2. Numeric / Scale equivalence (e.g. answer "5" matches "5 - Strongly Agree" or "5/5")
      else if (/^\d+$/.test(ansClean)) {
        const num = parseInt(ansClean, 10);
        const optNumMatch = optClean.match(/^(\d+)[\s\-\:\.\)]+/);
        if (optNumMatch && parseInt(optNumMatch[1], 10) === num) {
          score = 0.96;
        } else if (optClean === String(num)) {
          score = 0.98;
        }
      }
      // 3. Synonym matching
      if (score < 0.9) {
        const syns = SYNONYM_MAP[ansClean] || SYNONYM_MAP[ansNorm] || [];
        for (const syn of syns) {
          if (optClean === syn || optClean.includes(syn) || syn.includes(optClean)) {
            score = Math.max(score, 0.93);
            break;
          }
        }
      }
      // 4. Reverse synonym matching
      if (score < 0.9) {
        const optSyns = SYNONYM_MAP[optClean] || SYNONYM_MAP[optNorm] || [];
        for (const syn of optSyns) {
          if (ansClean === syn || ansClean.includes(syn) || syn.includes(ansClean)) {
            score = Math.max(score, 0.92);
            break;
          }
        }
      }
      // 5. Parenthetical note stripping (e.g. "Employed (Full-Time 30+ hrs)" <=> "Employed Full-Time")
      if (score < 0.85) {
        const optCore = normalize(optRaw.replace(/\([^\)]*\)/g, ''));
        const ansCore = normalize(ansRaw.replace(/\([^\)]*\)/g, ''));
        if (optCore && ansCore && (optCore === ansCore || optCore.includes(ansCore) || ansCore.includes(optCore))) {
          score = Math.max(score, 0.88);
        }
      }
      // 6. Substring containment
      if (score < 0.8) {
        if (optClean.includes(ansClean) || ansClean.includes(optClean)) {
          score = Math.max(score, 0.82);
        }
      }
      // 7. Token overlap and Dice similarity
      if (score < 0.7) {
        const sim = similarity(ansClean, optClean);
        if (sim > 0.5) score = Math.max(score, sim * 0.8);
      }

      if (score > bestScore) {
        bestScore = score;
        best = opt;
      }
    }

    // If score is reasonable, return best match; otherwise fallback to first option
    return bestScore > 0.25 ? best : (options[0] || null);
  }

  function stripNoisePrefix(str) {
    return str
      .replace(/^(option\s*\d+[\:\.\-\s]*|[0-9]+[\.\)\:\-\s]+|[a-z][\.\)\:\-\s]+|[•\-–—\*]\s*)/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalize(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, ' ').trim();
  }

  function similarity(a, b) {
    if (a === b) return 1;
    if (!a || !b || a.length < 2 || b.length < 2) return 0;
    const bg = new Map();
    for (let i = 0; i < a.length - 1; i++) {
      const bi = a.substring(i, i + 2);
      bg.set(bi, (bg.get(bi) || 0) + 1);
    }
    let inter = 0;
    for (let i = 0; i < b.length - 1; i++) {
      const bi = b.substring(i, i + 2);
      const c = bg.get(bi) || 0;
      if (c > 0) { bg.set(bi, c - 1); inter++; }
    }
    return (2 * inter) / (a.length + b.length - 2);
  }

  // ─── Verify a fill worked ─────────────────────────────────────────────────
  function verifyFill(element, expectedValue) {
    if (!element) return false;
    const actual = getInputValue(element);
    return actual === String(expectedValue);
  }

  return { fill, typeText, setSpeed, sleep, sleepRandom, getConfig, scrollTo, verifyFill, getInputValue };
})();

window.SurveyBot = SurveyBot;
