"use client";

import { FormEvent, useMemo, useRef, useState, useEffect } from "react";
import type { PolicyAnswer, PolicyIntent } from "@/lib/policyKnowledge";


type ChatMessage =
  | { id: string; role: "system" | "user"; content: string; timestamp?: string }
  | { id: string; role: "assistant"; content: string; answer?: PolicyAnswer; timestamp?: string };

type ChatMessageInput =
  | { role: "system" | "user"; content: string; timestamp?: string }
  | { role: "assistant"; content: string; answer?: PolicyAnswer; timestamp?: string };

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
  const [activeSearchQuery, setActiveSearchQuery] = useState("");

  const userLiveTranscriptRef = useRef("");
  useEffect(() => {
    userLiveTranscriptRef.current = userLiveTranscript;
  }, [userLiveTranscript]);

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

  // Web Audio API VAD Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const vadRafIdRef = useRef<number | null>(null);
  const lastActiveTimeRef = useRef<number>(Date.now());
  const hasSpokenRef = useRef<boolean>(false);

  const statusLabel = useMemo(() => {
    if (isConnecting) return "프로미 호출 중...";
    if (isConnected) return "실시간 음성 연결됨";
    return "음성 대기 중";
  }, [isConnecting, isConnected]);

  const searchingMessage = "네 PA님 금방 안내드리겠습니다";

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

  // Local static guide audio immediate play
  function playLocalGuideAudio() {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    
    const randomIdx = Math.floor(Math.random() * 3) + 1; // 1, 2, 3
    const guideFile = `/audio/guide_${randomIdx}.mp3`;
    
    isPlayingAudio.current = true;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
    }

    const audio = new Audio(guideFile);
    activeAudioRef.current = audio;
    
    const guideTexts: Record<number, string> = {
      1: "네, PA님! 금방 약관을 조회해 드릴게요.",
      2: "약관 내용을 분석하고 있습니다. 잠시만 기다려 주세요.",
      3: "해당 보장 조항을 검색 중입니다. 잠시만요."
    };
    setLiveTranscript(guideTexts[randomIdx] || "조회 중입니다. 잠시만 기다려 주세요.");

    audio.onended = () => {
      activeAudioRef.current = null;
      setLiveTranscript("");
      isPlayingAudio.current = false;
    };
    audio.onerror = () => {
      activeAudioRef.current = null;
      setLiveTranscript("");
      isPlayingAudio.current = false;
    };
    
    audio.play().catch((err) => {
      console.error("Local guide audio play failed:", err);
      isPlayingAudio.current = false;
    });
  }

  // Start Web Audio API VAD
  async function startVadMonitoring() {
    try {
      if (typeof window === "undefined") return;
      stopVadMonitoring();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      lastActiveTimeRef.current = Date.now();
      hasSpokenRef.current = false;

      const checkVolume = () => {
        if (!analyserRef.current || !isConnected || isSearching || isPlayingAudio.current || isMicMuted) {
          vadRafIdRef.current = requestAnimationFrame(checkVolume);
          return;
        }

        analyserRef.current.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          const v = (dataArray[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / bufferLength);

        // Volume threshold for active speaking
        const VOICE_THRESHOLD = 0.015; 
        const now = Date.now();

        if (rms > VOICE_THRESHOLD) {
          lastActiveTimeRef.current = now;
          if (!hasSpokenRef.current) {
            hasSpokenRef.current = true;
            console.log("[VAD] Voice activity detected");
          }
        } else {
          // If the user has spoken, and then is silent for 1.5 seconds, auto-submit
          if (hasSpokenRef.current && (now - lastActiveTimeRef.current > 1500)) {
            const currentSpeechText = userLiveTranscriptRef.current.trim();
            if (currentSpeechText) {
              console.log("[VAD] 1.5s silence detected, auto-submitting:", currentSpeechText);
              hasSpokenRef.current = false;
              lastActiveTimeRef.current = now;
              void handleUserVoiceQuery(currentSpeechText);
            }
          }
        }

        vadRafIdRef.current = requestAnimationFrame(checkVolume);
      };

      vadRafIdRef.current = requestAnimationFrame(checkVolume);
    } catch (err) {
      console.warn("VAD monitoring failed to initialize:", err);
    }
  }

  function stopVadMonitoring() {
    if (vadRafIdRef.current) {
      cancelAnimationFrame(vadRafIdRef.current);
      vadRafIdRef.current = null;
    }
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== "closed") {
        audioContextRef.current.close().catch(() => {});
      }
      audioContextRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    analyserRef.current = null;
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

    // Start VAD monitoring alongside SpeechRecognition
    startVadMonitoring();

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

      for (let i = 0; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const currentLiveText = (finalTranscript + interimTranscript).trim();
      if (currentLiveText) {
        setUserLiveTranscript(currentLiveText);

        // Update VAD activity states
        lastActiveTimeRef.current = Date.now();
        hasSpokenRef.current = true;

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

    // Reset VAD state to prevent double execution
    hasSpokenRef.current = false;

    // Stop recording and clear live transcript display
    isPlayingAudio.current = true;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
    }
    setUserLiveTranscript("");

    const correctedQuestion = correctSttErrors(question);

    // Optimistically add user bubble
    addMessage({ role: "user", content: correctedQuestion });

    setActiveSearchQuery(correctedQuestion);
    setIsSearching(true);
    setError(null);

    try {
      // Play local static guide audio immediately to minimize latency (fire-and-forget)
      playLocalGuideAudio();
      
      const payload = await requestPolicyAnswer(correctedQuestion);
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

    try {
      // 1. Request microphone permission first to unlock mobile audio context and ask for consent immediately
      if (typeof navigator !== "undefined" && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop()); // Immediately release the stream
      }

      setIsConnected(true);
      setIsConnecting(false);
      isPlayingAudio.current = true;

      // 2. Play welcome greeting after permission is granted
      addMessage({ role: "assistant", content: "PA님 무엇을 도와드릴까요?" });
      await playTts("PA님 무엇을 도와드릴까요?");

      isPlayingAudio.current = false;
      if (!isMicMuted) {
        startSpeechRecognition();
      }
    } catch (cause) {
      stopRealtime();
      setIsConnecting(false);
      setError(
        cause instanceof Error && (cause.name === "NotAllowedError" || cause.name === "PermissionDeniedError")
          ? "마이크 사용 권한이 거부되었습니다. 설정에서 마이크를 허용한 뒤 다시 도움요청을 눌러주세요."
          : cause instanceof Error
          ? cause.message
          : "마이크 연결에 실패했습니다."
      );
    }
  }

  function stopRealtime() {
    // Stop VAD monitoring
    stopVadMonitoring();

    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }

    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      // Detach all event handlers to avoid race conditions and background restarts
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.abort();
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

    // Removed call-end system message per user request (times are now embedded in report cards)

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
    if (muted) {
      stopVadMonitoring();
    } else {
      if (isConnected && !isPlayingAudio.current) {
        startVadMonitoring();
      }
    }

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
      role: "assistant",
      content: contentText,
      answer: payload,
      timestamp: formattedTime
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

    setActiveSearchQuery(question);
    setIsSearching(true);
    try {
      const searchSpeakText = "네 PA님 금방 안내드리겠습니다";

      // Play searching notification voice in background (fire-and-forget)
      void playTts(searchSpeakText);
      
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
                  <p>{searchingMessage}</p>
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

// Helper to parse double asterisks (e.g. **bold**) and render them as JSX strong tags with soft brand blue highlight
function renderFormattedText(text: string | undefined) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const cleanText = part.slice(2, -2);
      return (
        <strong
          key={index}
          style={{
            fontWeight: "700",
            color: "#0f172a",
            backgroundColor: "rgba(37, 99, 235, 0.08)",
            borderBottom: "1.5px solid rgba(37, 99, 235, 0.3)",
            padding: "0 4px",
            borderRadius: "3px",
            margin: "0 2px"
          }}
        >
          {cleanText}
        </strong>
      );
    }
    return part;
  });
}

