// ============================================================
// 和後端（Cloudflare Worker）溝通
// ============================================================
import { CONFIG } from './config.js';

export const isDemo = () => !CONFIG.API_BASE || !/^https?:\/\//.test(CONFIG.API_BASE);

// ---- 方案與密碼 ----
export function getTier() {
  try { return localStorage.getItem('tier') === 'paid' ? 'paid' : 'free'; } catch { return 'free'; }
}
export function setTier(tier) {
  try { localStorage.setItem('tier', tier); } catch {}
}
export function getPassword() {
  try { return sessionStorage.getItem('paidPw') || localStorage.getItem('paidPw') || ''; } catch { return ''; }
}
export function setPassword(pw, remember) {
  try {
    sessionStorage.setItem('paidPw', pw);
    if (remember) localStorage.setItem('paidPw', pw);
    else localStorage.removeItem('paidPw');
  } catch {}
}
export function clearPassword() {
  try { sessionStorage.removeItem('paidPw'); localStorage.removeItem('paidPw'); } catch {}
}

async function post(path, body, { tier = getTier(), password = getPassword() } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (tier === 'paid') headers['X-Access-Password'] = encodeURIComponent(password); // 編碼後才能放中文密碼
  let res;
  try {
    res = await fetch(CONFIG.API_BASE.replace(/\/$/, '') + path, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, tier }),
    });
  } catch {
    throw new Error('連不到後端伺服器，請檢查網路或 Worker 網址');
  }
  let data = {};
  try { data = JSON.parse((await res.text()).trim() || '{}'); } catch {}
  if (!res.ok || data.error) {
    const status = data.status || res.status;
    const msg = data.error
      || (status === 524 ? 'AI 批改太久，連線逾時了，請再試一次（照片少一點會比較快）' : `伺服器錯誤（${status}）`);
    const err = new Error(msg);
    err.status = status;
    err.code = data.code;
    throw err;
  }
  return data;
}

export async function verifyPassword(password) {
  if (isDemo()) {
    await sleep(500);
    return true;
  }
  await post('/api/verify', {}, { tier: 'paid', password });
  return true;
}

function splitDataURL(dataURL) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataURL);
  return m ? { mime: m[1], data: m[2] } : null;
}

export async function gradeEssay(essay) {
  if (isDemo()) {
    await sleep(1800);
    return essay.subject === 'en' ? DEMO_EN : DEMO_ZH;
  }
  const data = await post('/api/grade', {
    subject: essay.subject,
    note: essay.note,
    essayImages: essay.essayImages.map(splitDataURL).filter(Boolean),
    topicImages: essay.topicImages.map(splitDataURL).filter(Boolean),
  });
  return data.result;
}

