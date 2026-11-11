/**
 * 作文批改室 — 後端（Cloudflare Worker）
 * ------------------------------------------------------------
 * 這個檔案負責：
 *   1. 把你的 API key 藏在伺服器端（網頁原始碼裡看不到）
 *   2. 付費方案的密碼驗證（在伺服器端比對，別人無法繞過）
 *   3. 學測評分標準的提示詞，以及呼叫 AI 模型
 *
 * 需要在 Cloudflare 後台設定的「變數 / 秘密」（Settings → Variables and Secrets）：
 *   FREE_API_KEY     （Secret）免費那組 key
 *   PAID_API_KEY     （Secret）付費那組 key
 *   PAID_PASSWORDS   （Secret）付費方案的密碼，可以設多組，用逗號分隔，例如：  abc123,好朋友專用
 *   FREE_PROVIDER    （選填）gemini / openai / anthropic，預設 gemini
 *   PAID_PROVIDER    （選填）同上，預設 gemini
 *   FREE_MODEL       （選填）模型名稱，預設 gemini-flash-latest
 *   PAID_MODEL       （選填）模型名稱
 *   OPENAI_BASE_URL  （選填）使用 OpenAI 相容服務時的網址
 *   ALLOWED_ORIGINS  （建議）你的網站網址，例如 https://你的帳號.github.io  （多個用逗號分隔）
 */

// 版本號：打開 Worker 網址會顯示，用來確認 Cloudflare 上跑的是不是最新版
const VERSION = '2026-11-11 v4（含健康檢查）';

// ============================================================
// 一、學測評分標準（提示詞）
// ============================================================

const OUTPUT_SCHEMA = `
【輸出格式】只輸出一個 JSON 物件，不要有任何其他文字、不要用 \`\`\` 包起來。欄位如下：
{
  "topic_text": "題目內容辨識與整理（含各小題要求、字數限制、配分；若配分是推定的請註明）",
  "transcription": "學生作文逐字辨識結果，保留分段（用 \\n 換行）。看不清楚的字用［？］標示。若有多個小題，用「（一）」「（二）」標示",
  "word_count": 數字（國文算字數、英文算單詞數）,
  "score": {
    "total": 數字（總分）,
    "max": 數字（滿分）,
    "level": "總等級（國文如 A、B+；英文如 優、可）",
    "summary": "一句話總評（30 字內）"
  },
  "breakdown": [
    { "item": "評分項目或小題名稱", "score": 數字, "max": 數字, "level": "該項等級", "comment": "給分理由（具體指出作文中的表現）" }
  ],
  "deductions": [ { "reason": "斟酌扣分原因", "points": 數字 } ],
  "comments": {
    "overall": "整體評語（150～300 字，像閱卷老師寫給學生的話）",
    "strengths": ["優點 1", "優點 2"],
    "weaknesses": ["主要問題 1", "主要問題 2"]
  },
  "improvements": [
    {
      "category": "類別",
      "severity": "高 / 中 / 低（對分數影響程度）",
      "original": "學生原句（逐字引用；若是整體結構問題可寫段落位置）",
      "suggestion": "修改後的寫法",
      "explanation": "為什麼要這樣改、改了對分數有什麼幫助"
    }
  ],
  "rewrite": {
    "text": "滿分改寫全文（用 \\n 分段）",
    "highlights": ["改寫重點 1：說明改了什麼、為什麼", "改寫重點 2"]
  },
  "notes": [
    { "title": "筆記主題", "points": ["重點 1", "重點 2"] }
  ]
}
deductions 沒有就給空陣列。improvements 請給 5～10 條，依影響程度由高到低排列。notes 給 3～5 則。
`;

