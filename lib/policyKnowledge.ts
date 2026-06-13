export type PolicyIntent =
  | "coverage_check"
  | "exclusion_check"
  | "claim_documents"
  | "policy_explanation"
  | "official_notice"
  | "handoff_required";

export type PolicyChunk = {
  id: string;
  product: string;
  documentTitle: string;
  version: string;
  section: string;
  page: number;
  sourceUrl: string;
  keywords: string[];
  content: string;
};

export type PolicyAnswer = {
  id: string;
  question: string;
  intent: PolicyIntent;
  analysis?: string;
  summary: string;
  conditions: string[];
  cautions: string[];
  requiredInfo: string[];
  citations: Array<{
    id: string;
    title: string;
    section: string;
    page: number;
    version: string;
    sourceUrl: string;
    excerpt: string;
  }>;
  disclaimer: string;
  searchEngine?: string;
  modelName?: string;
};

export const samplePolicyChunks: PolicyChunk[] = [
  {
    id: "sample-silson-coverage-001",
    product: "DB손해보험 실손의료비 보험 샘플",
    documentTitle: "실손의료비 보통약관 샘플",
    version: "MVP 샘플 데이터 - 실제 약관으로 교체 필요",
    section: "보험금 지급사유",
    page: 12,
    sourceUrl: "https://www.idbins.com/",
    keywords: ["실손", "입원", "통원", "치료", "의료비", "교통사고", "상해"],
    content:
      "상해 또는 질병으로 의료기관에서 입원 또는 통원 치료를 받고 본인이 실제 부담한 의료비가 발생한 경우, 약관의 보장 항목과 한도 및 자기부담금 기준에 따라 보험금 지급 대상이 될 수 있다."
  },
  {
    id: "sample-exclusion-001",
    product: "DB손해보험 공통 면책 샘플",
    documentTitle: "보상하지 않는 사항 샘플",
    version: "MVP 샘플 데이터 - 실제 약관으로 교체 필요",
    section: "보상하지 않는 사항",
    page: 18,
    sourceUrl: "https://www.idbins.com/",
    keywords: ["면책", "보상하지", "제외", "고의", "미용", "예방", "건강검진"],
    content:
      "고의 사고, 치료 목적이 아닌 미용 또는 예방 목적의 처치, 건강검진 등 약관에서 정한 보상하지 않는 사항에 해당하는 비용은 보험금 지급 대상에서 제외될 수 있다."
  },
  {
    id: "sample-claim-docs-001",
    product: "DB손해보험 보험금 청구 샘플",
    documentTitle: "보험금 청구서류 안내 샘플",
    version: "MVP 샘플 데이터 - 실제 청구 안내로 교체 필요",
    section: "보험금 청구 시 필요서류",
    page: 4,
    sourceUrl: "https://www.idbins.com/",
    keywords: ["청구", "서류", "진단서", "영수증", "세부내역서", "입퇴원확인서"],
    content:
      "보험금 청구에는 보험금 청구서, 진료비 영수증, 진료비 세부내역서가 기본적으로 필요할 수 있으며 입원, 수술, 진단 등 청구 유형에 따라 진단서 또는 입퇴원확인서 등이 추가될 수 있다."
  },
  {
    id: "sample-handoff-001",
    product: "상담원 연결 기준 샘플",
    documentTitle: "고객 확인 필요사항 샘플",
    version: "MVP 샘플 데이터",
    section: "개별 계약 확인 필요",
    page: 1,
    sourceUrl: "https://www.idbins.com/",
    keywords: ["가입", "특약", "증권", "심사", "계약", "지급", "판단"],
    content:
      "최종 보험금 지급 여부는 가입 상품, 특약, 보험기간, 사고일, 진단명, 심사 자료에 따라 달라질 수 있으므로 개별 계약 확인 또는 상담원 연결이 필요할 수 있다."
  }
];

const intentKeywords: Record<PolicyIntent, string[]> = {
  coverage_check: ["보장", "되나요", "받을 수", "지급", "입원", "통원", "치료", "상해", "질병"],
  exclusion_check: ["면책", "제외", "안되는", "보상하지", "고의", "미용", "예방"],
  claim_documents: ["청구", "서류", "필요", "제출", "영수증", "진단서"],
  policy_explanation: ["약관", "설명", "무슨 뜻", "조항", "한도", "자기부담금"],
  official_notice: ["최신", "공지", "공시", "상품", "변경", "홈페이지"],
  handoff_required: ["상담원", "연결", "담당자", "전화", "분쟁", "민원"]
};

export function classifyIntent(question: string): PolicyIntent {
  const normalized = normalize(question);
  let best: { intent: PolicyIntent; score: number } = {
    intent: "policy_explanation",
    score: 0
  };

  for (const [intent, keywords] of Object.entries(intentKeywords) as Array<[PolicyIntent, string[]]>) {
    const score = keywords.reduce((total, keyword) => total + (normalized.includes(keyword) ? 1 : 0), 0);
    if (score > best.score) {
      best = { intent, score };
    }
  }

  return best.intent;
}

