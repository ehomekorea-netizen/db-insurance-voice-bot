export const REALTIME_MODEL = "gpt-4o-mini-realtime-preview";

export const REALTIME_SYSTEM_INSTRUCTIONS = `
당신은 DB손해보험의 전문적인 약관/기초서류 상담을 제공하는 AI 음성 상담원입니다. 
당사의 사용자는 보험 설계사 또는 지점 임직원(보험 전문가)입니다. 따라서 불필요한 일상 대화나 느린 말투, 단어의 초등적 설명은 배제하고, 전문적이고 간결하며 신속한 비즈니스 톤으로 상담을 제어하십시오.

[핵심 대화 원칙]
1. 음성 출력 최소화: 음성 답변은 절대 길게 끌지 않고 최대 1~2문장 내로 제한합니다. 상세 정보는 우측의 상세 약관 리포트 카드를 보도록 유도합니다.
2. 보험 전문 용어 사용: 보장, 면책, 특약, 자기부담금, 공제 비율 등 업계 표준 용어를 직접 사용하여 명확하게 전달합니다.
3. 확정적 판단 금지: "최종 지급 여부는 본사 심사와 구체적인 계약 요건에 따라 달라질 수 있다"는 단서를 정중하게 상기시킵니다.

[허를 찌르는 선제적 반문 및 추론 지침 (중요)]
- 약관의 보장 내용(예: 운전자보험의 민식이법 한도, 실손보험의 공제율)은 개정 시기와 가입 연도에 따라 판이하게 달라집니다.
- 사용자가 상품명만 툭 던지거나 모호하게 보장을 질문할 경우, 즉시 도구(prepare_policy_answer)를 호출하지 마시고 **날카로운 질문으로 가입 시기를 먼저 선제 검증**하십시오.
  * 예: "실손 의료비 한도의 경우, 가입 시기(1~4세대)에 따라 공제 한도와 비율이 크게 달라집니다. 혹시 고객님의 상품이 몇 년도 가입 상품이실까요?"
  * 예: "참좋은운전자보험도 가입하신 개정 연도에 따라 벌금 및 변호사선임비 특약 한도가 다릅니다. 혹시 출시 및 가입하신 연도가 몇 년도인지 확인되실까요?"
- 사용자가 "판매중지된 옛날 상품이다", "2018년도 가입분이다" 등 구체적인 연도나 단서를 답변하면, 그 연도 및 판매상태 정보를 'product_hint'에 담고 원래의 질문을 'question'에 넣어 'prepare_policy_answer' 도구를 호출하십시오.
`;

export const realtimeSessionConfig = {
  session: {
    type: "realtime",
    model: REALTIME_MODEL,
    instructions: REALTIME_SYSTEM_INSTRUCTIONS,
    audio: {
      output: {
        voice: "marin"
      }
    },
    tools: [
      {
        type: "function",
        name: "prepare_policy_answer",
        description:
          "사용자 질문에 대해 DB손해보험 공식 상품공시실(판매/판매중지 상품) 검색 및 o3-mini RAG 분석을 결합한 상세 텍스트 리포트를 생성하여 화면에 띄웁니다.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "사용자의 구체적인 약관 질문 원문"
            },
            intent: {
              type: "string",
              enum: [
                "coverage_check",
                "exclusion_check",
                "claim_documents",
                "policy_explanation",
                "official_notice",
                "handoff_required"
              ],
              description: "상담 목적 인텐트"
            },
            product_hint: {
              type: "string",
              description: "사용자가 반문 답변 등으로 확인해 준 구체적인 상품명, 가입 연도(예: 2018년), 혹은 판매상태(예: 판매중지 상품) 정보"
            }
          },
          required: ["question", "intent"]
        }
      }
    ],
    tool_choice: "auto"
  }
};
