/**
 * app.js — 前端純 JS 聊天室邏輯（渣打馬拉松英文版）
 * ---------------------------------------------------------
 * 功能重點：
 * 1) 機器人回覆支援 HTML/Markdown 渲染 (表格、清單、連結)
 * 2) 使用者輸入保持純文字 (防護 XSS)
 * 3) 錯誤處理與思考中動畫
 * 4) 針對渣打馬拉松的 API 與歡迎詞
 */

"use strict";

/* =========================
   後端 API 網域
   ========================= */
const API_BASE = "https://standard-chartered-taipei-charity.onrender.com";

/**
 * 組合完整 API 路徑
 */
const api = (p) => `${API_BASE}${p}`;

/* =========================
   免登入多使用者：clientId
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
   DOM 參照
   ========================= */
const elMessages = document.getElementById("messages");
const elInput = document.getElementById("txtInput");
const elBtnSend = document.getElementById("btnSend");
const elThinking = document.getElementById("thinking");

/* =========================
   訊息狀態
   ========================= */
/** @type {{id:string, role:'user'|'assistant', text:string, ts:number, isHtml?:boolean}[]} */
const messages = [];

/* =========================
   小工具函式
   ========================= */
const uid = () => Math.random().toString(36).slice(2);

function scrollToBottom() {
  elMessages?.scrollTo({ top: elMessages.scrollHeight, behavior: "smooth" });
}

/**
 * ★ 解析 Markdown 表格
 */
function parseMarkdownTables(text) {
  if (!text || typeof text !== 'string') return '';

  const tableRegex = /(?:^|\n)((?:\|[^\n]+\|\s*\n)+)/g;

  return text.replace(tableRegex, (match, tableBlock) => {
    const lines = tableBlock.trim().split('\n').filter(line => line.trim());
    if (lines.length < 2) return match;

    function parseTableRow(line) {
      let trimmed = line.trim();
      if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
      if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
      return trimmed.split('|').map(cell => cell.trim());
    }

    function isSeparatorRow(line) {
      const trimmed = line.trim();
      return /^\|?[\s\-:\|]+\|?$/.test(trimmed) && trimmed.includes('-');
    }

    function parseAlignment(line) {
      const cells = parseTableRow(line);
      return cells.map(cell => {
        const trimmed = cell.trim();
        const leftColon = trimmed.startsWith(':');
        const rightColon = trimmed.endsWith(':');
        if (leftColon && rightColon) return 'center';
        if (rightColon) return 'right';
        return 'left';
      });
    }

    let separatorIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (isSeparatorRow(lines[i])) {
        separatorIndex = i;
        break;
      }
    }

    if (separatorIndex === -1 || separatorIndex === 0) return match;

    const alignments = parseAlignment(lines[separatorIndex]);
    let html = '\n<table class="markdown-table">\n<thead>\n';

    // 表頭
    for (let i = 0; i < separatorIndex; i++) {
      const headerCells = parseTableRow(lines[i]);
      html += '<tr>\n';
      headerCells.forEach((cell, index) => {
        const align = alignments[index] || 'left';
        html += `<th style="text-align:${align}">${cell}</th>\n`;
      });
      html += '</tr>\n';
    }
    html += '</thead>\n';

    // 表身
    if (separatorIndex < lines.length - 1) {
      html += '<tbody>\n';
      for (let i = separatorIndex + 1; i < lines.length; i++) {
        const rowCells = parseTableRow(lines[i]);
        html += '<tr>\n';
        rowCells.forEach((cell, index) => {
          const align = alignments[index] || 'left';
          html += `<td style="text-align:${align}">${cell}</td>\n`;
        });
        html += '</tr>\n';
      }
      html += '</tbody>\n';
    }

    html += '</table>\n';
    return html;
  });
}

/**
 * ★ Markdown 轉 HTML
 */
