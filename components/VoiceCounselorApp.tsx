"use client";

import { FormEvent, useMemo, useRef, useState, useEffect } from "react";
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

export function VoiceCounselorApp() {
  const [hasStartedConsultation, setHasStartedConsultation] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sessionDuration, setSessionDuration] = useState(0);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "system",
      content:
        "반갑습니다. DB손해보험 동목포 부지점장 프로미입니다. PA님 무엇을 도와드릴까요? 우측 상단의 [도움요청 🎙️] 버튼을 누르시면 음성 상담을 시작하실 수 있습니다."
    }
  ]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const processedCallIdsRef = useRef<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);

  const statusLabel = useMemo(() => {
    if (isConnecting) return "프로미 호출 중...";
    if (isConnected) return "실시간 음성 연결됨";
    return "음성 대기 중";
  }, [isConnecting, isConnected]);

  // Reset inactivity timer (3 minutes auto-disconnect)
  const resetInactivityTimer = () => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = setTimeout(() => {
      console.log("3분간 활동이 없어 음성 세션을 자동 차단합니다.");
      stopRealtime();
    }, 3 * 60 * 1000);
  };

  // Monitor session duration
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    if (isConnected) {
      setSessionDuration(0);
      intervalId = setInterval(() => {
        setSessionDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setSessionDuration(0);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isConnected]);

  // Monitor visibility state to disconnect WebRTC in background
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        console.log("PWA 백그라운드 전환으로 음성 세션을 자동 종료합니다.");
        stopRealtime();
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, []);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveTranscript, isSearching]);

  async function startRealtime() {
    setError(null);
    setIsConnecting(true);
    resetInactivityTimer();

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

      // Explicitly enable echoCancellation and noiseSuppression to prevent feedback loops on mobile speakers
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      streamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);

        // Explicitly update session configuration on connection to enable Whisper transcription in Korean
        sendRealtimeEvent({
          type: "session.update",
          session: {
            input_audio_transcription: {
              model: "whisper-1",
              language: "ko"
            }
          }
        });

        // Stabilize mic stream pop noise to prevent VAD from interrupting the initial greeting
        setTimeout(() => {
          sendRealtimeEvent({
            type: "response.create",
            response: {
              instructions: "사용자에게 한국어로 'PA님 무엇을 도와드릴까요?'라고 단 한 문장으로 간결하게 첫 인사를 하십시오. 다른 불필요한 안내 멘트는 절대로 추가하지 마십시오."
            }
          });
        }, 800);
      };
      dc.onmessage = (event) => {
        resetInactivityTimer();
        handleRealtimeEvent(event.data);
      };
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
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
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
      const text = event.transcript || liveTranscript;
      const cleaned = text.trim();
      if (cleaned) {
        addMessage({ role: "assistant", content: cleaned });
      }
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

    const isConfirmation = (text: string) => {
      const clean = text.trim().replace(/[\s,.!~?]+/g, "");
      return ["네", "맞아요", "네맞아요", "응", "어", "맞아", "예", "맞습니다", "그렇습니다", "그럼요", "네그렇습니다", "ok", "yes", "y"].includes(clean.toLowerCase());
    };

    // Deduplicate user bubble
    setMessages((current) => {
      // If there is already a substantial user message in the history, we don't insert a fake question.
      const hasExistingQuery = current.some(
        (m) =>
          m.role === "user" &&
          m.content.length > 5 &&
          !isConfirmation(m.content)
      );

      if (hasExistingQuery) {
        return current;
      }

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

    setIsSearching(true);
    let answerPayload: PolicyAnswer | null = null;

    try {
      answerPayload = await requestPolicyAnswer(question, args.intent, args.product_hint);
    } catch (err) {
      setError(err instanceof Error ? err.message : "약관 검색 중 에러가 발생했습니다.");
    } finally {
      setIsSearching(false);
    }

    sendRealtimeEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({
          status: "sent_to_chat",
          spoken_message: "요청하신 상세 약관 리포트 조회를 마쳤습니다. 대화창에 분석 결과를 전송해드렸습니다.",
          chat_answer_id: answerPayload?.id || "error",
          citation_count: answerPayload?.citations?.length || 0
        })
      }
    });

    sendRealtimeEvent({
      type: "response.create",
      response: {
        instructions:
          "도구 결과의 spoken_message만 한국어로 짧게 말하세요. 그 이외의 대답은 절대로 덧붙이지 마십시오."
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

    // Auto-disconnect voice session to save costs after rendering the RAG report
    stopRealtime();

    return payload;
  }

  async function submitTextQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = input.trim();
    if (!question) return;

    setInput("");
    setError(null);
    addMessage({ role: "user", content: question });

    setIsSearching(true);
    try {
      await requestPolicyAnswer(question);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "답변 생성에 실패했습니다.");
    } finally {
      setIsSearching(false);
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

  function handleStartButtonClick() {
    setHasStartedConsultation(true);
    // DO NOT start WebRTC automatically here to let user view UI first and grant microphone access via help button
  }

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  function handleCopyText(msgId: string, question: string, ans: PolicyAnswer) {
    const conditionsText = ans.conditions && ans.conditions.length > 0
      ? `\n\n✅ 보장 대상 및 지급 조건:\n${ans.conditions.map((c) => `- ${c}`).join("\n")}`
      : "";
    const cautionsText = ans.cautions && ans.cautions.length > 0
      ? `\n\n⚠️ 보장 제외 및 유의사항 (면책):\n${ans.cautions.map((c) => `- ${c}`).join("\n")}`
      : "";
    const requiredInfoText = ans.requiredInfo && ans.requiredInfo.length > 0
      ? `\n\n📋 정확한 확인을 위해 필요한 정보:\n${ans.requiredInfo.map((i) => `- ${i}`).join("\n")}`
      : "";

    const copyText = `💡 핵심 요약:
${ans.summary}${conditionsText}${cautionsText}${requiredInfoText}

---
* ${ans.disclaimer || "본 답변은 공식 공시자료 검색 기반 참고용이며, 최종 심사 결과와 다를 수 있습니다."}`;

    navigator.clipboard.writeText(copyText).then(() => {
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  // Cover Screen / Entrance - Revamped and brand aligned
  if (!hasStartedConsultation) {
    return (
      <main className="cover-shell">
        <div className="cover-card">
          <div className="promy-avatar-lg">
            <img src="/promy.png" alt="PROMY" className="welcome-promy-img" />
          </div>
          <h1 className="cover-title">동목포 부지점장</h1>
          <p className="cover-description">
            공식 상품 공시 자료 기반 약관 RAG 조회 시스템
          </p>
          <button className="primary-button start-consult-btn" onClick={handleStartButtonClick}>
            상담 시작하기 💬
          </button>
        </div>
      </main>
    );
  }

  // Main Unified Messenger UI
  return (
    <main className="messenger-shell">
      {/* Header */}
      <header className="messenger-header">
        <div className="messenger-brand">
          <img src="/promy.png" alt="PROMY" className="avatar-img" />
          <div>
            <h2>동목포 부지점장</h2>
            <div className="messenger-status-row">
              <span className={`messenger-status ${isConnected ? "online" : ""}`}>
                {statusLabel}
              </span>
              {isConnected && (
                <span className="session-timer">
                  [{formatDuration(sessionDuration)}]
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="messenger-header-actions">
          {!isConnected && !isConnecting ? (
            <button className="primary-button help-request-btn" onClick={startRealtime}>
              도움요청 🎙️
            </button>
          ) : (
            <button className="danger-button help-request-btn" onClick={stopRealtime} disabled={isConnecting}>
              {isConnecting ? "연결 중..." : "상담 종료 ✖"}
            </button>
          )}
        </div>
      </header>

      {/* Messages */}
      <section className="messenger-chat-area">
        {messages.map((message) => {
          const wrapperClass =
            message.role === "user"
              ? "user-wrapper"
              : message.role === "system"
              ? "system-wrapper"
              : "assistant-wrapper";
          return (
            <div key={message.id} className={`message-wrapper ${wrapperClass}`}>
              {message.role === "assistant" && (
                <div className="avatar-wrapper">
                  <img src="/promy.png" alt="PROMY" className="avatar-img" />
                </div>
              )}
              <div className="bubble-wrapper">
                {message.role === "assistant" && <span className="sender-name">프로미</span>}
                {message.role === "user" && <span className="sender-name">나 (설계사)</span>}
                <MessageBubble
                  message={message}
                  copiedId={copiedId}
                  onCopy={(ans) => handleCopyText(message.id, message.content, ans)}
                />
              </div>
              {message.role === "user" && (
                <div className="avatar-wrapper">
                  <div className="user-avatar-circle">PA</div>
                </div>
              )}
            </div>
          );
        })}

        {/* Live speech transcript (Typing bubble) */}
        {liveTranscript && (
          <div className="message-wrapper assistant-wrapper">
            <div className="avatar-wrapper">
              <img src="/promy.png" alt="PROMY" className="avatar-img" />
            </div>
            <div className="bubble-wrapper">
              <span className="sender-name">프로미 (말하는 중)</span>
              <div className="message assistant-bubble live-typing-bubble">
                <span className="live-transcript-tag">🎙️ 실시간 음성</span>
                <p>{liveTranscript}</p>
              </div>
            </div>
          </div>
        )}

        {/* Searching Loader Card */}
        {isSearching && (
          <div className="message-wrapper assistant-wrapper">
            <div className="avatar-wrapper">
              <img src="/promy.png" alt="PROMY" className="avatar-img" />
            </div>
            <div className="bubble-wrapper">
              <span className="sender-name">프로미</span>
              <div className="message assistant-bubble loader-bubble">
                <div className="loader-card-content">
                  <div className="loader-spinner">
                    <span className="dot dot-1" />
                    <span className="dot dot-2" />
                    <span className="dot dot-3" />
                  </div>
                  <p>프로미가 DB손해보험 상품공시실에서 관련 약관을 조회하는 중입니다...</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="system-error-wrapper">
            <div className="toast-error">{error}</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </section>
    </main>
  );
}

function MessageBubble({
  message,
  copiedId,
  onCopy
}: {
  message: ChatMessage;
  copiedId: string | null;
  onCopy: (ans: PolicyAnswer) => void;
}) {
  if (message.role === "assistant" && message.answer) {
    const ans = message.answer;
    const isCopied = copiedId === message.id;
    return (
      <article className="message assistant answer-card">
        <div className="card-top">
          <span className="card-logo-badge">DB손보</span>
          <span className="card-category-tag">공식 약관 RAG 리포트</span>
          <button className="copy-action-btn" onClick={() => onCopy(ans)}>
            {isCopied ? "복사 완료! ✔" : "📋 클립보드 복사"}
          </button>
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

  if (message.role === "system") {
    return (
      <div className="message system-bubble">
        {message.content}
      </div>
    );
  }

  return (
    <div className="message user-bubble">
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
