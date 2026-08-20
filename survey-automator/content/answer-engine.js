// ─── Answer Engine ────────────────────────────────────────────────────────────
// Two-phase answer resolution:
//   1. Rule-based matching against the user's profile
//   2. AI fallback (via service worker) for unrecognized questions
// Returns: { answer, confidence, source }

var SurveyBot = window.SurveyBot || {};

SurveyBot.AnswerEngine = (function () {

  // ─── Rule-based Matching ───────────────────────────────────────────────────

  // ─── Helpers for Granular Profile Extraction ──────────────────────────────
  function getBirthYear(profile) {
    if (profile.birthYear) return String(profile.birthYear);
    if (profile.dateOfBirth) {
      const m = String(profile.dateOfBirth).match(/(\d{4})/);
      if (m) return m[1];
    }
    if (profile.age) {
      const yr = new Date().getFullYear() - parseInt(profile.age, 10);
      if (yr > 1900 && yr < 2050) return String(yr);
    }
    return '1998';
  }

  function getBirthMonth(profile) {
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    if (profile.dateOfBirth) {
      const m = String(profile.dateOfBirth).match(/^\d{4}[-/](\d{1,2})/);
      if (m) {
        const idx = parseInt(m[1], 10) - 1;
        return MONTHS[idx] || m[1];
      }
    }
    return 'June';
  }

  function getBirthDay(profile) {
    if (profile.dateOfBirth) {
      const m = String(profile.dateOfBirth).match(/^\d{4}[-/]\d{1,2}[-/](\d{1,2})/);
      if (m) return String(parseInt(m[1], 10));
    }
    return '15';
  }

  function getCountry(profile) {
    if (profile.country) return profile.country;
    if (profile.location && /australia/i.test(profile.location)) return 'Australia';
    if (profile.location) {
      const parts = profile.location.split(',');
      if (parts.length > 1) return parts[parts.length - 1].trim();
    }
    return 'Australia';
  }

  function getState(profile) {
    if (profile.state) return profile.state;
    if (profile.location && /sydney/i.test(profile.location)) return 'New South Wales';
    return 'New South Wales';
  }

  function getCity(profile) {
    if (profile.city) return profile.city;
    if (profile.location) {
      const parts = profile.location.split(',');
      return parts[0].trim();
    }
    return 'Sydney';
  }

  function getPostcode(profile) {
    return profile.postcode || profile.postalCode || '2000';
  }

  // Keyword maps: profile field → trigger words in question text
  const KEYWORD_RULES = [
    // 1. Birth Year specifically (HIGH PRIORITY - must come before generic DOB)
    {
      field: 'birthYear',
      getter: (p) => getBirthYear(p),
      keywords: ['what year were you born', 'birth year', 'year of birth', 'year were you born', 'year you were born', 'which year were you born', 'born in what year', 'select your birth year', 'what is your birth year', 'year of your birth', 'in what year were you born'],
      transform: (v) => String(v),
    },
    // 2. Birth Month
    {
      field: 'birthMonth',
      getter: (p) => getBirthMonth(p),
      keywords: ['birth month', 'month of birth', 'what month were you born', 'which month were you born', 'month were you born', 'select your birth month'],
      transform: (v) => v,
    },
    // 3. Birth Day
    {
      field: 'birthDay',
      getter: (p) => getBirthDay(p),
      keywords: ['birth day', 'day of birth', 'what day were you born', 'day were you born', 'day of the month you were born'],
      transform: (v) => String(v),
    },
    // 4. Country of Residence specifically (HIGH PRIORITY)
    {
      field: 'country',
      getter: (p) => getCountry(p),
      keywords: ['which country', 'what country', 'country do you live', 'country of residence', 'current country', 'citizenship', 'nationality', 'select your country', 'in what country', 'country of living', 'where in the world do you live', 'what country are you located'],
      transform: (v) => v,
    },
    // 5. State / Province
    {
      field: 'state',
      getter: (p) => getState(p),
      keywords: ['which state', 'what state', 'state/territory', 'state or province', 'state do you live', 'state of residence', 'territory do you live', 'what territory'],
      transform: (v) => v,
    },
    // 6. City / Suburb
    {
      field: 'city',
      getter: (p) => getCity(p),
      keywords: ['which city', 'what city', 'city do you live', 'city of residence', 'town', 'suburb', 'metro area', 'municipality'],
      transform: (v) => v,
    },
    // 7. Postcode / Zip
    {
      field: 'postcode',
      getter: (p) => getPostcode(p),
      keywords: ['zip code', 'postal code', 'postcode', 'zip/postal', 'pin code'],
      transform: (v) => String(v),
    },
    // 8. Age specifically
    {
      field: 'age',
      getter: (p) => p.age ? String(p.age) : null,
      keywords: ['how old are you', 'how old', 'your age', 'age range', 'age group', 'what is your age', 'your exact age', 'current age', 'age in years'],
      transform: (v) => String(v),
    },
    // 9. Full DOB
    {
      field: 'dateOfBirth',
      getter: (p) => p.dateOfBirth,
      keywords: ['date of birth', 'full dob', 'what is your date of birth', 'when is your birthday', 'birthdate', 'exact date of birth'],
      transform: (v) => v,
    },
    // 10. Gender / Sex
    {
      field: 'gender',
      getter: (p) => p.gender,
      keywords: ['gender', 'what is your sex', 'sex', 'identify as', 'male or female', 'are you male or female', 'what is your gender'],
      transform: (v) => v,
    },
    // 11. Name
    {
      field: 'name',
      getter: (p) => p.name,
      keywords: ['your name', 'full name', 'first name', 'last name', 'what is your name'],
      transform: (v) => v,
    },
    // 12. Marital Status
    {
      field: 'maritalStatus',
      getter: (p) => p.maritalStatus,
      keywords: ['marital status', 'marital', 'are you married', 'relationship status', 'civil status', 'partner'],
      transform: (v) => v,
    },
    // 13. Occupation
    {
      field: 'occupation',
      getter: (p) => p.occupation,
      keywords: ['occupation', 'job title', 'current job', 'profession', 'line of work', 'industry do you work', 'field of work', 'what is your job', 'what do you do for a living'],
      transform: (v) => v,
    },
    // 14. Education
    {
      field: 'education',
      getter: (p) => p.education,
      keywords: ['highest level of education', 'highest degree', 'education level', 'highest level of school', 'education completed', 'qualification', 'degree'],
      transform: (v) => v,
    },
    // 15. Ethnicity
    {
      field: 'ethnicity',
      getter: (p) => p.ethnicity,
      keywords: ['ethnicity', 'ethnic background', 'racial origin', 'racial background', 'which of these best describes your race', 'race/ethnicity', 'race or origin', 'ethnic origin'],
      transform: (v) => v,
    },
    // 16. Politics
    {
      field: 'politics',
      getter: (p) => p.politics,
      keywords: ['political view', 'political orientation', 'political affiliation', 'politics', 'party affiliation', 'democrat or republican', 'liberal or conservative', 'political ideology'],
      transform: (v) => v,
    },
    // 17. Employment
    {
      field: 'employment',
      getter: (p) => p.employment,
      keywords: ['employment status', 'work status', 'are you employed', 'current employment', 'working status', 'employment situation', 'employment condition'],
      transform: (v) => v,
    },
    // 18. Household
    {
      field: 'household',
      getter: (p) => p.household ? String(p.household) : null,
      keywords: ['household size', 'people live in your household', 'how many people live in your house', 'number of people in your household', 'size of your household', 'including yourself, how many'],
      transform: (v) => String(v),
    },
    // 19. Language
    {
      field: 'language',
      getter: (p) => p.language,
      keywords: ['primary language', 'language spoken', 'native language', 'first language', 'language do you speak at home', 'preferred language'],
      transform: (v) => v,
    },
    // 20. Income
    {
      field: 'income',
      getter: (p) => p.income,
      keywords: ['household income', 'annual income', 'annual household income', 'total income', 'income bracket', 'salary bracket', 'how much do you earn', 'gross annual'],
      transform: (v) => v,
    },
    // 21. General Location
    {
      field: 'location',
      getter: (p) => p.location,
      keywords: ['where do you live', 'current location', 'general location', 'residence'],
      transform: (v) => v,
    },
    // 22. Interests
    {
      field: 'interests',
      getter: (p) => p.interests,
      keywords: ['interest', 'hobby', 'hobbies', 'activities do you enjoy', 'like to do', 'leisure', 'spare time'],
      transform: (v) => Array.isArray(v) ? v.join(', ') : v,
    },
    // 23. Email
    {
      field: 'email',
      getter: (p) => p.email,
      keywords: ['email', 'e-mail', 'email address'],
      transform: (v) => v,
    },
    // 24. Phone
    {
      field: 'phone',
      getter: (p) => p.phone,
      keywords: ['phone', 'mobile', 'cell', 'telephone', 'contact number'],
      transform: (v) => v,
    },
  ];

  /**
   * Main resolve function
   * @param {object} question - { text, type, options }
   * @param {object} profile - user's persona
   * @param {object} settings - { aiProvider, aiApiKey, aiModel, fallback }
   * @returns {Promise<{answer: string|string[], confidence: number, source: string}>}
   */
  async function resolve(question, profile, settings) {
    // 0. Automatic Attention Check / Quality Trap Solver (100% confidence)
    const trapAnswer = solveAttentionCheck(question);
    if (trapAnswer) {
      console.log('[SurveyBot] 🛡️ Attention check trap intercepted & solved:', trapAnswer);
      return { answer: trapAnswer, confidence: 100, source: 'attention-check' };
    }

    if (!profile) {
      return { answer: pickDefault(question, settings), confidence: 10, source: 'default' };
    }

    // 1. Check custom Q&A rules first (highest user priority)
    const customMatch = matchCustomRules(question, profile);
    if (customMatch) {
      return { answer: customMatch, confidence: 95, source: 'custom' };
    }

    // 2. High-confidence Rule matching (>= 85) for exact demographic hits (Country, Birth Year, Gender, etc.)
    const ruleMatch = matchRules(question, profile);
    if (ruleMatch && ruleMatch.confidence >= 85) {
      return { ...ruleMatch, source: 'rule' };
    }

    // 3. AI / Gemini First! If AI is configured, use Gemini for all non-exact questions
    if (settings?.aiProvider && settings?.aiApiKey) {
      try {
        const aiAnswer = await queryAI(question, profile, settings);
        if (aiAnswer) {
          const validated = validateAgainstOptions(aiAnswer, question.options);
          return { answer: validated, confidence: 90, source: 'ai' };
        }
      } catch (e) {
        console.warn('[SurveyBot] Gemini AI query failed, falling back to rules/default:', e.message);
      }
    }

    // 4. Secondary rule match fallback (confidence >= 50)
    if (ruleMatch && ruleMatch.confidence >= 50) {
      return { ...ruleMatch, source: 'rule' };
    }

    // 5. Best-effort default strategy
    return { answer: pickDefault(question, settings), confidence: 20, source: 'default' };
  }

  // ─── Automatic Attention Trap Solver ───────────────────────────────────────
  function solveAttentionCheck(question) {
    if (!question?.text || !question.options?.length) return null;
    const qText = question.text;
    const qNorm = qText.toLowerCase();

    // Check if question is an attention trap
    const isTrap = /(to\s+(ensure|verify|show|prove)\s+(that\s+)?(you('re| are)?|reading)|attention\s*check|quality\s*check|instructional\s*check|to\s+confirm\s+you\s+are\s+paying\s+attention|if\s+you\s+are\s+reading\s+this)/i.test(qNorm) ||
                   /(please|kindly|must)\s+(select|choose|click|pick|mark)\s+['"“]([^'"”]+)['"”]/i.test(qText);

    if (!isTrap) return null;

    // Pattern 1: Quoted option demand: please select "Somewhat agree"
    const quotedMatch = qText.match(/(?:select|choose|click|pick|mark)\s+(?:the\s+option\s+)?['"“]([^'"”]+)['"”]/i);
    if (quotedMatch && quotedMatch[1]) {
      const demanded = quotedMatch[1].trim();
      const matchedOpt = question.options.find(o => normalize(o.text) === normalize(demanded) || normalize(o.text).includes(normalize(demanded)));
      if (matchedOpt) return matchedOpt.text;
    }

    // Pattern 2: Explicit option name: select Disagree to show you are reading
    for (const opt of question.options) {
      const optWord = normalize(opt.text);
      if (optWord.length > 2) {
        const optRegex = new RegExp(`(?:select|choose|click|pick|mark)\\s+['"]?${optWord}['"]?\\b`, 'i');
        if (optRegex.test(qNorm)) {
          return opt.text;
        }
      }
    }

    // Pattern 3: Positional demand: select the second option
    const posMatch = qNorm.match(/(?:select|choose|click|pick|mark)\s+(?:the\s+)?(first|second|third|fourth|fifth|last)\s+(?:option|choice|answer|radio|checkbox)/i);
    if (posMatch) {
      const posMap = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, last: question.options.length - 1 };
      const idx = posMap[posMatch[1].toLowerCase()];
      if (idx !== undefined && question.options[idx]) {
        return question.options[idx].text;
      }
    }

    return null;
  }

  function matchCustomRules(question, profile) {
    if (!profile.customQA?.length) return null;
    const qNorm = normalize(question.text);

    for (const rule of profile.customQA) {
      if (!rule.question || !rule.answer) continue;
      const ruleNorm = normalize(rule.question);

      // Exact or fuzzy match
      if (qNorm.includes(ruleNorm) || ruleNorm.includes(qNorm) || similarity(qNorm, ruleNorm) > 0.7) {
        return rule.answer;
      }
    }
    return null;
  }

  function matchRules(question, profile) {
    const qNorm = normalize(question.text);
    let bestField = null;
    let bestScore = 0;

    for (const rule of KEYWORD_RULES) {
      const fieldValue = rule.getter ? rule.getter(profile) : profile[rule.field];
      if (!fieldValue) continue;

      let score = 0;
      for (const kw of rule.keywords) {
        if (qNorm.includes(kw)) {
          score = Math.max(score, kw.length > 10 ? 95 : 85);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestField = { ...rule, resolvedValue: fieldValue };
      }
    }

    if (!bestField || bestScore < 40) {
      return { answer: null, confidence: 0 };
    }

    const rawValue = bestField.transform(bestField.resolvedValue);
    const answer = pickBestOption(rawValue, question, bestField.field);

    return { answer, confidence: bestScore };
  }

  function pickBestOption(profileValue, question, fieldName) {
    if (!profileValue) return null;
    const pNorm = normalize(String(profileValue));

    // Date-group: return the raw DOB value — filler.js will parse it
    if (question.type === 'date-group' || question.type === 'date') {
      return profileValue;
    }

    if (['radio', 'select', 'scale', 'rating'].includes(question.type) && question.options?.length) {
      let bestOpt = null;
      let bestSim = 0;

      for (const opt of question.options) {
        const oNorm = normalize(opt.text);
        let sim = 0;

        if (oNorm === pNorm) {
          sim = 1.0;
        } else if (oNorm.includes(pNorm) || pNorm.includes(oNorm)) {
          sim = 0.9;
        } else {
          sim = similarity(pNorm, oNorm);
        }

        // Demographic range / bracket matching
        if (fieldName === 'age' || /age/i.test(question.text)) {
          if (matchAgeRange(profileValue, opt.text)) sim = Math.max(sim, 0.98);
        } else if (fieldName === 'income' || /income/i.test(question.text)) {
          if (matchIncomeBracket(profileValue, opt.text)) sim = Math.max(sim, 0.98);
        } else if (fieldName === 'household' || /household/i.test(question.text)) {
          if (matchHouseholdBracket(profileValue, opt.text)) sim = Math.max(sim, 0.98);
        }

        if (sim > bestSim) {
          bestSim = sim;
          bestOpt = opt.text;
        }
      }
      return bestSim > 0.3 ? bestOpt : (question.options[0]?.text || null);
    }

    if (question.type === 'checkbox' && question.options?.length) {
      const matches = [];
      const values = Array.isArray(profileValue) ? profileValue : [profileValue];

      for (const opt of question.options) {
        const oNorm = normalize(opt.text);
        for (const val of values) {
          if (oNorm.includes(normalize(val)) || normalize(val).includes(oNorm)) {
            matches.push(opt.text);
            break;
          }
        }
      }
      return matches.length > 0 ? matches : [question.options[0]?.text];
    }

    // Text inputs
    if (['text', 'textarea', 'number', 'email', 'tel'].includes(question.type)) {
      return String(profileValue);
    }

    return String(profileValue);
  }

  function matchAgeRange(profileValue, optionText) {
    const age = parseInt(profileValue, 10);
    if (isNaN(age)) return false;

    // Match patterns like "25-34", "25 to 34", "25–34"
    const rangeMatch = optionText.match(/(\d+)\s*[-–to]+\s*(\d+)/);
    if (rangeMatch) {
      const low = parseInt(rangeMatch[1]);
      const high = parseInt(rangeMatch[2]);
      return age >= low && age <= high;
    }

    // Match patterns like "Under 18", "18 or younger"
    if (/under\s*(\d+)|less than\s*(\d+)/i.test(optionText)) {
      const match = optionText.match(/(\d+)/);
      if (match) return age < parseInt(match[1]);
    }

    // Match "65+" or "65 or older"
    if (/(\d+)\+|(\d+)\s+or\s+older|(\d+)\s+and\s+over/i.test(optionText)) {
      const match = optionText.match(/(\d+)/);
      if (match) return age >= parseInt(match[1]);
    }

    return false;
  }

  function matchIncomeBracket(profileValue, optionText) {
    const pStr = String(profileValue).toLowerCase();
    const optStr = optionText.toLowerCase();
    if (optStr.includes(pStr) || pStr.includes(optStr)) return true;

    // e.g. "$50,000" inside "$50,000 - $74,999"
    const numbersInOpt = optionText.match(/\d+[\d,]*/g);
    const numInProfile = profileValue.match(/\d+[\d,]*/);
    if (numInProfile && numbersInOpt?.length >= 2) {
      const pVal = parseInt(numInProfile[0].replace(/,/g, ''), 10);
      const low = parseInt(numbersInOpt[0].replace(/,/g, ''), 10);
      const high = parseInt(numbersInOpt[1].replace(/,/g, ''), 10);
      if (pVal >= low && pVal <= high) return true;
    }
    return false;
  }

  function matchHouseholdBracket(profileValue, optionText) {
    const num = parseInt(profileValue, 10);
    if (isNaN(num)) return false;
    if (optionText.includes(String(num))) return true;
    if (num >= 5 && /5\+|5\s+or\s+more|more\s+than\s+4/i.test(optionText)) return true;
    return false;
  }

  function pickDefault(question, settings) {
    const fallback = settings?.fallback || 'first'; // 'first', 'middle', 'random'

    if (['radio', 'select', 'scale', 'rating'].includes(question.type) && question.options?.length) {
      if (fallback === 'random') {
        const idx = Math.floor(Math.random() * question.options.length);
        return question.options[idx].text;
      } else if (fallback === 'middle' || question.type === 'scale' || question.type === 'rating') {
        const mid = Math.floor(question.options.length / 2);
        return question.options[mid].text;
      } else {
        return question.options[0].text;
      }
    }

    if (question.type === 'checkbox' && question.options?.length) {
      // Pick 2-3 options based on strategy
      const numOptions = Math.min(question.options.length, Math.floor(Math.random() * 2) + 2); // 2 or 3
      if (fallback === 'random') {
        const shuffled = [...question.options].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, numOptions).map(o => o.text);
      } else if (fallback === 'middle') {
        const mid = Math.floor(question.options.length / 2);
        return question.options.slice(mid, mid + numOptions).map(o => o.text);
      } else {
        return question.options.slice(0, numOptions).map(o => o.text);
      }
    }
    if (question.type === 'text' || question.type === 'textarea') {
      const qNorm = (question.text || '').toLowerCase();
      // Smart brand/item generation if asking for brands/products
      if (qNorm.includes('brand') || qNorm.includes('aware') || qNorm.includes('product') || qNorm.includes('company') || qNorm.includes('security') || qNorm.includes('device')) {
        const brands = ['Ring', 'Google Nest', 'Arlo', 'SimpliSafe', 'Swann', 'Eufy', 'Bosch', 'Yale'];
        const m = question.text.match(/\[?(\d+)[\.\)]?\]?|\(item\s*(\d+)\)/i);
        const idx = m ? (parseInt(m[1] || m[2], 10) - 1) : 0;
        return brands[idx % brands.length];
      }
      if (qNorm.includes('why') || qNorm.includes('reason') || qNorm.includes('think') || qNorm.includes('feel') || qNorm.includes('feedback') || qNorm.includes('opinion')) {
        return 'It is reliable, well-designed, and offers great value.';
      }
      return 'Yes';
    }
    return '';
  }

  function validateAgainstOptions(aiAnswer, options) {
    if (!options?.length) return aiAnswer;

    // Handle array from AI checkboxes (pipe separated)
    if (typeof aiAnswer === 'string' && aiAnswer.includes('|')) {
       const parts = aiAnswer.split('|').map(s => s.trim());
       const validated = parts.map(p => validateSingleOption(p, options)).filter(Boolean);
       return validated.length ? validated : [validateSingleOption(parts[0], options)];
    }

    return validateSingleOption(aiAnswer, options);
  }

  function validateSingleOption(aiAnswer, options) {
    if (!aiAnswer) return null;
    const aNorm = normalize(aiAnswer);

    // Exact match
    for (const opt of options) {
      if (normalize(opt.text) === aNorm) return opt.text;
    }

    // Partial match
    for (const opt of options) {
      if (normalize(opt.text).includes(aNorm) || aNorm.includes(normalize(opt.text))) {
        return opt.text;
      }
    }

    // Fuzzy match — pick closest
    let best = options[0].text;
    let bestSim = 0;
    for (const opt of options) {
      const sim = similarity(aNorm, normalize(opt.text));
      if (sim > bestSim) {
        bestSim = sim;
        best = opt.text;
      }
    }
    return best;
  }

  async function queryAI(question, profile, settings) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'AI_QUERY',
        questionType: question.type,
        question: question.text,
        options: question.options?.map(o => o.text) || [],
        profile,
        provider: settings.aiProvider,
        apiKey: settings.aiApiKey,
        model: settings.aiModel,
      }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (resp?.ok) {
          resolve(resp.answer);
        } else {
          reject(new Error(resp?.error || 'AI query failed'));
        }
      });
    });
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  function normalize(str) {
    return String(str).toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, ' ').trim();
  }

  // Simple Dice coefficient similarity
  function similarity(a, b) {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const firstBigrams = new Map();
    for (let i = 0; i < a.length - 1; i++) {
      const bigram = a.substring(i, i + 2);
      firstBigrams.set(bigram, (firstBigrams.get(bigram) || 0) + 1);
    }
    let intersectionSize = 0;
    for (let i = 0; i < b.length - 1; i++) {
      const bigram = b.substring(i, i + 2);
      const count = firstBigrams.get(bigram) || 0;
      if (count > 0) {
        firstBigrams.set(bigram, count - 1);
        intersectionSize++;
      }
    }
    return (2 * intersectionSize) / (a.length + b.length - 2);
  }

  return { resolve, normalize, similarity };
})();

window.SurveyBot = SurveyBot;