function cleanListText(text: string | undefined): string {
  if (!text) return "";
  let cleaned = text.replace(/^[\s\u200B\u200C\u200D\uFEFF\u00A0\u3000\-*•◦‣⁃]+/g, "").trim();
  if (cleaned.startsWith("* ")) {
    cleaned = cleaned.substring(2).trim();
  }
  if (cleaned.startsWith("- ")) {
    cleaned = cleaned.substring(2).trim();
  }
  return cleaned;
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
  const [isExpanded, setIsExpanded] = useState(false);

  if (message.role === "assistant" && message.answer) {
    const ans = message.answer;
    const isCopied = copiedId === message.id;
    return (
      <article className="message assistant answer-card">
        <div className="card-top">
          <div className="card-top-left">
            <span className="card-logo-badge">DB손보</span>
            <span className="card-category-tag">공식 약관 RAG 리포트 ({ans.searchEngine || "Google (Serper)"})</span>
          </div>
          <button className="copy-action-btn" onClick={() => onCopy(ans)}>
            {isCopied ? "복사 완료! ✔" : (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                복사
              </>
            )}
          </button>
        </div>

        {/* 질문 이해 및 분석 근거 (최상단 아코디언 배치) */}
        {ans.analysis && (
          <div className="answer-section">
            <h4
              className="section-title accordion-header"
              onClick={() => setIsExpanded(!isExpanded)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                padding: "8px 12px",
                borderRadius: "8px",
                backgroundColor: isExpanded ? "rgba(37, 99, 235, 0.03)" : "transparent",
                transition: "background-color 0.2s"
              }}
              title="클릭하여 분석 근거 상세 보기"
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span className="icon-badge badge-analysis">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="section-icon">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                </span>
                <span style={{ fontWeight: "800" }}>질문 이해 및 분석 근거</span>
              </div>
              <span
                style={{
                  fontSize: "11px",
                  color: "#2563eb",
                  fontWeight: "750",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "2px",
                  backgroundColor: "rgba(37, 99, 235, 0.08)",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  border: "1px solid rgba(37, 99, 235, 0.2)"
                }}
              >
                {isExpanded ? "분석 내용 접기 🔼" : "상세 분석 보기 (클릭) 👉"}
              </span>
            </h4>
            {isExpanded && (
              <div style={{ marginTop: "4px" }}>
                <p className="analysis-text" style={{ whiteSpace: "pre-line", lineHeight: "1.65", color: "#334155" }}>
                  {renderFormattedText(ans.analysis)}
                </p>
              </div>
            )}
          </div>
        )}

        {ans.summary && (
          <div className="answer-section">
            <h4 className="section-title">
              <span className="icon-badge badge-summary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="section-icon">
                  <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .5 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"></path>
                  <line x1="9" y1="18" x2="15" y2="18"></line>
                  <line x1="10" y1="22" x2="14" y2="22"></line>
                </svg>
              </span>
              핵심 답변 요약
            </h4>
            <p className="summary-text" style={{ lineHeight: "1.6", color: "#0f172a", fontWeight: "500" }}>
              {renderFormattedText(ans.summary)}
            </p>
          </div>
        )}

        {ans.conditions && ans.conditions.length > 0 && (
          <div className="answer-section">
            <h4 className="section-title">
              <span className="icon-badge badge-conditions">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="section-icon">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  <path d="m9 11 2 2 4-4"></path>
                </svg>
              </span>
              보장 대상 및 지급 조건
            </h4>
            <ul className="bullet-list green-theme">
              {ans.conditions.map((item, idx) => (
                <li key={idx} style={{ lineHeight: "1.5" }}>{renderFormattedText(cleanListText(item))}</li>
              ))}
            </ul>
          </div>
        )}

        {ans.cautions && ans.cautions.length > 0 && (
          <div className="answer-section">
            <h4 className="section-title">
              <span className="icon-badge badge-cautions">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="section-icon">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
              </span>
              보장 제외 및 유의사항 (면책)
            </h4>
            <ul className="bullet-list orange-theme">
              {ans.cautions.map((item, idx) => (
                <li key={idx} style={{ lineHeight: "1.5" }}>{renderFormattedText(cleanListText(item))}</li>
              ))}
            </ul>
          </div>
        )}



        {ans.requiredInfo && ans.requiredInfo.length > 0 && (
          <div className="answer-section">
            <h4 className="section-title">
              <span className="icon-badge badge-info">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="section-icon">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                  <line x1="9" y1="12" x2="15" y2="12"></line>
                  <line x1="9" y1="16" x2="15" y2="16"></line>
                </svg>
              </span>
              정확한 확인을 위해 필요한 정보
            </h4>
            <ul className="bullet-list blue-theme">
              {ans.requiredInfo.map((item, idx) => (
                <li key={idx} style={{ lineHeight: "1.5" }}>{renderFormattedText(cleanListText(item))}</li>
              ))}
            </ul>
          </div>
        )}

        {ans.citations && ans.citations.length > 0 && (
          <div className="answer-section" style={{ borderBottom: "none" }}>
            <h4 className="section-title">
              <span className="icon-badge badge-citation">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="section-icon">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
              </span>
              참고 출처 및 공시 자료
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
              {ans.citations.map((citation) => (
                <a
                  key={citation.id}
                  href={citation.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="citation-headline-link"
                >
                  <span className="citation-badge">
                    {citation.section || "출처"}
                  </span>
                  <span className="citation-title-text">
                    {safeDecodeURIComponent(citation.title)}
                  </span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="citation-link-icon">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
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

        <div className="card-timestamp" style={{ textAlign: "right", fontSize: "11px", color: "#94a3b8", marginTop: "12px", borderTop: "1px solid #f1f5f9", paddingTop: "8px" }}>
          조회 시간: {message.timestamp || new Date().toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false })}
        </div>
      </article>
    );
  }

  if (message.role === "system") {
    if (message.id === "welcome") {
      return (
        <div className="welcome-banner-card">
          <div className="welcome-banner-header">
            <span className="welcome-banner-badge">GUIDE</span>
            <h4>동목포 부지점장 프로미의 약관 안내</h4>
          </div>
          <div className="welcome-banner-body">
            <p className="welcome-greet">반갑습니다 PA님! DB손해보험 부지점장 프로미입니다. 😊</p>
            <p className="welcome-instruction">
              우측 상단의 <strong className="highlight-text">[도움요청 🎙️]</strong> 버튼을 누르시면 음성 상담이 활성화되어 약관 조회 및 보장 조건에 대해 대화로 편하게 안내받으실 수 있습니다.
            </p>
            <div className="welcome-features">
              <div className="feature-item">
                <span className="feature-dot"></span>
                <span><strong>음성 인식 보정:</strong> "2번비", "수치료", "포장" 등 전사 오류도 올바른 용어(입원비, 도수치료, 보장)로 자동 보정됩니다.</span>
              </div>
              <div className="feature-item">
                <span className="feature-dot"></span>
                <span><strong>실시간 구글 검색:</strong> 최신 DB손보 공식 공시 자료와 규정을 Google Search로 정밀 검색합니다.</span>
              </div>
            </div>
          </div>
        </div>
      );
    }
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

function extractKoreanKeywords(text: string): string {
  const clean = text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").trim();
  const words = clean.split(/\s+/);
  
  const stopSuffixes = ["이랑", "이랑은", "이랑도", "은", "는", "이", "가", "을", "를", "에", "에서", "으로", "로", "와", "과", "도", "만", "의", "인", "인데", "해서", "되나요", "받을", "필요해", "뭐야", "알려줘", "알려주세요"];
  const stopWords = ["둘", "다", "더", "또", "타고", "가다가", "넘어져서", "있어", "수", "할", "해", "한", "하", "뭐", "왜", "어떻게", "언제", "어디서"];

  const filtered = words.map(word => {
    let stripped = word;
    for (const suffix of stopSuffixes) {
      if (stripped.endsWith(suffix) && stripped.length > suffix.length) {
        stripped = stripped.slice(0, -suffix.length);
        break;
      }
    }
    return stripped;
  }).filter(word => {
    const lower = word.toLowerCase();
    return !stopWords.includes(lower) && lower.length >= 2;
  });

  if (filtered.length === 0) {
    return text.substring(0, 15) + "...";
  }

  return filtered.slice(0, 5).join(" ");
}

function correctSttErrors(text: string): string {
  const corrections: Record<string, string> = {
    "포장한도": "보장한도",
    "포장 한도": "보장 한도",
    "실소": "실손",
    "실소보험": "실손보험",
    "실선": "실손",
    "실선보험": "실손보험",
    "도수치로": "도수치료",
    "수치료": "도수치료",
    "포장": "보장",
    "고번에": "이번에",
    "2번 의료비": "입원 의료비",
    "2번의료비": "입원의료비",
    "2번 보장": "입원 보장",
    "2번보장": "입원보장",
    "2번 치료": "입원 치료",
    "2번치료": "입원치료",
    "2번 수술": "입원 수술",
    "2번수술": "입원수술",
    "2번 실손": "입원 실손",
    "2번실손": "입원실손",
    "2번 보상": "입원 보상",
    "2번보상": "입원보상",
    "2번 공제": "입원 공제",
    "2번공제": "입원공제"
  };
  
  let corrected = text;
  for (const [key, value] of Object.entries(corrections)) {
    corrected = corrected.replace(new RegExp(key, "g"), value);
  }
  return corrected;
}
