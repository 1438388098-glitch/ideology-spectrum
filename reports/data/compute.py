# -*- coding: utf-8 -*-
"""Compute Jev's political spectrum using the site's exact scoring + matching logic."""
import io, json, math, os

OUT = os.path.dirname(os.path.abspath(__file__))   # 输入/输出都在本目录

questions = json.load(io.open(os.path.join(OUT, "questions.json"), encoding="utf-8"))
ideologies = json.load(io.open(os.path.join(OUT, "ideologies.json"), encoding="utf-8"))
gov = json.load(io.open(os.path.join(OUT, "gov_profile.json"), encoding="utf-8"))
ax = json.load(io.open(os.path.join(OUT, "axes.json"), encoding="utf-8"))
answers = json.load(io.open(os.path.join(OUT, "jev_answers.json"), encoding="utf-8"))

axes = ax["axes"]
axis_keys = ax["axis_keys"]
axis_by_key = dict((a["key"], a) for a in axes)
by_id = dict((str(q["id"]), q) for q in questions)

# ---- denominators (identical to app.js computeUserAxes) ----
max_abs = dict((k, 0) for k in axis_keys)
for q in questions:
    for k in axis_keys:
        mx = 0
        for o in q["options"]:
            v = o.get("scores", {}).get(k)
            if isinstance(v, (int, float)):
                mx = max(mx, abs(v))
        max_abs[k] += mx


def normalize(sumv):
    out = {}
    for k in axis_keys:
        v = (sumv[k] / max_abs[k]) * 100 if max_abs[k] else 0.0
        out[k] = max(-100, min(100, int(round(v))))
    return out


def normalize_f(sumv):
    """Float version (no rounding) for finer comparisons."""
    out = {}
    for k in axis_keys:
        v = (sumv[k] / max_abs[k]) * 100 if max_abs[k] else 0.0
        out[k] = max(-100.0, min(100.0, v))
    return out


# ---- HARD result: argmax choice ----
hard_sum = dict((k, 0) for k in axis_keys)
# ---- SOFT result: probability-weighted expectation ----
soft_sum = dict((k, 0.0) for k in axis_keys)

per_question = []
for q in questions:
    key = str(q["id"])
    a = answers[key]
    ci = a["choice"]
    # hard
    if isinstance(ci, int) and 1 <= ci <= len(q["options"]):
        for k in axis_keys:
            hard_sum[k] += q["options"][ci - 1]["scores"].get(k, 0)
    # soft
    probs = a.get("probabilities") or {}
    if probs:
        for oi, o in enumerate(q["options"], 1):
            p = probs.get(oi, probs.get(str(oi), 0.0))
            for k in axis_keys:
                soft_sum[k] += p * o.get("scores", {}).get(k, 0)
    per_question.append({
        "id": q["id"],
        "theme": q["theme"],
        "stem": q["stem"],
        "choice": ci,
        "chosen_text": q["options"][ci - 1]["text"] if isinstance(ci, int) and 1 <= ci <= len(q["options"]) else None,
        "confidence": a.get("confidence"),
        "probs": probs,
        "options": [o["text"] for o in q["options"]],
    })

hard_axes = normalize(hard_sum)
soft_axes = normalize_f(soft_sum)
hard_axes_f = normalize_f(hard_sum)

# ---- matching (identical to app.js computeMatches) ----
max_dist = math.sqrt(len(axis_keys) * (200.0 ** 2))


def matches(user_axes):
    out = []
    for ideo in ideologies:
        d2 = sum((user_axes[k] - ideo["axes"].get(k, 0)) ** 2 for k in axis_keys)
        d = math.sqrt(d2)
        sim = max(0.0, 100.0 * (1 - d / max_dist))
        out.append({"name": ideo["name"], "nameEn": ideo["nameEn"], "sim": sim, "dist": d,
                    "axes": ideo["axes"]})
    out.sort(key=lambda r: -r["sim"])
    return out


hard_matches = matches(hard_axes)
soft_matches = matches(soft_axes)

# gov fit
def gov_fit(user_axes):
    def dist(u, g):
        return math.sqrt(sum((u[k] - g["axes"].get(k, 0)) ** 2 for k in axis_keys))
    return {
        "gov_only": 100.0 * (1 - dist(user_axes, gov) / max_dist),
        "vs_top_ideo": hard_matches[0]["sim"],
    }


