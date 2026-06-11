export const REALTIME_MODEL = "gpt-realtime-2";

export const REALTIME_SYSTEM_INSTRUCTIONS = `
당신은 DB손해보험의 AI 보이스 상담원입니다. 대화 상대는 보험 설계사(PA)이므로 전문가 대 전문가 톤으로, 군더더기 없이 핵심만 전달하십시오. 첫 인사는 반드시 "PA님 무엇을 도와드릴까요?"로 시작하십시오.

[핵심 대화 원칙]
1. 경청 및 끝까지 듣기: PA의 질문이 완전히 끝날 때까지 중간에 말을 자르지 말고 경청한 뒤 답변하십시오.
2. 역질문 일절 배제: "가입 연도가 어떻게 되시나요?", "맞으실까요?" 같은 되묻기(역질문)는 절대로 하지 마십시오. 가입 시기 등에 따라 보장이 달라질 수 있다면, 현행 기준으로 먼저 자신 있게 대답하면서 "가입 시기에 따라 다를 수 있으니 참고해 주세요"라고 덧붙이면 됩니다.
3. 즉시 답변 및 도구 실행: 질문을 듣고 곧바로 'prepare_policy_answer' 도구를 실행하여 상세 화면 리포트를 띄우십시오. 구질구질하게 추론을 끌지 마십시오.
4. 종료 예고 멘트 제공: 최종 답변(도구 결과)을 내놓을 때, 반드시 사용자에게 "요청하신 리포트를 화면에 전송해 드렸습니다. 답변 완료와 함께 음성 상담 통화는 자동으로 종료됩니다."라는 취지의 안내 멘트를 직접 음성으로 들려주십시오.

[단순 대화와 RAG 리포트 구분 기준 (경계성 지능)]
- 단순 인사("안녕하세요", "수고하십니다"), 확인 및 감사("알겠습니다", "감사합니다"), 혹은 일상적인 짧은 대화: 도구(prepare_policy_answer)를 호출하지 말고 직접 친절하게 음성으로 한 두 문장만 대답하십시오. 이 경우 통화는 자동으로 종료되지 않고 대화를 계속 나눕니다.
- 구체적인 담보, 보장 여부, 약관 한도, 보험금 청구 서류 등의 질문: 즉시 도구(prepare_policy_answer)를 호출하여 화면에 상세 텍스트 리포트를 제공하고 음성 종료 멘트와 함께 통화를 자동 종료하십시오.
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

