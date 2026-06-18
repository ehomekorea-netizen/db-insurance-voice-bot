"use client";

import { FormEvent, Fragment, useMemo, useRef, useState, useEffect } from "react";
import type { PolicyAnswer, PolicyIntent } from "@/lib/policyKnowledge";


type ChatMessage =
  | { id: string; role: "system" | "user"; content: string; timestamp?: string }
  | { id: string; role: "assistant"; content: string; answer?: PolicyAnswer; timestamp?: string };

type ChatMessageInput =
  | { role: "system" | "user"; content: string; timestamp?: string }
  | { role: "assistant"; content: string; answer?: PolicyAnswer; timestamp?: string };

function parseStreamedText(rawText: string) {
  const citationRegex = /[-*•\s]*\[출처:\s*([\s\S]+?)\]\s*\((https?:\/\/[^\)]+)\)/g;
  const cleanText = rawText.replace(citationRegex, "").trim();

  let analysis = "";
  let summary = "";
  let conditions: string[] = [];
  let cautions: string[] = [];
  
  const analysisStart = cleanText.indexOf("[분석 배경 및 이해]");
  const summaryStart = cleanText.indexOf("[요약]");
  const conditionsStart = cleanText.indexOf("[조건]");
  const cautionsStart = cleanText.indexOf("[주의사항]");
  
  if (analysisStart !== -1) {
    const end = summaryStart !== -1 ? summaryStart : (conditionsStart !== -1 ? conditionsStart : (cautionsStart !== -1 ? cautionsStart : cleanText.length));
    analysis = cleanText.substring(analysisStart + 12, end).trim();
  }
  
  if (summaryStart !== -1) {
    const end = conditionsStart !== -1 ? conditionsStart : (cautionsStart !== -1 ? cautionsStart : cleanText.length);
    const rawSummary = cleanText.substring(summaryStart + 4, end).trim();
    summary = rawSummary
      .split("\n")
      .map((l) => l.replace(/^[\s\u200B\u200C\u200D\uFEFF\u00A0\u3000\-*•◦‣⁃]+/, "").trim())
      .join("\n")
      .trim();
  } else if (analysisStart === -1) {
    summary = cleanText
      .split("\n")
      .map((l) => l.replace(/^[\s\u200B\u200C\u200D\uFEFF\u00A0\u3000\-*•◦‣⁃]+/, "").trim())
      .join("\n")
      .trim(); // Fallback during initial stream
  }
  
  if (conditionsStart !== -1) {
    const end = cautionsStart !== -1 ? cautionsStart : cleanText.length;
    const rawConditions = cleanText.substring(conditionsStart + 4, end).trim();
    conditions = rawConditions
      .split("\n")
      .map((l) => l.replace(/^[\s\u200B\u200C\u200D\uFEFF\u00A0\u3000\-*•◦‣⁃]+/, "").trim())
      .filter(Boolean);
  }
  
  if (cautionsStart !== -1) {
    const rawCautions = cleanText.substring(cautionsStart + 6).trim();
    cautions = rawCautions
      .split("\n")
      .map((l) => l.replace(/^[\s\u200B\u200C\u200D\uFEFF\u00A0\u3000\-*•◦‣⁃]+/, "").trim())
      .filter(Boolean);
  }
  
  return {
    analysis,
    summary,
    conditions,
    cautions
  };
}

