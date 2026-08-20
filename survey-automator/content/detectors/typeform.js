// ─── Typeform Detector ────────────────────────────────────────────────────────
// Handles Typeform's one-question-at-a-time navigation and data-qa attributes.

var SurveyBot = window.SurveyBot || {};
SurveyBot.Detectors = SurveyBot.Detectors || {};

SurveyBot.Detectors.Typeform = (function () {

  function detect() {
    return (
      window.location.hostname.includes('typeform.com') ||
      !!document.querySelector('[data-qa="form-view"]') ||
      !!document.querySelector('[class*="typeform"]')
    );
  }

  function parseQuestions() {
    const questions = [];

    // Typeform shows one question at a time — get the active/visible one
    const activeQuestion = getActiveQuestion();
    if (!activeQuestion) return questions;

    const q = parseContainer(activeQuestion, 0);
    if (q) questions.push(q);

    return questions;
  }

  function getActiveQuestion() {
    // Typeform highlights the current question
    return (
      document.querySelector('[data-qa="focused-question"]') ||
      document.querySelector('.is-focused') ||
      document.querySelector('[class*="question"][class*="current"]') ||
      document.querySelector('[class*="QuestionWrapper"]:not([aria-hidden="true"])') ||
      document.querySelector('[data-qa="question"]')
    );
  }

  function parseContainer(container, idx) {
    const titleEl = container.querySelector(
      '[data-qa="question-title"], ' +
      '[class*="question-title"], ' +
      'h1, h2, legend'
    );
    const questionTitle = titleEl.textContent.trim();
    if (!questionTitle) return null;

    const descEl = container.querySelector('[data-qa="question-description"], [class*="Description"], [class*="subtitle"], p');
    const descText = descEl ? descEl.textContent.trim() : '';
    const questionText = descText ? `${questionTitle} [Note: ${descText}]` : questionTitle;

    const required = container.querySelector('[aria-required="true"]') !== null;

    // Typeform types
    const radioInputs = container.querySelectorAll('input[type="radio"]');
    const checkboxInputs = container.querySelectorAll('input[type="checkbox"]');
    const textInput = container.querySelector('input[type="text"], input[type="email"], input[type="number"], input[type="tel"]');
    const textarea = container.querySelector('textarea');
    const select = container.querySelector('select');
    const yesNoBtns = container.querySelectorAll('[data-qa="yes-button"], [data-qa="no-button"]');
    const opinionScale = container.querySelectorAll('[data-qa*="scale"], [class*="OpinionScale"] button');
    const ratingStars = container.querySelectorAll('[data-qa*="rating"], [class*="Rating"] button, [class*="star"]');

    let type = 'unknown';
    let options = [];
    let element = container;

    if (yesNoBtns.length >= 2) {
      type = 'radio';
      yesNoBtns.forEach(btn => {
        options.push({ text: btn.textContent.trim(), element: btn });
      });
      element = container;
    } else if (opinionScale.length > 0) {
      type = 'scale';
      opinionScale.forEach(btn => {
        options.push({ text: btn.textContent.trim(), element: btn });
      });
      element = container;
    } else if (ratingStars.length > 0) {
      type = 'rating';
      ratingStars.forEach(btn => {
        options.push({ text: btn.textContent.trim() || btn.getAttribute('aria-label') || '', element: btn });
      });
      element = container;
    } else if (radioInputs.length > 0) {
      type = 'radio';
      radioInputs.forEach(input => {
        const label = document.querySelector(`label[for="${input.id}"]`) ||
                      input.closest('label');
        const text = label ? label.textContent.trim() : input.value;
        if (text) options.push({ text, element: input });
      });
      element = radioInputs[0];
    } else if (checkboxInputs.length > 0) {
      type = 'checkbox';
      checkboxInputs.forEach(input => {
        const label = document.querySelector(`label[for="${input.id}"]`) ||
                      input.closest('label');
        const text = label ? label.textContent.trim() : input.value;
        if (text) options.push({ text, element: input });
      });
      element = container;
    } else if (select) {
      type = 'select';
      Array.from(select.options).forEach(opt => {
        if (opt.value) options.push({ text: opt.text, element: opt, value: opt.value });
      });
      element = select;
    } else if (textarea) {
      type = 'textarea';
      element = textarea;
    } else if (textInput) {
      type = 'text';
      element = textInput;
    }

    return {
      id: `tf_${idx}`,
      platform: 'typeform',
      text: questionText,
      type,
      options,
      element,
      container,
      required,
    };
  }

  function clickNext() {
    // Typeform uses Enter key or explicit next buttons
    const nextBtn = document.querySelector(
      '[data-qa="ok-button"], ' +
      '[class*="button"][class*="next"], ' +
      'button[aria-label*="next" i]'
    );
    if (nextBtn) {
      nextBtn.click();
      return true;
    }
    // Typeform often advances with Enter
    const active = document.activeElement;
    if (active) {
      active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    }
    return false;
  }

  function hasNextPage() {
    return !!(
      document.querySelector('[data-qa="ok-button"]') ||
      document.querySelector('[class*="button"][class*="next"]')
    );
  }

  function hasSubmit() {
    return !!(
      document.querySelector('[data-qa="submit-button"]') ||
      document.querySelector('button[type="submit"]')
    );
  }

  function isComplete() {
    return !!(
      document.querySelector('[data-qa="thankyou-screen"]') ||
      document.querySelector('[class*="ThankYou"], [class*="thank-you"]') ||
      document.querySelector('[class*="end-screen"]')
    );
  }

  return {
    name: 'typeform',
    label: 'Typeform',
    detect,
    parseQuestions,
    clickNext,
    hasNextPage,
    hasSubmit,
    isComplete,
  };
})();

window.SurveyBot = SurveyBot;