const ZH_SYSTEM = `你是大學入學考試中心「國語文寫作能力測驗」（學測國寫）的資深閱卷委員，熟悉歷屆評分原則與閱卷流程。請根據學生上傳的題目照片與作文照片，完全依照學測國寫的方式評分。

【測驗架構】
- 國寫共兩大題，各 25 分，合計 50 分。
- 第一大題「知性題」：評量知性的統整判斷能力——能否正確理解引文或圖表、統整資訊、分析說明、提出有理據的見解，具邏輯思辨。
- 第二大題「情意題」：評量情意的感受抒發能力——能否體察情感、連結個人經驗、自我省思、想像創發，敘寫具體細膩。
- 每大題通常分為小題（例如：問題（一）4 分、問題（二）21 分），配分以題目上標示為準。

【評分流程】先判定「等」（A、B、C），再決定「級」，最後選定分數。
25 分的題目級距：
- A+ 22–25｜A 18–21｜B+ 14–17｜B 10–13｜C+ 6–9｜C 1–5｜0 分：空白、文不對題、或僅抄錄題幹。
小題配分不是 25 分時依比例換算，例如 21 分小題：A+ 19–21、A 15–18、B+ 12–14、B 8–11、其餘依比例。
短答小題（約 3–6 分）採 A、B、C 三等，例如 4 分題：A 等 3–4 分、B 等 2 分、C 等 1 分。

【各級描述】
知性題：
- A+：精確掌握材料與題旨，論述深刻、言之有物，條理分明，文辭洗練，具思辨深度。
- A：能掌握題旨，條理分明，論述清晰，文辭暢達。
- B+：大致掌握題旨，論述合理，文辭得宜。
- B：大致掌握但說明欠具體，論述普通，文辭平順。
- C+：稍能觸及題旨，內容空洞，結構鬆散，文辭欠通順。
- C：敘寫雜亂，文句不通。
情意題：
- A+：切合題旨，敘寫細膩，情感真摯，體悟深刻，結構嚴謹，文辭優美。
- A：切合題旨，敘寫生動，結構穩妥，文辭順暢。
- B+：大致切題，敘寫平實，結構適當，文辭平順。
- B：敘寫平淡，結構大致合宜，文辭大致通順。
- C+：稍能觸及題旨，內容空洞，結構鬆散，文辭欠通順。
- C：敘寫雜亂，文句不通。

【斟酌扣分】視標點符號使用、錯別字多寡、字數是否符合要求、是否遵守作答規定（如未依小題分別作答、未依指示訂題目），斟酌扣分，並列在 deductions。

【判斷題目】
- 先辨識題目屬於知性題或情意題、有幾個小題、各小題配分與要求。
- 若學生只寫一大題，滿分 25；若兩大題都有，分別評分，滿分 50。
- 若沒有題目照片，依作文內容推斷題型，並在 topic_text 註明「未提供題目，題目為推定」。
- 若照片看不清配分，採大考常見配分並註明「配分為推定」。

【評分態度】
- 模擬真實閱卷委員，嚴格而公允，不灌水、不給人情分。A+ 只給真正出色的作品；一般高中生多落在 B 到 A 之間。
- breakdown 請以「小題」為單位（例如「問題（一）」「問題（二）」），每一項 comment 都要指出作文中的具體表現。
- 不因字跡美醜扣分；無法辨識的字以［？］標示，不要猜測後當錯別字扣分。

【改進建議】category 請用：立意取材、論述深度、結構組織、段落銜接、修辭文采、用字遣詞、錯別字、標點符號、題目要求。要引用原句並給出改寫。

【滿分改寫】保留學生原本的立意、素材與優點，改寫成 A+ 水準的示範，符合題目字數要求；有小題時分別以「（一）」「（二）」標示。

【筆記】整理可以帶走的寫作能力：此題型的答題策略、可用的論證方法或描寫技巧、值得記下的詞語與佳句。

全部使用繁體中文（臺灣用語）。
${OUTPUT_SCHEMA}`;

