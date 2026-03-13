import { useState, useRef } from "react";
import React from "react";
import Speech from "react-text-to-speech";
import './App.css'

function App() {
  const [isRecording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const streamRef = useRef(null);

  const start = async () => {
    try {
      const ws = new WebSocket("wss://connectsphere-backend-production.up.railway.app");
      wsRef.current = ws;

      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          setTranscript(event.data);
        }
      };

      ws.onerror = (e) => console.error("WS error:", e);
      ws.onclose = () => console.log("WS closed");

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
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        const float32 = e.inputBuffer.getChannelData(0);
        const int16 = new Int16Array(float32.length);

        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 32768 : s * 32767;
        }

        wsRef.current.send(int16.buffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      setRecording(true);
    } catch (err) {
      console.error("Start error:", err);
    }
  };

  const stop = async () => {
    processorRef.current?.disconnect();
    processorRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    if (audioContextRef.current) {
      await audioContextRef.current.close();
      audioContextRef.current = null;
    }

    wsRef.current?.close();
    wsRef.current = null;

    setRecording(false);
  };

  return (
    <div className="app-shell">
      <h1 className="app-title">ConnectSphere</h1>
      <p className="app-subtitle">
        Real-time voice assistant interface
      </p>

      <div className="controls">
        <button
          className={`record-button ${isRecording ? "recording" : ""}`}
          onClick={isRecording ? stop : start}
        >
          {isRecording ? "🔴 Stop" : "📱 Start"}
        </button>

        <div className="status-pill">
          <span className={`status-dot ${isRecording ? "recording" : ""}`}></span>
          {isRecording ? "Listening live" : "Standing by"}
        </div>
      </div>

      <div className="transcript-card">
        <div className="transcript-label">Live transcript</div>
        <p className="transcript-text">
          {transcript || "Say something and your response will appear here..."}
        </p>

        {isRecording && (
          <div className="wave-bar">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </div>
        )}
      </div>

      {transcript && (
        <Speech text={transcript} stableText={true} autoPlay={true} />
      )}
    </div>
  );
}

export default App;