function markdownToHTML(markdown) {
  if (!markdown || typeof markdown !== 'string') return '';

  let html = markdown;

  // 1. 保護程式碼區塊
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    const index = codeBlocks.length;
    const escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
    const langClass = lang ? ` class="language-${lang}"` : '';
    codeBlocks.push(`<pre><code${langClass}>${escapedCode}</code></pre>`);
    return `%%CODEBLOCK_${index}%%`;
  });

  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (match, code) => {
    const index = inlineCodes.length;
    const escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    inlineCodes.push(`<code>${escapedCode}</code>`);
    return `%%INLINECODE_${index}%%`;
  });

  // 2. 處理表格
  html = parseMarkdownTables(html);

  // 3. 區塊元素
  html = html.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '<hr>'); // 分隔線
  
  // 標題
  html = html.replace(/^###### (.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // 引用
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // 清單
  html = html.replace(/^[\s]*[-*+] ([^\n]+)$/gm, (match, content) => {
    if (/^[-:\s|]+$/.test(content)) return match; // 避開表格分隔線
    return `<li>${content}</li>`;
  });
  html = html.replace(/^[\s]*\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[^<]*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // 4. 行內元素
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;">');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // 5. 換行
  html = html.replace(/  \n/g, '<br>\n');
  html = html.replace(/([^>\n])\n([^<\n])/g, '$1<br>\n$2');

  // 6. 還原程式碼
  inlineCodes.forEach((code, index) => html = html.replace(`%%INLINECODE_${index}%%`, code));
  codeBlocks.forEach((block, index) => html = html.replace(`%%CODEBLOCK_${index}%%`, block));

  return html;
}

/**
 * HTML 基本清理 (XSS 防護)
 */
function sanitizeHTML(html) {
  const allowedTags = [
    'b', 'i', 'u', 'strong', 'em', 'del', 'br', 'p', 'div', 'span',
    'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'blockquote', 'code', 'pre', 'hr', 'img'
  ];
  const allowedAttributes = {
    'a': ['href', 'target', 'rel'],
    'img': ['src', 'alt', 'style', 'width', 'height'],
    '*': ['class', 'style', 'colspan', 'rowspan']
  };

  const temp = document.createElement('div');
  temp.innerHTML = html;

  function cleanNode(node) {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tagName = child.tagName.toLowerCase();
        if (!allowedTags.includes(tagName)) {
          const textNode = document.createTextNode(child.textContent || '');
          node.replaceChild(textNode, child);
        } else {
          const attrs = Array.from(child.attributes);
          for (const attr of attrs) {
            const name = attr.name.toLowerCase();
            const val = attr.value.toLowerCase();
            if (name.startsWith('on') || val.startsWith('javascript:') || (name === 'src' && val.startsWith('data:') && !val.startsWith('data:image/'))) {
              child.removeAttribute(attr.name);
              continue;
            }
          }
          cleanNode(child);
        }
      }
    }
  }
  cleanNode(temp);
  return temp.innerHTML;
}

function escapeHTML(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function processReplyContent(text) {
  if (!text || typeof text !== 'string') return '';
  let html = markdownToHTML(text);
  return sanitizeHTML(html);
}

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

/* =========================
   渲染邏輯
   ========================= */
function render() {
  if (!elMessages) return;
  elMessages.innerHTML = "";

  for (const m of messages) {
    const isUser = m.role === "user";
    const row = document.createElement("div");
    row.className = `msg ${isUser ? "user" : "bot"}`;

    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.src = isUser
      ? "https://raw.githubusercontent.com/justin-321-hub/standard_chartered_taipei_charity_marathon/refs/heads/main/assets/user.png"
      : "https://raw.githubusercontent.com/justin-321-hub/standard_chartered_taipei_charity_marathon/refs/heads/main/assets/S__53714948.png";
    avatar.alt = isUser ? "you" : "bot";

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (isUser) {
      bubble.innerHTML = escapeHTML(m.text);
    } else {
      bubble.innerHTML = processReplyContent(m.text);
    }

    row.appendChild(avatar);
    row.appendChild(bubble);
    elMessages.appendChild(row);
  }
  scrollToBottom();
}

/* =========================
   送出訊息邏輯
   ========================= */
async function sendText(text) {
  const content = (text ?? elInput?.value ?? "").trim();
  if (!content) return;

  const userMsg = { id: uid(), role: "user", text: content, ts: Date.now(), isHtml: false };
  messages.push(userMsg);
  if (elInput) elInput.value = "";
  render();
  setThinking(true);

  try {
    const res = await fetch(api("/api/chat"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": clientId,
      },
      body: JSON.stringify({ 
        text: content, 
        clientId, 
        language: "英文", // 修改：將語言設定為英文
        role:"user"
      }),
    });

    const raw = await res.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { errorRaw: raw };
    }

    if (!res.ok) {
      if (res.status === 502 || res.status === 404) throw new Error("Network unstable, please try again!"); // 修改：英文錯誤訊息
      const serverMsg = (data && (data.error || data.body || data.message)) ?? raw ?? "unknown error";
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${serverMsg}`);
    }

    let replyText;
    if (typeof data === "string") {
      replyText = data.trim() || "(Empty response)"; // 修改：英文空白回覆提示
    } else if (data && (data.text || data.message)) {
      replyText = String(data.text || data.message);
    } else {
      const isPlainEmptyObject = data && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0;
      replyText = isPlainEmptyObject ? "Network unstable, please try again" : JSON.stringify(data, null, 2); // 修改：英文錯誤訊息
    }

    const botMsg = { id: uid(), role: "assistant", text: replyText, ts: Date.now(), isHtml: true };
    messages.push(botMsg);
    setThinking(false);
    render();

  } catch (err) {
    setThinking(false);
    // 修改：英文離線提示
    const friendly = (!navigator.onLine && "You are currently offline. Please check your network connection and try again.") || `${err?.message || err}`;
    const botErr = { id: uid(), role: "assistant", text: friendly, ts: Date.now(), isHtml: true };
    messages.push(botErr);
    render();
  }
}

// 事件綁定
elBtnSend?.addEventListener("click", () => sendText());
elInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendText();
  }
});
window.addEventListener("load", () => elInput?.focus());

// 歡迎訊息 (英文)
messages.push({
  id: uid(),
  role: "assistant",
  text: "Hi, I am **Sky**. I love running, I am passionate about charity and full of positive energy. I know every detail of the event inside out and hope to use my expertise to meet your service needs.\n\nIf you have any questions about the **Standard Chartered Taipei Charity Marathon**, feel free to ask me!",
  ts: Date.now(),
  isHtml: true
});
render();
