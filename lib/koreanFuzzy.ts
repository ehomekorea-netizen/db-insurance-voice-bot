// Choseong, Jungseong, Jongseong definition
const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];
const JUNGSEONG = [
  'ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'
];
const JONGSEONG = [
  '', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];

// Decompose a Korean character into jamo
export function disassembleChar(char: string): string {
  const code = char.charCodeAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3) {
    const relativeCode = code - 0xAC00;
    const jong = relativeCode % 28;
    const jung = Math.floor((relativeCode - jong) / 28) % 21;
    const cho = Math.floor(Math.floor((relativeCode - jong) / 28) / 21);

    return CHOSEONG[cho] + JUNGSEONG[jung] + (JONGSEONG[jong] || '');
  }
  return char;
}

// Decompose a string into a jamo string
export function disassembleString(str: string): string {
  return str.split('').map(disassembleChar).join('');
}

// Compute Levenshtein distance between two strings
export function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // deletion
          dp[i][j - 1] + 1, // insertion
          dp[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }
  return dp[m][n];
}

// Similarity score between 0 and 1
export function getSimilarity(s1: string, s2: string): number {
  const jamo1 = disassembleString(s1);
  const jamo2 = disassembleString(s2);
  const distance = levenshteinDistance(jamo1, jamo2);
  const maxLength = Math.max(jamo1.length, jamo2.length);
  if (maxLength === 0) return 1;
  return 1 - distance / maxLength;
}

// Core Insurance Dictionary
export const INSURANCE_GLOSSARY = [
  "납입면제",
  "도수치료",
  "실손의료비",
  "실손보험",
  "자동차부상치료비",
  "부상치료비",
  "자부치",
  "골절진단비",
  "깁스치료비",
  "보장한도",
  "입원의료비",
  "통원의료비",
  "수술비",
  "면책사항",
  "자기부담금",
  "의료실비"
];

/**
 * Scans tokens of the input text and corrects phonetically close STT errors
 * to official insurance glossary terms.
 */
export function correctInsuranceTerms(inputText: string, threshold: number = 0.70): string {
  if (!inputText) return inputText;

  const words = inputText.split(/\s+/);
  const correctedWords = words.map(word => {
    // Clean word from punctuation for comparison, but keep original punctuation at the end if needed.
    const cleanWord = word.replace(/[.,?/#!$%^&*;:{}=\-_`~()]/g, "").trim();
    if (!cleanWord || cleanWord.length < 2) return word; // Skip very short words or empty

    let bestMatch = cleanWord;
    let maxSim = 0;

    for (const term of INSURANCE_GLOSSARY) {
      const sim = getSimilarity(cleanWord, term);
      if (sim > maxSim) {
        maxSim = sim;
        bestMatch = term;
      }
    }

    // If similarity is high enough, replace the word (preserving punctuation if possible)
    if (maxSim >= threshold && bestMatch !== cleanWord) {
      console.log(`[Fuzzy Correction] Correcting "${cleanWord}" -> "${bestMatch}" (similarity: ${(maxSim * 100).toFixed(1)}%)`);
      // Restore punctuation if any
      const prefix = word.match(/^[.,?/#!$%^&*;:{}=\-_`~()]+/)?.[0] || "";
      const suffix = word.match(/[.,?/#!$%^&*;:{}=\-_`~()]+$/)?.[0] || "";
      return prefix + bestMatch + suffix;
    }

    return word;
  });

  return correctedWords.join(" ");
}
