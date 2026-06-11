"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import type { PolicyAnswer, PolicyIntent } from "@/lib/policyKnowledge";

type ChatMessage =
  | { id: string; role: "system" | "user"; content: string }
  | { id: string; role: "assistant"; content: string; answer?: PolicyAnswer };

type ChatMessageInput =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; answer?: PolicyAnswer };

type RealtimeEvent = {
  type?: string;
  delta?: string;
  transcript?: string;
  item?: {
    type?: string;
    name?: string;
    call_id?: string;
    arguments?: string;
  };
  name?: string;
  call_id?: string;
  arguments?: string;
};

const EXAMPLE_QUESTIONS = [
  "교통사고로 입원하면 실손에서 보장되나요?",
  "보험금 청구할 때 어떤 서류가 필요해요?",
  "미용 목적 치료는 보상에서 제외되나요?"
];

export function VoiceCounselorApp() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "system",
      content:
        "MVP 데모입니다. 현재 약관 데이터는 샘플이며, 실제 배포 전 DB손해보험 공식 약관 원문으로 인덱스를 교체해야 합니다."
    }
  ]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const statusLabel = useMemo(() => {
    if (isConnecting) return "Realtime 연결 중";
    if (isConnected) return "음성 상담 연결됨";
    return "대기 중";
  }, [isConnecting, isConnected]);

  async function startRealtime() {
    setError(null);
    setIsConnecting(true);

    try {
      const tokenResponse = await fetch("/api/realtime/token", { method: "POST" });
      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        throw new Error(tokenData.error ?? "Realtime token 발급에 실패했습니다.");
      }

      const ephemeralKey = tokenData.value ?? tokenData.client_secret?.value;
      if (!ephemeralKey) {
        throw new Error("Realtime client secret 응답에서 value를 찾지 못했습니다.");
      }

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audio = new Audio();
      audio.autoplay = true;
      audioRef.current = audio;

      pc.ontrack = (event) => {
        audio.srcObject = event.streams[0];
        void audio.play().catch(() => undefined);
      };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        sendRealtimeEvent({
          type: "response.create",
          response: {
            instructions:
              "사용자에게 한국어로 짧게 인사하고, 약관 질문을 말해달라고 안내하세요. 한 문장으로만 말하세요."
          }
        });
      };
      dc.onmessage = (event) => handleRealtimeEvent(event.data);
      dc.onerror = () => setError("Realtime data channel 오류가 발생했습니다.");
      dc.onclose = () => setIsConnected(false);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp"
        }
      });

      if (!sdpResponse.ok) {
        throw new Error(await sdpResponse.text());
      }

      const answer: RTCSessionDescriptionInit = {
        type: "answer",
        sdp: await sdpResponse.text()
      };
      await pc.setRemoteDescription(answer);
    } catch (cause) {
      stopRealtime();
      setIsConnecting(false);
      setError(cause instanceof Error ? cause.message : "Realtime 연결에 실패했습니다.");
    }
  }

  function stopRealtime() {
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    audioRef.current?.pause();

    dcRef.current = null;
    pcRef.current = null;
    streamRef.current = null;
    audioRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
  }

  function sendRealtimeEvent(payload: unknown) {
    const channel = dcRef.current;
    if (channel?.readyState === "open") {
      channel.send(JSON.stringify(payload));
    }
  }

  function handleRealtimeEvent(rawData: string) {
    const event = safeJsonParse<RealtimeEvent>(rawData);
    if (!event?.type) return;

    if (event.type === "response.output_audio_transcript.delta" && event.delta) {
      setLiveTranscript((current) => `${current}${event.delta}`);
    }

    if (event.type === "response.output_audio_transcript.done") {
      setLiveTranscript("");
    }

    if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
      addMessage({ role: "user", content: event.transcript });
    }

    const functionCall =
      event.type === "response.output_item.done" && event.item?.type === "function_call"
        ? event.item
        : event.type === "response.function_call_arguments.done"
          ? event
          : null;

    if (functionCall?.name === "prepare_policy_answer" && functionCall.call_id) {
      void preparePolicyAnswer(functionCall.call_id, functionCall.arguments ?? "{}");
    }
  }

  async function preparePolicyAnswer(callId: string, rawArguments: string) {
    const args = safeJsonParse<{ question?: string; intent?: PolicyIntent; product_hint?: string }>(rawArguments) ?? {};
    const question = args.question?.trim() || "사용자 약관 질문";

    addMessage({ role: "user", content: question });
    const answer = await requestPolicyAnswer(question, args.intent, args.product_hint);

    sendRealtimeEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          status: "sent_to_chat",
          spoken_message: "답변은 채팅창으로 보내드리겠습니다.",
          chat_answer_id: answer.id,
          citation_count: answer.citations.length
        })
      }
    });

    sendRealtimeEvent({
      type: "response.create",
      response: {
        instructions:
          "도구 결과의 spoken_message만 한국어로 짧게 말하세요. 약관 내용은 말하지 마세요."
      }
    });
  }

  async function requestPolicyAnswer(question: string, intent?: PolicyIntent, productHint?: string) {
    const response = await fetch("/api/policy/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        intent,
        product_hint: productHint
      })
    });
    const payload = (await response.json()) as PolicyAnswer | { error?: string };

    if (!response.ok || !isPolicyAnswer(payload)) {
      throw new Error("error" in payload && payload.error ? payload.error : "약관 답변 생성에 실패했습니다.");
    }

    addMessage({
      role: "assistant",
      content: payload.summary,
      answer: payload
    });

    return payload;
  }

  async function submitTextQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question) return;

    setInput("");
    setError(null);
    addMessage({ role: "user", content: question });

    try {
      await requestPolicyAnswer(question);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "답변 생성에 실패했습니다.");
    }
  }

  function addMessage(message: ChatMessageInput) {
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        ...message
      } as ChatMessage
    ]);
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-mark">DB</div>
          <div>
            <h1>DB손해보험 약관 보이스 상담봇 MVP</h1>
            <p>Realtime 음성 상담은 짧게, 약관 근거 답변은 채팅으로 길게 제공합니다.</p>
          </div>
        </div>
        <div className={`status-pill ${isConnected ? "connected" : ""}`}>
          <span className="status-dot" />
          {statusLabel}
        </div>
      </header>

      <section className="workspace">
        <aside className="panel voice-panel">
          <div className="voice-stage">
            <div className={`orb ${isConnected ? "listening" : ""}`} aria-hidden="true" />
            <div>
              <h2>{isConnected ? "듣고 있습니다" : "음성 상담 시작"}</h2>
              <p>
                사용자가 긴 약관 설명을 요구하면 음성은 짧게 응답하고, 조항과 조건은 오른쪽
                채팅창으로 보냅니다.
              </p>
            </div>
          </div>

          <div className="controls">
            <button
              className="primary-button"
              onClick={startRealtime}
              disabled={isConnecting || isConnected}
            >
              음성 연결
            </button>
            <button
              className="ghost-button danger"
              onClick={stopRealtime}
              disabled={!isConnecting && !isConnected}
            >
              연결 종료
            </button>
          </div>

          {liveTranscript ? <div className="hint-box">봇 음성: {liveTranscript}</div> : null}
          {error ? <div className="hint-box error">{error}</div> : null}

          <div className="hint-box runbook">
            <h3>MVP 운영 기준</h3>
            <ol>
              <li>Realtime 모델은 intent 파악과 짧은 음성 안내만 담당합니다.</li>
              <li>약관 검색과 긴 답변은 백엔드 API가 생성해 채팅에 표시합니다.</li>
              <li>실제 배포 전 공식 약관 PDF와 공시 URL 인덱싱이 필요합니다.</li>
            </ol>
          </div>
        </aside>

        <section className="panel chat-panel">
          <div className="chat-header">
            <h2>채팅 답변</h2>
            <p>
              긴 답변은 요약, 적용 조건, 주의사항, 근거 조항, 확인 필요사항으로 나누어 표시합니다.
            </p>
          </div>

          <div className="messages">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>

          <form className="composer" onSubmit={submitTextQuestion}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={EXAMPLE_QUESTIONS[0]}
              aria-label="약관 질문"
            />
            <button className="secondary-button" type="submit">
              질문
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "assistant" && message.answer) {
    return (
      <article className="message assistant answer-card">
        <h3>약관 기준 답변</h3>
        <AnswerSection title="요약" items={[message.answer.summary]} />
        <AnswerSection title="적용 가능 조건" items={message.answer.conditions} />
        <AnswerSection title="주의/제외 가능 조건" items={message.answer.cautions} />
        <AnswerSection title="확인 필요 정보" items={message.answer.requiredInfo} />
        <div className="answer-section">
          <strong>근거</strong>
          {message.answer.citations.map((citation) => (
            <div className="citation" key={citation.id}>
              {citation.title} / {citation.section}
              <small>
                p.{citation.page} · {citation.version} · {citation.sourceUrl}
              </small>
              <small>{citation.excerpt}</small>
            </div>
          ))}
        </div>
        <div className="answer-section">
          <strong>면책 안내</strong>
          <span>{message.answer.disclaimer}</span>
        </div>
      </article>
    );
  }

  return <div className={`message ${message.role}`}>{message.content}</div>;
}

function AnswerSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="answer-section">
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isPolicyAnswer(value: PolicyAnswer | { error?: string }): value is PolicyAnswer {
  return "id" in value && "summary" in value && "citations" in value;
}
