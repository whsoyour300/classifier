"""규칙 분류기 대시보드 (Streamlit) — 로컬 전용 (tools/ 는 배포 제외).

실행:  streamlit run tools/streamlit_app.py
data/practice200.json 의 연습 문장 200건을 criteria.json 기준의 규칙(rules.js 와 같은 방식)으로 분류하고,
사람 정답(category · sentiment · urgency)과 견주어 맞는 수와 오분류를 보여 준다. 파일 업로드는 없다.
"""
import json
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st

ROOT = Path(__file__).resolve().parent.parent
KEYS = ("category", "sentiment", "urgency")
LABELS = {"category": "분류", "sentiment": "감정", "urgency": "긴급도"}
ORDER = {"sentiment": ["부정", "중립", "긍정"], "urgency": ["높음", "보통", "낮음"]}
BLUE, ORANGE = "#2a78d6", "#eb6834"  # 정답 · 규칙 (고정 순서의 1·2번 색)
MUTED = "#8a8985"


def hit(text, words):
    return next((w for w in words or [] if w in text), None)


def classify(text, c):
    kw = {x["name"]: x["keywords"] for x in c["categories"]}
    category = next((n for n in c["priority"] if hit(text, kw.get(n))), "기타")
    neg, pos = hit(text, c["sentiment"]["부정"]), hit(text, c["sentiment"]["긍정"])
    hi, lo = hit(text, c["urgency"]["높음"]), hit(text, c["urgency"]["낮음"])
    return {
        "category": category,
        "sentiment": "부정" if neg else "긍정" if pos else "중립",
        "urgency": "높음" if hi else "낮음" if lo else "보통",
    }


def style(chart):
    return (
        chart.configure_view(strokeWidth=0)
        .configure_axis(grid=True, gridColor="#8884", domainColor="#8884", tickColor="#8884", labelFontSize=12, titleFontSize=12)
        .configure_legend(orient="top", title=None, labelFontSize=12)
    )


def compare_chart(df, key, order):
    """칸별 건수 — 정답과 규칙을 나란히."""
    def counts(col, who):
        s = df[col].value_counts().reindex(order).fillna(0)
        return pd.DataFrame({"칸": s.index, "건수": s.values, "구분": who})

    long = pd.concat([counts(key, "정답"), counts(f"규칙_{key}", "규칙")])
    chart = (
        alt.Chart(long)
        .mark_bar(cornerRadiusTopLeft=4, cornerRadiusTopRight=4, size=18)
        .encode(
            x=alt.X("칸:N", sort=order, title=None, axis=alt.Axis(labelAngle=0)),
            xOffset=alt.XOffset("구분:N", sort=["정답", "규칙"]),
            y=alt.Y("건수:Q", title=None),
            color=alt.Color("구분:N", scale=alt.Scale(domain=["정답", "규칙"], range=[BLUE, ORANGE])),
            tooltip=["칸", "구분", "건수"],
        )
        .properties(height=240)
    )
    return style(chart)


def count_chart(df, key, order):
    """정답이 없을 때 — 규칙 판정 건수만."""
    s = df[f"규칙_{key}"].value_counts().reindex(order).fillna(0).rename("건수").reset_index()
    s.columns = ["칸", "건수"]
    chart = (
        alt.Chart(s)
        .mark_bar(cornerRadiusTopLeft=4, cornerRadiusTopRight=4, size=28, color=ORANGE)
        .encode(x=alt.X("칸:N", sort=order, title=None, axis=alt.Axis(labelAngle=0)), y=alt.Y("건수:Q", title=None), tooltip=["칸", "건수"])
        .properties(height=240)
    )
    return style(chart)