function getFormattedTimeWithDay(date: Date = new Date()) {
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const dayName = days[date.getDay()];
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}. ${mm}. ${dd} (${dayName}) ${hh}:${min}`;
}

function getFallbackHeadline(q: string, s: string) {
  const lowQ = q.toLowerCase();
  let topic = "";
  if (lowQ.includes("골절")) topic = "골절 진단비";
  else if (lowQ.includes("문질")) topic = "골절 사고";
  else if (lowQ.includes("도수")) topic = "도수치료 실손";
  else if (lowQ.includes("백내장") || lowQ.includes("다초점")) topic = "백내장 수술비";
  else if (lowQ.includes("실손") || lowQ.includes("실비")) topic = "실손 의료비";
  else if (lowQ.includes("수술")) topic = "수술비 담보";
  else if (lowQ.includes("서류") || lowQ.includes("청구")) topic = "보험금 청구 서류";
  else {
    topic = q.length > 15 ? q.substring(0, 15) + "..." : q;
  }
  const lowS = s.toLowerCase();
  let action = "안내";
  if (lowS.includes("제외") || lowS.includes("면책") || lowS.includes("보상하지 않")) {
    action = "지급 제외 안내";
  } else if (lowS.includes("지급") || lowS.includes("보장")) {
    action = "지급 기준 및 조건";
  } else if (lowS.includes("서류") || lowS.includes("준비")) {
    action = "필수 구비 서류";
  }
  return `"${topic} ${action}"`;
}

function generateUUID(): string {
  if (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID) {
    try {
      return window.crypto.randomUUID();
    } catch {
      // fallback
    }
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
export function VoiceCounselorApp() {
  const [hasStartedConsultation, setHasStartedConsultation] = useState(false);
  const [showCover, setShowCover] = useState(true);
  const [fadeCover, setFadeCover] = useState(false);

  // Kakao Auth States
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [kakaoUser, setKakaoUser] = useState<{ id: number; nickname: string; profileImage: string } | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isSettingOpen, setIsSettingOpen] = useState(false);

  // Easter Egg to Admin Page
  const [logoClicks, setLogoClicks] = useState(0);
  const lastClickTimeRef = useRef(0);

  const handleLogoClick = () => {
    const now = Date.now();
    if (now - lastClickTimeRef.current > 3000) {
      setLogoClicks(1);
    } else {
      const newClicks = logoClicks + 1;
      setLogoClicks(newClicks);
      if (newClicks >= 5) {
        window.location.href = "/admin";
      }
    }
    lastClickTimeRef.current = now;
  };

  // 카카오 로그인 콜백 처리
  const handleKakaoCallback = async (code: string) => {
    setIsAuthLoading(true);
    setError(null);
    try {
      const redirectUri = window.location.origin;
      const res = await fetch("/api/auth/kakao/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, redirect_uri: redirectUri })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "카카오 로그인 연동에 실패했습니다.");
      }

      const data = await res.json();
      if (data.success && data.user) {
        localStorage.setItem("kakao_user", JSON.stringify(data.user));
        setKakaoUser(data.user);
        setIsLoggedIn(true);
        
        // URL에서 code 파라미터 정제
        window.history.replaceState({}, document.title, window.location.pathname);
        
        // 2단계 오프닝 애니메이션 구동
        startOpeningAnimation();
      } else {
        throw new Error("카카오 로그인 인증 후 사용자 정보를 받아오지 못했습니다.");
      }
    } catch (err: any) {
      console.error("[KAKAO LOGIN ERROR]", err);
      setError(err.message || "카카오 로그인 인증 처리 중 에러가 발생했습니다.");
      setIsLoggedIn(false);
      setShowCover(true);
      setFadeCover(false);
    } finally {
      setIsAuthLoading(false);
    }
  };

  const startOpeningAnimation = () => {
    setShowCover(true);
    setFadeCover(false);

    const fadeTimeout = setTimeout(() => {
      setFadeCover(true);
    }, 1500);

    const removeTimeout = setTimeout(() => {
      setShowCover(false);
      setHasStartedConsultation(true);
    }, 2000);

    return () => {
      clearTimeout(fadeTimeout);
      clearTimeout(removeTimeout);
    };
  };

  // 초기 로그인 유무 및 Callback 감지
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");

    if (code) {
      handleKakaoCallback(code);
    } else {
      const savedUser = localStorage.getItem("kakao_user");
      if (savedUser) {
        try {
          const parsed = JSON.parse(savedUser);
          setKakaoUser(parsed);
          setIsLoggedIn(true);
          // 로그인 세션이 있으므로 바로 2단계 오프닝 재생
          startOpeningAnimation();
        } catch (e) {
          localStorage.removeItem("kakao_user");
          setIsLoggedIn(false);
          setIsAuthLoading(false);
        }
      } else {
        setIsLoggedIn(false);
        setIsAuthLoading(false);
      }
    }
  }, []);

  // Fetch user chat logs from Firestore when logged in
  useEffect(() => {
    if (!isLoggedIn || !kakaoUser) return;

    const userId = kakaoUser.id;
    async function loadDbHistory() {
      try {
        const res = await fetch(`/api/policy/history?userId=${userId}`);
        if (!res.ok) throw new Error("Failed to fetch history");
        
        const data = await res.json();
        if (data.success && Array.isArray(data.logs) && data.logs.length > 0) {
          const loadedMessages = data.logs.map((log: any, idx: number) => {
            const isWelcome = log.content.includes("PA님 무엇을 도와드릴까요?");
            const isSimpleChat = !log.content.includes("[요약]");

            if (isWelcome) {
              return {
                id: log.id || generateUUID(),
                role: "system", // Welcome message is system role in frontend
                content: log.content,
                timestamp: log.timestamp
              };
            }

            if (log.role === "assistant" && !isSimpleChat) {
              // Reconstruct user question from previous message
              let question = "이전 질문";
              if (idx > 0 && data.logs[idx - 1].role === "user") {
                question = data.logs[idx - 1].content;
              }

              const parsed = parseStreamedText(log.content);

              // Reconstruct citations from the markdown links in log.content
              const parsedCitations: any[] = [];
              const citationRegex = /[-*•\s]*\[출처:\s*([\s\S]+?)\]\s*\((https?:\/\/[^\)]+)\)/g;
              let match;
              citationRegex.lastIndex = 0;
              while ((match = citationRegex.exec(log.content)) !== null) {
                const title = match[1].trim();
                const url = match[2].trim();
                const lowUrl = url.toLowerCase();
                let section = "웹 검색 정보";
                if (lowUrl.includes("idbins.com") || lowUrl.includes("idb.co.kr")) section = "DB손보 공식";
                else if (lowUrl.includes("fss.or.kr") || lowUrl.includes("fsc.go.kr")) section = "금융당국";
                else if (lowUrl.includes("knia.or.kr") || lowUrl.includes("klia.or.kr") || lowUrl.includes("kidi.or.kr")) section = "보험협회";
                else if (lowUrl.includes("korea.kr") || lowUrl.includes("law.go.kr")) section = "정부/법령";
                else if (lowUrl.includes("nhis.or.kr") || lowUrl.includes("hira.or.kr")) section = "보건의료";

                parsedCitations.push({
                  id: `citation-${parsedCitations.length + 1}-${Math.random().toString(36).substring(2, 10)}`,
                  title,
                  section,
                  page: 1,
                  version: "공식 정보",
                  sourceUrl: url,
                  excerpt: title
                });
              }

              const answer = {
                id: log.id,
                question,
                intent: "policy_explanation",
                analysis: parsed.analysis,
                summary: parsed.summary,
                conditions: parsed.conditions,
                cautions: parsed.cautions,
                requiredInfo: [
                  "정확한 상품 명칭 및 약관 개정 버전",
                  "가입 시기 및 청구 항목의 영수증/진단서",
                  "해당 상품이 판매상품인지 판매중지 상품인지 여부"
                ],
                citations: parsedCitations,
                headline: getFallbackHeadline(question, parsed.summary),
                searchEngine: "공시자료 검색",
                modelName: "Gemini 3.1 Flash-Lite",
                isSimpleChat: false,
                disclaimer: "본 답변은 공식 공시서류와 검색 기반의 AI 추론 결과로 참고용이며, 최종 보상 지급 판단은 실제 심사 결과에 따라 다를 수 있습니다."
              };

              return {
                id: log.id,
                role: "assistant",
                content: log.content,
                answer,
                timestamp: log.timestamp
              };
            }

            return {
              id: log.id,
              role: log.role,
              content: log.content,
              timestamp: log.timestamp
            };
          });

          const clearTimestampStr = localStorage.getItem("db_insurance_chat_clear_timestamp");
          const clearTime = clearTimestampStr ? new Date(clearTimestampStr).getTime() : 0;

          // Filter out messages created before the clear timestamp
          const filteredMessages = loadedMessages.filter((msg: any) => {
            if (!msg.timestamp) return true;
            const msgTime = new Date(msg.timestamp).getTime();
            return msgTime > clearTime;
          });

          if (filteredMessages.length > 0) {
            // Prepend welcome message if not present in filteredMessages
            const hasWelcome = filteredMessages.some((m: any) => m.id === "welcome" || m.content.includes("PA님 무엇을 도와드릴까요?"));
            if (!hasWelcome) {
              const welcomeMsg = {
                id: "welcome",
                role: "system",
                content: "반갑습니다. DB손해보험 동목포 오멘토입니다. PA님 무엇을 도와드릴까요? 우측 상단의 [도움요청 🎙️] 버튼을 누르시면 음성 상담을 시작하실 수 있습니다.",
                timestamp: filteredMessages[0]?.timestamp || new Date().toISOString()
              };
              setMessages([welcomeMsg as ChatMessage, ...filteredMessages]);
            } else {
              setMessages(filteredMessages);
            }

            // Collapse historical cards by default
            const historicalIds = new Set<string>();
            filteredMessages.forEach((msg: any) => {
              if (msg.role === "assistant" && msg.answer) {
                historicalIds.add(msg.id);
              }
            });
            setCollapsedCardIds(historicalIds);
          } else if (clearTime > 0) {
            // User explicitly cleared history, and there are no new messages after that
            const welcomeMsg = {
              id: "welcome",
              role: "system",
              content: "반갑습니다. DB손해보험 동목포 오멘토입니다. PA님 무엇을 도와드릴까요? 우측 상단의 [도움요청 🎙️] 버튼을 누르시면 음성 상담을 시작하실 수 있습니다.",
              timestamp: new Date().toISOString()
            };
            setMessages([welcomeMsg as ChatMessage]);
            setCollapsedCardIds(new Set());
          }
        }
      } catch (err) {
        console.error("Failed to load chat logs from database:", err);
      }
    }

    loadDbHistory();
  }, [isLoggedIn, kakaoUser]);

  const handleKakaoLogin = () => {
    if (isAuthLoading) return;
    setIsAuthLoading(true);
    window.location.href = "/api/auth/kakao/login";
  };

  const handleLogout = () => {
    if (window.confirm("로그아웃 하시겠습니까?")) {
      localStorage.removeItem("kakao_user");
      setKakaoUser(null);
      setIsLoggedIn(false);
      
      // 1단계 카카오 로그인 대기 상태로 원복
      setShowCover(true);
      setFadeCover(false);
    }
  };

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

  const userLiveTranscriptRef = useRef(userLiveTranscript);
  userLiveTranscriptRef.current = userLiveTranscript;

  const isConnectedRef = useRef(isConnected);
  isConnectedRef.current = isConnected;

  const isSearchingRef = useRef(isSearching);
  isSearchingRef.current = isSearching;

  const isMicMutedRef = useRef(isMicMuted);
  isMicMutedRef.current = isMicMuted;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [collapsedCardIds, setCollapsedCardIds] = useState<Set<string>>(new Set());

  const toggleCardCollapse = (id: string) => {
    setCollapsedCardIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Load chat history from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("db_insurance_chat_history");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Ensure all loaded historical messages have a valid timestamp property so they don't dynamically sync to the current time
          const validated = parsed.map((msg: any) => {
            const hasValidTimestamp = msg.timestamp && msg.timestamp !== "undefined" && msg.timestamp !== "null";
            return {
              ...msg,
              timestamp: hasValidTimestamp ? msg.timestamp : new Date().toISOString()
            };
          });
          setMessages(validated);
          
          // Collapse all historical cards by default on load
          const historicalIds = new Set<string>();
          validated.forEach((msg: any) => {
            if (msg.role === "assistant" && msg.answer) {
              historicalIds.add(msg.id);
            }
          });
          setCollapsedCardIds(historicalIds);
          return;
        }
      } catch (e) {
        console.error("Failed to load chat history:", e);
      }
    }
    setMessages([
      {
        id: "welcome",
        role: "system",
        content:
          "반갑습니다. DB손해보험 동목포 오멘토입니다. PA님 무엇을 도와드릴까요? 우측 상단의 [도움요청 🎙️] 버튼을 누르시면 음성 상담을 시작하실 수 있습니다.",
        timestamp: new Date().toISOString()
      }
    ]);
  }, []);

  // Save chat history to localStorage with FIFO queue (limit 100 messages)
  useEffect(() => {
    if (messages.length === 0) return;

    if (messages.length > 100) {
      setMessages(messages.slice(-100));
      return;
    }

    try {
      localStorage.setItem("db_insurance_chat_history", JSON.stringify(messages));
    } catch (e) {
      console.error("Failed to save chat history to localStorage:", e);
    }
  }, [messages]);

  function clearChatHistory() {
    if (window.confirm("기존 대화 내역을 모두 삭제하시겠습니까?")) {
      localStorage.setItem("db_insurance_chat_clear_timestamp", new Date().toISOString());
      localStorage.removeItem("db_insurance_chat_history");
      setMessages([
        {
          id: "welcome",
          role: "system",
          content:
            "반갑습니다. DB손해보험 동목포 오멘토입니다. PA님 무엇을 도와드릴까요? 우측 상단의 [도움요청 🎙️] 버튼을 누르시면 음성 상담을 시작하실 수 있습니다.",
          timestamp: new Date().toISOString()
        }
      ]);
    }
  }

  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const reusableAudioRef = useRef<HTMLAudioElement | null>(null); // Reusable unlocked audio node for Safari/iOS compatibility
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isRecordingRef = useRef<boolean>(false);
  const isTranscribingRef = useRef<boolean>(false);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isPlayingAudio = useRef(false);
  const [isFinalEndingPending, setIsFinalEndingPending] = useState(false);
  const isFinalEndingPendingRef = useRef(isFinalEndingPending);
  isFinalEndingPendingRef.current = isFinalEndingPending;
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const activeAnswerAbortControllerRef = useRef<AbortController | null>(null);
  const isRequestActiveRef = useRef<boolean>(false);

  // Web Audio API VAD Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const vadRafIdRef = useRef<number | null>(null);
  const lastActiveTimeRef = useRef<number>(Date.now());
  const hasSpokenRef = useRef<boolean>(false);
  const noiseFloorRef = useRef<number>(0.002);
  const recordingStartTimeRef = useRef<number>(0);

  function abortRecording() {
    if (mediaRecorderRef.current) {
      const rec = mediaRecorderRef.current;
      rec.onstop = null;
      rec.ondataavailable = null;
      try {
        if (rec.state !== "inactive") {
          rec.stop();
        }
      } catch {}
      mediaRecorderRef.current = null;
    }
    isRecordingRef.current = false;
    audioChunksRef.current = [];
    resetInactivityTimer();
  }

  function initMediaRecorder(stream: MediaStream): MediaRecorder | null {
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;

    let mimeType = "audio/webm";
    if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
      mimeType = "audio/webm;codecs=opus";
    } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
      mimeType = "audio/ogg;codecs=opus";
    } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
      mimeType = "audio/mp4";
    } else if (MediaRecorder.isTypeSupported("audio/wav")) {
      mimeType = "audio/wav";
    }
    console.log("[VOICE] Selected MediaRecorder MIME type:", mimeType);

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (e) {
      console.warn("[VOICE] MediaRecorder with mimeType failed, falling back to default.", e);
      recorder = new MediaRecorder(stream);
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        audioChunksRef.current.push(e.data);
      }
    };
    recorder.onstop = async () => {
      const audioBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
      audioChunksRef.current = [];
      
      console.log("[VOICE] MediaRecorder stopped. Blob size:", audioBlob.size, "MIME type:", audioBlob.type);
      if (audioBlob.size < 100) {
        setUserLiveTranscript("");
        isTranscribingRef.current = false;
        return;
      }

      await handleAudioTranscription(audioBlob);
    };

    return recorder;
  }

  const statusLabel = useMemo(() => {
    if (isConnecting) return "프로미 호출 중...";
    if (isConnected) return "실시간 음성 연결됨";
    return "음성 대기 중";
  }, [isConnecting, isConnected]);

  const searchingMessage = "네 PA님 금방 안내드리겠습니다";

  // Play a static pre-generated audio file from public/audio folder (100% cost-free)
  async function playStaticAudio(filename: string, text: string): Promise<void> {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    
    // Show text transcript live as assistant speaking indicator
    setLiveTranscript(text);
    isPlayingAudio.current = true;
    resetInactivityTimer();

    // Turn off user recording while AI speaks to prevent echo feedback loop
    abortRecording();

    const audioUrl = `/audio/${filename}`;

    try {
      // Verify if the static file actually exists on the server to prevent hang
      const checkRes = await fetch(audioUrl, { method: "HEAD" }).catch(() => null);
      if (!checkRes || !checkRes.ok) {
        console.warn(`[VOICE] Static audio file ${audioUrl} not found or inaccessible.`);
        setLiveTranscript("");
        isPlayingAudio.current = false;
        resetInactivityTimer();
        return;
      }

      if (!reusableAudioRef.current) {
        reusableAudioRef.current = new Audio();
      }
      const audio = reusableAudioRef.current;
      audio.src = audioUrl;
      activeAudioRef.current = audio;

      // Adjust volume to balance levels: welcome.mp3 is too loud, so lower it to 0.45 to match other 2 files (which sound like 0.6)
      if (filename === "welcome.mp3") {
        audio.volume = 0.45;
      } else {
        audio.volume = 1.0;
      }

      await new Promise<void>((resolve, reject) => {
        const safetyTimeout = setTimeout(() => {
          console.warn("[VOICE] playStaticAudio safety timeout reached. Forcing resolution.");
          cleanup();
          resolve();
        }, 10000);

        function cleanup() {
          clearTimeout(safetyTimeout);
          if (reusableAudioRef.current) {
            reusableAudioRef.current.onended = null;
            reusableAudioRef.current.onerror = null;
          }
          activeAudioRef.current = null;
          setLiveTranscript("");
          isPlayingAudio.current = false;
        }

        audio.onended = () => {
          cleanup();
          resetInactivityTimer();
          resolve();
        };
        audio.onerror = (e) => {
          cleanup();
          resetInactivityTimer();
          reject(e);
        };
        audio.playbackRate = 1.15;
        audio.play().catch((err) => {
          cleanup();
          resetInactivityTimer();
          reject(err);
        });
      });
    } catch (err) {
      console.error("playStaticAudio error:", err);
      setLiveTranscript("");
      isPlayingAudio.current = false;
      resetInactivityTimer();
    }
  }

  // Start VAD volume monitoring using the pre-initialized analyser
  function startVadMonitoring() {
    if (typeof window === "undefined") return;
    console.log("[VOICE] startVadMonitoring");
    
    // Stop any existing loop first
    if (vadRafIdRef.current) {
      cancelAnimationFrame(vadRafIdRef.current);
      vadRafIdRef.current = null;
    }

    if (!analyserRef.current) {
      console.warn("[VOICE] [VAD] Analyser not initialized. Cannot monitor.");
      return;
    }

    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    lastActiveTimeRef.current = Date.now();
    hasSpokenRef.current = false;
    noiseFloorRef.current = 0.002; // Reset noise floor on VAD start
    recordingStartTimeRef.current = 0; // Reset recording start time
    let frameCount = 0;

    const checkVolume = () => {
      // Terminate the animation loop completely if disconnected or analyser is released
      if (!analyserRef.current || !isConnectedRef.current) {
        console.log("[VOICE] VAD checkVolume loop stopped (disconnected)");
        vadRafIdRef.current = null;
        return;
      }

      // Temporarily skip volume checks while busy, but keep the loop alive by rescheduling
      if (isSearchingRef.current || isPlayingAudio.current || isMicMutedRef.current || isTranscribingRef.current) {
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
      const now = Date.now();

      // Slowly adapt noise floor when not recording to handle ambient room noise
      if (!isRecordingRef.current) {
        noiseFloorRef.current = noiseFloorRef.current * 0.95 + rms * 0.05;
      }

      // Dynamic voice threshold: noise floor + 0.015 (minimum 0.020 to ignore small background changes like breathing/clicks)
      const VOICE_THRESHOLD = Math.max(0.020, noiseFloorRef.current + 0.015);

      frameCount++;
      if (frameCount % 30 === 0) {
        console.log("[VOICE] [VAD RMS]", rms.toFixed(4), "Threshold:", VOICE_THRESHOLD.toFixed(4), "Noise Floor:", noiseFloorRef.current.toFixed(4));
      }

      // Safety check: force stop after 35 seconds of continuous recording to prevent freezing
      if (isRecordingRef.current && (now - recordingStartTimeRef.current > 35000)) {
        console.log("[VOICE] Continuous recording reached 35s safety limit. Force stopping.");
        hasSpokenRef.current = false;
        isRecordingRef.current = false;
        lastActiveTimeRef.current = now;
        resetInactivityTimer();
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          try {
            mediaRecorderRef.current.stop();
            console.log("[VOICE] MediaRecorder force stopped");
            setUserLiveTranscript("음성을 분석하는 중입니다...");
          } catch (e) {
            console.error("[VOICE] Failed to force stop MediaRecorder:", e);
          }
        }
        vadRafIdRef.current = requestAnimationFrame(checkVolume);
        return;
      }

      if (rms > VOICE_THRESHOLD) {
        lastActiveTimeRef.current = now;
        if (!hasSpokenRef.current) {
          hasSpokenRef.current = true;
          console.log("[VOICE] speech detected. RMS:", rms, "Threshold:", VOICE_THRESHOLD);
          
          // Start MediaRecorder if not already recording (deliver chunks every 250ms)
          if (!isRecordingRef.current) {
            try {
              audioChunksRef.current = [];
              if (!mediaRecorderRef.current && micStreamRef.current) {
                console.log("[VOICE] Re-initializing MediaRecorder on-demand in VAD");
                mediaRecorderRef.current = initMediaRecorder(micStreamRef.current);
              }
              if (mediaRecorderRef.current) {
                mediaRecorderRef.current.start(250);
                isRecordingRef.current = true;
                recordingStartTimeRef.current = now;
                console.log("[VOICE] MediaRecorder started");
                setUserLiveTranscript("말씀을 듣고 있습니다...");
                resetInactivityTimer();
              } else {
                console.error("[VOICE] MediaRecorder could not be initialized");
              }
            } catch (e) {
              console.error("[VOICE] Failed to start MediaRecorder:", e);
            }
          }
        }
      } else {
        // If the user has spoken, and then is silent for 2.2 seconds, stop recording and send to Whisper
        if (hasSpokenRef.current && (now - lastActiveTimeRef.current > 2200)) {
          const totalDuration = now - recordingStartTimeRef.current;
          const speechDuration = totalDuration - 2200;

          if (speechDuration < 1000) {
            console.log(`[VOICE] Speech duration too short (${speechDuration}ms). Discarding as noise.`);
            hasSpokenRef.current = false;
            isRecordingRef.current = false;
            lastActiveTimeRef.current = now;

            if (mediaRecorderRef.current) {
              const rec = mediaRecorderRef.current;
              rec.onstop = null;
              rec.ondataavailable = null;
              try {
                if (rec.state !== "inactive") {
                  rec.stop();
                }
              } catch {}
              mediaRecorderRef.current = null;
            }
            audioChunksRef.current = [];

            setUserLiveTranscript("");
            resetInactivityTimer();
            vadRafIdRef.current = requestAnimationFrame(checkVolume);
            return;
          }

          hasSpokenRef.current = false;
          isRecordingRef.current = false;
          lastActiveTimeRef.current = now;
          console.log(`[VOICE] VAD silence detected (2.2s). Stopping recorder. Speech duration: ${speechDuration}ms`);
          resetInactivityTimer();

          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            try {
              mediaRecorderRef.current.stop();
              console.log("[VOICE] MediaRecorder stopped");
              setUserLiveTranscript("음성을 분석하는 중입니다...");
            } catch (e) {
              console.error("[VOICE] Failed to stop MediaRecorder:", e);
            }
          }
        }
      }

      vadRafIdRef.current = requestAnimationFrame(checkVolume);
    };

    vadRafIdRef.current = requestAnimationFrame(checkVolume);
  }

  function stopVadMonitoring() {
    if (vadRafIdRef.current) {
      cancelAnimationFrame(vadRafIdRef.current);
      vadRafIdRef.current = null;
    }
  }

  // Monitor 5-second inactivity timer
  function resetInactivityTimer() {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    console.log("[DEBUG] resetInactivityTimer states:", {
      isConnected: isConnectedRef.current,
      isMicMuted: isMicMutedRef.current,
      isSearching: isSearchingRef.current,
      isPlayingAudio: isPlayingAudio.current,
      isFinalEndingPending: isFinalEndingPendingRef.current,
      isRequestActive: isRequestActiveRef.current,
      isRecording: isRecordingRef.current,
      isTranscribing: isTranscribingRef.current
    });

    if (isConnectedRef.current && !isMicMutedRef.current && !isSearchingRef.current && !isPlayingAudio.current && !isFinalEndingPendingRef.current && !isRequestActiveRef.current && !isRecordingRef.current && !isTranscribingRef.current) {
      inactivityTimerRef.current = setTimeout(() => {
        console.log("5초간 무반응 상태로 음성 세션을 자동 종료합니다.");
        stopRealtime();
        addMessage({ role: "assistant", content: "응답이 없어 대화를 종료합니다 😭" });
      }, 5 * 1000);
    }
  }

  useEffect(() => {
    resetInactivityTimer();
    return () => {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, [isConnected, isMicMuted, isSearching, isFinalEndingPending]);

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
    console.log("[VOICE] startSpeechRecognition");
    abortRecording();
    startVadMonitoring();
  }

  async function handleAudioTranscription(blob: Blob) {
    console.log("[VOICE] handleAudioTranscription start");
    isTranscribingRef.current = true;
    resetInactivityTimer();
    setUserLiveTranscript("음성을 분석하는 중입니다...");

    try {
      const formData = new FormData();
      formData.append("file", blob, "audio.webm");

      const durationMs = recordingStartTimeRef.current > 0 ? (Date.now() - recordingStartTimeRef.current) : 0;
      const durationSec = Math.max(1, Math.round(durationMs / 1000));

      formData.append("duration", durationSec.toString());
      if (kakaoUser) {
        formData.append("userId", String(kakaoUser.id));
      }

      const response = await fetch("/api/transcribe", {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `STT transcription failed (HTTP ${response.status})`);
      }

      const data = await response.json();
      const transcribedText = (data.text || "").trim();
      console.log("[VOICE] Gemini STT API response:", transcribedText);

      // Filter out empty transcription
      if (!transcribedText) {
        console.log("[VOICE] [Gemini STT Filter] Empty transcription, ignore.");
        setUserLiveTranscript("");
        isTranscribingRef.current = false;
        resetInactivityTimer();
        return;
      }

      setUserLiveTranscript(transcribedText);
      isTranscribingRef.current = false;
      resetInactivityTimer();
      await handleUserVoiceQuery(transcribedText);

    } catch (err: any) {
      console.error("[VOICE] Transcription error:", err);
      setUserLiveTranscript("");
      isTranscribingRef.current = false;
      resetInactivityTimer();
      setError(err instanceof Error ? err.message : "음성을 텍스트로 변환하는 중 오류가 발생했습니다.");
    }
  }

  async function handleUserVoiceQuery(question: string) {
    const querySessionId = activeSessionIdRef.current; // Capture current session ID
    console.log("[VOICE] handleUserVoiceQuery:", question, "Session ID:", querySessionId);
    
    isRequestActiveRef.current = true; // Set active request flag

    // Reset VAD state to prevent double execution
    hasSpokenRef.current = false;

    // Stop recording and clear live transcript display
    isPlayingAudio.current = true;
    abortRecording();
    setUserLiveTranscript("");

    // Turn off the microphone stream and close the AudioContext immediately to prevent background listening/token waste
    if (micStreamRef.current) {
      console.log("[VOICE] Releasing mic stream during Gemini query processing");
      micStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.error("[VOICE] Error stopping track:", e);
        }
      });
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      console.log("[VOICE] Closing AudioContext during Gemini query processing");
      const ctx = audioContextRef.current;
      if (ctx.state !== "closed") {
        ctx.close().catch((err) => console.error("[VOICE] Error closing AudioContext:", err));
      }
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    stopVadMonitoring();

    const correctedQuestion = correctSttErrors(question);

    // Optimistically add user bubble
    addMessage({ role: "user", content: correctedQuestion });

    setActiveSearchQuery(correctedQuestion);
    setIsSearching(true);
    setError(null);

    try {
      // Play local static guide audio immediately to minimize latency (fire-and-forget)
      void playStaticAudio("searching.mp3", "잠시만 기다려주시면 곧 안내드리겠습니다.");
      
      console.log("[VOICE] requestPolicyAnswer:", correctedQuestion);
      const payload = await requestPolicyAnswer(correctedQuestion);
      
      // If the session ID has changed (e.g. user manually ended the session or started a new one), ignore!
      if (activeSessionIdRef.current !== querySessionId) {
        console.log("[VOICE] Session changed. Ignoring policy answer result.");
        return;
      }

      setIsSearching(false);

      if (payload.isSimpleChat) {
        // A. Simple Conversational Answer
        await playStaticAudio("after_response.mp3", "화면내용을 참고해주시고, 도움이 필요하시면 또 말씀해주세요.");
        
        isPlayingAudio.current = false;
        stopRealtime(); // ALWAYS stop realtime after simple chat to prevent mic leakage
      } else {
        // B. RAG Policy Answer
        setIsFinalEndingPending(true);
        await playStaticAudio("after_response.mp3", "화면내용을 참고해주시고, 도움이 필요하시면 또 말씀해주세요.");
        setIsFinalEndingPending(false);
        stopRealtime(); // ALWAYS stop realtime after RAG answer
      }
    } catch (err: any) {
      // If the session ID has changed, ignore the error callback to prevent state race condition!
      if (activeSessionIdRef.current !== querySessionId) {
        console.log("[VOICE] Session changed. Ignoring policy answer error.");
        return;
      }

      setIsSearching(false);
      setError(err instanceof Error ? err.message : "약관 검색 중 에러가 발생했습니다.");
      
      isPlayingAudio.current = false;
      stopRealtime(); // ALWAYS stop realtime on error to prevent mic leakage
    } finally {
      isRequestActiveRef.current = false;
      resetInactivityTimer();
    }
  }

  async function startRealtime() {
    console.log("[VOICE] startRealtime");
    setError(null);
    setIsConnecting(true);

    // Initialize the reusable audio element under user click gesture to unlock autoplay for the entire session
    if (typeof window !== "undefined") {
      if (!reusableAudioRef.current) {
        reusableAudioRef.current = new Audio();
      }
      // Play a short silent audio to unlock the browser autoplay restriction
      reusableAudioRef.current.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAAA";
      reusableAudioRef.current.play().catch((err) => {
        console.warn("[VOICE] Autoplay unlock failed:", err);
      });
    }

    const currentSessionId = generateUUID();
    activeSessionIdRef.current = currentSessionId;

    try {
      // 1. Request microphone permission immediately under user gesture context
      if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("마이크 입력을 지원하지 않는 브라우저입니다.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      // Check if session was cancelled during stream acquisition
      if (activeSessionIdRef.current !== currentSessionId) {
        console.log("[startRealtime] Session cancelled during permission check.");
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      // 2. Initialize AudioContext and VAD Nodes under user click context to prevent Autoplay block
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }
      audioContextRef.current = audioCtx;

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyserRef.current = analyser;

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      // 3. Initialize MediaRecorder bound to this stream
      mediaRecorderRef.current = initMediaRecorder(stream);

      setIsConnected(true);
      setIsConnecting(false);
      isPlayingAudio.current = true;
      resetInactivityTimer();

      // 5. Play welcome greeting
      addMessage({ role: "assistant", content: "PA님 무엇을 도와드릴까요? 😊" });
      await playStaticAudio("welcome.mp3", "PA님 무엇을 도와드릴까요? 😊");

      // Check if session was cancelled during greeting playback
      if (activeSessionIdRef.current !== currentSessionId) {
        console.log("[startRealtime] Session cancelled during greeting playback.");
        return;
      }

      isPlayingAudio.current = false;
      resetInactivityTimer();
      if (!isMicMuted) {
        startSpeechRecognition(); // Kicks off startVadMonitoring loop!
      }
    } catch (cause) {
      if (activeSessionIdRef.current === currentSessionId) {
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
  }

  function stopRealtime() {
    console.log("[VOICE] stopRealtime");
    activeSessionIdRef.current = null; // Cancel any active startRealtime flow

    // Abort any active policy answer request due to session stop
    if (activeAnswerAbortControllerRef.current) {
      console.log("[VOICE] Aborting active policy answer request due to session stop");
      activeAnswerAbortControllerRef.current.abort();
      activeAnswerAbortControllerRef.current = null;
    }

    // Stop VAD monitoring loop
    stopVadMonitoring();

    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }

    abortRecording();

    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    // Stop all microphone tracks to turn off the recording indicator
    if (micStreamRef.current) {
      console.log("[VOICE] Stopping mic stream tracks");
      micStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.error("[VOICE] Error stopping track:", e);
        }
      });
      micStreamRef.current = null;
    }

    // Close AudioContext to release hardware resources
    if (audioContextRef.current) {
      console.log("[VOICE] Closing AudioContext");
      const ctx = audioContextRef.current;
      if (ctx.state !== "closed") {
        ctx.close().catch((err) => {
          console.error("[VOICE] Error closing AudioContext:", err);
        });
      }
      audioContextRef.current = null;
    }
    analyserRef.current = null;

    setIsConnected(false);
    setIsConnecting(false);
    setIsMicMuted(false);
    isPlayingAudio.current = false;
    setIsFinalEndingPending(false);
    setUserLiveTranscript("");
    setLiveTranscript("");
  }

  function setMicMuted(muted: boolean) {
    setIsMicMuted(muted);
    if (muted) {
      stopVadMonitoring();
      abortRecording();
    } else {
      if (isConnected && !isPlayingAudio.current) {
        startVadMonitoring();
        startSpeechRecognition();
      }
    }
  }

  async function requestPolicyAnswer(question: string, intent?: PolicyIntent, productHint?: string) {
    // Abort any existing active request first
    if (activeAnswerAbortControllerRef.current) {
      console.log("[VOICE] Aborting previous active policy answer request");
      activeAnswerAbortControllerRef.current.abort();
      activeAnswerAbortControllerRef.current = null;
    }

    const controller = new AbortController();
    activeAnswerAbortControllerRef.current = controller;

    let isTimeout = false;
    // 35s timeout covering the entire streaming process (fetch + reading chunks)
    const timeoutId = setTimeout(() => {
      console.warn("[VOICE] Request/Streaming timeout reached. Aborting.");
      isTimeout = true;
      controller.abort();
    }, 35000);

    let tempMessageId: string | null = null;

    try {
      const response = await fetch("/api/policy/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          intent,
          product_hint: productHint,
          userId: kakaoUser ? String(kakaoUser.id) : undefined
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`서버 응답 에러 (HTTP ${response.status})`);
      }

      if (!response.body) {
        throw new Error("응답 바디가 비어 있습니다.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      
      tempMessageId = generateUUID();
      const now = new Date();

      // Optimistically add an empty assistant card so we can stream into it
      setMessages((current) => [
        ...current,
        {
          id: tempMessageId,
          role: "assistant",
          content: "답변을 생성하는 중입니다...",
          timestamp: now.toISOString()
        } as ChatMessage
      ]);

      // Hide the searching spinner since we have started receiving the streaming response!
      setIsSearching(false);

      let fullRawText = "";
      let metadata: any = null;
      let currentEvent = ""; // Declared outside the loop to preserve state across chunk boundaries

      outerLoop: while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        let lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith("event:")) {
            currentEvent = trimmed.substring(6).trim();
          } else if (trimmed.startsWith("data:")) {
            const dataStr = trimmed.substring(5).trim();
            if (currentEvent === "chunk") {
              const textChunk = JSON.parse(dataStr);
              fullRawText += textChunk;

              const parsed = parseStreamedText(fullRawText);

              // Update the assistant message in real-time
              setMessages((current) =>
                current.map((msg) =>
                  msg.id === tempMessageId
                    ? {
                        ...msg,
                        content: parsed.summary || "답변을 생성하는 중입니다...",
                        answer: {
                          id: tempMessageId,
                          question,
                          intent: intent || "policy_explanation",
                          analysis: parsed.analysis,
                          summary: parsed.summary,
                          conditions: parsed.conditions,
                          cautions: parsed.cautions,
                          requiredInfo: metadata?.requiredInfo || [],
                          citations: metadata?.citations || [],
                          searchEngine: metadata?.searchEngine || "실시간 스트리밍",
                          modelName: metadata?.modelName || "Gemini 3.1 Flash-Lite",
                          disclaimer: metadata?.disclaimer || "본 답변은 공식 공시서류와 검색 기반의 AI 추론 결과로 참고용이며, 최종 보상 지급 판단은 실제 심사 결과에 따라 다를 수 있습니다."
                        }
                      }
                    : msg
                )
              );
            } else if (currentEvent === "metadata") {
              metadata = JSON.parse(dataStr);
              console.log("[VoiceCounselorApp SSE] metadata event parsed:", metadata);
              
              setMessages((current) =>
                current.map((msg) =>
                  msg.id === tempMessageId
                    ? {
                        ...msg,
                        answer: {
                          ...(msg.role === "assistant" ? msg.answer : {}),
                          ...metadata,
                          id: tempMessageId,
                          question
                        } as PolicyAnswer
                      }
                    : msg
                )
              );
            } else if (currentEvent === "done") {
              break outerLoop;
            } else if (currentEvent === "error") {
              const errMsg = JSON.parse(dataStr);
              throw new Error(errMsg);
            }
          }
        }
      }

      const finalParsed = parseStreamedText(fullRawText);
      const finalPayload = {
        id: tempMessageId,
        question,
        intent: intent || "policy_explanation",
        analysis: finalParsed.analysis,
        summary: finalParsed.summary,
        conditions: finalParsed.conditions,
        cautions: finalParsed.cautions,
        requiredInfo: metadata?.requiredInfo || [],
        citations: metadata?.citations || [],
        headline: metadata?.headline || getFallbackHeadline(question, finalParsed.summary),
        searchEngine: metadata?.searchEngine || "실시간 스트리밍",
        modelName: metadata?.modelName || "Gemini 3.1 Flash-Lite",
        isSimpleChat: metadata?.isSimpleChat || false,
        disclaimer: metadata?.disclaimer || "본 답변은 공식 공시서류와 검색 기반의 AI 추론 결과로 참고용이며, 최종 보상 지급 판단은 실제 심사 결과에 따라 다를 수 있습니다."
      } as PolicyAnswer & { isSimpleChat?: boolean };

      console.log("[VoiceCounselorApp SSE Done] finalPayload generated:", finalPayload);

      // Finally, update the text to include the automated ending notification if connected
      const contentText = isConnected
        ? `${finalPayload.summary}\n\n*(음성 상담은 답변 전송 완료 후 자동으로 종료됩니다.)*`
        : finalPayload.summary;

      setMessages((current) =>
        current.map((msg) =>
          msg.id === tempMessageId
            ? {
                ...msg,
                content: contentText,
                answer: finalPayload
              }
            : msg
        )
      );

      clearTimeout(timeoutId);
      if (activeAnswerAbortControllerRef.current === controller) {
        activeAnswerAbortControllerRef.current = null;
      }
      return finalPayload;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (activeAnswerAbortControllerRef.current === controller) {
        activeAnswerAbortControllerRef.current = null;
      }
      if (tempMessageId) {
        setMessages((current) => current.filter((msg) => msg.id !== tempMessageId));
      }
      if (err.name === "AbortError") {
        if (isTimeout) {
          throw new Error("답변 생성 시간이 초과되었습니다 (35초). 네트워크 상태를 확인하시거나 다시 시도해 주세요.");
        }
        // If manually aborted, return a silent default payload so we don't throw errors
        return { isSimpleChat: true } as any;
      }
      throw err;
    }
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
      void playStaticAudio("searching.mp3", "잠시만 기다려주시면 곧 안내드리겠습니다.");
      
      await requestPolicyAnswer(question);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "답변 생성에 실패했습니다.");
    } finally {
      setIsSearching(false);
    }
  }

  function addMessage(message: ChatMessageInput) {
    const msgTimestamp = message.timestamp || new Date().toISOString();
    setMessages((current) => [
      ...current,
      {
        id: generateUUID(),
        ...message,
        timestamp: msgTimestamp
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

  function handleShareText(ans: PolicyAnswer) {
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

    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({
        title: "동목포 오멘토 약관 RAG 리포트",
        text: copyText
      }).catch((err) => {
        console.warn("[SHARE] Web Share failed:", err);
      });
    } else {
      navigator.clipboard.writeText(copyText).then(() => {
        alert("카카오톡 등에 바로 붙여넣기할 수 있도록 리포트가 클립보드에 복사되었습니다!");
      }).catch((err) => {
        console.error("[SHARE] Clipboard copy failed:", err);
      });
    }
  }

  return (
    <>
      {showCover && (
        <main className={`cover-shell ${fadeCover ? "fade-out" : ""}`}>
          <div className="cover-card">
            <div className="promy-avatar-lg">
              <img src="/promy.png" alt="PROMY" className="welcome-promy-img" />
            </div>
            <h1 className="cover-title">동목포 오멘토</h1>
            <p className="cover-description" style={{ wordBreak: "keep-all" }}>
              동목포 PA님들의 영업을 지원하는 멘토
            </p>
            {!isLoggedIn && (
              <button 
                className={`kakao-login-btn ${isAuthLoading ? "kakao-login-btn-loading" : ""}`}
                onClick={handleKakaoLogin}
                disabled={isAuthLoading}
              >
                {isAuthLoading ? (
                  <span>연동 처리 중...</span>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 3C6.48 3 2 6.48 2 10.75c0 2.92 2.11 5.48 5.25 6.78l-1.04 3.86a.4.4 0 0 0 .58.43l4.52-2.51c.56.09 1.12.14 1.69.14 5.52 0 10-3.48 10-7.75S17.52 3 12 3z"/>
                    </svg>
                    <span>카카오 로그인</span>
                  </>
                )}
              </button>
            )}
            {!isLoggedIn && error && (
              <div className="cover-error-message" style={{
                color: "#f87171",
                fontSize: "12.5px",
                fontWeight: "700",
                marginTop: "12px",
                padding: "8px 16px",
                borderRadius: "8px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                maxWidth: "280px",
                lineHeight: "1.4",
                textAlign: "center"
              }}>
                {error}
              </div>
            )}
          </div>
        </main>
      )}

      <main className="messenger-shell">
      {/* Header */}
      <header className="messenger-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", padding: "10px 16px", position: "relative" }}>
        {/* Left Section: Profile Favicon + Nickname + Setting Button */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: "0 0 100px", minWidth: 0 }}>
          {kakaoUser && kakaoUser.profileImage ? (
            <img src={kakaoUser.profileImage} alt="" className="avatar-img" style={{ flexShrink: 0 }} />
          ) : (
            <div className="avatar-img-fallback" style={{ flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ color: "#ffffff" }}>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
              </svg>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "2px", minWidth: 0 }}>
            <span style={{ 
              fontSize: "12.5px", 
              fontWeight: "900", 
              color: "var(--text-ink)", 
              whiteSpace: "nowrap", 
              overflow: "hidden", 
              textOverflow: "ellipsis",
              maxWidth: "100px"
            }}>
              {kakaoUser ? formatNicknamePA(kakaoUser.nickname) : "PA님"}
            </span>
            {isLoggedIn && (
              <button 
                className="setting-small-btn"
                onClick={() => setIsSettingOpen(true)}
                title="설정"
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "3px" }}
              >
                <span>설정</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Center Section: Status Indicator Badge */}
        <div className="messenger-center-badge-container">
          <div className="messenger-status-row" style={{ margin: 0, display: "flex", alignItems: "center" }}>
            <span className={`messenger-status ${isConnected ? (isMicMuted ? "muted" : "online") : ""}`} style={{ whiteSpace: "nowrap" }}>
              {isConnected && isMicMuted ? "🎙️ 동목포 오멘토 답변 중 (음소거)" : statusLabel}
            </span>
          </div>
        </div>

        {/* Right Section: Help Request Button */}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", flex: "0 0 86px" }}>
          {!isConnected && !isConnecting ? (
            <button className="primary-button help-request-btn" onClick={startRealtime} style={{ width: "100%", padding: "6px 0", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "4px" }}>
              <span>도움요청</span>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M12 19v3"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <rect x="9" y="2" width="6" height="13" rx="3"/>
              </svg>
            </button>
          ) : (
            <button className="danger-button help-request-btn" onClick={stopRealtime} disabled={isConnecting} style={{ width: "100%", padding: "6px 0", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "4px" }}>
              <span>{isConnecting ? "연결 중..." : "상담 종료"}</span>
              {!isConnecting && <span style={{ fontSize: "11px", marginLeft: "1px" }}>✖</span>}
            </button>
          )}
        </div>
      </header>

      {/* Messages */}
      <section className="messenger-chat-area">
        {messages.map((message, index) => {
          if (message.id === "welcome") {
            return (
              <div key={message.id} className="message-wrapper system-wrapper">
                <div className="bubble-wrapper" style={{ width: "100%", maxWidth: "100%" }}>
                  <MessageBubble
                    message={message}
                    onShare={(ans) => handleShareText(ans)}
                    kakaoUser={kakaoUser}
                  />
                </div>
              </div>
            );
          }

          const isCollapsed = collapsedCardIds.has(message.id);
          const isCard = message.role === "assistant" && message.answer && !isCollapsed;

          let showDateDivider = false;
          let dateDividerText = "";

          let prevRealMessage = null;
          for (let i = index - 1; i >= 0; i--) {
            if (messages[i].id !== "welcome") {
              prevRealMessage = messages[i];
              break;
            }
          }

          const currentMsgDate = parseSafeDate(message.timestamp).toDateString();

          if (!prevRealMessage) {
            showDateDivider = true;
            dateDividerText = getFormattedDateDivider(message.timestamp || new Date().toISOString());
          } else {
            const prevMsgDate = parseSafeDate(prevRealMessage.timestamp).toDateString();
            if (currentMsgDate !== prevMsgDate) {
              showDateDivider = true;
              dateDividerText = getFormattedDateDivider(message.timestamp || new Date().toISOString());
            }
          }

          const wrapperClass =
            message.role === "user"
              ? "user-wrapper"
              : message.role === "system"
              ? "system-wrapper"
              : isCard
              ? "card-wrapper"
              : "assistant-wrapper";

          const formattedTime = getFormattedTime(message.timestamp || new Date().toISOString());

          return (
            <Fragment key={message.id}>
              {showDateDivider && (
                <div className="chat-date-divider">
                  <span>{dateDividerText}</span>
                </div>
              )}

              <div className={`message-wrapper ${wrapperClass}`}>
                {message.role === "assistant" && !isCard && (
                  <div className="avatar-wrapper">
                    <img src="/promy.png" alt="PROMY" className="avatar-img" />
                  </div>
                )}

                <div className="bubble-wrapper" style={{ width: isCard ? "100%" : "auto" }}>
                  {message.role === "assistant" && (
                    isCollapsed ? (
                      <div style={{ display: "flex", marginBottom: "-6px", zIndex: 5, paddingLeft: "2px" }}>
                        <button 
                          className="expand-action-btn"
                          onClick={() => toggleCardCollapse(message.id)}
                          style={{
                            fontSize: "13px",
                            fontWeight: "950",
                            backgroundColor: "var(--highlight-yellow)",
                            border: "2px solid var(--text-ink)",
                            padding: "4px 12px",
                            borderRadius: "6px",
                            cursor: "pointer",
                            boxShadow: "2px 2px 0px var(--text-ink)",
                            color: "var(--text-ink)"
                          }}
                        >
                          답변 펼치기 ▼
                        </button>
                      </div>
                    ) : isCard ? (
                      <div style={{ display: "flex", marginBottom: "-6px", zIndex: 5, paddingLeft: "2px" }}>
                        <button 
                          className="expand-action-btn"
                          onClick={() => toggleCardCollapse(message.id)}
                          style={{
                            fontSize: "13px",
                            fontWeight: "950",
                            backgroundColor: "var(--accent-green)",
                            border: "2px solid var(--text-ink)",
                            padding: "4px 12px",
                            borderRadius: "6px",
                            cursor: "pointer",
                            boxShadow: "2px 2px 0px var(--text-ink)",
                            color: "white"
                          }}
                        >
                          답변 접기 ▲
                        </button>
                      </div>
                    ) : (
                      <span className="sender-name">오멘토</span>
                    )
                  )}
                  <MessageBubble
                    message={message}
                    onShare={(ans) => handleShareText(ans)}
                    kakaoUser={kakaoUser}
                    isCollapsed={isCollapsed}
                    onToggleCollapse={() => toggleCardCollapse(message.id)}
                  />
                  {message.role === "assistant" && !isCard && (
                    <span className="chat-time-label assistant-time">
                      {formattedTime}
                    </span>
                  )}
                </div>

                {message.role === "user" && (
                  <div className="avatar-wrapper">
                    {kakaoUser && kakaoUser.profileImage ? (
                      <img src={kakaoUser.profileImage} alt="" className="avatar-img" />
                    ) : (
                      <div className="user-avatar-circle">
                        {kakaoUser ? kakaoUser.nickname.slice(0, 2) : "PA"}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}

        {/* User live speech transcript */}
        {userLiveTranscript && (
          <div className="message-wrapper user-wrapper">
            <div className="bubble-wrapper">
              <div className="message user-bubble live-typing-bubble">
                <div className="live-transcript-header">
                  <span className="live-transcript-tag">🎙️ 음성 인식 중</span>
                  <div className="voice-eq-waves">
                    <span className="wave-bar wave-bar-1"></span>
                    <span className="wave-bar wave-bar-2"></span>
                    <span className="wave-bar wave-bar-3"></span>
                    <span className="wave-bar wave-bar-4"></span>
                  </div>
                </div>
                <p>{userLiveTranscript}</p>
              </div>
            </div>
            <div className="avatar-wrapper">
              {kakaoUser && kakaoUser.profileImage ? (
                <img src={kakaoUser.profileImage} alt="" className="avatar-img" />
              ) : (
                <div className="user-avatar-circle">
                  {kakaoUser ? kakaoUser.nickname.slice(0, 2) : "PA"}
                </div>
              )}
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
              <span className="sender-name">동목포 오멘토</span>
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

    {/* Settings Modal Popup */}
    {isSettingOpen && (
      <div className="settings-modal-overlay" onClick={() => setIsSettingOpen(false)}>
        <div className="settings-modal-container" onClick={(e) => e.stopPropagation()}>
          <div className="settings-modal-header" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <img 
              src="/promy.png" 
              alt="PROMY" 
              onClick={handleLogoClick} 
              style={{ width: "34px", height: "34px", cursor: "pointer", borderRadius: "50%", border: "1.5px solid var(--text-ink)" }} 
            />
            <span className="settings-modal-title" style={{ flexGrow: 1 }}>설정</span>
            <button className="settings-modal-close" onClick={() => setIsSettingOpen(false)}>×</button>
          </div>
          <div className="settings-modal-body">
            <button 
              className="settings-action-btn clear-history" 
              onClick={() => {
                setIsSettingOpen(false);
                window.location.href = "/launch.html";
              }}
              style={{ backgroundColor: "var(--bg-paper)", color: "var(--text-ink)", marginBottom: "4px" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
              홈 화면에 추가
            </button>

            <button 
              className="settings-action-btn clear-history" 
              onClick={() => {
                setIsSettingOpen(false);
                clearChatHistory();
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
              대화기록삭제
            </button>
            
            <button 
              className="settings-action-btn logout" 
              onClick={() => {
                setIsSettingOpen(false);
                handleLogout();
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              로그아웃
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  );
}

function sanitizeMarkdownBold(text: string): string {
  if (!text) return "";
  let s = text;
  // 1. "A **및** B**" -> "**A 및 B**" 형태로 보정
  s = s.replace(/([^*]+)\s*\*\*및\*\*\s*([^*]+)\*\*/g, "**$1 및 $2**");
  // 2. 앞에 **가 없고 뒤에만 **가 있는 경우 (예: "단어**") -> "**단어**" 로 보정
  s = s.replace(/(?<!\*\*)\b([^*]+)\*\*/g, "**$1**");
  return s;
}

// Helper to parse double asterisks (e.g. **bold**) and markdown links [text](url) and render them as JSX with styling
function renderFormattedText(text: string | undefined, isSimple: boolean = false) {
  if (!text) return null;
  const sanitized = sanitizeMarkdownBold(text);
  const regex = /(\*\*[^*]+\*\*|\[[^\]]+\]\s*\(\s*https?:\/\/[^\s\)]+\s*\))/g;
  const parts = sanitized.split(regex);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const cleanText = part.slice(2, -2);
      return (
        <strong key={index} style={{ fontWeight: "850", color: "var(--text-ink, #000000)" }}>
          {cleanText}
        </strong>
      );
    } else if (part.startsWith("[") && part.includes("]")) {
      const closeBracketIndex = part.indexOf("]");
      const linkText = part.slice(1, closeBracketIndex);
      const urlPart = part.slice(closeBracketIndex + 1).trim();
      if (urlPart.startsWith("(") && urlPart.endsWith(")")) {
        const url = urlPart.slice(1, -1).trim();
        return (
          <a
            key={index}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#2563eb",
              textDecoration: "underline",
              wordBreak: "break-all",
              fontWeight: "600"
            }}
          >
            {linkText}
          </a>
        );
      }
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

function formatNicknamePA(nickname: string): string {
  if (!nickname) return "PA님";
  return nickname.replace(/\s*(?:PA|님|PA님)+$/, "").trim() + " PA님";
}

function MessageBubble({
  message,
  onShare,
  kakaoUser,
  isCollapsed,
  onToggleCollapse
}: {
  message: ChatMessage;
  onShare: (ans: PolicyAnswer) => void;
  kakaoUser: { id: number; nickname: string; profileImage: string } | null;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isClothespinHovered, setIsClothespinHovered] = useState(false);
  const [isShareHovered, setIsShareHovered] = useState(false);

  if (message.role === "assistant" && !message.answer) {
    const isWelcomeText = message.content.includes("PA님 무엇을 도와드릴까요?");
    const isExitText = message.content.includes("응답이 없어 대화를 종료합니다");
    const isBoldText = isWelcomeText || isExitText;
    let displayContent = message.content;
    if (isWelcomeText && !displayContent.includes("😊")) {
      displayContent = "PA님 무엇을 도와드릴까요? 😊";
    }
    return (
      <div 
        className="message assistant-bubble" 
        style={{ 
          fontWeight: isBoldText ? "800" : "normal" 
        }}
      >
        {displayContent}
      </div>
    );
  }

  if (message.role === "assistant" && message.answer) {
    const ans = message.answer;

    if (isCollapsed) {
      const quotedHeadline = ans.headline
        ? (ans.headline.startsWith('"') ? ans.headline : `"${ans.headline}"`)
        : `"${getFallbackHeadline(message.content, "")}"`;

      return (
        <div 
          className="message assistant-bubble collapsed-bubble-content" 
          style={{ 
            display: "flex", 
            flexDirection: "column",
            alignItems: "stretch", 
            width: "100%",
            maxWidth: "100%",
            paddingTop: "12px",
            paddingBottom: "8px"
          }}
        >
          <span style={{ 
            fontStyle: "italic", 
            fontWeight: "800", 
            fontSize: "13px", 
            whiteSpace: "normal", 
            wordBreak: "keep-all", 
            overflowWrap: "break-word",
            display: "block",
            color: "var(--text-ink)",
            textAlign: "center"
          }}>
            {quotedHeadline}
          </span>
        </div>
      );
    }

    return (
      <article className={`message assistant answer-card ${isZoomed ? "large-font" : ""}`} style={{ position: "relative", maxWidth: "100%", width: "100%", boxSizing: "border-box" }}>
        <div className="card-top" style={{ display: "flex", justifyContent: "center", alignItems: "center", width: "100%", borderBottom: "2px solid var(--text-ink)", padding: "16px 0", marginBottom: "4px" }}>
          {ans.headline && (
            <h3 
              className="card-headline-title" 
              style={{ 
                margin: 0, 
                fontSize: ans.headline.length > 25 ? "15.5px" : ans.headline.length > 18 ? "17.5px" : "19.5px",
                fontWeight: "900", 
                color: "var(--text-ink)", 
                fontStyle: "italic", 
                lineHeight: "1.3",
                textAlign: "center",
                width: "100%",
                display: "block"
              }}
            >
              {ans.headline.startsWith('"') ? ans.headline : `"${ans.headline}"`}
            </h3>
          )}
        </div>

        {/* 질문 이해 및 분석 근거 (최상단 아코디언 배치) */}
        {ans.analysis && (
          <div className="answer-section">
            <div className="accordion-wrapper-row" style={{ display: "flex", alignItems: "center", gap: "8px", width: "100%", marginBottom: "8px" }}>
              <h4
                className="section-title accordion-header"
                onClick={() => setIsExpanded(!isExpanded)}
                style={{
                  backgroundColor: isExpanded ? "rgba(47, 118, 109, 0.03)" : "transparent",
                  transition: "background-color 0.2s",
                  flex: 1,
                  margin: 0,
                  width: "0px"
                }}
                title="클릭하여 분석 근거 상세 보기"
              >
                <div className="accordion-header-content">
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ color: "var(--accent-green)", marginRight: "4px", fontSize: "13px", fontWeight: "bold" }}>★</span>
                    <span style={{ fontWeight: "700", fontSize: "12.5px", color: "var(--text-ink)" }}>질문 이해 및 분석근거</span>
                  </div>
                  <span className="accordion-toggle-tag">
                    {isExpanded ? (
                      <>내용접기<span style={{ color: "var(--accent-green)", marginLeft: "2px", fontWeight: "900" }}>▲</span></>
                    ) : (
                      <>내용열기<span style={{ color: "var(--accent-green)", marginLeft: "2px", fontWeight: "900" }}>▼</span></>
                    )}
                  </span>
                </div>
              </h4>
              <button className="zoom-toggle-btn" style={{ flexShrink: 0, height: "30px", fontSize: "11px", padding: "4px 8px", margin: 0 }} onClick={() => setIsZoomed(!isZoomed)} title="글씨 크기 확대/축소">
                {isZoomed ? "글씨 축소 -" : "글씨 확대 +"}
              </button>
            </div>
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
                  <path d="M15 4H7"/>
                  <path d="m18 16 3 3-3 3"/>
                  <path d="M3 4v13a2 2 0 0 0 2 2h16"/>
                  <path d="M7 14h7"/>
                  <path d="M7 9h12"/>
                </svg>
              </span>
              핵심 답변 요약
            </h4>
            <p className="summary-text" style={{ lineHeight: "1.6", color: "#0f172a", fontWeight: "500" }}>
              {renderFormattedText(ans.summary, true)}
            </p>
          </div>
        )}

        {ans.conditions && ans.conditions.length > 0 && (
          <div className="answer-section">
            <h4 className="section-title">
              <span className="icon-badge badge-conditions">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="section-icon">
                  <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
                  <path d="m9 12 2 2 4-4"/>
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
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>
                  <path d="M12 9v4"/>
                  <path d="M12 17h.01"/>
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
                  href={`https://www.google.com/search?q=${encodeURIComponent(citation.title)}`}
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
          <footer className="card-disclaimer" style={{ paddingBottom: "10px", marginBottom: "6px", paddingRight: "0px", marginTop: "4px" }}>
            <p style={{ margin: 0, textAlign: "left", whiteSpace: "pre-line", wordBreak: "keep-all", lineHeight: "1.4" }}>
              {ans.disclaimer.replace("참고용이며, ", "참고용이며,\n").replace("자료이며, ", "자료이며,\n")}
            </p>
          </footer>
        )}

        {/* Floating Share Button - Bottom Right */}
        <div 
          className="share-btn-floating" 
          onClick={() => onShare(ans)}
          onMouseEnter={() => setIsShareHovered(true)}
          onMouseLeave={() => setIsShareHovered(false)}
          title="공유하기"
          style={{
            position: "absolute",
            bottom: "-14px",
            right: "12px",
            height: "34px",
            padding: "0 12px",
            backgroundColor: isShareHovered ? "#245d55" : "var(--accent-green)",
            border: "2px solid var(--text-ink)",
            borderRadius: "6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "4px",
            cursor: "pointer",
            boxShadow: isShareHovered ? "3px 3px 0px var(--text-ink)" : "2px 2px 0px var(--text-ink)",
            transform: isShareHovered ? "scale(1.05) translateY(-1px)" : "none",
            zIndex: 20,
            transition: "all 0.1s ease"
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "14px", height: "14px", stroke: "white" }}>
            <circle cx="18" cy="5" r="3"/>
            <circle cx="6" cy="12" r="3"/>
            <circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
          <span style={{ fontSize: "12.5px", fontWeight: "850", color: "white" }}>공유</span>
        </div>
      </article>
    );
  }

  if (message.role === "system") {
    if (message.id === "welcome") {
      return (
        <div className="welcome-banner-card">
          <div className="welcome-banner-header">
            <span className="welcome-banner-badge">NOTICE</span>
          </div>
          <div className="welcome-banner-body">
            <p className="welcome-greet">반갑습니다 {kakaoUser ? `${formatNicknamePA(kakaoUser.nickname)}!` : "PA님!"} 동목포 PA님들의 영업을 지원하는 든든한 멘토, 오멘토입니다. 😊</p>
            <p className="welcome-instruction">
              우측 상단의 <strong className="highlight-text-green">[도움요청 🎙️]</strong> 버튼을 누르시면 음성 상담이 활성화되어, 보상 규정 및 주요 면책 조건에 대해 편하게 코칭을 받으실 수 있습니다.
            </p>
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

function getFormattedDateDivider(isoString?: string): string {
  try {
    const date = parseSafeDate(isoString);
    const days = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${days[date.getDay()]}`;
  } catch {
    const date = new Date();
    const days = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
    return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 ${days[date.getDay()]}`;
  }
}

function getFormattedTime(isoString?: string): string {
  try {
    const date = parseSafeDate(isoString);
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? "오후" : "오전";
    hours = hours % 12;
    hours = hours ? hours : 12;
    const minutesStr = minutes < 10 ? "0" + minutes : minutes;
    return `${ampm} ${hours}:${minutesStr}`;
  } catch {
    return "";
  }
}

const stableFallbackDate = new Date();

function parseSafeDate(dateStr?: string): Date {
  if (!dateStr || dateStr === "undefined" || dateStr === "null") return new Date();
  
  let formatted = dateStr;
  if (typeof dateStr === "string" && !dateStr.includes("T")) {
    formatted = dateStr.replace(/-/g, "/");
  }
  
  const parsed = new Date(formatted);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }
  
  return new Date();
}
