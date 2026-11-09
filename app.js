/* 고객 한마디 분류기 — 화면.
 *
 * 흐름: 문장 → 가림(mask.js, 브라우저 안) → AI(api/classify) → 실패하면 규칙(rules.js)
 * 채점: 정답 100건을 규칙으로, 또는 AI로(10건씩 열 번) 돌려 맞힌 비율을 잰다.
 */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const S = { criteria: null, test: [], practice: [], aiResults: null };

  async function load() {
    const [c, t, p] = await Promise.all([
      fetch("criteria.json").then(r => r.json()),
      fetch("data/answer100.json").then(r => r.json()),
      fetch("data/practice200.json").then(r => r.json()),
    ]);
    S.criteria = c; S.test = t; S.practice = p;
    renderCriteria();
  }

  // ── 탭 ──────────────────────────────────────────────
  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
    ["try", "score", "rules"].forEach(k => { $("#tab-" + k).hidden = k !== b.dataset.tab; });
  }));

  // ── AI 모델 고르기 ──────────────────────────────────
  // 목록 출처: https://aistudio.google.com/docs/pricing 의 «Free tier 무료» 텍스트 모델 (2026-11-09 확인).
  // 음성·번역·임베딩·TTS 는 뺐다. 이름과 무료 여부는 자주 바뀌니 가격표를 다시 본다.
  // ※ 순서는 «추정»이다 — 하루 무료 요청 수는 AI Studio 에 로그인해야 보이고 공식 문서에 표가 없어,
  //   한도가 높은 순서로 확인한 것이 아니다. 최신 세대 → 가벼운 모델 순으로 늘어놓았을 뿐이다.
  const MODELS = [
    { id: "gemini-3.8-flash",       note: "" },
    { id: "gemini-3.6-flash",       note: "이전 세대" },
    { id: "gemini-3.5-flash-lite",  note: "" },
    { id: "gemini-3.1-flash-lite",  note: "" },
    { id: "gemini-3-flash-preview", note: "프리뷰" },
  ];
  const CUSTOM = "__custom__";
  const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._\-]{0,63}$/;   // 서버(api/classify.py)와 같은 규칙
  const KEY_SEL = "classifier.model.select", KEY_TXT = "classifier.model.custom";
  const BATCH = 10;   // 채점할 때 한 번에 보내는 문장 수 (서버 MAX_TEXTS 는 20)
  let serverDefault = null;   // GET api/classify 로 알아낸 서버 기본 모델

  // localStorage 를 못 써도(시크릿 창 등) 앱은 그대로 돈다
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 못 써도 괜찮다 */ } }
  function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // 서버로 보낼 모델 이름. «서버 기본값»이면 빈 문자열
  function chosenModel() {
    const v = $("#model-select").value;
    return v === CUSTOM ? $("#model-custom").value.trim() : v;
  }

  function showModelNow() {
    const m = chosenModel(), v = $("#model-select").value;
    const custom = $("#model-custom");
    custom.hidden = v !== CUSTOM;
    custom.classList.toggle("bad", v === CUSTOM && m !== "" && !MODEL_RE.test(m));
    let t;
    if (m) t = `지금 호출하는 모델: ${m}`;
    else if (v === CUSTOM) t = "모델 이름을 입력하세요 (비워 두면 서버 기본값으로 호출합니다)";
    else t = "서버 기본값으로 호출합니다 — " + (serverDefault ? serverDefault : "기본 모델 이름은 서버가 있어야 알 수 있습니다");
    if (v === CUSTOM && !m) t += serverDefault ? ` — ${serverDefault}` : "";
    $("#model-now").textContent = t;
  }

  function initModelPicker() {
    const sel = $("#model-select");
    sel.innerHTML = `<option value="">서버 기본값</option>` +
      MODELS.map(m => `<option value="${m.id}">${m.id}${m.note ? " (" + m.note + ")" : ""}</option>`).join("") +
      `<option value="${CUSTOM}">직접 입력…</option>`;
    const saved = recall(KEY_SEL);
    if (saved !== null && [...sel.options].some(o => o.value === saved)) sel.value = saved;
    $("#model-custom").value = recall(KEY_TXT) || "";
    sel.addEventListener("change", () => { store(KEY_SEL, sel.value); showModelNow(); });
    $("#model-custom").addEventListener("input", () => { store(KEY_TXT, $("#model-custom").value); showModelNow(); });
    showModelNow();
    // 서버 기본 모델 이름 — 서버 함수가 없는 로컬에서는 실패해도 괜찮다
    fetch("api/classify").then(r => (r.ok ? r.json() : null)).then(j => {
      if (j && typeof j.default === "string") { serverDefault = j.default; showModelNow(); }
    }).catch(() => { /* 서버 함수 없음 */ });
  }

  // ── AI 호출 ─────────────────────────────────────────
  async function askAI(maskedTexts) {
    try {
      const r = await fetch("api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: maskedTexts, criteria: S.criteria, model: chosenModel() }),
      });
      if (!r.ok) return { results: null, reason: `서버 함수가 없습니다 (${r.status}) — 배포하면 생깁니다` };
      return await r.json();
    } catch (e) {
      return { results: null, reason: "서버 함수에 닿지 못했습니다" };
    }
  }

  function chips(el, res) {
    el.innerHTML = ["category", "sentiment", "urgency"]
      .map(k => `<span class="chip ${res[k]}">${res[k]}</span>`).join("");
  }

  // ── 분류해 보기 ─────────────────────────────────────
  $("#btn-sample").addEventListener("click", () => {
    const r = S.practice[Math.floor(Math.random() * S.practice.length)];
    $("#input").value = r.text;
  });

  $("#btn-classify").addEventListener("click", async () => {
    const text = $("#input").value.trim();
    if (!text) return;
    const btn = $("#btn-classify");
    btn.disabled = true; btn.textContent = "분류 중…";

    const m = Mask.mask(text);
    $("#sent").hidden = false;
    $("#sent-text").textContent = m.masked;
    $("#sent-found").innerHTML = m.found.length
      ? m.found.map(f => `<span class="tag">${f.type} 가림</span>`).join("")
      : `<span class="muted">가린 것 없음</span>`;

    const rule = Rules.classify(m.masked, S.criteria);
    const ai = await askAI([m.masked]);
    const got = ai.results && ai.results[0];

    $("#result").hidden = false;
    if (got) {
      $("#main-by").textContent = "AI · " + (ai.model || "");
      chips($("#main-chips"), got);
      $("#main-reason").textContent = got.reason || "";
      $("#note").hidden = true;
    } else {
      $("#main-by").textContent = "규칙";
      chips($("#main-chips"), rule);
      $("#main-reason").textContent = `분류: ${rule.why.category} · 감정: ${rule.why.sentiment} · 긴급도: ${rule.why.urgency}`;
      $("#note").hidden = false;
      $("#note").textContent = `AI 없이 규칙으로만 분류했습니다 — ${ai.reason || "AI 응답 없음"}`;
    }
    chips($("#rule-chips"), rule);
    $("#rule-reason").textContent = `분류: ${rule.why.category}`;
    $("#card-rule").hidden = !got;

    btn.disabled = false; btn.textContent = "분류하기";
  });

  // ── 채점 ───────────────────────────────────────────
  function pct(x) { return x.toFixed(x % 1 ? 1 : 0) + "%"; }

  function showScore(who, s) {
    $("#score-table").hidden = false;
    for (const k of ["category", "sentiment", "urgency"]) {
      document.querySelector(`[data-k="${who}-${k}"]`).textContent = pct(s.accuracy[k]);
    }
    document.querySelector(`[data-k="${who}-all"]`).textContent = `${s.n - s.wrong.length} / ${s.n}`;
    $("#wrong").hidden = false;
    $("#wrong-who").textContent = (who === "ai" ? "— AI" : "— 규칙") + " · 정답 → 판정";
    $("#wrong-list").innerHTML = s.wrong.slice(0, 15).map(w => {
      const diff = ["category", "sentiment", "urgency"].filter(k => w.got[k] !== w.want[k])
        .map(k => `${w.want[k]}→${w.got[k]}`).join(" · ");
      return `<li><span class="t">${w.text}</span><br><span class="d">${diff}${w.note ? " · " + w.note : ""}</span></li>`;
    }).join("") + (s.wrong.length > 15 ? `<li class="d">… 외 ${s.wrong.length - 15}건</li>` : "");
  }

  $("#btn-score-rule").addEventListener("click", () => {
    const s = Rules.score(S.test, r => Rules.classify(Mask.mask(r.text).masked, S.criteria));
    showScore("rule", s);
    $("#score-msg").hidden = true;
  });

  $("#btn-score-ai").addEventListener("click", async () => {
    const btn = $("#btn-score-ai");
    btn.disabled = true;
    const masked = S.test.map(r => Mask.mask(r.text).masked);
    const results = [];
    const used = [];   // 실제로 쓰인 모델 이름들
    for (let i = 0; i < masked.length; i += BATCH) {
      btn.textContent = `AI 채점 중… ${i}/${masked.length}`;
      let r = await askAI(masked.slice(i, i + BATCH));
      if (!r.results && r.timeout) {   // 느려서 끊겼으면 그 묶음만 한 번 더
        btn.textContent = `다시 시도 · AI 채점 중… ${i}/${masked.length}`;
        r = await askAI(masked.slice(i, i + BATCH));
      }
      if (!r.results) {
        $("#score-msg").hidden = false;
        $("#score-msg").textContent = `AI로 채점하지 못했습니다 — ${r.reason}` +
          (r.timeout ? " (한 번 다시 시도했지만 같았습니다)" : "");
        btn.disabled = false; btn.textContent = "AI로 채점";
        return;
      }
      if (r.model && !used.includes(r.model)) used.push(r.model);
      results.push(...r.results);
    }
    $("#ai-head").textContent = used.length ? "AI · " + used.join(", ") : "AI";
    // 답을 못 받은 문장은 «오답»으로 센다 — 빠진 것을 빼고 세면 점수가 부풀려진다
    const miss = { category: "-", sentiment: "-", urgency: "-" };
    S.aiResults = results;
    const s = Rules.score(S.test, (r, i) => results[i] || miss);
    showScore("ai", s);
    const blank = results.filter(x => !x).length;
    $("#score-msg").hidden = !blank;
    if (blank) $("#score-msg").textContent = `AI가 답하지 않은 문장 ${blank}건은 오답으로 셌습니다.`;
    $("#btn-download").hidden = false;
    btn.disabled = false; btn.textContent = "AI로 채점";
  });

  $("#btn-download").addEventListener("click", () => {
    const rows = S.test.map((r, i) => ({ id: r.id, text: r.text, 정답: r, AI: S.aiResults[i] }));
    const blob = new Blob([JSON.stringify(rows, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "ai_채점결과.json"; a.click();
  });

  // ── 기준 ───────────────────────────────────────────
  function renderCriteria() {
    const c = S.criteria;
    $("#owner").textContent = c.owner;
    $("#crit-cats").innerHTML = c.categories
      .map(x => `<tr><td>${x.name}</td><td>${x.definition}</td></tr>`).join("");
    $("#crit-priority").textContent = c.priority.join(" → ") + " 순서로 먼저 봅니다.";
    $("#crit-priority-reason").textContent = c.priority_reason;
    $("#crit-sent").textContent = c.sentiment.guide;
    $("#crit-urg").textContent = c.urgency.guide;
  }

  initModelPicker();
  load();
})();
