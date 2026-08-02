"""
저장분석.py가 MongoDB 저장을 끝낸 직후 자동 호출해 유튜브용 16:9 카드 이미지를 만드는 스크립트.
단독 실행도 가능: python 유튜브카드.py [YYYY-MM-DD]        # 16:9 카드만
                  python 유튜브카드.py [YYYY-MM-DD] --shorts # 16:9 + 9:16(쇼츠) 카드
"""

import html
import json
import math
import os
import sys

from dotenv import load_dotenv
from pymongo import MongoClient

import 저장분석  # find_latest(), build_change_rate_map() 재사용

if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

load_dotenv('.env.local')

OUT_DIR = 'Youtube'
WIDTH, HEIGHT = 1920, 1080
SHORTS_WIDTH, SHORTS_HEIGHT = 1080, 1920
SHORTS_DIR_NAME = 'shorts'
TREND_PALETTE = ['#3182f6', '#9b59b6', '#f04452', '#2ecc71', '#f39c12', '#1abc9c']
ETC_COLOR = '#8b95a1'
NEWS_CHUNK = 4
NEWS_TOP_N = 30
SHORTS_THEME_CHUNK = 3
SHORTS_NEWS_CHUNK = 2

BASE_CSS = """
:root {
  --c-primary:#3182f6; --c-bg:#ffffff; --c-surface:#f2f4f6; --c-border:#e5e8eb;
  --c-heading:#191f28; --c-body:#333d4b; --c-muted:#4e5968;
  --c-up:#f04452; --c-down:#3182f6; --c-flat:#4e5968;
  --shadow-card:0px 2px 8px rgba(0,0,0,0.08); --r-md:12px; --r-lg:16px;
  --font: "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1920px; height: 1080px; font-family: var(--font); background: var(--c-surface); }
.card { width: 1920px; height: 1080px; padding: 48px 80px; display: flex; flex-direction: column; overflow: hidden; }
.card-title { font-size: 48px; font-weight: 800; color: var(--c-heading); }
.card-subtitle { font-size: 26px; font-weight: 700; color: var(--c-muted); margin-top: 8px; }
.card-body { flex: 1; margin-top: 24px; min-height: 0; }
"""


def esc(value):
    return html.escape(str(value)) if value is not None else ''


def fetch_indices(date):
    uri = os.getenv('MONGODB_URI')
    if not uri:
        return None
    client = MongoClient(uri)
    doc = client.get_default_database()['stock_data'].find_one({'_id': date}, {'indices': 1})
    client.close()
    return doc.get('indices') if doc else None


def load_news_data(date):
    path = os.path.join('분석결과', f"뉴스데이터_{date.replace('-', '')}.json")
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def aggregate_by_category(items):
    counts = {}
    for item in items:
        cat = item.get('카테고리') or '기타'
        counts[cat] = counts.get(cat, 0) + 1
    total = sum(counts.values())
    etc_count = counts.pop('기타', 0)
    others = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))

    slices = []
    for i, (label, count) in enumerate(others):
        slices.append({
            'label': label,
            'count': count,
            'pct': count / total * 100 if total else 0,
            'color': TREND_PALETTE[i % len(TREND_PALETTE)],
        })
    if etc_count:
        slices.append({
            'label': '기타',
            'count': etc_count,
            'pct': etc_count / total * 100 if total else 0,
            'color': ETC_COLOR,
        })
    return slices


def render_base(title, subtitle, body_html):
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{BASE_CSS}</style></head>
<body><div class="card">
  <div class="card-title">{esc(title)}</div>
  <div class="card-subtitle">{esc(subtitle)}</div>
  <div class="card-body">{body_html}</div>