const EN_SYSTEM = `You are a senior grader for the English Composition (英文作文) section of Taiwan's General Scholastic Ability Test (學測), organized by the College Entrance Examination Center (大考中心). Grade the student's essay exactly the way 學測 graders do.

【學測英文作文評分方式】
- 滿分 20 分，採分項式評分（analytic scoring）後給予整體分數：
  • 內容 Content（5 分）：主題是否清楚切題、是否完整回應題目每一項要求（例如每段指定的重點）、是否有充分具體的細節與說明支持。
  • 組織 Organization（5 分）：重點分明，有開頭、發展、結尾；段落安排合理；句與句、段與段之間連貫，轉承語恰當。
  • 文法句構 Grammar & Sentence Structure（4 分）：文法正確，句構有變化且適切。
  • 字彙拼字 Vocabulary & Spelling（4 分）：用字精確、得宜，拼字正確。
  • 體例 Mechanics（2 分）：格式（分段、縮排、信件格式等）、標點符號、大小寫正確。
- 總分等級：特優 19–20｜優 15–18｜可 10–14｜差 5–9｜劣 0–4。
- 字數：題目通常要求至少 120 個單詞（或依題目規定）。字數明顯不足者扣總分 1 分（列在 deductions）。
- 未依題目要求（如題目指定兩段、每段要寫的重點、信件署名用指定名字）會影響內容分；完全離題或空白給 0 分。
- 若沒有題目照片，依作文內容推斷題目，並在 topic_text 註明「未提供題目，題目為推定」。

【評分態度】
- 模擬真實閱卷委員，嚴格而公允，不灌水。特優只給真正出色、幾乎沒有錯誤的作品。
- breakdown 固定為五項：內容、組織、文法句構、字彙拼字、體例（item 用中文名稱加英文，如「內容 Content」），每項 comment 都要舉出作文中的具體例子。
- 中式英文（Chinglish）、時態不一致、主詞動詞一致、冠詞、介系詞、run-on sentence、fragment 等常見錯誤要特別指出。

【改進建議】category 請用：內容、組織、文法、句構、字彙、拼字、中式英文、標點體例、題目要求。original 逐字引用學生原句，suggestion 給正確且道地的寫法，explanation 用繁體中文說明。

【滿分改寫】rewrite.text 用英文，保留學生原本的想法與架構，改寫成特優（19–20 分）水準、符合題目段落與字數要求的範文。rewrite.highlights 用繁體中文說明改寫重點。

【筆記】用繁體中文整理，可包含：此題型的寫作策略、好用的轉承語、值得背的片語與句型（附例句）、本篇最常犯的文法觀念。

所有說明、評語、筆記使用繁體中文（臺灣用語）；英文例句維持英文。
${OUTPUT_SCHEMA}`;

function chatSystem(subject) {
  const subjectName = subject === 'en' ? '學測英文作文' : '學測國寫';
  return `你是一位熟悉${subjectName}評分標準的閱卷老師，也是這位學生的專屬家教。學生正在和你討論「同一篇作文」，下方附有這篇作文的題目、原文辨識、以及先前的批改結果。

請遵守：
- 根據下方資料回答，不要捏造作文裡沒有的內容。
- 可以：解釋扣分原因、示範改寫某一句或某一段、提供不同的開頭或結尾、補充相關的寫作技巧、出類似的練習題。
- 如果學生不同意分數，依照學測評分標準理性說明；若學生的理由確實合理，可以承認並說明調整後大約會落在哪一級。
- 回答要清楚好讀：使用 Markdown（小標題、條列、粗體），篇幅適中，不要一大段文字。
- ${subject === 'en' ? '說明用繁體中文，英文例句用英文。' : '使用繁體中文（臺灣用語）。'}`;
}

// ============================================================
// 二、主程式（處理網頁送來的請求）
// ============================================================

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/') {
        return json({ ok: true, message: '作文批改室後端運作中 ✅', version: VERSION }, 200, cors);
      }
      if (request.method === 'GET' && url.pathname === '/debug') return debug(url, env);
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);
      if (!isOriginAllowed(origin, env)) return json({ error: '這個網站來源沒有被允許使用（請檢查 ALLOWED_ORIGINS）' }, 403, cors);

      const body = await request.json().catch(() => null);
      if (!body) return json({ error: '請求格式錯誤' }, 400, cors);

      const tier = body.tier === 'paid' ? 'paid' : 'free';
      if (tier === 'paid' && !checkPassword(request.headers.get('X-Access-Password'), env)) {
        return json({ error: '付費方案密碼錯誤', code: 'BAD_PASSWORD' }, 401, cors);
      }

      if (url.pathname === '/api/verify') return json({ ok: true }, 200, cors);

      const llm = getLLM(tier, env);
      // 批改和對話可能超過 100 秒，用「邊等邊回報」的方式回應，避免 Cloudflare 524 逾時
      if (url.pathname === '/api/grade') return streamJSON(() => grade(body, llm), cors, ctx);
      if (url.pathname === '/api/chat') return streamJSON(() => chat(body, llm), cors, ctx);

      return json({ error: 'Not found' }, 404, cors);
    } catch (err) {
      return json({ error: err.message || String(err) }, err.status || 500, cors);
    }
  },
};

