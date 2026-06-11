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
  const [userLiveTranscript, setUserLiveTranscript] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [isMicMuted, setIsMicMuted] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "system",
      content:
        "반갑습니다. DB손해보험 동목포 부지점장 프로미입니다. PA님 무엇을 도와드릴까요? 우측 상단의 [도움요청 🎙️] 버튼을 누르시면 음성 상담을 시작하실 수 있습니다."
    }
  ]);

  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const silenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isPlayingAudio = useRef(false);
  const isFinalEndingPending = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const statusLabel = useMemo(() => {
    if (isConnecting) return "프로미 호출 중...";
    if (isConnected) return "실시간 음성 연결됨";
    return "음성 대기 중";
  }, [isConnecting, isConnected]);

  // Audio Playback with TTS
  async function playTts(text: string): Promise<void> {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    
    // Show text transcript live as assistant speaking indicator
    setLiveTranscript(text);
    isPlayingAudio.current = true;

    // Turn off user SpeechRecognition while AI speaks to prevent echo feedback loop
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
    }

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (!response.ok) {
        throw new Error("TTS generation failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      activeAudioRef.current = audio;

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          activeAudioRef.current = null;
          setLiveTranscript("");
          isPlayingAudio.current = false;
          resolve();
        };
        audio.onerror = (e) => {
          activeAudioRef.current = null;
          setLiveTranscript("");
          isPlayingAudio.current = false;
          reject(e);
        };
        audio.play().catch((err) => {
          activeAudioRef.current = null;
          setLiveTranscript("");
          isPlayingAudio.current = false;
          reject(err);
        });
      });
    } catch (err) {
      console.error("playTts error:", err);
      setLiveTranscript("");
      isPlayingAudio.current = false;
    }
  }

  // Monitor 20-second inactivity timer
  function resetInactivityTimer() {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    if (isConnected && !isMicMuted && !isSearching && !isPlayingAudio.current && !isFinalEndingPending.current) {
      inactivityTimerRef.current = setTimeout(() => {
        console.log("20초간 무반응 상태로 음성 세션을 자동 종료합니다.");
        stopRealtime();
        setError("20초 동안 대화가 없어 음성 상담이 자동으로 종료되었습니다.");
      }, 20 * 1000);
    }
  }

  useEffect(() => {
    resetInactivityTimer();
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [isConnected, isMicMuted, isSearching, isFinalEndingPending.current]);

  // Monitor session duration & enforce 3-minute hard cap
  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    if (isConnected) {
      setSessionDuration(0);
      intervalId = setInterval(() => {
        setSessionDuration((prev) => {
          if (prev >= 180) { // 3 minutes limit
            stopRealtime();
            setError("최대 상담 시간(3분)을 초과하여 음성 상담이 자동으로 종료되었습니다.");
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      setSessionDuration(0);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isConnected]);

  // Monitor visibility state to disconnect in background
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
    };
  }, []);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveTranscript, isSearching, userLiveTranscript]);

  function startSpeechRecognition() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
    }

    if (typeof window === "undefined") return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("SpeechRecognition not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "ko-KR";

    recognition.onresult = (event: any) => {
      // Clear 20-second inactivity timer while user is actively speaking
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }

      let interimTranscript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const currentLiveText = (interimTranscript || finalTranscript).trim();
      if (currentLiveText) {
        setUserLiveTranscript(currentLiveText);

        // Reset silence detection timer (VAD threshold)
        if (silenceTimeoutRef.current) {
          clearTimeout(silenceTimeoutRef.current);
        }

        silenceTimeoutRef.current = setTimeout(() => {
          const finalQuestion = currentLiveText;
          if (finalQuestion) {
            void handleUserVoiceQuery(finalQuestion);
          }
        }, 1800);
      }
    };

    recognition.onerror = (e: any) => {
      console.warn("SpeechRecognition error:", e.error);
    };

    recognition.onend = () => {
      console.log("SpeechRecognition ended");
      // Auto restart if connected, not playing audio, and not searching
      if (isConnected && !isPlayingAudio.current && !isSearching && !isMicMuted) {
        try {
          recognition.start();
        } catch {}
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (err) {
      console.error("Failed to start SpeechRecognition:", err);
    }
  }

  async function handleUserVoiceQuery(question: string) {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    // Stop recording and clear live transcript display
    isPlayingAudio.current = true;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
    }
    setUserLiveTranscript("");

    // Optimistically add user bubble
    addMessage({ role: "user", content: question });

    setIsSearching(true);
    setError(null);

    try {
      const payload = await requestPolicyAnswer(question);
      setIsSearching(false);

      if (payload.isSimpleChat) {
        // A. Simple Conversational Answer
        await playTts(payload.summary);
        
        isPlayingAudio.current = false;
        if (isConnected && !isMicMuted) {
          startSpeechRecognition();
          resetInactivityTimer();
        }
      } else {
        // B. RAG Policy Answer
        isFinalEndingPending.current = true;
        await playTts("답변과 함께 상담은 자동종료됩니다.");
        isFinalEndingPending.current = false;
        stopRealtime();
      }
    } catch (err: any) {
      setIsSearching(false);
      setError(err instanceof Error ? err.message : "약관 검색 중 에러가 발생했습니다.");
      
      // Play error fallback message
      await playTts("죄송합니다. 약관 조회 중 일시적인 오류가 발생했습니다. 다시 말씀해 주시겠어요?");
      
      isPlayingAudio.current = false;
      if (isConnected && !isMicMuted) {
        startSpeechRecognition();
        resetInactivityTimer();
      }
    }
  }

  async function startRealtime() {
    setError(null);
    setIsConnecting(true);
    isPlayingAudio.current = true;

    try {
      setIsConnected(true);
      setIsConnecting(false);

      // Play welcome greeting
      await playTts("PA님 무엇을 도와드릴까요?");

      isPlayingAudio.current = false;
      if (!isMicMuted) {
        startSpeechRecognition();
      }
    } catch (cause) {
      stopRealtime();
      setIsConnecting(false);
      setError(cause instanceof Error ? cause.message : "Realtime 연결에 실패했습니다.");
    }
  }

  function stopRealtime() {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }

    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }

    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    if (isConnected) {
      const now = new Date();
      const formattedTime = now.toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
      addMessage({
        role: "system",
        content: `━━━ 음성 상담 종료 (${formattedTime}) ━━━`
      });
    }

    setIsConnected(false);
    setIsConnecting(false);
    setIsMicMuted(false);
    isPlayingAudio.current = false;
    isFinalEndingPending.current = false;
    setUserLiveTranscript("");
    setLiveTranscript("");
  }

  function setMicMuted(muted: boolean) {
    setIsMicMuted(muted);
    if (recognitionRef.current) {
      try {
        if (muted) {
          recognitionRef.current.abort();
        } else {
          if (isConnected && !isPlayingAudio.current) {
            recognitionRef.current.start();
          }
        }
      } catch (e) {}
    }
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
    const payload = (await response.json()) as (PolicyAnswer & { isSimpleChat?: boolean }) | { error?: string };

    if (!response.ok || !isPolicyAnswer(payload)) {
      throw new Error("error" in payload && payload.error ? payload.error : "약관 답변 생성에 실패했습니다.");
    }

    const contentText = isConnected
      ? `${payload.summary}\n\n*(음성 상담은 답변 전송 완료 후 자동으로 종료됩니다.)*`
      : payload.summary;

    addMessage({
      role: "assistant",
      content: contentText,
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
  }

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  function handleCopyText(msgId: string, question: string, ans: PolicyAnswer) {
    const analysisText = ans.analysis
      ? `🔍 질문 이해 및 분석 근거:\n${ans.analysis}\n\n`
      : "";
    const conditionsText = ans.conditions && ans.conditions.length > 0
      ? `\n\n✅ 보장 대상 및 지급 조건:\n${ans.conditions.map((c) => `- ${c}`).join("\n")}`
      : "";
    const cautionsText = ans.cautions && ans.cautions.length > 0
      ? `\n\n⚠️ 보장 제외 및 유의사항 (면책):\n${ans.cautions.map((c) => `- ${c}`).join("\n")}`
      : "";
    const requiredInfoText = ans.requiredInfo && ans.requiredInfo.length > 0
      ? `\n\n📋 정확한 확인을 위해 필요한 정보:\n${ans.requiredInfo.map((i) => `- ${i}`).join("\n")}`
      : "";

    const copyText = `${analysisText}💡 핵심 요약:
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
              <span className={`messenger-status ${isConnected ? (isMicMuted ? "muted" : "online") : ""}`}>
                {isConnected && isMicMuted ? "🎙️ 프로미 답변 중 (음소거)" : statusLabel}
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
                {message.role === "user" && <span className="sender-name">나</span>}
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

        {/* User live speech transcript */}
        {userLiveTranscript && (
          <div className="message-wrapper user-wrapper">
            <div className="bubble-wrapper">
              <span className="sender-name">나 (말하는 중)</span>
              <div className="message user-bubble live-typing-bubble">
                <span className="live-transcript-tag">🎙️ 음성 인식 중</span>
                <p>{userLiveTranscript}</p>
              </div>
            </div>
            <div className="avatar-wrapper">
              <div className="user-avatar-circle">PA</div>
            </div>
          </div>
        )}

        {/* Assistant live speech transcript (Typing bubble) */}
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

        {ans.analysis && (
          <div className="answer-section">
            <h4 className="section-title analysis-style">🔍 질문 이해 및 분석 근거</h4>
            <p className="analysis-text" style={{ whiteSpace: "pre-line" }}>{ans.analysis}</p>
          </div>
        )}

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
                    <span className="citation-name">{safeDecodeURIComponent(citation.title)}</span>
                    <span className="citation-section">{citation.section}</span>
                  </div>
                  {citation.excerpt && <p className="citation-excerpt">"{safeDecodeURIComponent(citation.excerpt)}"</p>}
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

function safeDecodeURIComponent(val: string): string {
  try {
    return decodeURIComponent(val);
  } catch {
    return val;
  }
}

function isPolicyAnswer(value: PolicyAnswer | { error?: string }): value is PolicyAnswer {
  return "id" in value && "summary" in value && "citations" in value;
}
