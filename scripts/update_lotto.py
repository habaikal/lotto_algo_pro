#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""lotto_results.csv 관리 스크립트 (표준라이브러리만 사용).
사용법:
  python scripts/update_lotto.py --check
  python scripts/update_lotto.py --add 1245 3,11,18,27,34,42 7
  python scripts/update_lotto.py --fetch   # 공식 API 시도, 차단 시 SKIP(정상 종료)
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(BASE, "lotto_results.csv")


def load(path=CSV_PATH):
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        rows = []
        for r in reader:
            if len(r) < 8:
                continue
            try:
                rows.append((int(r[0]), sorted(map(int, r[1:7])), int(r[7])))
            except ValueError:
                continue
    rows.sort(key=lambda t: t[0])
    return header, rows


def problems(rows):
    out = []
    seen = set()
    for rnd, nums, bonus in rows:
        if rnd in seen:
            out.append(f"duplicate round {rnd}")
        seen.add(rnd)
        if len(nums) != 6 or any(not 1 <= x <= 45 for x in nums) or len(set(nums)) != 6:
            out.append(f"round {rnd}: invalid main numbers {nums}")
        if not 1 <= bonus <= 45 or bonus in nums:
            out.append(f"round {rnd}: invalid bonus {bonus}")
    for a, b in zip(rows, rows[1:]):
        if b[0] != a[0] + 1:
            out.append(f"gap: {a[0]} -> {b[0]}")
    return out


def save(header, rows, path=CSV_PATH):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for rnd, nums, bonus in rows:
            w.writerow([rnd, *nums, bonus])


def cmd_check(_):
    header, rows = load()
    print(f"rounds: {len(rows)} ({rows[0][0]}~{rows[-1][0]})")
    ps = problems(rows)
    for p in ps:
        print("WARN:", p)
    if any("invalid" in p or "duplicate" in p for p in ps):
        print("CHECK: FAIL")
        return 1
    print("CHECK: OK" + (" (gaps noted)" if ps else ""))
    return 0


def cmd_add(a):
    nums = sorted(map(int, a.numbers.replace(" ", "").split(",")))
    bonus = int(a.bonus)
    rnd = int(a.add)
    if len(nums) != 6 or len(set(nums)) != 6 or any(not 1 <= x <= 45 for x in nums):
        print("ERR: numbers must be 6 unique 1..45");
        return 2
    if not 1 <= bonus <= 45 or bonus in nums:
        print("ERR: invalid bonus");
        return 2
    header, rows = load()
    rows = [r for r in rows if r[0] != rnd] + [(rnd, nums, bonus)]
    rows.sort(key=lambda t: t[0])
    save(header, rows)
    print(f"ADDED round {rnd}: {nums}+{bonus} (total {len(rows)})")
    return 0


def cmd_fetch(_):
    # 동행복권은 TRACER 봇 차단을 운용 중이라 자동 크롤링이 차단된다.
    # --fetch는 시도만 하고 차단 시 SKIP로 정상 종료한다(워크플로 실패 방지).
    header, rows = load()
    last = rows[-1][0]
    nxt = last + 1
    url = f"https://www.dhlottery.co.kr/common.do?method=getLottoNumber&drwNo={nxt}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": "https://www.dhlottery.co.kr/",
        "X-Requested-With": "XMLHttpRequest", "Accept": "application/json"})
    try:
        raw = urllib.request.urlopen(req, timeout=20).read()
        d = json.loads(raw.decode("utf-8"))
        if d.get("returnValue") != "success":
            print(f"SKIP: round {nxt} not published yet ({d.get('returnValue')})")
            return 0
        nums = sorted(d[f"drNo{i}"] for i in range(1, 7))
        bonus = int(d["bnusNo"])
        rows = [r for r in rows if r[0] != nxt] + [(nxt, nums, bonus)]
        rows.sort(key=lambda t: t[0])
        save(header, rows)
        print(f"FETCHED round {nxt}: {nums}+{bonus}")
        return 0
    except Exception as e:
        print(f"SKIP: official API blocked/unreachable ({type(e).__name__}); use --add or Actions dispatch")
        return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--add", type=int, metavar="ROUND")
    ap.add_argument("numbers", nargs="?", default="")
    ap.add_argument("bonus", nargs="?", default="")
    ap.add_argument("--fetch", action="store_true")
    a = ap.parse_args()
    if a.fetch:
        return cmd_fetch(a)
    if a.add:
        return cmd_add(a)
    return cmd_check(a)


if __name__ == "__main__":
    sys.exit(main())