</div></body></html>"""


def _change_color(rate):
    if rate is None:
        return 'var(--c-flat)'
    if rate > 0:
        return 'var(--c-up)'
    if rate < 0:
        return 'var(--c-down)'
    return 'var(--c-flat)'


def _index_tile(label, idx):
    if not idx:
        return '<div style="flex:1;"></div>'
    close = idx.get('close', 0)
    change = idx.get('change', 0)
    rate = idx.get('changeRate', 0)
    color = _change_color(change)
    sign = '+' if change >= 0 else ''
    return f"""
    <div style="flex:1; background:var(--c-bg); border-radius:var(--r-lg); box-shadow:var(--shadow-card); padding:56px 64px;">
      <div style="font-size:36px; font-weight:700; color:var(--c-muted);">{esc(label)}</div>
      <div style="font-size:104px; font-weight:800; color:var(--c-heading); margin-top:16px;">{close:,.2f}</div>
      <div style="font-size:42px; font-weight:700; color:{color}; margin-top:16px;">{sign}{change:,.2f} ({sign}{rate:.2f}%)</div>
    </div>"""


def render_index_card(date, indices):
    if indices:
        index_html = (
            '<div style="display:flex; gap:40px; width:100%;">'
            + _index_tile('코스피', indices.get('kospi'))
            + _index_tile('코스닥', indices.get('kosdaq'))
            + '</div>'
        )
    else:
        index_html = '<div style="font-size:30px; color:var(--c-muted);">지수 데이터 없음</div>'

    body = f'<div style="height:100%; display:flex; align-items:center;">{index_html}</div>'
    return render_base(f'{date} 시장 브리핑', '코스피·코스닥 지수', body)


def render_theme_card(date, themes):
    theme_rows = ''.join(f"""
      <div style="background:var(--c-bg); border-radius:var(--r-md); box-shadow:var(--shadow-card); padding:24px 32px; overflow:hidden;">
        <div style="display:flex; align-items:baseline; gap:18px; white-space:nowrap; overflow:hidden;">
          <span style="font-size:32px; font-weight:800; color:var(--c-heading); flex-shrink:0;">{esc(t.get('테마', ''))}</span>
          <span style="font-size:24px; font-weight:600; color:var(--c-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{esc(t.get('주요종목', ''))}</span>
        </div>
        <div style="font-size:26px; color:var(--c-body); margin-top:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">{esc(t.get('핵심재료', ''))}</div>
      </div>""" for t in themes[:6]) or '<div style="font-size:28px; color:var(--c-muted);">테마 정보 없음</div>'

    body = f'<div style="display:flex; flex-direction:column; gap:18px; height:100%; justify-content:center;">{theme_rows}</div>'
    return render_base(f'{date} 오늘의 핫한 테마', 'TOP 6 테마 요약', body)


def _polar(cx, cy, r, angle_deg):
    rad = math.radians(angle_deg - 90)
    return cx + r * math.cos(rad), cy + r * math.sin(rad)


def _donut_path(cx, cy, r_outer, r_inner, start, end):
    large_arc = 1 if (end - start) > 180 else 0
    x1, y1 = _polar(cx, cy, r_outer, end)
    x2, y2 = _polar(cx, cy, r_outer, start)
    x3, y3 = _polar(cx, cy, r_inner, start)
    x4, y4 = _polar(cx, cy, r_inner, end)
    return (f'M {x1:.2f} {y1:.2f} A {r_outer} {r_outer} 0 {large_arc} 0 {x2:.2f} {y2:.2f} '
            f'L {x3:.2f} {y3:.2f} A {r_inner} {r_inner} 0 {large_arc} 1 {x4:.2f} {y4:.2f} Z')


def _donut_svg(slices, size=600):
    cx = cy = size / 2
    r_outer, r_inner = size * 0.45, size * 0.27
    if not slices:
        return f'<svg width="{size}" height="{size}"></svg>'
    if len(slices) == 1:
        return (f'<svg width="{size}" height="{size}">'
                f'<circle cx="{cx}" cy="{cy}" r="{r_outer}" fill="{slices[0]["color"]}"/>'
                f'<circle cx="{cx}" cy="{cy}" r="{r_inner}" fill="#f2f4f6"/></svg>')
    angle = 0
    paths = []
    for s in slices:
        start, end = angle, angle + s['pct'] / 100 * 360
        angle = end
        paths.append(f'<path d="{_donut_path(cx, cy, r_outer, r_inner, start, end)}" fill="{s["color"]}"/>')
    return f'<svg width="{size}" height="{size}">{"".join(paths)}</svg>'


def render_category_donut_card(title, items):
    slices = aggregate_by_category(items)
    donut = _donut_svg(slices)
    legend_rows = ''.join(f"""
      <div style="display:flex; align-items:center; gap:12px; font-size:26px;">
        <span style="width:20px; height:20px; border-radius:5px; background:{s['color']}; flex-shrink:0; display:inline-block;"></span>
        <span style="color:var(--c-heading); font-weight:700; flex:1;">{esc(s['label'])}</span>
        <span style="color:var(--c-muted); font-weight:600;">{s['count']}개 ({s['pct']:.0f}%)</span>
      </div>""" for s in slices)
    body = f"""
    <div style="display:flex; height:100%; align-items:center; gap:64px;">
      <div style="flex-shrink:0;">{donut}</div>
      <div style="flex:1; display:grid; grid-template-columns:1fr 1fr; gap:20px 40px; align-content:center;">
        {legend_rows}
      </div>
    </div>
    """
    total = sum(s['count'] for s in slices)
    return render_base(title, f'상위 {total}개 종목 기준 카테고리 분포', body)


def render_news_card(subtitle, chunk, start_rank, rate_map):
    rows = []
    for i, item in enumerate(chunk):
        rank = start_rank + i
        name = item.get('종목명', '')
        rate = rate_map.get(name)
        color = _change_color(rate)
        rate_text = f'{rate:+.2f}%' if rate is not None else ''
        cat = item.get('카테고리', '')
        reason = item.get('상승원인', '')
        rows.append(f"""
        <div style="display:flex; gap:24px; align-items:flex-start; background:var(--c-bg);
                    border-radius:var(--r-md); box-shadow:var(--shadow-card); padding:26px 34px;">
          <div style="font-size:32px; font-weight:800; color:var(--c-muted); width:60px;">{rank}</div>
          <div style="flex:1; min-width:0;">
            <div style="display:flex; align-items:baseline; gap:16px;">
              <span style="font-size:34px; font-weight:800; color:var(--c-heading);">{esc(name)}</span>
              <span style="font-size:26px; font-weight:700; color:{color};">{rate_text}</span>
              <span style="font-size:20px; font-weight:700; color:var(--c-primary); background:rgba(49,130,246,.14); border-radius:9999px; padding:5px 16px;">{esc(cat)}</span>
            </div>
            <div style="font-size:25px; color:var(--c-body); line-height:1.45; margin-top:10px;
                        display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">{esc(reason)}</div>
          </div>
        </div>""")
    body = f'<div style="display:flex; flex-direction:column; gap:18px;">{"".join(rows)}</div>'
    return render_base('등락률 상위 종목 주요뉴스', subtitle, body)


def build_card_specs(date, analysis, indices, rate_map):
    themes = analysis.get('테마', [])
    vol_items = analysis.get('거래대금', [])
    rate_items = analysis.get('등락률', [])

    specs = [
        ('01_지수', render_index_card(date, indices)),
        ('02_테마', render_theme_card(date, themes)),
        ('03_카테고리_거래대금', render_category_donut_card('거래대금 상위 카테고리 비중', vol_items)),
        ('04_카테고리_등락률', render_category_donut_card('등락률 상위 카테고리 비중', rate_items)),
    ]

    top30 = rate_items[:NEWS_TOP_N]
    for i in range(0, len(top30), NEWS_CHUNK):
        chunk = top30[i:i + NEWS_CHUNK]
        start_rank = i + 1
        end_rank = i + len(chunk)
        idx = i // NEWS_CHUNK + 5
        specs.append((
            f'{idx:02d}_주요뉴스_{start_rank:02d}-{end_rank:02d}',
            render_news_card(f'{start_rank}~{end_rank}위', chunk, start_rank, rate_map),
        ))
    return specs


def generate_cards(date, analysis, indices=None, news_data=None):
    if news_data is None:
        news_data = load_news_data(date)
    if indices is None:
        indices = fetch_indices(date)
    rate_map = 저장분석.build_change_rate_map(news_data) if news_data else {}

    specs = build_card_specs(date, analysis, indices, rate_map)

    date_dir = os.path.join(OUT_DIR, date)
    os.makedirs(date_dir, exist_ok=True)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': WIDTH, 'height': HEIGHT})
        for stem, html_str in specs:
            html_path = os.path.join(date_dir, f'{stem}.html')
            png_path = os.path.join(date_dir, f'{stem}.png')
            with open(html_path, 'w', encoding='utf-8') as f:
                f.write(html_str)
            page.set_content(html_str)
            page.screenshot(path=png_path)
            print(f'카드 생성: {png_path}')
        browser.close()


SHORTS_CSS = """
:root {
  --c-primary:#3182f6; --c-bg:#ffffff; --c-surface:#f2f4f6; --c-border:#e5e8eb;
  --c-heading:#191f28; --c-body:#333d4b; --c-muted:#4e5968;
  --c-up:#f04452; --c-down:#3182f6; --c-flat:#4e5968;
  --shadow-card:0px 2px 8px rgba(0,0,0,0.08); --r-md:12px; --r-lg:16px;
  --font: "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", "Segoe UI", sans-serif;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 1080px; height: 1920px; font-family: var(--font); background: var(--c-surface); }