// ---------- 健康檢查：/debug?pw=付費密碼 ----------
// 顯示目前的設定（key 只顯示最後 4 碼），並用兩組 key 各實際呼叫一次 Gemini，回報 Google 的原始結果
async function debug(url, env) {
  const out = (data, status = 200) =>
    new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  if (!checkPassword(encodeURIComponent(url.searchParams.get('pw') || ''), env)) {
    return out({ error: '請在網址後面加上 ?pw=你的付費密碼' }, 401);
  }
  const tail = (k) => (k ? `…${String(k).trim().slice(-4)}（長度 ${String(k).length}${/\s/.test(k) ? '，⚠️ 含有空白或換行！' : ''}）` : '❌ 未設定');
  const report = { version: VERSION, settings: {}, tests: {} };
  for (const P of ['FREE', 'PAID']) {
    const provider = (env[`${P}_PROVIDER`] || 'gemini').toLowerCase();
    const model = env[`${P}_MODEL`] || (provider === 'gemini' ? 'gemini-flash-latest' : '(未設定)');
    report.settings[P] = { provider, model, key: tail(env[`${P}_API_KEY`]) };
    if (provider !== 'gemini' || !env[`${P}_API_KEY`]) continue;
    const t0 = Date.now();
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': String(env[`${P}_API_KEY`]).trim() },
          body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: '只回覆兩個字：正常' }] }] }),
        }
      );
      const raw = await res.text();
      let d = {};
      try { d = JSON.parse(raw); } catch {}
      report.tests[P] = res.ok
        ? { 結果: '✅ 成功', 秒數: (Date.now() - t0) / 1000, 回覆: (d.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').slice(0, 50) }
        : { 結果: `❌ 失敗（HTTP ${res.status}）`, Google原文: d.error?.message || raw.slice(0, 800), 狀態: d.error?.status, 詳細: d.error?.details };
    } catch (e) {
      report.tests[P] = { 結果: '❌ 連不到 Google', 錯誤: String(e) };
    }
  }
  report.settings.PAID_PASSWORDS = `已設定 ${String(env.PAID_PASSWORDS || '').split(',').filter((s) => s.trim()).length} 組`;
  report.settings.ALLOWED_ORIGINS = env.ALLOWED_ORIGINS || '（未設定，目前所有網站都能用）';
  return out(report);
}

// 先立刻回應網頁，AI 還在想的時候每 5 秒送一個空白字元保持連線，做完再送出結果
function streamJSON(work, cors, ctx) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  writer.write(enc.encode(' ')).catch(() => {});
  const beat = setInterval(() => writer.write(enc.encode(' ')).catch(() => {}), 5000);

  const job = (async () => {
    let payload;
    try {
      payload = await work();
    } catch (err) {
      payload = { error: err.message || String(err), status: err.status || 500 };
    }
    clearInterval(beat);
    try {
      await writer.write(enc.encode(JSON.stringify(payload)));
      await writer.close();
    } catch {}
  })();
  ctx?.waitUntil?.(job);

  return new Response(readable, {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });
}

// ---------- 批改 ----------
async function grade(body, llm) {
  const subject = body.subject === 'en' ? 'en' : 'zh';
  const essayImages = cleanImages(body.essayImages);
  const topicImages = cleanImages(body.topicImages);
  if (essayImages.length === 0) throw httpError(400, '請至少上傳一張作文照片');
  if (essayImages.length + topicImages.length > 12) throw httpError(400, '照片太多了（最多 12 張）');

  const parts = [];
  if (topicImages.length) {
    parts.push({ text: `以下是【題目照片】，共 ${topicImages.length} 張：` });
    topicImages.forEach((img) => parts.push(img));
  } else {
    parts.push({ text: '（學生沒有提供題目照片。）' });
  }
  parts.push({ text: `以下是【學生作文照片】，共 ${essayImages.length} 張，依頁序排列：` });
  essayImages.forEach((img) => parts.push(img));
  const note = String(body.note || '').trim().slice(0, 2000);
  parts.push({ text: note ? `學生備註：${note}` : '學生沒有填寫備註。' });
  parts.push({ text: '請依照系統指示完成批改，只輸出 JSON。' });

  const system = subject === 'en' ? EN_SYSTEM : ZH_SYSTEM;
  const raw = await llm({ system, messages: [{ role: 'user', parts }], json: true });

  let result = parseJSON(raw);
  if (!result) {
    // 模型偶爾輸出格式不完整，請它修正一次
    const fixed = await llm({
      system: '你是 JSON 修復工具。把使用者給的內容修正成合法的 JSON 物件後輸出，只輸出 JSON。',
      messages: [{ role: 'user', parts: [{ text: raw.slice(0, 60000) }] }],
      json: true,
    });
    result = parseJSON(fixed);
  }
  if (!result) throw httpError(502, 'AI 回傳的格式有誤，請再試一次');
  return { result: normalizeResult(result, subject) };
}

