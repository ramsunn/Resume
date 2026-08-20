// ─── Generic HTML Form Detector (v2) ─────────────────────────────────────────
// Universal fallback detector for any survey page.
// Works without <form> tags — handles modern React/Vue survey apps.
// Includes special handling for split date fields (MM / DD / YYYY).

var SurveyBot = window.SurveyBot || {};
SurveyBot.Detectors = SurveyBot.Detectors || {};

SurveyBot.Detectors.Generic = (function () {

  // ─── detect ───────────────────────────────────────────────────────────────
  // Always returns true — this is the universal fallback detector.
  function detect() {
    const inputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="reset"]), select, textarea, [role="radio"], [role="checkbox"], [role="textbox"], [contenteditable="true"], [role="combobox"], [role="listbox"], .text-input, .form-control'
    );
    if (inputs.length >= 1) return true;

    // Check same-origin child iframes if top frame
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      try {
        if (iframe.contentDocument && iframe.contentDocument.querySelectorAll('input:not([type="hidden"]), select, textarea, [role="radio"], [role="checkbox"]').length >= 1) {
          return true;
        }
      } catch (e) {}
    }
    return false;
  }

  // ─── parseQuestions ───────────────────────────────────────────────────────
  function parseQuestions() {
    const questions = [];
    const processed = new Set();
    let idx = 0;

    // ── Strategy 0: Date field groups (MM/DD/YYYY or separate month/day/year) ──
    const dateGroups = detectDateGroups();
    for (const dg of dateGroups) {
      questions.push(dg);
      if (dg.monthEl) processed.add(dg.monthEl);
      if (dg.dayEl)   processed.add(dg.dayEl);
      if (dg.yearEl)  processed.add(dg.yearEl);
      idx++;
    }

    // ── Strategy 1: Fieldsets with legends ────────────────────────────────────
    document.querySelectorAll('fieldset').forEach(fieldset => {
      const legend = fieldset.querySelector('legend');
      if (!legend) return;
      const inputs = Array.from(fieldset.querySelectorAll('input, select, textarea'))
        .filter(i => !processed.has(i) && isVisible(i));
      if (!inputs.length) return;

      if (inputs.every(i => i.type === 'radio' || i.getAttribute('role') === 'radio') || 
          inputs.every(i => i.type === 'checkbox' || i.getAttribute('role') === 'checkbox')) {
        const q = classifyInputGroup(legend.textContent.trim(), fieldset, inputs, idx++);
        if (q) { questions.push(q); inputs.forEach(i => processed.add(i)); }
      } else {
        const qText = legend.textContent.trim();
        inputs.forEach((inp, itemIdx) => {
           let prefix = '';
           const prev = inp.previousElementSibling || inp.parentElement?.querySelector('span, label, strong, b, div');
           if (prev && prev !== inp) {
             const pt = prev.textContent.trim();
             if (pt && pt.length < 20 && pt !== qText) prefix = pt;
           }
           const itemText = prefix ? `${qText} [${prefix}]` : (inputs.length > 1 ? `${qText} (Item ${itemIdx + 1})` : qText);
           const q = classifySingleInput(itemText, inp, null, idx++);
           if (q) { questions.push(q); processed.add(inp); }
        });
      }
    });

    // ── Strategy 2: Labeled inputs ────────────────────────────────────────────
    document.querySelectorAll('label').forEach(label => {
      const forAttr = label.getAttribute('for');
      let input = forAttr ? document.getElementById(forAttr) : label.querySelector('input, select, textarea');
      if (!input || processed.has(input) || !isVisible(input)) return;
      if (['hidden','submit','button','image','reset'].includes(input.type)) return;

      const text = label.textContent.replace(/[*†‡✱]/g, '').trim();
      if (!text) return;

      const q = classifySingleInput(text, input, label, idx++);
      if (q) { questions.push(q); processed.add(input); }
    });

    // ── Strategy 3: Heading/paragraph near inputs (for formless survey apps) ──
    // Finds the nearest visible text heading above each input group
    const allInputs = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="reset"]), select, textarea, [role="radio"], [role="checkbox"]'
    )).filter(i => isVisible(i) && !processed.has(i));

    // Group inputs that are siblings / share a container
    const inputGroups = groupNearbyInputs(allInputs);

    for (const group of inputGroups) {
      if (group.every(i => processed.has(i))) continue;

      const questionText = findNearestQuestionText(group[0]) ||
        group[0].getAttribute('placeholder') ||
        group[0].getAttribute('aria-label') ||
        group[0].getAttribute('name') || '';

      if (!questionText) { group.forEach(i => processed.add(i)); continue; }

      if (group.every(i => i.type === 'radio' || i.getAttribute('role') === 'radio')) {
        // Radio group
        const opts = extractGroupOptions(group);
        questions.push({ id: `gen_${idx++}`, platform: 'generic', text: questionText,
          type: 'radio', options: opts, element: group[0], container: group[0].closest('div, section, form, tr, fieldset') || document.body, required: group[0].required || false });
        group.forEach(i => processed.add(i));
      } else if (group.every(i => i.type === 'checkbox' || i.getAttribute('role') === 'checkbox')) {
        // Checkbox group
        const opts = extractGroupOptions(group);
        questions.push({ id: `gen_${idx++}`, platform: 'generic', text: questionText,
          type: 'checkbox', options: opts, element: group[0], container: group[0].closest('div, section, form, tr, fieldset') || document.body, required: group[0].required || false });
        group.forEach(i => processed.add(i));
      } else if (group.length === 1) {
        const q = classifySingleInput(questionText, group[0], null, idx++);
        if (q) { questions.push(q); processed.add(group[0]); }
      } else {
        // Multiple text / number / dropdown inputs under one question prompt (e.g. list inputs 1., 2., 3., 4.)
        group.forEach((inp, itemIdx) => {
          if (processed.has(inp)) return;
          let prefix = '';
          const prev = inp.previousElementSibling || inp.parentElement?.querySelector('span, label, strong, b, div');
          if (prev && prev !== inp) {
            const pt = prev.textContent.trim();
            if (pt && pt.length < 20 && pt !== questionText) prefix = pt;
          }
          const itemText = prefix ? `${questionText} [${prefix}]` : (group.length > 1 ? `${questionText} (Item ${itemIdx + 1})` : questionText);
          const q = classifySingleInput(itemText, inp, null, idx++);
          if (q) { questions.push(q); processed.add(inp); }
        });
      }
    }

    // ── Strategy 4: Unprocessed visible inputs catch-all ───────────────────────
    const remaining = Array.from(document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="reset"]), select, textarea'
    )).filter(i => isVisible(i) && !processed.has(i));

    for (const inp of remaining) {
      const qText = findNearestQuestionText(inp) || inp.placeholder || inp.getAttribute('aria-label') || 'Question';
      const q = classifySingleInput(qText, inp, null, idx++);
      if (q) { questions.push(q); processed.add(inp); }
    }

    return questions;
  }

  // ─── Date Group Detection ──────────────────────────────────────────────────
  function detectDateGroups() {
    const groups = [];

    // Selectors for month, day, year inputs
    const MONTH_SEL = [
      'input[placeholder="MM"]', 'input[placeholder="Month"]',
      'input[name*="month" i]',  'input[id*="month" i]',
      'input[aria-label*="month" i]',
    ].join(', ');

    const DAY_SEL = [
      'input[placeholder="DD"]', 'input[placeholder="Day"]',
      'input[name*="day" i]',   'input[id*="day" i]',
      'input[aria-label*="day" i]',
    ].join(', ');

    const YEAR_SEL = [
      'input[placeholder="YYYY"]', 'input[placeholder="Year"]',
      'input[name*="year" i]',    'input[id*="year" i]',
      'input[aria-label*="year" i]',
    ].join(', ');

    // Strategy A: explicit month input found
    document.querySelectorAll(MONTH_SEL).forEach(monthEl => {
      if (!isVisible(monthEl)) return;
      const container = monthEl.closest('div, section, form, fieldset') || document.body;
      const dayEl  = container.querySelector(DAY_SEL);
      const yearEl = container.querySelector(YEAR_SEL);

      if (monthEl && (dayEl || yearEl)) {
        const questionText = findNearestQuestionText(monthEl) || 'Date of Birth';
        groups.push({
          id: 'gen_date_0',
          platform: 'generic',
          text: questionText,
          type: 'date-group',
          monthEl,
          dayEl: dayEl || null,
          yearEl: yearEl || null,
          element: monthEl,
          container,
          required: monthEl.required,
          options: [],
        });
      }
    });

    // Strategy B: Three consecutive numeric inputs (fallback for unlabeled dates)
    if (groups.length === 0) {
      const numericInputs = Array.from(document.querySelectorAll('input[type="number"], input[type="text"], input[type="tel"]'))
        .filter(i => isVisible(i) && !i.value);

      // Look for triplet
      for (let i = 0; i + 2 < numericInputs.length; i++) {
        const a = numericInputs[i];
        const b = numericInputs[i + 1];
        const c = numericInputs[i + 2];

        const aLen = parseInt(a.maxLength) || parseInt(a.size) || (a.placeholder === 'MM' ? 2 : 0);
        const bLen = parseInt(b.maxLength) || parseInt(b.size) || (b.placeholder === 'DD' ? 2 : 0);
        const cLen = parseInt(c.maxLength) || parseInt(c.size) || (c.placeholder === 'YYYY' ? 4 : 0);

        // Check if placeholders directly match MM DD YYYY
        const matchesPlaceholder = (a.placeholder === 'MM' && b.placeholder === 'DD' && c.placeholder === 'YYYY');
        
        // Or if aria-labels indicate date parts
        const aLabel = (a.getAttribute('aria-label') || '').toLowerCase();
        const cLabel = (c.getAttribute('aria-label') || '').toLowerCase();
        const matchesLabel = aLabel.includes('month') && cLabel.includes('year');

        // Classic: 2 + 2 + 4 (MM/DD/YYYY) OR matches placeholder/label
        if ((aLen <= 2 && bLen <= 2 && cLen === 4) || matchesPlaceholder || matchesLabel) {
          const questionText = findNearestQuestionText(a) || 'Date of Birth';
          groups.push({
            id: 'gen_date_triplet',
            platform: 'generic',
            text: questionText,
            type: 'date-group',
            monthEl: a,
            dayEl: b,
            yearEl: c,
            element: a,
            container: a.closest('div, section, form') || document.body,
            required: a.required,
            options: [],
          });
          break; // Stop after finding one triplet to avoid duplicates
        }
      }
    }

    return groups;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  // ─── Extract Options for Radio/Checkbox Groups ─────────────────────────────
  function extractGroupOptions(group) {
    return group.map((r, optIdx) => {
      let text = '';
      const lbl = r.id ? document.querySelector(`label[for="${r.id}"]`) : null;
      const labelEl = lbl || r.closest('label');

      if (labelEl) {
        text = labelEl.textContent.trim();
      } else {
        // 1. Matrix Grid Column Header Detection
        const td = r.closest('td, th, [role="gridcell"], [role="cell"]');
        if (td) {
          const tr = td.parentElement;
          const cellIndex = Array.from(tr.children).indexOf(td);
          const table = tr.closest('table, tbody, thead, [role="grid"], .matrix, .grid-container');
          if (table) {
            const headerRow = table.querySelector('thead tr, tr.headers, tr.headings, tr:has(th), tr:first-child');
            if (headerRow && headerRow !== tr && headerRow.children.length > cellIndex) {
              const headerCell = headerRow.children[cellIndex];
              if (headerCell && headerCell.textContent.trim()) {
                text = headerCell.textContent.trim();
              }
            }
          }
        }

        // 2. Custom grid / columnheader lookup
        if (!text) {
          const colHeaders = document.querySelectorAll('[role="columnheader"], .matrix-header-cell, th');
          if (colHeaders[optIdx] && colHeaders[optIdx].textContent.trim()) {
            text = colHeaders[optIdx].textContent.trim();
          }
        }

        // 3. Fallback attributes
        if (!text) {
          text = r.getAttribute('aria-label') ||
                 r.getAttribute('data-label') ||
                 r.getAttribute('title') ||
                 r.textContent.trim() ||
                 r.value || '';
        }
      }

      return { text: text.replace(/\s+/g, ' ').trim(), element: labelEl || r, value: r.value };
    }).filter(o => o.text);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function findNearestQuestionText(el) {
    // 1. Check if it's inside a matrix grid row (like a table tr or .row)
    let rowLabel = '';
    const row = el.closest('tr, [role="row"], .row, .grid-row, .matrix-row');
    if (row) {
      const rowHeader = row.querySelector('th, [role="rowheader"], td:first-child, .row-label, .statement, .matrix-label, [class*="label"]');
      if (rowHeader && !rowHeader.contains(el) && rowHeader.textContent.trim().length > 1) {
        rowLabel = rowHeader.textContent.trim().replace(/\s+/g, ' ');
      }
    }

    // 2. Check enclosing structured question containers (Qualtrics, SurveyMonkey, Google Forms, Decipher)
    const container = el.closest('fieldset, .question, .survey-question, .form-group, [data-question-id], [data-testid*="question"], .matrix, table, [role="radiogroup"]');
    let containerTitle = '';
    let containerDesc = '';

    if (container) {
      const titleEl = container.querySelector('legend, h1, h2, h3, h4, .question-title, [class*="QuestionTitle"], [class*="question-title"], [role="heading"], strong');
      if (titleEl && !titleEl.contains(el)) {
        containerTitle = titleEl.textContent.trim().replace(/\s+/g, ' ');
      }

      const descEl = container.querySelector('.question-description, .instruction, .sub-title, p, .help-text, small');
      if (descEl && !descEl.contains(el) && descEl !== titleEl) {
        const descText = descEl.textContent.trim().replace(/\s+/g, ' ');
        if (descText.length > 5 && !containerTitle.includes(descText)) {
          containerDesc = descText;
        }
      }
    }

    // 3. Walk up DOM to find preceding heading/paragraph if container title wasn't found
    let precedingHeading = '';
    let precedingDesc = '';
    if (!containerTitle) {
      let node = el.parentElement;
      for (let depth = 0; depth < 8 && node && node !== document.body; depth++) {
        let sib = node.previousElementSibling;
        while (sib) {
          const tag = sib.tagName.toLowerCase();
          const sibText = sib.textContent.trim().replace(/\s+/g, ' ');
          if (['h1','h2','h3','h4','h5','h6','legend'].includes(tag) || sib.getAttribute('role') === 'heading') {
            if (sibText.length > 2 && !precedingHeading) precedingHeading = sibText;
          } else if (['p','span','div','label'].includes(tag) && sibText.length > 3) {
            if (!precedingDesc && sibText !== precedingHeading) precedingDesc = sibText;
          }
          sib = sib.previousElementSibling;
        }
        if (precedingHeading) break;
        node = node.parentElement;
      }
    }

    const mainTitle = containerTitle || precedingHeading;
    const instructions = containerDesc || precedingDesc;

    // 4. Combine into rich structured question text
    let fullQuestion = '';
    if (mainTitle && rowLabel) {
      fullQuestion = `${mainTitle} - Item: ${rowLabel}`;
    } else if (mainTitle) {
      fullQuestion = mainTitle;
    } else if (rowLabel) {
      fullQuestion = rowLabel;
    }

    if (instructions && instructions !== mainTitle && instructions.length > 5 && instructions.length < 200) {
      fullQuestion += ` [Note: ${instructions}]`;
    }

    return fullQuestion.trim() || null;
  }

  function groupNearbyInputs(inputs) {
    // Group inputs that share the same name, or share the same direct parent/grandparent
    const groups = [];
    const seen = new Set();

    for (const input of inputs) {
      if (seen.has(input)) continue;

      // 1. Group by name (crucial for radio buttons in separate divs)
      if (input.name && (input.type === 'radio' || input.type === 'checkbox')) {
        const siblingsByName = inputs.filter(i => i.name === input.name);
        if (siblingsByName.length > 1) {
          groups.push(siblingsByName);
          siblingsByName.forEach(s => seen.add(s));
          continue;
        }
      }

      // 2. Tiered grouping for inputs without a name attribute
      let parent = input.closest('tr, [role="row"], .row, .grid-row');
      if (!parent) parent = input.closest('[role="radiogroup"], fieldset, .radio-group, .checkbox-group, .question-container');
      if (!parent) parent = input.parentElement;

      // 2. Group by immediate container
      const siblings = Array.from(parent.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea, [role="radio"], [role="checkbox"]'
      )).filter(i => inputs.includes(i) && !seen.has(i));

      if (siblings.length > 0) {
        groups.push(siblings);
        siblings.forEach(i => seen.add(i));
      }
    }
    return groups;
  }

  function classifyInputGroup(questionText, container, inputs, idx) {
    const firstInput = inputs[0];
    let type = 'unknown', options = [], element = container;

    if (inputs.every(i => i.type === 'radio')) {
      type = 'radio';
      inputs.forEach(input => {
        const lbl = document.querySelector(`label[for="${input.id}"]`) || input.closest('label') || input.parentElement;
        const text = lbl ? lbl.textContent.trim() : input.value;
        if (text) options.push({ text, element: input });
      });
    } else if (inputs.every(i => i.type === 'checkbox')) {
      type = 'checkbox';
      inputs.forEach(input => {
        const lbl = document.querySelector(`label[for="${input.id}"]`) || input.closest('label') || input.parentElement;
        const text = lbl ? lbl.textContent.trim() : input.value;
        if (text) options.push({ text, element: input });
      });
    } else {
      return classifySingleInput(questionText, firstInput, null, idx);
    }

    return { id: `gen_${idx}`, platform: 'generic', text: questionText, type, options, element, container, required: firstInput.required };
  }

  function classifySingleInput(questionText, input, label, idx) {
    let type = 'unknown', options = [];

    if (input.tagName === 'SELECT') {
      type = 'select';
      Array.from(input.options).forEach(opt => {
        if (opt.value) options.push({ text: opt.text.trim(), element: opt, value: opt.value });
      });
    } else if (input.tagName === 'TEXTAREA') {
      type = 'textarea';
    } else if (input.type === 'radio') {
      type = 'radio';
      const siblings = document.querySelectorAll(`input[type="radio"][name="${input.name}"]`);
      siblings.forEach(sib => {
        const lbl = document.querySelector(`label[for="${sib.id}"]`) || sib.closest('label');
        const text = lbl ? lbl.textContent.trim() : sib.value;
        if (text) options.push({ text, element: sib });
      });
    } else if (input.type === 'checkbox') {
      type = 'checkbox';
      options.push({ text: questionText, element: input });
    } else if (input.type === 'date') {
      type = 'date';
    } else if (['text','email','number','tel','url'].includes(input.type) || !input.type) {
      type = input.type === 'number' ? 'number' : 'text';
    } else if (input.type === 'range') {
      type = 'range';
    }

    return {
      id: `gen_${idx}`, platform: 'generic', text: questionText, type, options,
      element: input,
      container: label || input.closest('div, p, section, form') || input,
      required: input.required,
    };
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    
    // Radios and checkboxes are often visually hidden by frameworks (opacity:0, clip-path, display:none)
    if (el.type === 'radio' || el.type === 'checkbox') {
        return true;
    }
    
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  // ─── Navigation ───────────────────────────────────────────────────────────
  function clickNext() {
    const NEXT_KEYWORDS = ['next', 'continue', 'proceed', 'ok', 'forward', 'next page', 'go'];
    const buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a[href="#"]');

    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').trim().toLowerCase();
      if (NEXT_KEYWORDS.some(k => text === k || text.startsWith(k))) {
        if (!btn.disabled && !btn.hasAttribute('disabled')) {
          btn.click();
          return true;
        }
      }
    }
    return false;
  }

  function hasNextPage() {
    const NEXT_KEYWORDS = ['next', 'continue', 'proceed', 'ok'];
    const buttons = document.querySelectorAll('button, input[type="submit"], [role="button"]');
    for (const btn of buttons) {
      const text = (btn.textContent || btn.value || '').trim().toLowerCase();
      if (NEXT_KEYWORDS.some(k => text === k || text.startsWith(k))) {
        if (!btn.disabled) return true;
      }
    }
    return false;
  }

  function hasSubmit() {
    return !!(document.querySelector('input[type="submit"], button[type="submit"]'));
  }

  function isComplete() {
    const bodyText = document.body.innerText.toLowerCase();
    return ['thank you', 'thanks for', 'response recorded', 'submission received', 'survey complete', 'all done'].some(p => bodyText.includes(p));
  }

  function findDashboardLinks() {
    const SURVEY_KEYWORDS = ['survey', 'poll', 'study', 'questionnaire', 'take-survey', 'start-survey', 'opinion', 'research'];
    const SURVEY_HOSTS = ['docs.google.com/forms', 'surveymonkey.com', 'typeform.com', 'qualtrics.com', 'yougov.com', 'samplicio.us', 'cint.com', 'dynata.com', 'toluna.com', 'swagbucks.com', 'ysense.com', 'primeopinion.com', 'prolific.com', 'pureprofile.com', 'octopusgroup.com.au'];

    const links = Array.from(document.querySelectorAll('a[href]'));
    const found = [];
    const seen = new Set();

    for (const a of links) {
      const href = a.href;
      if (!href || !/^https?:\/\//i.test(href) || seen.has(href)) continue;

      const text = (a.textContent || a.title || a.getAttribute('aria-label') || '').trim();
      const lowerHref = href.toLowerCase();
      const lowerText = text.toLowerCase();

      const matchesHost = SURVEY_HOSTS.some(h => lowerHref.includes(h));
      const matchesKeyword = SURVEY_KEYWORDS.some(k => lowerHref.includes(k) || lowerText.includes(k));
      const isActionButton = /^(take|start|begin|open|launch|continue|go to)\s*(survey|study|poll)?/i.test(lowerText);

      if (matchesHost || matchesKeyword || isActionButton) {
        seen.add(href);
        found.push({ url: href, title: text || href });
      }
    }
    return found;
  }

  function clickDashboardSurvey() {
    const links = findDashboardLinks();
    if (links.length > 0) {
      const first = document.querySelector(`a[href="${CSS.escape(links[0].url)}"]`);
      if (first) {
        first.click();
        return true;
      }
    }
    return false;
  }

  return {
    name: 'generic',
    label: 'HTML Form',
    detect,
    parseQuestions,
    clickNext,
    hasNextPage,
    hasSubmit,
    isComplete,
    findDashboardLinks,
    clickDashboardSurvey,
  };
})();

window.SurveyBot = SurveyBot;
