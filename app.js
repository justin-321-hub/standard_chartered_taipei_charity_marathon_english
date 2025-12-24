/**
 * app.js — Frontend JS Chat Logic (English Version)
 */

"use strict";

/* =========================
   Backend API Domain
========================= */
const API_BASE = "https://standard-chartered-taipei-charity.onrender.com";
const api = (p) => `${API_BASE}${p}`;

/* =========================
   No-login Multi-user: clientId
========================= */
const CID_KEY = "fourleaf_client_id";
let clientId = localStorage.getItem(CID_KEY);
if (!clientId) {
  clientId =
    (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(CID_KEY, clientId);
}

/* =========================
   DOM References
========================= */
const elMessages = document.getElementById("messages");
const elInput = document.getElementById("txtInput");
const elBtnSend = document.getElementById("btnSend");
const elThinking = document.getElementById("thinking");

/* =========================
   Message State
========================= */
const messages = [];

/* =========================
   Utilities
========================= */
const uid = () => Math.random().toString(36).slice(2);

function scrollToBottom() {
  elMessages?.scrollTo({ top: elMessages.scrollHeight, behavior: "smooth" });
}

/**
 * Toggle "thinking" animation
 */
function setThinking(on) {
  if (!elThinking) return;
  if (on) {
    elThinking.classList.remove("hidden");
    if (elBtnSend) elBtnSend.disabled = true;
    if (elInput) elInput.disabled = true;
  } else {
    elThinking.classList.add("hidden");
    if (elBtnSend) elBtnSend.disabled = false;
    if (elInput) elInput.disabled = false;
    elInput?.focus();
  }
}

/**
 * Smart question mark processing (for user input)
 */
function processQuestionMarks(text) {
  let result = text;
  result = result.replace(/[?？]\s*$/g, '');
  result = result.replace(/[?？](?=.)/g, '\n');
  result = result.replace(/\n\s*\n/g, '\n');
  return result.trim();
}

/**
 * HTML escaping (prevent XSS)
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Check if response contains incomplete processing markers
 */
function containsIncompleteMarkers(text) {
  if (typeof text !== 'string') return false;
  const lowerText = text.toLowerCase();
  return lowerText.includes('search results') && lowerText.includes('html');
}

/* =========================
   Render messages to screen
========================= */
function render() {
  if (!elMessages) return;
  elMessages.innerHTML = "";
  for (const m of messages) {
    const isUser = m.role === "user";
    // Row container
    const row = document.createElement("div");
    row.className = `msg ${isUser ? "user" : "bot"}`;

    // Avatar
    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.src = isUser
      ? "https://raw.githubusercontent.com/justin-321-hub/standard_chartered_taipei_charity_marathon/refs/heads/main/assets/user.png"
      : "https://raw.githubusercontent.com/justin-321-hub/standard_chartered_taipei_charity_marathon/refs/heads/main/assets/20251224_logo.jpg";
    avatar.alt = isUser ? "you" : "bot";

    // Message bubble
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (isUser) {
      bubble.innerHTML = escapeHtml(m.text).replace(/\n/g, '<br>');
    } else {
      bubble.innerHTML = m.text;
    }

    // Assembly
    row.appendChild(avatar);
    row.appendChild(bubble);
    elMessages.appendChild(row);
  }
  scrollToBottom();
}

/* =========================
   Call backend logic (independent error counters)
========================= */
async function sendText(text, retryCounts = {}) {
  const content = (text ?? elInput?.value ?? "").trim();
  if (!content) return;

  const contentToSend = processQuestionMarks(content);

  // Initialize retry counters
  if (!retryCounts.emptyResponse) retryCounts.emptyResponse = 0;
  if (!retryCounts.incompleteMarkers) retryCounts.incompleteMarkers = 0;
  if (!retryCounts.httpErrors) retryCounts.httpErrors = 0;

  // Check if this is the first request
  const isFirstRequest = 
    retryCounts.emptyResponse === 0 && 
    retryCounts.incompleteMarkers === 0 && 
    retryCounts.httpErrors === 0;

  // Only show user message and clear input on first call
  if (isFirstRequest) {
    const userMsg = { id: uid(), role: "user", text: content, ts: Date.now() };
    messages.push(userMsg);
    if (elInput) elInput.value = "";
    render();
  }

  setThinking(true);

  try {
    const res = await fetch(api("/api/chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": clientId,
      },
      body: JSON.stringify({
        text: contentToSend,
        clientId,
        language: "繁體中文",
        role: "user"
      }),
    });

    const raw = await res.text();
    let data;
    
    // Simplified JSON parsing, wrap as errorRaw on failure
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { errorRaw: raw };
    }

    // ★★★ 3. HTTP 500/502/503/504/401/404 Error Handling ★★★
    const commonHttpErrors = [500, 502, 503, 504, 401, 404];
    if (commonHttpErrors.includes(res.status)) {
      if (retryCounts.httpErrors === 0) {
        retryCounts.httpErrors++;
        setThinking(false);
        const retryMsg = {
          id: uid(),
          role: "assistant",
          text: "The network is unstable， we are asking your question again.",
          ts: Date.now(),
        };
        messages.push(retryMsg);
        render();
        await new Promise(resolve => setTimeout(resolve, 1000));
        return sendText(content, retryCounts);
      } else {
        throw new Error("Sorry, the network is unstable. Please try again later.");
      }
    }

    // ★★★ 4. Other HTTP Errors ★★★
    if (!res.ok) {
      throw new Error("Sorry, the network is unstable. Please try again later.");
    }

    // ★★★ 1. HTTP 200 Empty Response Error Handling ★★★
    if (res.status === 200) {
      let isEmptyResponse = false;
      
      if (typeof data === "object" && data !== null) {
        const isPlainEmptyObject =
          !Array.isArray(data) &&
          Object.keys(data).filter(k => k !== 'clientId').length === 0;
        
        const hasTextField = 'text' in data || 'message' in data;
        if (hasTextField) {
          const textValue = data.text !== undefined ? data.text : data.message;
          if (textValue === "" || textValue === null || textValue === undefined) {
            isEmptyResponse = true;
          }
        } else if (isPlainEmptyObject) {
          isEmptyResponse = true;
        }
      }

      if (isEmptyResponse && retryCounts.emptyResponse === 0) {
        retryCounts.emptyResponse++;
        setThinking(false);
        const retryMsg = {
          id: uid(),
          role: "assistant",
          text: "The network is unstable， we are asking your question again.",
          ts: Date.now(),
        };
        messages.push(retryMsg);
        render();
        await new Promise(resolve => setTimeout(resolve, 1000));
        return sendText(content, retryCounts);
      }
      
      if (isEmptyResponse && retryCounts.emptyResponse >= 1) {
        throw new Error("Sorry, the network is unstable. Please try again later.");
      }
    }

    // Process reply text (HTML)
    let replyText;
    if (typeof data === "string") {
      replyText = data.trim() || "Please rephrase your question, thank you.";
    } else if (data && typeof data === "object") {
      const hasTextField = 'text' in data || 'message' in data;
      if (hasTextField) {
        const textValue = data.text !== undefined ? data.text : data.message;
        if (textValue === "" || textValue === null || textValue === undefined) {
          replyText = "Please rephrase your question, thank you.";
        } else {
          replyText = String(textValue).trim() || "Please rephrase your question, thank you.";
        }
      } else {
        const isPlainEmptyObject =
          !Array.isArray(data) &&
          Object.keys(data).filter(k => k !== 'clientId').length === 0;
        if (isPlainEmptyObject) {
          replyText = "The network is unstable, please try again later.";
        } else {
          replyText = JSON.stringify(data, null, 2);
        }
      }
    } else {
      replyText = "Please rephrase your question, thank you.";
    }

    // ★★★ 2. Backend Incomplete Processing Error ★★★
    if (containsIncompleteMarkers(replyText)) {
      if (retryCounts.incompleteMarkers === 0) {
        retryCounts.incompleteMarkers++;
        setThinking(false);
        const thinkingMsg = {
          id: uid(),
          role: "assistant",
          text: "Still searching, please wait.",
          ts: Date.now(),
        };
        messages.push(thinkingMsg);
        render();
        await new Promise(resolve => setTimeout(resolve, 1000));
        return sendText(content, retryCounts);
      } else {
        // Second failure, show error message and return
        setThinking(false);
        const errorMsg = {
          id: uid(),
          role: "assistant",
          text: "Sorry, the network is unstable. Please try again later.",
          ts: Date.now(),
        };
        messages.push(errorMsg);
        render();
        return;
      }
    }

    // Push bot message
    const botMsg = { id: uid(), role: "assistant", text: replyText, ts: Date.now() };
    messages.push(botMsg);
    setThinking(false);
    render();

  } catch (err) {
    setThinking(false);
    
    // ★★★ 5. Offline Status Check ★★★
    if (!navigator.onLine) {
      const offlineMsg = {
        id: uid(),
        role: "assistant",
        text: "You are currently offline. Please check your network connection and try again.",
        ts: Date.now(),
      };
      messages.push(offlineMsg);
      render();
      return;
    }
    
    const friendly = `${err?.message || err}`;
    const botErr = {
      id: uid(),
      role: "assistant",
      text: friendly,
      ts: Date.now(),
    };
    messages.push(botErr);
    render();
  }
}

// Event bindings
elBtnSend?.addEventListener("click", () => sendText());
elInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendText();
  }
});

window.addEventListener("load", () => elInput?.focus());

// Welcome message
messages.push({
  id: uid(),
  role: "assistant",
  text: "<p>Hi~~</p><p>I am <strong>Standard Chartered Marathon's</strong> online customer service assistant.What information do you need to inquire about?</p><p>Feel free to ask questions!</p>",
  ts: Date.now(),
});
render();