// ---------- 對話 ----------
async function chat(body, llm) {
  const subject = body.subject === 'en' ? 'en' : 'zh';
  const message = String(body.message || '').trim();
  if (!message) throw httpError(400, '訊息是空的');

  const context = body.context || {};
  const contextText = JSON.stringify(context).slice(0, 60000);
  const system = `${chatSystem(subject)}\n\n【這篇作文的資料】\n${contextText}`;

  const history = Array.isArray(body.history) ? body.history.slice(-30) : [];
  const messages = [];
  for (const m of history) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const text = String(m.content || '').slice(0, 8000);
    if (!text) continue;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.parts[0].text += `\n\n${text}`; // 合併連續同角色訊息
    else messages.push({ role, parts: [{ text }] });
  }
  if (messages.length && messages[0].role === 'assistant') messages.shift();
  const last = messages[messages.length - 1];
  if (last && last.role === 'user') last.parts[0].text += `\n\n${message}`;
  else messages.push({ role: 'user', parts: [{ text: message.slice(0, 8000) }] });

  const reply = await llm({ system, messages, json: false });
  return { reply: reply.trim() };
}

// ============================================================
// 三、AI 模型呼叫（支援 Gemini / OpenAI / Anthropic）
// ============================================================

function getLLM(tier, env) {
  const P = tier === 'paid' ? 'PAID' : 'FREE';
  const provider = (env[`${P}_PROVIDER`] || 'gemini').toLowerCase().trim();
  const apiKey = String(env[`${P}_API_KEY`] || '').trim(); // 去掉貼上時多出來的空白、換行
  if (!apiKey) throw httpError(500, `後端尚未設定 ${P}_API_KEY`);

  const defaults = { gemini: 'gemini-flash-latest', anthropic: 'claude-sonnet-5-5' };
  const model = (env[`${P}_MODEL`] || defaults[provider] || '').trim();
  if (!model) throw httpError(500, `請在後端設定 ${P}_MODEL（模型名稱）`);

  const callers = { gemini: callGemini, openai: callOpenAI, anthropic: callAnthropic };
  const caller = callers[provider];
  if (!caller) throw httpError(500, `不支援的 provider：${provider}`);
  return (args) => caller({ ...args, apiKey, model, env });
}

async function callGemini({ apiKey, model, system, messages, json }) {
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: m.parts.map((p) => (p.text != null ? { text: p.text } : { inline_data: { mime_type: p.mime, data: p.data } })),
  }));
  // 用串流模式（streamGenerateContent）：Gemini 邊想邊回傳，
  // 連線一直有資料在跑，就不會因為超過 100 秒沒回應而被 Cloudflare 中斷（524）
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: {
          temperature: json ? 0.3 : 0.7,
          maxOutputTokens: 32768,
          ...(json ? { responseMimeType: 'application/json' } : {}),
          // 讓「思考過程」也串流回來，思考很久時連線才不會閒置
          ...(/gemini-(1\.|2\.0)/.test(model) ? {} : { thinkingConfig: { includeThoughts: true } }),
        },
      }),
    }
  );
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    let msg = '';
    try {
      const d = JSON.parse(raw);
      msg = (Array.isArray(d) ? d[0] : d)?.error?.message || '';
    } catch {}
    throw apiError('Gemini', res.status, msg || raw.slice(0, 200));
  }

  // 讀取 SSE 串流：每一行 "data: {...}" 是一小段結果
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason = '';
  let blockReason = '';
  const handleLine = (line) => {
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let chunk;
    try { chunk = JSON.parse(payload); } catch { return; }
    if (chunk.error) throw apiError('Gemini', chunk.error.code || 502, chunk.error.message);
    const cand = chunk.candidates?.[0];
    for (const p of cand?.content?.parts || []) if (!p.thought && p.text) text += p.text;
    if (cand?.finishReason) finishReason = cand.finishReason;
    if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, i).trim());
      buffer = buffer.slice(i + 1);
    }
  }
  handleLine(buffer.trim());

  if (!text) throw httpError(502, `AI 沒有回傳內容（${finishReason || blockReason || '未知原因'}）`);
  if (finishReason === 'MAX_TOKENS' && json) throw httpError(502, '批改內容太長被截斷了，請再試一次');
  return text;
}