def confusion_chart(df, order):
    """행 = 사람 정답, 열 = 규칙이 낸 분류. 대각선 밖이 오분류."""
    m = df.groupby(["category", "규칙_category"]).size().rename("건수").reset_index()
    m.columns = ["정답", "규칙", "건수"]
    base = alt.Chart(m).encode(
        x=alt.X("규칙:N", sort=order, title="규칙이 낸 분류", axis=alt.Axis(labelAngle=0)),
        y=alt.Y("정답:N", sort=order, title="사람 정답"),
    )
    cells = base.mark_rect(stroke="white", strokeWidth=2, cornerRadius=3).encode(
        color=alt.Color("건수:Q", scale=alt.Scale(range=["#e7f0fb", BLUE]), legend=None),
        tooltip=["정답", "규칙", "건수"],
    )
    text = base.mark_text(fontSize=13).encode(
        text="건수:Q", color=alt.condition(alt.datum.건수 > m["건수"].max() * 0.55, alt.value("white"), alt.value("#222"))
    )
    return style((cells + text).properties(height=300))


st.set_page_config(page_title="고객 한마디 분류 대시보드", page_icon="📊", layout="wide")
criteria = json.loads((ROOT / "criteria.json").read_text(encoding="utf-8"))

# ---- 사이드바 ----
with st.sidebar:
    st.header("데이터")
    st.caption("연습 문장 200건 (data/practice200.json)")
    st.caption(f"기준 criteria.json v{criteria['version']}")
    st.caption("분류 순서: " + " › ".join(criteria["priority"]))

df = pd.DataFrame(json.loads((ROOT / "data" / "practice200.json").read_text(encoding="utf-8")))

pred = pd.DataFrame([classify(str(t), criteria) for t in df["text"]]).add_prefix("규칙_")
df = pd.concat([df.reset_index(drop=True), pred], axis=1)
has_gold = all(k in df.columns for k in KEYS)
cat_order = criteria["priority"]

with st.sidebar:
    st.header("필터")
    picked = st.multiselect("규칙이 낸 분류", cat_order, default=cat_order)
    only_wrong = st.checkbox("정답과 다른 문장만", disabled=not has_gold)

view = df[df["규칙_category"].isin(picked)]
wrong_mask = pd.Series(False, index=view.index)
if has_gold:
    wrong_mask = (view[list(KEYS)].values != view[[f"규칙_{k}" for k in KEYS]].values).any(axis=1)
    wrong_mask = pd.Series(wrong_mask, index=view.index)
    if only_wrong:
        view = view[wrong_mask]
        wrong_mask = wrong_mask[view.index]

# ---- 머리 ----
st.title("고객 한마디 분류 대시보드")
st.caption(f"규칙 분류기 결과 · 전체 {len(df)}건 중 {len(view)}건 표시")

# ---- 지표 ----
cols = st.columns(4 if has_gold else 1)
cols[0].metric("문장 수", f"{len(view)}건")
if has_gold:
    for col, k in zip(cols[1:], KEYS):
        ok = int((view[k] == view[f"규칙_{k}"]).sum())
        col.metric(f"{LABELS[k]} 맞는 수", f"{ok} / {len(view)}", f"{ok / len(view):.0%}" if len(view) else None, delta_color="off")

# ---- 칸별 건수 ----
st.subheader("칸별 건수" + (" — 정답 vs 규칙" if has_gold else " — 규칙 판정"))
c1, c2, c3 = st.columns(3)
for col, k, order in zip((c1, c2, c3), KEYS, (cat_order, ORDER["sentiment"], ORDER["urgency"])):
    with col:
        st.markdown(f"**{LABELS[k]}**")
        st.altair_chart(compare_chart(view, k, order) if has_gold else count_chart(view, k, order), width="stretch")

tab_names = ["문장별 결과"] + (["분류 혼동표", "오분류 목록"] if has_gold else [])
tabs = st.tabs(tab_names)

with tabs[0]:
    st.dataframe(view, width="stretch", hide_index=True)
    st.download_button("결과 CSV 받기", view.to_csv(index=False).encode("utf-8-sig"), "classified.csv", "text/csv")

if has_gold:
    with tabs[1]:
        st.caption("행 = 사람 정답, 열 = 규칙이 낸 분류. 대각선 밖의 칸이 규칙이 놓친 문장입니다.")
        st.altair_chart(confusion_chart(view, cat_order), width="stretch")
    with tabs[2]:
        bad = view.loc[wrong_mask]
        st.caption(f"정답과 한 칸이라도 다른 문장 {len(bad)}건")
        st.dataframe(bad, width="stretch", hide_index=True)