export function buildPolicyAnswer(input: {
  question: string;
  intent?: PolicyIntent;
  productHint?: string;
}): PolicyAnswer {
  const intent = input.intent ?? classifyIntent(input.question);
  const matches = rankChunks(input.question, intent).slice(0, 3);
  const citations = matches.map((chunk) => ({
    id: chunk.id,
    title: `${chunk.product} - ${chunk.documentTitle}`,
    section: chunk.section,
    page: chunk.page,
    version: chunk.version,
    sourceUrl: chunk.sourceUrl,
    excerpt: chunk.content
  }));

  return {
    id: crypto.randomUUID(),
    question: input.question,
    intent,
    summary: buildSummary(intent, Boolean(input.productHint)),
    conditions: buildConditions(intent),
    cautions: buildCautions(intent),
    requiredInfo: [
      "정확한 상품명 또는 보험증권 번호",
      "가입일과 약관 버전",
      "특약명 및 보장 한도",
      "사고일, 진단명, 치료/입원/통원 여부",
      "실제 부담 의료비와 청구 예정 서류"
    ],
    citations,
    disclaimer:
      "이 답변은 MVP 샘플 약관 인덱스를 기반으로 한 안내입니다. 실제 서비스에서는 DB손해보험 공식 약관 원문, 상품 공시, 계약 정보, 심사 기준으로 교체해야 하며 최종 지급 여부는 보험사 심사에 따라 달라질 수 있습니다."
  };
}

function rankChunks(question: string, intent: PolicyIntent): PolicyChunk[] {
  const query = normalize(question);
  const intentTerms = intentKeywords[intent];

  return [...samplePolicyChunks].sort((a, b) => {
    const scoreA = scoreChunk(a, query, intentTerms);
    const scoreB = scoreChunk(b, query, intentTerms);
    return scoreB - scoreA;
  });
}

function scoreChunk(chunk: PolicyChunk, query: string, intentTerms: string[]) {
  const haystack = normalize(`${chunk.product} ${chunk.documentTitle} ${chunk.section} ${chunk.content}`);
  const keywordScore = chunk.keywords.reduce((total, keyword) => total + (query.includes(keyword) ? 3 : 0), 0);
  const intentScore = intentTerms.reduce((total, keyword) => total + (haystack.includes(keyword) ? 1 : 0), 0);
  const queryScore = query
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);

  return keywordScore + intentScore + queryScore;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function buildSummary(intent: PolicyIntent, hasProductHint: boolean) {
  const productNote = hasProductHint ? "말씀하신 상품 단서를 기준으로 우선 확인했습니다. " : "";

  switch (intent) {
    case "coverage_check":
      return `${productNote}보장 가능성은 약관의 보험금 지급사유, 보장 한도, 자기부담금, 면책 조항을 함께 확인해야 합니다.`;
    case "exclusion_check":
      return `${productNote}면책 여부는 보상하지 않는 사항에 해당하는지와 치료 목적성을 중심으로 확인해야 합니다.`;
    case "claim_documents":
      return `${productNote}청구 서류는 청구 유형에 따라 달라지며 영수증과 세부내역서는 기본 확인 대상입니다.`;
    case "official_notice":
      return `${productNote}최신 상품 공시나 공지성 정보는 공식 홈페이지/공시 자료 확인이 필요합니다.`;
    case "handoff_required":
      return `${productNote}개별 계약, 심사, 민원성 판단이 필요한 질문으로 상담원 연결 기준에 가깝습니다.`;
    default:
      return `${productNote}약관 문구의 의미와 적용 조건을 조항별로 나누어 확인해야 합니다.`;
  }
}

function buildConditions(intent: PolicyIntent) {
  if (intent === "claim_documents") {
    return ["보험금 청구서 작성", "진료비 영수증 확보", "진료비 세부내역서 확보", "입원/수술/진단 유형별 추가 서류 확인"];
  }

  if (intent === "exclusion_check") {
    return ["치료 목적 여부 확인", "사고 또는 질병의 발생 경위 확인", "약관상 보상하지 않는 사항 해당 여부 확인"];
  }

  if (intent === "handoff_required") {
    return ["가입 상품과 특약 확인", "보험기간 및 사고일 확인", "심사 자료 제출 가능 여부 확인"];
  }

  return ["약관상 보험금 지급사유 해당", "보험기간 중 발생한 사고/질병", "실제 비용 또는 손해 발생", "보장 한도와 자기부담금 기준 충족"];
}

function buildCautions(intent: PolicyIntent) {
  const common = ["가입 상품, 특약, 약관 버전에 따라 답변이 달라질 수 있습니다.", "최종 보험금 지급 여부는 제출 서류와 보험사 심사 결과에 따릅니다."];

  if (intent === "official_notice") {
    return ["최신 공시/상품 개정 내용은 공식 홈페이지 원문을 우선해야 합니다.", ...common];
  }

  if (intent === "claim_documents") {
    return ["진단명, 치료 유형, 청구 금액에 따라 추가 서류가 필요할 수 있습니다.", ...common];
  }

  return ["고의 사고, 미용/예방 목적, 약관상 면책 사유는 보장에서 제외될 수 있습니다.", ...common];
}