async function callOpenAI({ apiKey, model, system, messages, json, env }) {
  const base = (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const msgs = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'assistant') {
      msgs.push({ role: 'assistant', content: m.parts.map((p) => p.text || '').join('\n') });
    } else {
      msgs.push({
        role: 'user',
        content: m.parts.map((p) =>
          p.text != null
            ? { type: 'text', text: p.text }
            : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } }
        ),
      });
    }
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: msgs, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError('OpenAI', res.status, data?.error?.message);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw httpError(502, 'AI 沒有回傳內容');
  return text;
}

async function callAnthropic({ apiKey, model, system, messages }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      system,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.parts.map((p) =>
          p.text != null
            ? { type: 'text', text: p.text }
            : { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } }
        ),
      })),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw apiError('Anthropic', res.status, data?.error?.message);
  const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text) throw httpError(502, 'AI 沒有回傳內容');
  return text;
}

// ============================================================
// 四、小工具
// ============================================================

function cleanImages(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((img) => img && typeof img.data === 'string' && /^image\/(jpeg|png|webp|gif)$/.test(img.mime))
    .map((img) => ({ mime: img.mime, data: img.data }));
}

function parseJSON(text) {
  if (!text) return null;
  let t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(t.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeResult(r, subject) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const score = r.score || {};
  return {
    topic_text: String(r.topic_text || ''),
    transcription: String(r.transcription || ''),
    word_count: num(r.word_count, 0),
    score: {
      total: num(score.total),
      max: num(score.max, subject === 'en' ? 20 : 25),
      level: String(score.level || ''),
      summary: String(score.summary || ''),
    },
    breakdown: arr(r.breakdown).map((b) => ({
      item: String(b.item || ''),
      score: num(b.score),
      max: num(b.max, 1),
      level: String(b.level || ''),
      comment: String(b.comment || ''),
    })),
    deductions: arr(r.deductions).map((d) => ({ reason: String(d.reason || ''), points: num(d.points) })),
    comments: {
      overall: String(r.comments?.overall || ''),
      strengths: arr(r.comments?.strengths).map(String),
      weaknesses: arr(r.comments?.weaknesses).map(String),
    },
    improvements: arr(r.improvements).map((i) => ({
      category: String(i.category || '其他'),
      severity: String(i.severity || '中'),
      original: String(i.original || ''),
      suggestion: String(i.suggestion || ''),
      explanation: String(i.explanation || ''),
    })),
    rewrite: { text: String(r.rewrite?.text || ''), highlights: arr(r.rewrite?.highlights).map(String) },
    notes: arr(r.notes).map((n) => ({ title: String(n.title || ''), points: arr(n.points).map(String) })),
  };
}

function checkPassword(given, env) {
  try { given = decodeURIComponent(given || ''); } catch { return false; }
  const list = String(env.PAID_PASSWORDS || env.PAID_PASSWORD || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!given || list.length === 0) return false;
  return list.some((pw) => safeEqual(pw, given));
}

function safeEqual(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] || 0) ^ (eb[i] || 0);
  return diff === 0;
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

function isOriginAllowed(origin, env) {
  const list = allowedOrigins(env);
  if (list.length === 0) return true; // 還沒設定時先全部允許（上線後建議設定）
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true; // 本機測試
  return list.includes(origin);
}

function corsHeaders(origin, env) {
  return {
    'Access-Control-Allow-Origin': isOriginAllowed(origin, env) && origin ? origin : allowedOrigins(env)[0] || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Access-Password',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function apiError(name, status, msg) {
  if (status === 429) {
    const free = /free_tier|free tier/i.test(msg || '');
    return httpError(429, free
      ? `這組 API key 目前走的是「免費額度」，免費額度已用完或這個模型沒有免費額度。請確認 key 所在的專案有綁定帳單。（Google 原文：${(msg || '').slice(0, 300)}）`
      : `${name} 使用量達到上限，請等一兩分鐘再試。（Google 原文：${(msg || '').slice(0, 300)}）`);
  }
  if (status === 401 || status === 403) return httpError(502, `${name} API key 無效或沒有權限，請檢查後端設定`);
  if (status === 402) return httpError(502, `${name} 額度用完了，請到帳單頁面儲值`);
  if (status === 404) return httpError(502, `找不到模型，請檢查 Cloudflare 的 MODEL 名稱是否正確（${msg || ''}）`);
  if (status === 524 || status === 504) return httpError(504, `${name} 回應太久，請再試一次，或把 PAID_MODEL 改成 Flash 模型`);
  return httpError(502, `${name} 錯誤（${status}）：${msg || '未知錯誤'}`);
}