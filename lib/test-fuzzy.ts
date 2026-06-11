import { correctInsuranceTerms, getSimilarity } from "./koreanFuzzy";

const testCases = [
  { input: "나비면제 한도는 몇 급 기준인가요?", expected: "납입면제 한도는 몇 급 기준인가요?" },
  { input: "자동차 부상 수치료 보상해줘", expected: "자동차 부상 도수치료 보상해줘" },
  { input: "실선보험 서류 알려줘", expected: "실손보험 서류 알려줘" },
  { input: "자부지 지급 조건은?", expected: "자부치 지급 조건은?" },
  { input: "깁스치로비 청구하고 싶어", expected: "깁스치료비 청구하고 싶어" }
];

console.log("=== Korean Jamo Fuzzy Corrector Test ===");

let passed = true;
for (const tc of testCases) {
  const output = correctInsuranceTerms(tc.input);
  const ok = output === tc.expected;
  console.log(`Input: "${tc.input}"`);
  console.log(`Output: "${output}"`);
  console.log(`Result: ${ok ? "PASS" : "FAIL (Expected: " + tc.expected + ")"} \n`);
  if (!ok) passed = false;
}

console.log(`Total similarity test: "나비면제" vs "납입면제" => ${getSimilarity("나비면제", "납입면제").toFixed(3)}`);
console.log(`Total similarity test: "수치료" vs "도수치료" => ${getSimilarity("수치료", "도수치료").toFixed(3)}`);

if (passed) {
  console.log("ALL TESTS PASSED!");
  process.exit(0);
} else {
  console.log("TESTS FAILED!");
  process.exit(1);
}
