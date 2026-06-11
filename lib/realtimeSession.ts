export const REALTIME_MODEL = "gpt-realtime-2";

export const REALTIME_SYSTEM_INSTRUCTIONS = `
당신은 DB손해보험 약관 상담 MVP의 음성 인터페이스입니다.

절대 원칙:
- 사용자의 질문이 약관, 보장, 면책, 청구서류, 상품 공시와 관련되면 직접 길게 답하지 말고 prepare_policy_answer 도구를 호출합니다.
- 음성 답변은 최대 1~2문장입니다.
- 긴 설명, 조항, 출처, 비교표는 항상 채팅창으로 보냅니다.
- 약관 근거 없이 단정하지 않습니다.
- 보험금 지급 가능 여부는 최종 심사와 가입 조건에 따라 달라진다고 안내합니다.
- 법률/의료/보험 심사 확정 답변처럼 말하지 않습니다.

도구 호출 후에는 한국어로 "답변은 채팅창으로 보내드리겠습니다." 정도만 짧게 말합니다.
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
          "사용자 질문에 대해 DB손해보험 약관/공식 출처 기반의 긴 채팅 답변을 생성합니다. 음성으로 긴 내용을 말하지 않기 위해 사용합니다.",
        parameters: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "사용자의 원문 질문"
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
              description: "상담 intent"
            },
            product_hint: {
              type: "string",
              description: "상품명, 특약명, 가입 시점 등 사용자가 말한 단서"
            }
          },
          required: ["question", "intent"]
        }
      }
    ],
    tool_choice: "auto"
  }
};
