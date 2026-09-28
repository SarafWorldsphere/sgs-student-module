"use client";

import { useEffect, useRef, useState } from "react";
import AppSelect from "../app-select";
import { getApiBaseUrl } from "../api-base-url";
import { getLoggedInUserEmail } from "../login-session";
import DashboardShell from "../dashboard-shell";
import StudyTabs from "../study-tabs";

const API_BASE_URL = getApiBaseUrl();
const AI_REQUEST_DELAY_MS = 2000;

const languages = [
  "English",
  "Hindi",
  "Telugu",
  "Tamil",
  "Marathi",
  "Gujarati",
  "Kannada",
  "Bengali"
];

const sampleText = "Democracy means that people choose their representatives through regular elections.";
const speechLanguages = {
  English: "en-IN",
  Hindi: "hi-IN",
  Telugu: "te-IN",
  Tamil: "ta-IN",
  Marathi: "mr-IN",
  Gujarati: "gu-IN",
  Kannada: "kn-IN",
  Bengali: "bn-IN"
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 35000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function waitBeforeAiRequest() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, AI_REQUEST_DELAY_MS);
  });
}

export default function AiTranslatorPage() {
  const [sourceLanguage, setSourceLanguage] = useState("Auto Detect");
  const [targetLanguage, setTargetLanguage] = useState("Hindi");
  const [text, setText] = useState(sampleText);
  const [translatedText, setTranslatedText] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const speechChunksRef = useRef([]);
  const speechIndexRef = useRef(0);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      speechChunksRef.current = [];
      speechIndexRef.current = 0;
    };
  }, []);

  useEffect(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    speechChunksRef.current = [];
    speechIndexRef.current = 0;
    setIsSpeaking(false);
  }, [translatedText, targetLanguage]);

  async function handleTranslate() {
    const trimmedText = text.trim();
    if (!trimmedText) {
      setError("Please enter text to translate.");
      setStatus("");
      return;
    }

    setLoading(true);
    setError("");
    setStatus("Translating text...");
    setTranslatedText("");

    try {
      await waitBeforeAiRequest();
      const userEmail = await getLoggedInUserEmail();
      const response = await fetchWithTimeout(`${API_BASE_URL}/ai/translate-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmedText,
          source_language: sourceLanguage === "Auto Detect" ? null : sourceLanguage,
          target_language: targetLanguage,
          user_email: userEmail
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(typeof data.detail === "string" ? data.detail : "Unable to translate text.");
      }

      setTranslatedText(data.translated_text || "");
      setStatus("Translation ready.");
    } catch (translateError) {
      setError(translateError.name === "AbortError" ? "Translation timed out. Please try again." : translateError.message);
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!translatedText) {
      return;
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(translatedText);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = translatedText;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        const copied = document.execCommand("copy");
        textArea.remove();
        if (!copied) throw new Error("Copy command was rejected.");
      }
      setError("");
      setStatus("Translated text copied.");
    } catch {
      setStatus("");
      setError("Unable to copy automatically. Please select and copy the translated text manually.");
    }
  }

  function speakChunk(index) {
    if (index >= speechChunksRef.current.length) {
      setIsSpeaking(false);
      setStatus("Reading completed.");
      return;
    }

    speechIndexRef.current = index;
    const languageCode = speechLanguages[targetLanguage] || "en-IN";
    const utterance = new SpeechSynthesisUtterance(speechChunksRef.current[index]);
    const voices = window.speechSynthesis.getVoices();
    const languagePrefix = languageCode.split("-")[0].toLowerCase();
    const matchingVoice = voices.find((voice) => voice.lang.toLowerCase() === languageCode.toLowerCase())
      || voices.find((voice) => voice.lang.toLowerCase().startsWith(languagePrefix));

    utterance.lang = languageCode;
    utterance.rate = 0.92;
    if (matchingVoice) utterance.voice = matchingVoice;
    utterance.onend = () => speakChunk(index + 1);
    utterance.onerror = (event) => {
      if (event.error !== "canceled" && event.error !== "interrupted") {
        setError(`Unable to read ${targetLanguage} text with the available browser voice.`);
      }
      setIsSpeaking(false);
    };
    window.speechSynthesis.speak(utterance);
  }

  function handleSpeak() {
    if (!translatedText || !("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      setError("Text to voice is not supported in this browser.");
      return;
    }

    window.speechSynthesis.cancel();
    speechChunksRef.current = translatedText.match(/[\s\S]{1,180}(?:\s|$)/g)?.map((chunk) => chunk.trim()).filter(Boolean)
      || [translatedText];
    speechIndexRef.current = 0;
    setError("");
    setStatus(`Reading translated text in ${targetLanguage}...`);
    setIsSpeaking(true);
    window.setTimeout(() => speakChunk(0), 0);
  }

  function handleStopSpeech() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    speechChunksRef.current = [];
    speechIndexRef.current = 0;
    setIsSpeaking(false);
    setStatus("Reading stopped.");
  }

  return (
    <DashboardShell>
      <section className="module-page">
        <StudyTabs />
        <div className="module-content-area">
          <article className="module-card translator-card">
            <div className="card-title-row">
              <div>
                <h2>AI Translator</h2>
                <p>Translate study text into another language script.</p>
              </div>
              <span className="status-pill in-progress">AI Tool</span>
            </div>

            <div className="translator-grid">
              <section className="translator-panel">
                <div className="translator-controls">
                  <label>
                    <span>Source</span>
                    <AppSelect
                      value={sourceLanguage}
                      options={[
                        { value: "Auto Detect", label: "Auto Detect" },
                        ...languages.map((language) => ({ value: language, label: language }))
                      ]}
                      onChange={setSourceLanguage}
                      ariaLabel="Select source language"
                      searchable
                    />
                  </label>
                  <label>
                    <span>Target</span>
                    <AppSelect
                      value={targetLanguage}
                      options={languages.map((language) => ({ value: language, label: language }))}
                      onChange={setTargetLanguage}
                      ariaLabel="Select target language"
                      searchable
                    />
                  </label>
                </div>
                <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Paste study text here" />
              </section>

              <section className="translator-panel output">
                <div className="translator-output-head">
                  <strong>Translated Text</strong>
                  <div>
                    <button className="soft-button" type="button" onClick={handleCopy} disabled={!translatedText}>Copy</button>
                    <button className="soft-button" type="button" onClick={handleSpeak} disabled={!translatedText || isSpeaking}>{isSpeaking ? "Speaking..." : "Speak"}</button>
                    <button className="soft-button" type="button" onClick={handleStopSpeech} disabled={!isSpeaking}>Stop</button>
                  </div>
                </div>
                <div className="translator-output" aria-live="polite">
                  {translatedText || "Translation will appear here."}
                </div>
              </section>
            </div>

            {error && <div className="learning-status error" role="alert">{error}</div>}
            {status && <div className="learning-status success" role="status">{status}</div>}

            <div className="quiz-submit-row">
              <button className="primary-button" type="button" onClick={handleTranslate} disabled={loading}>
                {loading ? "Translating..." : "Translate"}
              </button>
            </div>
          </article>

          <div className="note-box">Use AI Translator for study notes, chapter paragraphs, and assignment instructions.</div>
        </div>
      </section>
    </DashboardShell>
  );
}
