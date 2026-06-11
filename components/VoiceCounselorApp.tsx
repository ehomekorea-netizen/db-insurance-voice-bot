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
  const [activeTab, setActiveTab] = useState<"voice" | "chat">("voice");
  const [unreadCount, setUnreadCount] = useState(0);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "system",
      content:
        "안녕하세요. DB손해보험 AI 보험 상담원입니다. 대화를 통해 약관 및 보장 내역을 문의하시거나 하단 채팅을 이용해보세요."
    }
  ]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const processedCallIdsRef = useRef<Set<string>>(new Set());

  const statusLabel = useMemo(() => {
    if (isConnecting) return "AI 상담원 호출 중...";
    if (isConnected) return "상담 연결 완료 (음성)";
    return "연결 대기 중";
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
    processedCallIdsRef.current.clear();
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

    if (
      event.type === "response.function_call_arguments.done" &&
      event.name === "prepare_policy_answer" &&
      event.call_id
    ) {
      void preparePolicyAnswer(event.call_id, event.arguments ?? "{}");
    }
  }

  async function preparePolicyAnswer(callId: string, rawArguments: string) {
    if (processedCallIdsRef.current.has(callId)) return;
    processedCallIdsRef.current.add(callId);

    const args = safeJsonParse<{ question?: string; intent?: PolicyIntent; product_hint?: string }>(rawArguments) ?? {};
    const question = args.question?.trim() || "사용자 약관 질문";

    // Deduplicate user bubble: if transcription event already added it, don't duplicate.
    setMessages((current) => {
      const lastMsg = current[current.length - 1];
      if (
        lastMsg &&
        lastMsg.role === "user" &&
        (lastMsg.content.includes(question) || question.includes(lastMsg.content))
      ) {
        return current;
      }
      return [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: question
        }
      ];
    });

    const answer = await requestPolicyAnswer(question, args.intent, args.product_hint);

    sendRealtimeEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          status: "sent_to_chat",
          spoken_message: "상세 약관 확인 결과는 하단 채팅 화면에 전송해드렸습니다. 확인해 보세요.",
          chat_answer_id: answer.id,
          citation_count: answer.citations.length
        })
      }
    });

    sendRealtimeEvent({
      type: "response.create",
      response: {
        instructions:
          "도구 결과의 spoken_message만 한국어로 짧게 말하세요. 약관의 긴 조항이나 리스트는 절대로 말하지 마세요."
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

    // Switch check and unread count
    if (message.role === "assistant" && activeTab !== "chat") {
      setUnreadCount((prev) => prev + 1);
    }
  }

  function handleTabChange(tab: "voice" | "chat") {
    setActiveTab(tab);
    if (tab === "chat") {
      setUnreadCount(0);
    }
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-mark">DB</div>
          <div>
            <h1>DB손해보험 AI 보이스 상담원</h1>
            <p className="subtitle">공식 공시실 기반 스마트 약관 RAG 검색 서비스</p>
          </div>
        </div>
        <div className={`status-pill ${isConnected ? "connected" : ""} ${isConnecting ? "connecting" : ""}`}>
          <span className="status-dot" />
          {statusLabel}
        </div>
      </header>

      <section className="workspace">
        {/* LEFT: VOICE VIEW */}
        <aside className={`panel voice-panel ${activeTab === "voice" ? "active" : ""}`}>
          <div className="voice-stage">
            <div className="orb-container">
              <div className={`orb-glow ${isConnected ? "active" : ""}`} />
              <div className={`orb-ring ring-1 ${isConnected ? "active" : ""}`} />
              <div className={`orb-ring ring-2 ${isConnected ? "active" : ""}`} />
              <div className={`orb ${isConnected ? "listening" : ""} ${isConnecting ? "connecting" : ""}`} aria-hidden="true">
                <div className="orb-inner" />
              </div>
            </div>
            <div className="stage-caption">
              <h2>{isConnected ? "음성 상담 진행 중" : isConnecting ? "연결 요청 중" : "AI 상담 시작하기"}</h2>
              <p>
                {isConnected 
                  ? "보험 약관에 대해 궁금한 점을 자연스럽게 말씀해보세요." 
                  : "음성 연결을 누르시면 마이크를 통해 대화를 시작할 수 있습니다."}
              </p>
            </div>
          </div>

          <div className="controls">
            {!isConnected && !isConnecting ? (
              <button className="primary-button call-btn" onClick={startRealtime}>
                <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6.62 10.79a15.15 15.15 0 006.59 6.59l2.2-2.2a1 1 0 011.11-.27 11.72 11.72 0 003.74.6 1 1 0 011 1v3.5a1 1 0 01-1 1A16 16 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.72 11.72 0 00.6 3.74 1 1 0 01-.27 1.1l-2.2 2.2z" />
                </svg>
                상담원 연결
              </button>
            ) : (
              <button className="danger-button hangup-btn" onClick={stopRealtime} disabled={isConnecting}>
                <svg className="btn-icon" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 11h3v2h-3v3h-2v-3H8v-2h3V8h2v5z" transform="rotate(45 12 12)" />
                </svg>
                상담 종료
              </button>
            )}
          </div>

          {liveTranscript && (
            <div className="live-transcript-bubble">
              <span className="speaker-tag">AI 상담원</span>
              <p className="transcript-text">{liveTranscript}</p>
            </div>
          )}

          {error && <div className="toast-error">{error}</div>}

          <div className="quick-guide">
            <h3>💡 음성 질문 예시</h3>
            <ul>
              {EXAMPLE_QUESTIONS.map((q, idx) => (
                <li key={idx} onClick={() => setInput(q)} className="guide-item">
                  "{q}"
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* RIGHT: CHAT VIEW */}
        <section className={`panel chat-panel ${activeTab === "chat" ? "active" : ""}`}>
          <div className="chat-header">
            <h2>상세 약관 리포트</h2>
            <p>공식 웹사이트 검색에 기반한 정확한 보장 조건과 출처 조항을 한 눈에 확인합니다.</p>
          </div>

          <div className="messages-area">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>

          <form className="composer" onSubmit={submitTextQuestion}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="약관이나 가입 조건을 여기에 텍스트로 물어보세요..."
              aria-label="약관 질문"
            />
            <button className="secondary-button" type="submit" disabled={!input.trim()}>
              전송
            </button>
          </form>
        </section>
      </section>

      {/* MOBILE BOTTOM NAV BAR */}
      <nav className="bottom-nav">
        <button
          className={`nav-item ${activeTab === "voice" ? "active" : ""}`}
          onClick={() => handleTabChange("voice")}
        >
          <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3z" />
          </svg>
          <span>음성 상담</span>
        </button>
        <button
          className={`nav-item ${activeTab === "chat" ? "active" : ""}`}
          onClick={() => handleTabChange("chat")}
        >
          <div className="chat-badge-wrapper">
            <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.12 2.9 2.78 2.9h12.94c1.66 0 2.78-1.3 2.78-2.9V6.49c0-1.6-1.12-2.9-2.78-2.9H3.47c-1.66 0-2.78 1.3-2.78 2.9v9.26z" />
            </svg>
            {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
          </div>
          <span>상세 답변</span>
        </button>
      </nav>
    </main>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "assistant" && message.answer) {
    const ans = message.answer;
    return (
      <article className="message assistant answer-card">
        <div className="card-top">
          <span className="card-logo-badge">DB손보</span>
          <span className="card-category-tag">약관 분석 리포트</span>
        </div>

        {ans.summary && (
          <div className="answer-section">
            <h4 className="section-title summary-style">💡 핵심 요약</h4>
            <p className="summary-text">{ans.summary}</p>
          </div>
        )}

        {ans.conditions && ans.conditions.length > 0 && (
          <div className="answer-section">
            <h4 className="section-title conditions-style">✅ 보장 대상 및 지급 조건</h4>
            <ul className="bullet-list green-theme">
              {ans.conditions.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {ans.cautions && ans.cautions.length > 0 && (
          <div className="answer-section">
            <h4 className="section-title cautions-style">⚠️ 보장 제외 및 유의사항 (면책)</h4>
            <ul className="bullet-list orange-theme">
              {ans.cautions.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {ans.requiredInfo && ans.requiredInfo.length > 0 && (
          <div className="answer-section">
            <h4 className="section-title info-style">📋 정확한 확인을 위해 필요한 정보</h4>
            <ul className="bullet-list blue-theme">
              {ans.requiredInfo.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {ans.citations && ans.citations.length > 0 && (
          <div className="answer-section">
            <h4 className="section-title citation-style">🔗 공식 출처 및 공시 자료</h4>
            <div className="citations-grid">
              {ans.citations.map((citation) => (
                <a
                  href={citation.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="citation-card"
                  key={citation.id}
                >
                  <div className="citation-header">
                    <span className="citation-name">{citation.title}</span>
                    <span className="citation-section">{citation.section}</span>
                  </div>
                  {citation.excerpt && <p className="citation-excerpt">"{citation.excerpt}"</p>}
                  <div className="citation-footer">
                    <span className="citation-ver">{citation.version}</span>
                    <span className="citation-link-action">공식 홈 바로가기 ↗</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}

        {ans.disclaimer && (
          <footer className="card-disclaimer">
            <p>{ans.disclaimer}</p>
          </footer>
        )}
      </article>
    );
  }

  return (
    <div className={`message ${message.role === "user" ? "user-bubble" : "system-bubble"}`}>
      {message.content}
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