# ---- per-axis labels ----
def describe(v, a):
    pole = a["left"] if v < -5 else (a["right"] if v > 5 else "中立")
    deg = "显著" if abs(v) >= 60 else ("偏向" if abs(v) >= 25 else ("轻微" if abs(v) > 5 else "中立"))
    return pole, deg


axis_rows = []
for a in axes:
    k = a["key"]
    pole, deg = describe(hard_axes[k], a)
    axis_rows.append({
        "key": k, "name": a["name"], "hard": hard_axes[k], "soft": round(soft_axes[k], 1),
        "pole": pole, "deg": deg,
        "left": a["left"], "right": a["right"],
    })

# ---- theme-level ----
theme_sum = {}
for pq in per_question:
    q = by_id[str(pq["id"])]
    t = q["theme"]
    ci = pq["choice"]
    if not (isinstance(ci, int) and 1 <= ci <= len(q["options"])):
        continue
    d = theme_sum.setdefault(t, dict((k, 0) for k in axis_keys))
    for k in axis_keys:
        d[k] += q["options"][ci - 1]["scores"].get(k, 0)

theme_rows = []
for t, s in theme_sum.items():
    # strongest axis by |sum| relative to that axis denominator is misleading;
    # use raw sum magnitude as "how much this theme pushed this axis"
    ranked = sorted(s.items(), key=lambda kv: -abs(kv[1]))
    k, v = ranked[0]
    theme_rows.append({"theme": t, "n": sum(1 for p in per_question if p["theme"] == t),
                       "strongest_axis": k, "amount": v,
                       "pole": axis_by_key[k]["left"] if v < 0 else axis_by_key[k]["right"]})
theme_rows.sort(key=lambda r: -abs(r["amount"]))

# ---- decisiveness ----
decisive = sorted([p for p in per_question if p["confidence"] is not None],
                  key=lambda p: -(p["confidence"] or 0))[:10]
uncertain = sorted([p for p in per_question if p["confidence"] is not None],
                   key=lambda p: (p["confidence"] or 1))[:10]

result = {
    "model": "jev-1.13-free",
    "n_questions": len(questions),
    "hard_axes": hard_axes,
    "hard_axes_f": dict((k, round(v, 2)) for k, v in hard_axes_f.items()),
    "soft_axes": dict((k, round(v, 2)) for k, v in soft_axes.items()),
    "axis_rows": axis_rows,
    "ideologies": hard_matches,
    "ideologies_soft": soft_matches,
    "gov": gov,
    "gov_fit": gov_fit(hard_axes),
    "themes": theme_rows,
    "decisive": [{"id": p["id"], "theme": p["theme"], "stem": p["stem"], "conf": p["confidence"],
                  "chosen": p["chosen_text"]} for p in decisive],
    "uncertain": [{"id": p["id"], "theme": p["theme"], "stem": p["stem"], "conf": p["confidence"],
                   "chosen": p["chosen_text"], "options": p["options"]} for p in uncertain],
}

with io.open(os.path.join(OUT, "results.json"), "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=1)

with io.open(os.path.join(OUT, "per_question.json"), "w", encoding="utf-8") as f:
    json.dump(per_question, f, ensure_ascii=False, indent=1)

# ---- console summary (ASCII labels) ----
print("=== JEV AXES (hard argmax) ===")
for r in axis_rows:
    print("  %-6s %6d   soft %6.1f   %s" % (r["key"], r["hard"], r["soft"], r["pole"]))
print("=== TOP MATCHES ===")
for m in hard_matches[:8]:
    print("  %-24s %5.1f  (d=%.1f)" % (m["nameEn"], m["sim"], m["dist"]))
print("=== GOV FIT ===")
print("  gov_only_similarity: %.1f" % result["gov_fit"]["gov_only"])
print("=== THEME PUSH (strongest) ===")
for r in theme_rows:
    print("  %-22s %-6s %+d" % (r["theme"], r["strongest_axis"], r["amount"]))
print("=== DECISIVE (top conf) ===")
for p in result["decisive"][:5]:
    print("  q%-4d %.2f" % (p["id"], p["conf"]))
print("=== UNCERTAIN (low conf) ===")
for p in result["uncertain"][:5]:
    print("  q%-4d %.2f" % (p["id"], p["conf"]))
print("written:", os.path.join(OUT, "results.json"))