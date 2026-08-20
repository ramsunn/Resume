// ─── SurveyMonkey Detector ────────────────────────────────────────────────────
// Parses SurveyMonkey pages — handles their React-rendered question blocks.

var SurveyBot = window.SurveyBot || {};
SurveyBot.Detectors = SurveyBot.Detectors || {};

SurveyBot.Detectors.SurveyMonkey = (function () {

  function detect() {
    return (
      window.location.hostname.includes('surveymonkey.com') ||
      window.location.hostname.includes('surveymonkey.net')
    );
  }

  function parseQuestions() {
    const questions = [];

    // SurveyMonkey uses data-testid for question rows
    const containers = document.querySelectorAll(
      '[data-testid^="question"], ' +
      '.question-container, ' +
      '.survey-question, ' +
      '[class*="QuestionTitle"], ' +
      '[class*="question-row"]'
    );

    // Fallback: find by fieldset or common wrappers
    const els = containers.length > 0 ? containers :
      document.querySelectorAll('fieldset, [class*="sm-question"]');

    els.forEach((container, idx) => {
      const titleEl = container.querySelector(
        '[data-testid="question-title"], ' +
        'legend, ' +
        'h2, h3, ' +
        '[class*="QuestionTitle"], ' +
        '[class*="question-title"]'
      );
      if (!titleEl) return;
      const questionTitle = titleEl.textContent.trim();
      if (!questionTitle) return;

      const descEl = container.querySelector('[data-testid="question-subtitle"], .question-description, .instruction-text, small');
      const descText = descEl ? descEl.textContent.trim() : '';
      const questionText = descText ? `${questionTitle} [Note: ${descText}]` : questionTitle;

      const required = container.querySelector('[aria-required="true"]') !== null ||
                       container.querySelector('[class*="required"]') !== null;

      // Detect type
      const radioInputs = container.querySelectorAll('input[type="radio"]');
      const checkboxInputs = container.querySelectorAll('input[type="checkbox"]');
      const textInput = container.querySelector('input[type="text"]');
      const textarea = container.querySelector('textarea');
      const select = container.querySelector('select');
      const ratingEls = container.querySelectorAll('[class*="rating"], [class*="star"]');
      const matrixRows = container.querySelectorAll('[class*="matrix-row"], tr[data-questionid]');

      let type = 'unknown';
      let options = [];
      let element = container;

      if (radioInputs.length > 0) {
        type = 'radio';
        radioInputs.forEach(input => {
          const labelEl = document.querySelector(`label[for="${input.id}"]`) ||
                         input.closest('label') ||
                         input.parentElement;
          const text = labelEl ? labelEl.textContent.trim() : '';
          if (text) options.push({ text, element: input });
        });
        element = radioInputs[0];
      } else if (checkboxInputs.length > 0) {
        type = 'checkbox';
        checkboxInputs.forEach(input => {
          const labelEl = document.querySelector(`label[for="${input.id}"]`) ||
                         input.closest('label') ||
                         input.parentElement;
          const text = labelEl ? labelEl.textContent.trim() : '';
          if (text) options.push({ text, element: input });
        });
        element = container;
      } else if (matrixRows.length > 0) {
        type = 'matrix';
        element = container;
      } else if (ratingEls.length > 0) {
        type = 'rating';
        element = container;
      } else if (select) {
        type = 'select';
        Array.from(select.options).forEach(opt => {
          if (opt.value) options.push({ text: opt.text.trim(), element: opt, value: opt.value });
        });
        element = select;
      } else if (textarea) {
        type = 'textarea';
        element = textarea;
      } else if (textInput) {
        type = 'text';
        element = textInput;
      }

      questions.push({
        id: `sm_${idx}`,
        platform: 'surveymonkey',
        text: questionText,
        type,
        options,
        element,
        container,
        required,
      });
    });

    return questions;
  }

  function clickNext() {
    // SurveyMonkey next buttons
    const candidates = [
      document.querySelector('[data-testid="next-button"]'),
      document.querySelector('button[title="Next"]'),
      document.querySelector('.sm-btn-next'),
      document.querySelector('[class*="next-button"]'),
    ];
    for (const btn of candidates) {
      if (btn && !btn.disabled) {
        btn.click();
        return true;
      }
    }
    // Text fallback
    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      if (btn.textContent.trim().toLowerCase() === 'next') {
        btn.click();
        return true;
      }
    }
    return false;
  }

  function hasNextPage() {
    return !!(
      document.querySelector('[data-testid="next-button"]') ||
      document.querySelector('.sm-btn-next')
    );
  }

  function hasSubmit() {
    return !!(
      document.querySelector('[data-testid="submit-button"]') ||
      document.querySelector('.sm-btn-submit')
    );
  }

  function isComplete() {
    return !!(
      document.querySelector('[class*="completion"], [class*="thank-you"], [class*="thankyou"]') ||
      document.title.toLowerCase().includes('thank') ||
      document.querySelector('.survey-completed')
    );
  }

  return {
    name: 'surveymonkey',
    label: 'SurveyMonkey',
    detect,
    parseQuestions,
    clickNext,
    hasNextPage,
    hasSubmit,
    isComplete,
  };
})();

window.SurveyBot = SurveyBot;
