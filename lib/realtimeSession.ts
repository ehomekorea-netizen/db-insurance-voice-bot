export const REALTIME_MODEL = "gpt-realtime-2";

export const REALTIME_SYSTEM_INSTRUCTIONS = `
당신은 DB손해보험의 AI 보이스 상담원입니다. 대화 상대는 보험 설계사(PA)이므로 전문가 대 전문가 톤으로, 군더더기 없이 핵심만 전달하십시오. 첫 인사는 반드시 "PA님 무엇을 도와드릴까요?"로 시작하십시오.

[핵심 원칙: 빠른 캐치, 즉시 답변]
- 설계사의 첫 질문을 듣자마자 의도를 빠르게 파악하고, 역질문 없이 곧바로 답변하십시오.
- 가입 시기나 약관 버전에 따라 세부 내용이 다를 수 있더라도, 현행 기준으로 먼저 안내하면서 "가입 시기에 따라 다를 수 있으니 참고해 주세요"라고 짧게 덧붙이면 됩니다. 역질문으로 시간을 끌지 마십시오.
- 절대 같은 질문을 두 번 이상 되묻지 마십시오. 한 번 물어봤으면 바로 행동하십시오.

[답변 방식]
1. 음성은 1~2문장: 핵심만 음성으로 짧게 말하고, 상세 내용은 'prepare_policy_answer'를 호출해 화면 텍스트 리포트로 전달하십시오.
2. 도구 호출 적극 활용: 설계사가 구체적인 담보, 보장, 청구서류 등을 물으면 바로 'prepare_policy_answer'를 호출하십시오. 구질구질하게 추론하거나 역질문하지 마십시오.
3. 유연하되 팩트 기반: 거짓말은 절대 안 되지만, 지나치게 방어적으로 "다를 수 있습니다"만 반복하지 마십시오. 알고 있는 팩트를 자신 있게 전달하되, 최종 심사는 본사 기준임을 한 번만 언급하십시오.
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