export async function chatAboutEssay(essay, message) {
  if (isDemo()) {
    await sleep(900);
    return `**（示範模式回覆）**\n\n你問的是：「${message.slice(0, 60)}」\n\n連接後端之後，AI 會根據這篇作文的批改結果回答你，例如：\n- 解釋為什麼某一項被扣分\n- 示範改寫某一段\n- 給你其他的開頭寫法`;
  }
  const r = essay.result || {};
  const context = {
    科目: essay.subject === 'en' ? '英文作文' : '國寫',
    標題: essay.title,
    學生備註: essay.note,
    題目: r.topic_text,
    作文原文: r.transcription,
    批改結果: {
      分數: r.score,
      各項得分: r.breakdown,
      扣分: r.deductions,
      評語: r.comments,
      可進步之處: r.improvements,
      滿分改寫: r.rewrite,
    },
    學生自己的筆記: essay.myNotes,
  };
  const history = essay.chat.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
  const data = await post('/api/chat', { subject: essay.subject, context, history, message });
  return data.reply;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// 示範模式的假資料（讓你在接上後端前先看到介面長什麼樣子）
// ============================================================
const DEMO_ZH = {
  topic_text: '（示範）第二大題 情意題：以「我與＿＿＿的距離」為題，寫一篇文章，敘述你與某人、某物或某種狀態之間的距離變化，並抒發感受與體悟。文長不限。（25 分）',
  transcription: '我與外婆的距離\n\n小時候，外婆家是暑假的同義詞。巷口的榕樹下，她總搖著蒲扇，等我從公車上跳下來……\n\n上了高中，補習班的時間表把週末切得細碎，我和外婆的通話從一小時縮成三分鐘……\n\n直到那天，我在她的抽屜裡發現一疊剪報，全是我小學得獎的作文。',
  word_count: 642,
  score: { total: 18, max: 25, level: 'A', summary: '情感真摯、結構穩妥，結尾體悟可再深化。' },
  breakdown: [
    { item: '第二大題（情意題）', score: 18, max: 25, level: 'A', comment: '能以「時間表切碎週末」具體呈現距離拉遠的過程，剪報的細節安排有力；但第三段由事件轉入體悟時略顯倉促，「距離」的意涵停留在物理與時間層面，未能進一步省思自我。' },
  ],
  deductions: [{ reason: '錯別字 2 處（「在接再厲」、「迫不急待」）', points: 0.5 }],
  comments: {
    overall: '這篇文章最大的優點是「以小見大」：蒲扇、榕樹、剪報這些物件讓情感有了落腳處，讀者能感受到你和外婆之間的溫度變化。結構上採「過去—現在—轉折」的安排清楚穩妥。若想從 A 進到 A+，關鍵在結尾：目前的體悟停在「我要多陪外婆」，比較常見；可以再往內挖一層，思考距離其實是自己選擇的結果，或是外婆一直用她的方式在縮短距離。',
    strengths: ['善用具體物件承載情感（蒲扇、剪報）', '段落安排有時間推進，結構清楚', '語言自然不做作'],
    weaknesses: ['結尾體悟較淺，缺乏自我省思的層次', '第三段轉折太快，情感醞釀不足', '有 2 處錯別字'],
  },
  improvements: [
    { category: '論述深度', severity: '高', original: '我發現我應該多陪陪外婆。', suggestion: '原來距離從來不是時間表造成的，而是我默默把她排在了「有空再說」的那一格；而她，卻一直把我放在抽屜最上層。', explanation: '把體悟從「應該做什麼」轉為「看見自己」，是情意題拿 A+ 的關鍵：閱卷老師要看的是自我省思的深度。' },
    { category: '段落銜接', severity: '中', original: '直到那天，我在她的抽屜裡發現一疊剪報。', suggestion: '那天外婆午睡，我替她找老花眼鏡，拉開抽屜時，一疊泛黃的剪報滑了出來。', explanation: '轉折前多一個生活化的動作，讓發現顯得自然，也增加畫面感。' },
    { category: '錯別字', severity: '低', original: '在接再厲', suggestion: '再接再厲', explanation: '錯別字會被斟酌扣分，考前要整理自己常寫錯的字。' },
    { category: '修辭文采', severity: '中', original: '我和外婆的通話從一小時縮成三分鐘。', suggestion: '電話那頭的「吃飽沒」，從一小時的絮叨，縮成三分鐘的例行公事。', explanation: '加入外婆的口頭禪，讓數字變化帶有情感溫度。' },
    { category: '題目要求', severity: '中', original: '（全文）', suggestion: '在文中至少一次明確點出「距離」的轉變：從遠到近或從近到遠。', explanation: '題目要求敘述距離的「變化」，要讓閱卷老師一眼看到你有扣題。' },
  ],
  rewrite: {
    text: '我與外婆的距離\n\n小時候，外婆家是暑假的同義詞。巷口那棵老榕樹下，她總搖著蒲扇，等我從公車階梯上一躍而下……\n\n（示範模式：這裡會是完整的 A+ 改寫範文）',
    highlights: ['開頭保留榕樹與蒲扇的畫面，但加入動作讓場景更立體', '新增「有空再說」的自我省思，提升體悟層次', '結尾回扣抽屜意象，首尾呼應'],
  },
  notes: [
    { title: '情意題拿 A+ 的關鍵', points: ['事件要具體，用物件承載情感', '體悟要「向內看」：看見自己的改變或盲點', '首尾呼應讓結構完整'] },
    { title: '本篇可以帶走的寫法', points: ['用數字變化寫關係變化（一小時→三分鐘）', '用「抽屜」這種私密空間呈現對方隱藏的心意'] },
    { title: '常錯字整理', points: ['再接再厲（不是「在」）', '迫不及待（不是「急」）'] },
  ],
};

const DEMO_EN = {
  topic_text: '（示範）Write an essay of at least 120 words. In the first paragraph, describe a time when you helped someone. In the second paragraph, explain what you learned from the experience.',
  transcription: 'Last summer, I helped an old man in the MRT station. He is carrying a heavy bag and looked very tired...\n\nFrom this experience, I learned that helping others can make me happy...',
  word_count: 156,
  score: { total: 14, max: 20, level: '可', summary: '內容切題完整，但時態錯誤與中式英文影響分數。' },
  breakdown: [
    { item: '內容 Content', score: 4, max: 5, level: '', comment: '兩段都有回應題目要求，第一段情境具體；第二段的體悟稍嫌籠統（helping others can make me happy）。' },
    { item: '組織 Organization', score: 4, max: 5, level: '', comment: '段落分明，有使用 First / Then 等轉承語，但第二段缺少結尾句。' },
    { item: '文法句構 Grammar', score: 2, max: 4, level: '', comment: '過去時態不一致（He is carrying → was carrying），且句型多為簡單句。' },
    { item: '字彙拼字 Vocabulary', score: 3, max: 4, level: '', comment: '用字大致正確，但 "very tired"、"very happy" 重複，可替換為 exhausted、fulfilled。' },
    { item: '體例 Mechanics', score: 1, max: 2, level: '', comment: '第二段未縮排，有一處逗號連接兩個完整句子（comma splice）。' },
  ],
  deductions: [],
  comments: {
    overall: '內容切題、故事完整，是這篇的基本盤。要往「優」邁進，最需要處理的是時態一致性和句型變化：敘述過去經驗時全文要用過去式，並嘗試加入分詞構句、關係子句等複句。第二段的體悟可以更具體，說明「為什麼」幫助別人讓你有收穫。',
    strengths: ['兩段皆切題', '情境描寫具體（MRT station, heavy bag）'],
    weaknesses: ['時態不一致', '句型單調、重複使用 very', '第二段缺乏具體說明'],
  },
  improvements: [
    { category: '文法', severity: '高', original: 'He is carrying a heavy bag and looked very tired.', suggestion: 'He was carrying a heavy bag and looked exhausted.', explanation: '敘述過去事件，動詞要統一用過去式；very tired 可換成更精確的 exhausted。' },
    { category: '中式英文', severity: '中', original: 'helping others can make me happy', suggestion: 'lending a hand to others gives me a sense of fulfillment', explanation: '「讓我快樂」直譯較平淡，用 sense of fulfillment 更道地也更有層次。' },
    { category: '句構', severity: '中', original: 'I saw him. I decided to help him.', suggestion: 'Seeing him struggle, I decided to give him a hand.', explanation: '用分詞構句合併兩個簡單句，展現句型變化。' },
  ],
  rewrite: {
    text: 'Last summer, while I was transferring trains at Taipei Main Station, I noticed an elderly man struggling with a heavy suitcase...\n\n(示範模式：這裡會是完整的特優改寫範文)',
    highlights: ['統一使用過去式並加入過去進行式營造情境', '第二段用具體反思取代 make me happy'],
  },
  notes: [
    { title: '好用的轉承語', points: ['To begin with / What is more / As a result', 'Looking back, I realize that…'] },
    { title: '本篇文法重點', points: ['敘事文時態統一用過去式', '避免 comma splice：兩個完整句子之間用句號或連接詞'] },
  ],
};