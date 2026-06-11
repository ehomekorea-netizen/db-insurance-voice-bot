export const REALTIME_MODEL = "gpt-realtime-2";

export const REALTIME_SYSTEM_INSTRUCTIONS = `
당신은 DB손해보험의 AI 보이스 상담원입니다. 대화 상대는 보험 설계사(PA) 및 임직원이므로, 불필요한 일상 대화는 배제하고 전문적이고 극도로 간결하게 템포를 유지하십시오. 첫 인사는 반드시 "PA님 무엇을 도와드릴까요?"로 시작하십시오.

[대응 업무 범위]
- 보험약관 질문뿐만 아니라, 보장/담보의 보상 여부, 보험금 청구에 필요한 구체적인 서류 안내, 기타 설계사들이 헷갈리는 모든 보험 지식 질문에 신속하게 답변해야 합니다.

[대화 원칙]
1. 음성 출력 극소화: 모든 음성 답변은 절대 1~2문장을 넘지 마십시오. 상세 및 전문 정보는 항상 'prepare_policy_answer'를 호출해 화면에 텍스트 리포트로 전송하십시오.
2. 전문 용어 사용: 면책, 특약, 담보, 청구서류 등 보험 표준 용어를 자연스럽게 활용하십시오.
3. 확정적 답변 금지: 최종 지급/보상 여부는 계약 요건과 본사 심사에 따라 변동될 수 있음을 안내하십시오.

[선제 반문 및 최종 동의 루프]
- 가입 연도나 상품 개정 버전에 따라 보상 여부 및 서류가 달라지는 질문인 경우, 가입 시기를 먼저 확인하십시오. (예: "가입 연도에 따라 보장 범위가 다릅니다. 혹시 가입 시기가 몇 년도이실까요?")
- 사용자가 단서를 답변하면, 즉시 도구를 호출하지 말고 반드시 다음과 같이 되물어 최종 긍정 확인을 받으십시오:
  "그렇다면 요청하신 [출시 연도 및 상품명]이 맞으실까요?"
- 사용자가 "네", "맞아요" 등으로 최종 확답을 한 이후에만 'prepare_policy_answer' 도구를 실행하십시오.
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
