"use client";

import { FormEvent, useMemo, useRef, useState, useEffect } from "react";
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
    summary = cleanText.substring(summaryStart + 4, end).trim();
  } else if (analysisStart === -1) {
    summary = cleanText; // Fallback during initial stream
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

  const isConnectedRef = useRef(isConnected);
  const isSearchingRef = useRef(isSearching);
  const isMicMutedRef = useRef(isMicMuted);

  useEffect(() => { isConnectedRef.current = isConnected; }, [isConnected]);
  useEffect(() => { isSearchingRef.current = isSearching; }, [isSearching]);
  useEffect(() => { isMicMutedRef.current = isMicMuted; }, [isMicMuted]);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "system",
      content:
        "반갑습니다. DB손해보험 동목포 부지점장 프로미입니다. PA님 무엇을 도와드릴까요? 우측 상단의 [도움요청 🎙️] 버튼을 누르시면 음성 상담을 시작하실 수 있습니다."
    }
  ]);

  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const reusableAudioRef = useRef<HTMLAudioElement | null>(null); // Reusable unlocked audio node for Safari/iOS compatibility
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const isRecordingRef = useRef<boolean>(false);
  const isTranscribingRef = useRef<boolean>(false);
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isPlayingAudio = useRef(false);
  const [isFinalEndingPending, setIsFinalEndingPending] = useState(false);
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

      await new Promise<void>((resolve, reject) => {
        audio.onended = () => {
          activeAudioRef.current = null;
          setLiveTranscript("");
          isPlayingAudio.current = false;
          resetInactivityTimer();
          resolve();
        };
        audio.onerror = (e) => {
          activeAudioRef.current = null;
          setLiveTranscript("");
          isPlayingAudio.current = false;
          resetInactivityTimer();
          reject(e);
        };
        audio.playbackRate = 1.15;
        audio.play().catch((err) => {
          activeAudioRef.current = null;
          setLiveTranscript("");
          isPlayingAudio.current = false;
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

      // Slowly adapt noise floor when not speaking to handle ambient room noise
      if (!hasSpokenRef.current) {
        noiseFloorRef.current = noiseFloorRef.current * 0.95 + rms * 0.05;
      }

      // Dynamic voice threshold: noise floor + 0.006 (minimum 0.008 to ignore small background changes)
      const VOICE_THRESHOLD = Math.max(0.008, noiseFloorRef.current + 0.006);

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
        // If the user has spoken, and then is silent for 3.0 seconds, stop recording and send to Whisper
        if (hasSpokenRef.current && (now - lastActiveTimeRef.current > 3000)) {
          const totalDuration = now - recordingStartTimeRef.current;
          const speechDuration = totalDuration - 3000;

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
          console.log(`[VOICE] VAD silence detected (3.0s). Stopping recorder. Speech duration: ${speechDuration}ms`);
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

  // Monitor 20-second inactivity timer
  function resetInactivityTimer() {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }

    if (isConnected && !isMicMuted && !isSearching && !isPlayingAudio.current && !isFinalEndingPending && !isRequestActiveRef.current && !isRecordingRef.current && !isTranscribingRef.current) {
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
      console.log("[VOICE] Whisper API response:", transcribedText);

      // Filter out empty transcription
      if (!transcribedText) {
        console.log("[VOICE] [Whisper STT Filter] Empty transcription, ignore.");
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
      addMessage({ role: "assistant", content: "PA님 무엇을 도와드릴까요?" });
      await playStaticAudio("welcome.mp3", "PA님 무엇을 도와드릴까요?");

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
          product_hint: productHint
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
      const formattedTime = now.toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });

      // Optimistically add an empty assistant card so we can stream into it
      setMessages((current) => [
        ...current,
        {
          id: tempMessageId,
          role: "assistant",
          content: "답변을 생성하는 중입니다...",
          timestamp: formattedTime
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
                          disclaimer: metadata?.disclaimer || "본 답변은 DB손해보험 공식 상품공시실 기초서류와 구글 실시간 검색을 바탕으로 AI 추론 엔진이 분석한 전문가용 자료이며, 최종 보상 지급 판단은 심사 결과에 따라 다를 수 있습니다."
                        }
                      }
                    : msg
                )
              );
            } else if (currentEvent === "metadata") {
              metadata = JSON.parse(dataStr);
              
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
        searchEngine: metadata?.searchEngine || "실시간 스트리밍",
        isSimpleChat: metadata?.isSimpleChat || false,
        disclaimer: metadata?.disclaimer || "본 답변은 DB손해보험 공식 상품공시실 기초서류와 구글 실시간 검색을 바탕으로 AI 추론 엔진이 분석한 전문가용 자료이며, 최종 보상 지급 판단은 심사 결과에 따라 다를 수 있습니다."
      } as PolicyAnswer & { isSimpleChat?: boolean };

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
    setMessages((current) => [
      ...current,
      {
        id: generateUUID(),
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
          <h1 className="cover-title">동목포 오멘토</h1>
          <p className="cover-description">
            동목포 PA님들의 영업을 지원하는 멘토
          </p>
          <button className="primary-button start-consult-btn" onClick={handleStartButtonClick}>
            상담 시작하기 <span className="btn-arrow">➔</span>
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
            <h2>동목포 오멘토</h2>
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

// Helper to parse double asterisks (e.g. **bold**) and markdown links [text](url) and render them as JSX with styling
function renderFormattedText(text: string | undefined) {
  if (!text) return null;
  const regex = /(\*\*[^*]+\*\*|\[[^\]]+\]\s*\(\s*https?:\/\/[^\s\)]+\s*\))/g;
  const parts = text.split(regex);
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
                <span style={{ fontWeight: "800" }}>질문 이해 및 분석근거</span>
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
                {isExpanded ? "내용접기▲" : "내용열기▼"}
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
            <h4>동목포 오멘토의 영업 & 보장분석 코칭</h4>
          </div>
          <div className="welcome-banner-body">
            <p className="welcome-greet">반갑습니다 PA님! 동목포 PA님들의 영업을 지원하는 든든한 멘토, 오멘토입니다. 😊</p>
            <p className="welcome-instruction">
              우측 상단의 <strong className="highlight-text-green">[도움요청 🎙️]</strong> 버튼을 누르시면 음성 상담이 활성화되어 약관 조회 및 영업 보장 조건에 대해 편하게 코칭을 받으실 수 있습니다.
            </p>
            <div className="welcome-features">
              <div className="feature-item">
                <span className="feature-dot"></span>
                <span>보상 규정 및 주요 면책 조건에 대해 쉽게 설명해 드립니다.</span>
              </div>
              <div className="feature-item">
                <span className="feature-dot"></span>
                <span>PA님의 영업 성공을 위해 약관 해석 및 영업 화법을 코칭해 드립니다.</span>
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