.scard { width: 1080px; height: 1920px; padding: 72px 60px; position: relative; overflow: hidden;
         display: flex; flex-direction: column; }
.blob-a { position:absolute; top:-180px; right:-180px; width:460px; height:460px; border-radius:50%;
          background:var(--c-primary); opacity:.10; }
.blob-b { position:absolute; bottom:-220px; left:-180px; width:520px; height:520px; border-radius:50%;
          background:#9b59b6; opacity:.08; }
.s-content { position:relative; z-index:1; flex:1; display:flex; flex-direction:column; min-height:0; }
.s-eyebrow { display:inline-block; align-self:flex-start; font-size:28px; font-weight:800; color:var(--c-primary);
             background:rgba(49,130,246,.14); border-radius:9999px; padding:10px 26px; }
.s-heading { font-size:52px; font-weight:800; color:var(--c-heading); margin-top:22px; line-height:1.25; }
.s-sub { font-size:28px; font-weight:600; color:var(--c-muted); margin-top:10px; }
"""


def render_shorts_page(body_html):
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>{SHORTS_CSS}</style></head>
<body><div class="scard"><div class="blob-a"></div><div class="blob-b"></div>
  <div class="s-content">{body_html}</div>
</div></body></html>"""


def _parse_stock_chips(text):
    import re
    out = []
    for m in re.finditer(r'([^,()]+)\(([+-][\d.]+)%\)', text or ''):
        out.append((m.group(1).strip(), float(m.group(2))))
    return out


def _stock_chip(name, pct, font_size=22):
    if pct > 0:
        color, bg = 'var(--c-up)', 'rgba(240,68,82,.12)'
    elif pct < 0:
        color, bg = 'var(--c-down)', 'rgba(49,130,246,.12)'
    else:
        color, bg = 'var(--c-flat)', 'rgba(78,89,104,.10)'
    sign = '+' if pct >= 0 else ''
    return (f'<span style="display:inline-flex; align-items:center; font-size:{font_size}px; font-weight:700; '
            f'color:{color}; background:{bg}; border-radius:9999px; padding:8px 18px; margin:5px 8px 5px 0;">'
            f'{esc(name)} {sign}{pct:.1f}%</span>')


def _arrow_for(rate):
    if rate is None or rate == 0:
        return '■'
    return '▲' if rate > 0 else '▼'


def render_index_card_shorts(date, indices):
    def tile(label, idx):
        if not idx:
            return ''
        close = idx.get('close', 0)
        change = idx.get('change', 0)
        rate = idx.get('changeRate', 0)
        color = _change_color(change)
        sign = '+' if change >= 0 else ''
        return f"""
        <div style="background:var(--c-bg); border-radius:24px; box-shadow:var(--shadow-card);
                    border-left:14px solid {color}; padding:36px 44px;">
          <div style="font-size:32px; font-weight:700; color:var(--c-muted);">{esc(label)}</div>
          <div style="font-size:80px; font-weight:800; color:var(--c-heading); margin-top:10px;">{close:,.2f}</div>
          <div style="font-size:36px; font-weight:800; color:{color}; margin-top:14px;">{_arrow_for(change)} {sign}{change:,.2f} ({sign}{rate:.2f}%)</div>
        </div>"""

    tiles = (tile('코스피', indices.get('kospi')) + tile('코스닥', indices.get('kosdaq'))) if indices \
        else '<div style="font-size:30px; color:var(--c-muted);">지수 데이터 없음</div>'

    body = f"""
    <div class="s-eyebrow">{esc(date)}</div>
    <div class="s-heading">시장 브리핑</div>
    <div class="s-sub">코스피 · 코스닥 지수</div>
    <div style="flex:1; display:flex; flex-direction:column; gap:16px; margin-top:64px; justify-content:center;">{tiles}</div>
    """
    return render_shorts_page(body)


def render_theme_card_shorts(date, chunk, start_no, end_no, total_themes):
    blocks = []
    for i, t in enumerate(chunk):
        color = TREND_PALETTE[(start_no - 1 + i) % len(TREND_PALETTE)]
        chips = ''.join(_stock_chip(n, p) for n, p in _parse_stock_chips(t.get('주요종목', '')))
        blocks.append(f"""
        <div style="background:var(--c-bg); border-radius:24px; box-shadow:var(--shadow-card);
                    border-left:12px solid {color}; padding:34px 36px;">
          <div style="font-size:38px; font-weight:800; color:var(--c-heading);">{esc(t.get('테마', ''))}</div>
          <div style="margin-top:16px; display:flex; flex-wrap:wrap;">{chips}</div>
          <div style="margin-top:16px; font-size:26px; color:var(--c-body); line-height:1.45;">{esc(t.get('핵심재료', ''))}</div>
        </div>""")

    body = f"""
    <div class="s-eyebrow">{esc(date)}</div>
    <div class="s-heading">오늘의 핫한 테마</div>
    <div class="s-sub">{start_no}~{end_no} / {total_themes}</div>
    <div style="flex:1; display:flex; flex-direction:column; gap:30px; margin-top:48px; justify-content:center;">{''.join(blocks)}</div>
    """
    return render_shorts_page(body)


def render_category_donut_card_shorts(date, title, items):
    slices = aggregate_by_category(items)
    donut = _donut_svg(slices, size=380)
    legend_rows = ''.join(f"""
      <div style="display:flex; align-items:center; gap:10px; font-size:20px; padding:5px 0;">
        <span style="width:18px; height:18px; border-radius:5px; background:{s['color']}; flex-shrink:0; display:inline-block;"></span>
        <span style="color:var(--c-heading); font-weight:700; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">{esc(s['label'])}</span>
        <span style="color:var(--c-muted); font-weight:600; flex-shrink:0;">{s['count']}개({s['pct']:.0f}%)</span>
      </div>""" for s in slices)
    total = sum(s['count'] for s in slices)

    body = f"""
    <div class="s-eyebrow">{esc(date)}</div>
    <div class="s-heading">{esc(title)}</div>
    <div class="s-sub">상위 {total}개 종목 기준</div>
    <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:24px; margin-top:32px; min-height:0;">
      <div style="flex-shrink:0;">{donut}</div>
      <div style="width:100%; display:grid; grid-template-columns:1fr 1fr; gap:4px 18px; align-content:start;">{legend_rows}</div>
    </div>
    """
    return render_shorts_page(body)


def _news_block_shorts(rank, total, item, rate_map):
    name = item.get('종목명', '')
    rate = rate_map.get(name)
    color = _change_color(rate)
    rate_text = f'{rate:+.2f}%' if rate is not None else ''
    tint = ('rgba(240,68,82,.10)' if (rate or 0) > 0
            else 'rgba(49,130,246,.10)' if (rate or 0) < 0 else 'rgba(78,89,104,.08)')
    cat = item.get('카테고리', '')
    reason = item.get('상승원인', '')

    return f"""
    <div style="background:var(--c-bg); border-radius:24px; box-shadow:var(--shadow-card); padding:36px 40px;">
      <div style="display:flex; align-items:center; gap:18px;">
        <div style="width:84px; height:84px; border-radius:50%; background:{tint}; border:4px solid {color};
                    display:flex; align-items:center; justify-content:center; font-size:36px; font-weight:800;
                    color:{color}; flex-shrink:0;">{rank}</div>
        <div style="font-size:24px; font-weight:700; color:var(--c-muted);">등락률 상위 {rank}/{total}위</div>
      </div>
      <div style="font-size:58px; font-weight:800; color:var(--c-heading); margin-top:24px; line-height:1.2;">{esc(name)}</div>
      <div style="display:flex; align-items:center; gap:14px; margin-top:20px; flex-wrap:wrap;">
        <span style="font-size:36px; font-weight:800; color:{color}; background:{tint}; border-radius:9999px; padding:11px 26px;">{_arrow_for(rate)} {rate_text}</span>
        <span style="font-size:24px; font-weight:700; color:var(--c-primary); background:rgba(49,130,246,.14); border-radius:9999px; padding:11px 22px;">{esc(cat)}</span>
      </div>
      <div style="height:6px; width:130px; border-radius:6px; background:{color}; opacity:.5; margin-top:28px;"></div>
      <div style="font-size:28px; color:var(--c-body); line-height:1.55; margin-top:26px;">{esc(reason)}</div>
    </div>"""


def render_news_card_shorts(date, start_rank, total, chunk, rate_map):
    blocks = ''.join(_news_block_shorts(start_rank + i, total, item, rate_map) for i, item in enumerate(chunk))
    end_rank = start_rank + len(chunk) - 1

    body = f"""
    <div class="s-eyebrow">{esc(date)}</div>
    <div class="s-heading">등락률 상위 종목 뉴스</div>
    <div class="s-sub">{start_rank}~{end_rank} / {total}위</div>
    <div style="flex:1; display:flex; flex-direction:column; gap:28px; margin-top:48px; justify-content:center;">{blocks}</div>
    """
    return render_shorts_page(body)


def build_shorts_card_specs(date, analysis, indices, rate_map):
    themes = analysis.get('테마', [])
    vol_items = analysis.get('거래대금', [])
    rate_items = analysis.get('등락률', [])

    specs = [('01_지수', render_index_card_shorts(date, indices))]

    theme_total = len(themes)
    n = 1
    for i in range(0, theme_total, SHORTS_THEME_CHUNK):
        chunk = themes[i:i + SHORTS_THEME_CHUNK]
        n += 1
        specs.append((
            f'{n:02d}_테마_{i + 1}-{i + len(chunk)}',
            render_theme_card_shorts(date, chunk, i + 1, i + len(chunk), theme_total),
        ))

    n += 1
    specs.append((f'{n:02d}_카테고리_거래대금', render_category_donut_card_shorts(date, '거래대금 상위 카테고리 비중', vol_items)))
    n += 1
    specs.append((f'{n:02d}_카테고리_등락률', render_category_donut_card_shorts(date, '등락률 상위 카테고리 비중', rate_items)))

    top30 = rate_items[:NEWS_TOP_N]
    for i in range(0, len(top30), SHORTS_NEWS_CHUNK):
        chunk = top30[i:i + SHORTS_NEWS_CHUNK]
        start_rank = i + 1
        end_rank = i + len(chunk)
        n += 1
        specs.append((
            f'{n:02d}_뉴스_{start_rank:02d}-{end_rank:02d}위',
            render_news_card_shorts(date, start_rank, len(top30), chunk, rate_map),
        ))

    return specs


def generate_shorts_cards(date, analysis, indices=None, news_data=None):
    if news_data is None:
        news_data = load_news_data(date)
    if indices is None:
        indices = fetch_indices(date)
    rate_map = 저장분석.build_change_rate_map(news_data) if news_data else {}

    specs = build_shorts_card_specs(date, analysis, indices, rate_map)

    date_dir = os.path.join(OUT_DIR, date, SHORTS_DIR_NAME)
    os.makedirs(date_dir, exist_ok=True)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': SHORTS_WIDTH, 'height': SHORTS_HEIGHT})
        for stem, html_str in specs:
            html_path = os.path.join(date_dir, f'{stem}.html')
            png_path = os.path.join(date_dir, f'{stem}.png')
            with open(html_path, 'w', encoding='utf-8') as f:
                f.write(html_str)
            page.set_content(html_str)
            page.screenshot(path=png_path)
            print(f'쇼츠 카드 생성: {png_path}')
        browser.close()


def main():
    args = [a for a in sys.argv[1:] if a != '--shorts']
    want_shorts = '--shorts' in sys.argv[1:]

    if args:
        path = os.path.join('분석결과', f'분석결과_{args[0]}.json')
    else:
        path = 저장분석.find_latest()
        print(f'자동 탐색: {path}')

    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    date = data.get('date')
    analysis = data.get('analysis')
    if not date or not analysis:
        print('오류: JSON에 date 또는 analysis 필드가 없습니다.')
        sys.exit(1)

    generate_cards(date, analysis)
    if want_shorts:
        generate_shorts_cards(date, analysis)


if __name__ == '__main__':
    main()
