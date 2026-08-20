// ─── Google Forms Detector ────────────────────────────────────────────────────
// Parses Google Forms survey pages and provides DOM interaction methods.

var SurveyBot = window.SurveyBot || {};
SurveyBot.Detectors = SurveyBot.Detectors || {};

SurveyBot.Detectors.GoogleForms = (function () {

  function detect() {
    return (
      window.location.hostname === 'docs.google.com' &&
      window.location.pathname.startsWith('/forms/')
    );
  }

  function parseQuestions() {
    const questions = [];

    // Google Forms question containers
    const containers = document.querySelectorAll(
      '.freebirdFormviewerViewItemsItemItem, ' +
      '[data-item-id], ' +
      '.Qr7Oae'
    );

    containers.forEach((container, idx) => {
      // Question title — try multiple selectors as Google changes class names
      const titleEl = container.querySelector(
        '.freebirdFormviewerViewItemsItemItemTitle, ' +
        '.M7eMe, ' +
        '[role="heading"], ' +
        '.HoXoMd'
      );
      const questionTitle = titleEl.textContent.trim();
      if (!questionTitle) return;

      // Question description/subtext
      const descEl = container.querySelector('.z3HNkc, .c2yD0b, .Y5sE8d, .m2JcT');
      const descText = descEl ? descEl.textContent.trim() : '';
      const questionText = descText ? `${questionTitle} [Note: ${descText}]` : questionTitle;

      // Required marker
      const required = container.querySelector('[aria-required="true"], .freebirdFormviewerViewItemsItemRequiredAsterisk') !== null;

      // Determine type
      const radios = container.querySelectorAll('[role="radio"]');
      const checkboxes = container.querySelectorAll('[role="checkbox"]');
      const textInput = container.querySelector('input[type="text"], input:not([type="checkbox"]):not([type="radio"])');
      const textarea = container.querySelector('textarea');
      const selectTrigger = container.querySelector('[role="listbox"], .quantumWizMenuPaperselectEl');
      const linearScale = container.querySelector('[role="radiogroup"]');

      let type = 'unknown';
      let options = [];
      let element = container;

      if (radios.length > 0) {
        type = 'radio';
        radios.forEach(radio => {
          const labelEl = radio.querySelector(
            '.docssharedWizToggleLabeledLabelText, ' +
            '.vd3tt, ' +
            'span:not([aria-hidden]):last-child'
          );
          const text = labelEl ? labelEl.textContent.trim() : radio.textContent.trim();
          if (text && text !== 'Other:') {
            options.push({ text, element: radio });
          }
        });
        element = container.querySelector('[role="radiogroup"]') || container;
      } else if (checkboxes.length > 0) {
        type = 'checkbox';
        checkboxes.forEach(cb => {
          const labelEl = cb.querySelector(
            '.docssharedWizToggleLabeledLabelText, .vd3tt, span:last-child'
          );
          const text = labelEl ? labelEl.textContent.trim() : cb.textContent.trim();
          if (text) options.push({ text, element: cb });
        });
        element = container;
      } else if (selectTrigger) {
        type = 'select';
        // Options will be fetched when dropdown opens
        element = selectTrigger;
      } else if (textarea) {
        type = 'textarea';
        element = textarea;
      } else if (textInput) {
        type = 'text';
        element = textInput;
      }

      questions.push({
        id: `gf_${idx}`,
        platform: 'google-forms',
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

  function getSelectOptions(question) {
    // Open dropdown and collect options
    question.element.click();
    return new Promise(resolve => {
      setTimeout(() => {
        const optEls = document.querySelectorAll('[role="option"], .quantumWizMenuPaperselectOption');
        const options = [];
        optEls.forEach(el => {
          const text = el.textContent.trim();
          if (text) options.push({ text, element: el });
        });
        resolve(options);
      }, 300);
    });
  }

  function clickNext() {
    const allButtons = document.querySelectorAll('[role="button"], button');
    for (const btn of allButtons) {
      if (btn.getAttribute('aria-disabled') === 'true') continue;
      const text = btn.textContent.trim().toLowerCase();
      if (text === 'next' || text === 'next page') {
        btn.click();
        return true;
      }
    }
    return false;
  }

  function hasNextPage() {
    const allButtons = document.querySelectorAll('[role="button"], button');
    for (const btn of allButtons) {
      if (btn.textContent.trim().toLowerCase() === 'next') return true;
    }
    return false;
  }

  function hasSubmit() {
    const allButtons = document.querySelectorAll('[role="button"], button');
    for (const btn of allButtons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text === 'submit' || text === 'send') return true;
    }
    return false;
  }

  function isComplete() {
    return !!(
      document.querySelector('.freebirdFormviewerViewResponseConfirmationMessage') ||
      document.querySelector('[class*="confirmation"]') ||
      document.querySelector('.freebirdFormviewerViewResponseLinksContainer')
    );
  }

  return {
    name: 'google-forms',
    label: 'Google Forms',
    detect,
    parseQuestions,
    getSelectOptions,
    clickNext,
    hasNextPage,
    hasSubmit,
    isComplete,
  };
})();

window.SurveyBot = SurveyBot;
