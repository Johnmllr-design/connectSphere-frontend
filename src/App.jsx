import React, { useEffect, useRef, useState } from "react";
import Speech from "react-text-to-speech";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://connectsphere-backend-production.up.railway.app";
const WS_BASE_URL =
  import.meta.env.VITE_WS_BASE_URL ||
  API_BASE_URL.replace(/^http/i, "ws");

const normalizeCode = (value) =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

function App() {
  const [activeScreen, setActiveScreen] = useState("owner");

  const [ownerName, setOwnerName] = useState("");
  const [targetName, setTargetName] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [createdCode, setCreatedCode] = useState("");
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [ownerError, setOwnerError] = useState("");

  const [codeInput, setCodeInput] = useState("");
  const [isResolvingCode, setIsResolvingCode] = useState(false);
  const [callerError, setCallerError] = useState("");
  const [connectedProfile, setConnectedProfile] = useState(null);

  const [isRecording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);

  const cleanupAudio = async () => {
    processorRef.current?.disconnect();
    processorRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    wsRef.current?.close();
    wsRef.current = null;
  };

  const stopCall = async () => {
    await cleanupAudio();
    setRecording(false);
  };

  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, []);

  useEffect(() => {
    setCallerError("");
    setOwnerError("");
    if (activeScreen !== "caller" && isRecording) {
      stopCall();
    }
  }, [activeScreen]);

  const createProfile = async (e) => {
    e.preventDefault();
    setOwnerError("");
    setCreatedCode("");

    if (!ownerName.trim() || !targetName.trim() || !customPrompt.trim()) {
      setOwnerError("Owner, call target, and prompt are required.");
      return;
    }

    setIsCreatingProfile(true);

    try {
      const response = await fetch(`${API_BASE_URL}/profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner_name: ownerName.trim(),
          target_name: targetName.trim(),
          prompt: customPrompt.trim(),
          code: customCode ? normalizeCode(customCode) : null,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "Unable to create code.");
      }

      const profile = await response.json();
      setCreatedCode(profile.code);
      setCodeInput(profile.code);
      setActiveScreen("caller");
    } catch (error) {
      setOwnerError(error.message || "Unable to create code.");
    } finally {
      setIsCreatingProfile(false);
    }
  };

  const connectByCode = async () => {
    const normalized = normalizeCode(codeInput);
    if (!normalized) {
      setCallerError("Please enter a valid code.");
      return;
    }

    setIsResolvingCode(true);
    setCallerError("");
    setConnectedProfile(null);

    try {
      const response = await fetch(`${API_BASE_URL}/profiles/${normalized}`);

      if (!response.ok) {
        throw new Error("Code not found. Ask the owner for the right code.");
      }

      const profile = await response.json();
      setConnectedProfile(profile);
      setCodeInput(profile.code);
      setTranscript("");
    } catch (error) {
      setCallerError(error.message || "Could not connect with that code.");
    } finally {
      setIsResolvingCode(false);
    }
  };

  const startCall = async () => {
    if (!connectedProfile?.code) {
      setCallerError("Connect with a valid code first.");
      return;
    }

    setCallerError("");

    try {
      const wsUrl = `${WS_BASE_URL}/stream/${encodeURIComponent(
        connectedProfile.code
      )}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          setTranscript(event.data);
        }
      };

      ws.onclose = () => setRecording(false);

      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return;
        }

        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);

        for (let i = 0; i < float32.length; i += 1) {
          const sample = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = sample < 0 ? sample * 32768 : sample * 32767;
        }

        wsRef.current.send(int16.buffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setRecording(true);
    } catch (error) {
      console.error("Call start error:", error);
      setCallerError("Could not start call. Check mic permissions and code.");
      await cleanupAudio();
      setRecording(false);
    }
  };

  const renderOwnerScreen = () => (
    <form className="panel" onSubmit={createProfile}>
      <h2>Owner setup</h2>
      <p className="muted">
        Configure who this line represents and what Claude should say.
      </p>

      <label>
        Owner/client name
        <input
          value={ownerName}
          onChange={(e) => setOwnerName(e.target.value)}
          placeholder="e.g. Acme Support Team"
          required
        />
      </label>

      <label>
        Person or team callers are trying to reach
        <input
          value={targetName}
          onChange={(e) => setTargetName(e.target.value)}
          placeholder="e.g. Sarah in Sales"
          required
        />
      </label>

      <label>
        Connection code (optional custom)
        <input
          value={customCode}
          onChange={(e) => setCustomCode(normalizeCode(e.target.value))}
          placeholder="e.g. SARAH1"
        />
      </label>

      <label>
        Claude voice-agent prompt
        <textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Describe tone, persona, and what the assistant should communicate."
          rows={6}
          required
        />
      </label>

      {ownerError ? <div className="error">{ownerError}</div> : null}

      <button type="submit" disabled={isCreatingProfile}>
        {isCreatingProfile ? "Creating..." : "Create call code"}
      </button>

      {createdCode ? (
        <div className="success">
          Code created: <strong>{createdCode}</strong>
        </div>
      ) : null}
    </form>
  );

  const renderCallerScreen = () => (
    <div className="panel">
      <h2>Caller screen</h2>
      <p className="muted">
        Enter your code to connect to the right person before starting audio.
      </p>

      <div className="code-row">
        <input
          value={codeInput}
          onChange={(e) => setCodeInput(normalizeCode(e.target.value))}
          placeholder="Enter code"
        />
        <button
          type="button"
          onClick={connectByCode}
          disabled={isResolvingCode}
          className="secondary"
        >
          {isResolvingCode ? "Connecting..." : "Connect"}
        </button>
      </div>

      {connectedProfile ? (
        <div className="profile-chip">
          Connected to {connectedProfile.target_name} via{" "}
          {connectedProfile.owner_name}
        </div>
      ) : null}

      {callerError ? <div className="error">{callerError}</div> : null}

      <div className="controls">
        <button
          type="button"
          onClick={isRecording ? stopCall : startCall}
          disabled={!connectedProfile}
        >
          {isRecording ? "Stop call" : "Start call"}
        </button>
        <span className="status">{isRecording ? "Live" : "Idle"}</span>
      </div>

      <div className="transcript">
        {transcript || "Live Claude response will appear here."}
      </div>

      {transcript ? <Speech text={transcript} stableText autoPlay /> : null}
    </div>
  );

  return (
    <div className="app-shell">
      <h1>ConnectSphere</h1>
      <p className="muted">Owner setup + caller connection flow</p>

      <div className="tabs">
        <button
          type="button"
          className={activeScreen === "owner" ? "tab active" : "tab"}
          onClick={() => setActiveScreen("owner")}
        >
          Owner page
        </button>
        <button
          type="button"
          className={activeScreen === "caller" ? "tab active" : "tab"}
          onClick={() => setActiveScreen("caller")}
        >
          Caller page
        </button>
      </div>

      {activeScreen === "owner" ? renderOwnerScreen() : renderCallerScreen()}
    </div>
  );
}

export default App;