"""
 注册机 - 仅注册版
只完成账号注册 + 信息填写，不获取 Codex Token
"""

import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import os
import re
import uuid
import json
import random
import string
import time
import math
import secrets
import hashlib
import base64
import argparse
import builtins
import shutil
import tempfile
import threading
import traceback
import requests as std_requests
from typing import Any, Optional, cast
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse, parse_qs, urlencode, quote, unquote
from curl_cffi import requests

from app_runtime import ensure_parent_dir, get_runtime_dir, resolve_output_path

RUNTIME_DIR_ENV = "OPENAI_REGISTER_RUNTIME_DIR"
APP_NAME = "OpenAI Register Only"


def _get_runtime_dir() -> str:
    return str(get_runtime_dir())


APP_RUNTIME_DIR = _get_runtime_dir()


def _resolve_output_path(path: str) -> str:
    return str(resolve_output_path(path, APP_NAME))


def _ensure_parent_dir(path: str) -> None:
    ensure_parent_dir(path)


# ================= 配置 =================
VERIFY_API_URL = "https://proud-feather-b980.lhl9532g.workers.dev"
DOMAIN = "usncf.xyz"
PROXY = "http://127.0.0.1:7897"
OAUTH_ISSUER = "https://auth.openai.com"
BASE = "https://chatgpt.com"
ACCOUNTS_DIR = _resolve_output_path("accounts")
ACCOUNTS_WITH_TOKEN_DIR = _resolve_output_path("accounts/with_token")
ACCOUNTS_WITHOUT_TOKEN_DIR = _resolve_output_path("accounts/without_token")
TOKEN_JSON_DIR = _resolve_output_path("codex_tokens")
AK_FILE = _resolve_output_path("ak.txt")
RK_FILE = _resolve_output_path("rk.txt")

_current_proxy = PROXY
_current_domain = DOMAIN

_print_lock = threading.RLock()
_file_lock = threading.Lock()
_original_print = builtins.print

_progress_state = {
    "active": False,
    "done": 0,
    "total": 1,
    "success": 0,
    "fail": 0,
    "start_time": 0.0,
}


def _clear_progress_line_unlocked():
    cols = shutil.get_terminal_size((110, 20)).columns
    _original_print("\r" + " " * max(10, cols - 1) + "\r", end="", flush=True)


def _render_apt_like_progress(done: int, total: int, success: int, fail: int, start_time: float):
    total = max(1, int(total or 1))
    done = max(0, min(int(done or 0), total))
    success = max(0, int(success or 0))
    fail = max(0, int(fail or 0))

    with _print_lock:
        _progress_state.update({
            "active": done < total,
            "done": done,
            "total": total,
            "success": success,
            "fail": fail,
            "start_time": float(start_time or time.time()),
        })

        percent = (done / total) * 100
        cols = shutil.get_terminal_size((110, 20)).columns
        elapsed = max(0.0, time.time() - _progress_state["start_time"])
        speed = (done / elapsed) if elapsed > 0 else 0.0
        right_text = f" {percent:6.2f}% [{done}/{total}] 成功:{success} 失败:{fail} 速率:{speed:.2f}/s"
        bar_width = max(12, min(50, cols - len(right_text) - 8))
        filled = int((done / total) * bar_width)

        if done >= total:
            bar = "=" * bar_width
        elif filled <= 0:
            bar = ">" + " " * (bar_width - 1)
        else:
            bar = "=" * (filled - 1) + ">" + " " * (bar_width - filled)

        line = f"\r进度: [{bar}]" + right_text
        _original_print(line, end="", flush=True)


def _print_with_progress(*args, **kwargs):
    with _print_lock:
        if _progress_state["active"]:
            _clear_progress_line_unlocked()

        _original_print(*args, **kwargs)

        if _progress_state["active"]:
            _render_apt_like_progress(
                _progress_state["done"],
                _progress_state["total"],
                _progress_state["success"],
                _progress_state["fail"],
                _progress_state["start_time"],
            )


builtins.print = _print_with_progress

def _proxies() -> Optional[dict[str, str]]:
    if not _current_proxy:
        return None
    return {"http": _current_proxy, "https": _current_proxy}


def _new_http_session(impersonate: str):
    return requests.Session(impersonate=cast(Any, impersonate))


def _apply_session_proxies(session, proxy_map: Optional[dict[str, str]]) -> None:
    if proxy_map:
        session.proxies = cast(Any, proxy_map)

# ================= 浏览器指纹随机化 =================
_CHROME_VERSIONS = [120, 121, 122, 123, 124, 125]
_IMPERSONATE_TARGETS = ["chrome", "chrome110", "chrome120"]
_ACCEPT_LANGS = [
    "en-US,en;q=0.9", "en-GB,en;q=0.9", "en;q=0.8",
    "en-US,en;q=0.9,zh-CN;q=0.8", "en;q=0.9,zh;q=0.7",
]

def _random_ua():
    ver = random.choice(_CHROME_VERSIONS)
    return (
        f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        f"AppleWebKit/537.36 (KHTML, like Gecko) "
        f"Chrome/{ver}.0.0.0 Safari/537.36"
    )

def _random_sec_ch_ua(ua=None):
    if ua is None:
        ua = _random_ua()
    m = re.search(r"Chrome/(\d+)", ua)
    ver = m.group(1) if m else "120"
    major = ver.split(".")[0]
    return (
        f'"Not_A Brand";v="8", "Chromium";v="{ver}", '
        f'"Google Chrome";v="{ver}", "Brave";v="{major}"'
    )

def _random_sec_ch_ua_platform():
    return random.choice(['"Windows"', '"Windows NT 10.0"', '"macOS"'])

def _random_accept_lang():
    return random.choice(_ACCEPT_LANGS)

# ================= Sentinel Token Generator =================
class SentinelTokenGenerator:
    MAX_ATTEMPTS = 500000
    ERROR_PREFIX = "wQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D"

    def __init__(self, device_id=None, user_agent=None):
        self.device_id = device_id or str(uuid.uuid4())
        self.user_agent = user_agent or _random_ua()
        self.requirements_seed = str(random.random())
        self.sid = str(uuid.uuid4())
        m = re.search(r"Chrome/(\d+)", self.user_agent)
        self.chrome_version = m.group(1) if m else "120"

    @staticmethod
    def _fnv1a_32(text: str):
        h = 2166136261
        for ch in text:
            h ^= ord(ch)
            h = (h * 16777619) & 0xFFFFFFFF
        h ^= (h >> 16)
        h = (h * 2246822507) & 0xFFFFFFFF
        h ^= (h >> 13)
        h = (h * 3266489909) & 0xFFFFFFFF
        h ^= (h >> 16)
        h &= 0xFFFFFFFF
        return format(h, "08x")

    def _get_config(self):
        now_str = time.strftime(
            "%a %b %d %Y %H:%M:%S GMT+0000 (Coordinated Universal Time)",
            time.gmtime(),
        )
        perf_now = random.uniform(1000, 50000)
        time_origin = time.time() * 1000 - perf_now
        nav_prop = random.choice([
            "vendorSub", "productSub", "vendor", "maxTouchPoints",
            "scheduling", "userActivation", "doNotTrack", "geolocation",
            "connection", "plugins", "mimeTypes", "pdfViewerEnabled",
            "webkitTemporaryStorage", "webkitPersistentStorage",
            "hardwareConcurrency", "cookieEnabled", "credentials",
            "mediaDevices", "permissions", "locks", "ink",
        ])
        nav_val = f"{nav_prop}-undefined"
        return [
            "1920x1080", now_str, 4294705152, random.random(),
            self.user_agent,
            f"https://sentinel.openai.com/sentinel/20260124ceb8/sdk.js",
            None, None, "en-US", "en-US,en", random.random(), nav_val,
            random.choice(["location", "implementation", "URL", "documentURI", "compatMode"]),
            random.choice(["Object", "Function", "Array", "Number", "parseFloat", "undefined"]),
            perf_now, self.sid, "", random.choice([4, 8, 12, 16]), time_origin,
        ]

    @staticmethod
    def _base64_encode(data):
        raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        return base64.b64encode(raw).decode("ascii")

    def _run_check(self, start_time, seed, difficulty, config, nonce):
        config[3] = nonce
        config[9] = round((time.time() - start_time) * 1000)
        data = self._base64_encode(config)
        hash_hex = self._fnv1a_32(seed + data)
        diff_len = len(difficulty)
        if hash_hex[:diff_len] <= difficulty:
            return data + "~S"
        return None

    def generate_token(self, seed=None, difficulty=None):
        seed = seed if seed is not None else self.requirements_seed
        difficulty = str(difficulty or "0")
        start_time = time.time()
        config = self._get_config()
        for i in range(self.MAX_ATTEMPTS):
            result = self._run_check(start_time, seed, difficulty, config, i)
            if result:
                return "gAAAAAB" + result
        return "gAAAAAB" + self.ERROR_PREFIX + self._base64_encode(str(None))

    def generate_requirements_token(self):
        config = self._get_config()
        config[3] = 0
        return "gAAAAAB" + self._base64_encode(config) + "~S"

def _make_trace_headers():
    trace_id = random.randint(10**17, 10**18 - 1)
    parent_id = random.randint(10**17, 10**18 - 1)
    tp = f"00-{uuid.uuid4().hex}-{format(parent_id, '016x')}-01"
    return {
        "traceparent": tp, "tracestate": "dd=s:1;o:rum",
        "x-datadog-origin": "rum", "x-datadog-sampling-priority": "1",
        "x-datadog-trace-id": str(trace_id), "x-datadog-parent-id": str(parent_id),
    }

def _generate_pkce():
    v = secrets.token_urlsafe(64)
    digest = hashlib.sha256(v.encode("ascii")).digest()
    c = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return v, c

def build_sentinel_token(session, device_id, flow, user_agent=None, sec_ch_ua=None, impersonate="chrome"):
    gen = SentinelTokenGenerator(device_id=device_id, user_agent=user_agent)
    body = {"p": gen.generate_requirements_token(), "id": device_id, "flow": flow}
    h = {
        "Content-Type": "text/plain;charset=UTF-8",
        "Referer": "https://sentinel.openai.com/backend-api/sentinel/frame.html",
        "Origin": "https://sentinel.openai.com",
        "User-Agent": user_agent or _random_ua(),
        "sec-ch-ua": sec_ch_ua or _random_sec_ch_ua(user_agent),
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": _random_sec_ch_ua_platform(),
    }
    try:
        resp = session.post(
            "https://sentinel.openai.com/backend-api/sentinel/req",
            data=json.dumps(body), headers=h, timeout=20, impersonate=impersonate
        )
        if resp.status_code == 200:
            data = resp.json()
            c_val = data.get("token", "")
            pow_data = data.get("proofofwork") or {}
            if pow_data.get("required") and pow_data.get("seed"):
                p_val = gen.generate_token(seed=pow_data.get("seed"), difficulty=pow_data.get("difficulty", "0"))
            else:
                p_val = gen.generate_requirements_token()
            return json.dumps({"p": p_val, "t": "", "c": c_val, "id": device_id, "flow": flow}, separators=(",", ":"))
    except:
        pass
    return ""

# ================= 邮箱相关 =================
def generate_email():
    prefix = "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(8))
    return f"{prefix}@{_current_domain}"

def generate_password():
    chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
    return "".join(secrets.choice(chars) for _ in range(12))

def wait_code(email, max_wait=120, interval=3):
    print(f"[*] 等待验证码...", end="", flush=True)
    email_key = (email or "").strip().lower()
    for _ in range(max_wait):
        print(".", end="", flush=True)
        try:
            ua = _random_ua()
            r = std_requests.get(
                f"{VERIFY_API_URL}?email={quote(email_key, safe='')}&t={int(time.time()*1000)}",
                timeout=10,
                headers={
                    "Accept": "application/json",
                    "Accept-Language": "en-US,en;q=0.9",
                    "User-Agent": ua,
                },
            )
            if r.status_code == 200 and r.json().get("code"):
                code = re.sub(r'\D', '', str(r.json()["code"]))[:6]
                print(f" -> {code}")
                return code
        except Exception as e:
            if _ == 0:
                print(f"\n[!] Worker 异常(将重试): {e}", flush=True)
        time.sleep(interval + random.uniform(-0.5, 0.5))
    return None

# ================= 注册类 =================
class OpenAIRegister:
    def __init__(self):
        self.ua = _random_ua()
        m = re.search(r"Chrome/(\d+)", self.ua)
        ver = m.group(1) if m else "120"
        self.sec_ch_ua = _random_sec_ch_ua(self.ua)
        self.sec_ch_ua_mobile = "?0"
        self.sec_ch_ua_platform = _random_sec_ch_ua_platform()
        self.impersonate = cast(Any, random.choice(_IMPERSONATE_TARGETS))
        self.session = _new_http_session(self.impersonate)
        _apply_session_proxies(self.session, _proxies())
        self.device_id = str(uuid.uuid4())
        self._init_cookies()

    def _init_cookies(self):
        did = self.device_id
        ts = int(time.time())
        self.session.cookies.set("__cf_bm", f"fake_{secrets.token_hex(16)}-{ts}", domain=".openai.com")
        self.session.cookies.set("_cfuvid", f"fake_{secrets.token_hex(20)}-{ts}", domain=".openai.com")
        self.session.cookies.set("oai-did", did, domain=".openai.com")
        self.session.cookies.set("oai-did", did, domain="chatgpt.com")
        self.session.cookies.set("oai-did", did, domain=".auth.openai.com")
        self.session.cookies.set("__Secure-next-auth.callback-url", BASE, domain=".auth.openai.com")
        self.session.cookies.set("__Secure-next-auth.session-token", secrets.token_hex(32), domain=".auth.openai.com")
        self.session.cookies.set("rg_context", "prim", domain=".openai.com")
        self.session.cookies.set("iss_context", "default", domain=".openai.com")
        self.session.cookies.set("__cflb", f"0H{secrets.token_hex(16)}", domain=".openai.com")
        self.session.cookies.set("dclid", secrets.token_hex(16), domain=".openai.com")
        g_state = f"0_l:{ts}"
        self.session.cookies.set("g_state", g_state, domain=".openai.com")

    def _random_delay(self, lo=0.5, hi=1.5):
        time.sleep(random.uniform(lo, hi))

    def _headers_base(self, referer=None, extra_accept=None):
        h = {
            "Accept": extra_accept or "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
            "Sec-Ch-Ua": self.sec_ch_ua,
            "Sec-Ch-Ua-Mobile": self.sec_ch_ua_mobile,
            "Sec-Ch-Ua-Platform": self.sec_ch_ua_platform,
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "User-Agent": self.ua,
        }
        if referer:
            h["Referer"] = referer
        return h

    def register(self, email: str, password: str, name: str = "OpenAI User", birthdate: str = "1995-01-01"):
        """仅注册流程：Step 0-7，不获取 Token"""
        print(f"\n[*] 邮箱: {email}")
        print(f"[*] 密码: {password}")
        print(f"[*] 姓名: {name}, 生日: {birthdate}")
        print(f"[*] UA: {self.ua}")
        print(f"[*] impersonate: {self.impersonate}")

        # Step 0: Visit homepage
        print("\n[*] Step 0: Visit homepage...")
        self._random_delay(1.0, 2.0)
        try:
            h0 = self._headers_base(BASE, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            h0["Upgrade-Insecure-Requests"] = "1"
            self.session.get(BASE, headers=h0, timeout=15)
        except:
            pass
        self._random_delay(1.0, 2.0)

        # Step 1: Get CSRF
        print("[*] Step 1: Get CSRF...")
        h1 = self._headers_base(BASE, "application/json")
        h1["Referer"] = BASE + "/"
        try:
            r = self.session.get(f"{BASE}/api/auth/csrf", headers=h1, timeout=15)
            csrf = r.json().get("csrfToken", "") if r.status_code == 200 else ""
        except:
            csrf = ""
        self._random_delay(0.8, 1.5)

        # Step 2: Signin
        print("[*] Step 2: Signin...")
        v, c = _generate_pkce()
        params = {
            "prompt": "login", "ext-oai-did": self.device_id,
            "auth_session_logging_id": str(uuid.uuid4()),
            "screen_hint": "login_or_signup", "login_hint": email,
        }
        form_data = {"callbackUrl": f"{BASE}/", "csrfToken": csrf, "json": "true"}
        h2 = self._headers_base(BASE)
        h2["Content-Type"] = "application/x-www-form-urlencoded"
        h2["Origin"] = BASE
        try:
            r = self.session.post(
                f"{BASE}/api/auth/signin/openai",
                params=params, data=form_data, headers=h2,
            )
            print(f"[*] Signin status: {r.status_code}")
            data = r.json()
            print(f"[*] Signin response: {json.dumps(data, indent=2)[:500]}")
            url = data.get("url", "") if isinstance(data, dict) else ""
            print(f"[*] Signin URL: {url}")
        except Exception as e:
            print(f"[!] Signin exception: {e}")
            url = ""
        self._random_delay(1.0, 2.0)

        # Step 3: Authorize with retry
        need_otp = False
        authorize_retry = 3
        while authorize_retry > 0:
            print("[*] Step 3: Authorize...")
            h3 = self._headers_base(f"{BASE}/", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
            h3["Upgrade-Insecure-Requests"] = "1"
            try:
                r = self.session.get(url if url else f"{OAUTH_ISSUER}/authorize", headers=h3,
                    allow_redirects=True, timeout=15)
                final_url = str(r.url)
            except:
                final_url = url
            final_path = urlparse(final_url).path
            print(f"[*] 跳转: {final_path}")
            self._random_delay(1.0, 2.0)

            if "create-account/password" in final_path:
                print("[*] 全新注册流程...")
                h = self._headers_base(OAUTH_ISSUER, "application/json")
                h["Content-Type"] = "application/json"
                h["Origin"] = OAUTH_ISSUER
                h.update(_make_trace_headers())
                try:
                    r = self.session.post(
                        f"{OAUTH_ISSUER}/api/accounts/user/register",
                        json={"username": email, "password": password},
                        headers=h, timeout=15
                    )
                    print(f"[*] Register: {r.status_code}")
                    if r.status_code == 200:
                        need_otp = True
                        break
                    else:
                        print(f"[!] 注册失败: {r.text[:200]}")
                except Exception as e:
                    print(f"[!] 注册异常: {e}")
                authorize_retry -= 1
                if authorize_retry > 0:
                    print(f"[*] 等待 10 秒后重试 Step 3 ({authorize_retry} 次)...\n")
                    time.sleep(10)
                continue
            elif "email-verification" in final_path or "email-otp" in final_path:
                print("[*] 跳到 OTP 验证阶段")
                need_otp = True
                break
            else:
                print(f"[*] 未知跳转: {final_path}, 重试中 ({authorize_retry-1} 次)...\n")
                authorize_retry -= 1
                if authorize_retry > 0:
                    time.sleep(10)
                continue

        if authorize_retry == 0 or not need_otp:
            print("[FAIL] Step 3 重试耗尽")
            return None

        # Step 4-5: OTP 验证
        if need_otp:
            self._random_delay(1.0, 2.0)
            print("\n[*] Step 5: Send OTP...")
            h_otp_send = self._headers_base(
                f"{OAUTH_ISSUER}/create-account/password",
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            )
            h_otp_send["Upgrade-Insecure-Requests"] = "1"
            try:
                self.session.get(
                    f"{OAUTH_ISSUER}/api/accounts/email-otp/send",
                    headers=h_otp_send, allow_redirects=True, timeout=15
                )
            except:
                pass
            self._random_delay(2.0, 4.0)

            print("\n[*] Step 6: Validate OTP...")
            code = wait_code(email)
            if not code:
                return None
            self._random_delay(0.8, 1.5)

            h = self._headers_base(OAUTH_ISSUER, "application/json")
            h["Content-Type"] = "application/json"
            h["Origin"] = OAUTH_ISSUER
            h.update(_make_trace_headers())
            try:
                r = self.session.post(
                    f"{OAUTH_ISSUER}/api/accounts/email-otp/validate",
                    json={"code": code}, headers=h, timeout=15
                )
                print(f"[*] Validate OTP: {r.status_code}")
                if r.status_code != 200:
                    return None
            except Exception as e:
                print(f"[!] OTP 验证异常: {e}")
                return None

        # Step 7: Create Account
        self._random_delay(1.0, 2.0)
        print("\n[*] Step 7: Create Account...")
        for create_retry in range(4):
            h = self._headers_base(OAUTH_ISSUER, "application/json")
            h["Content-Type"] = "application/json"
            h["Origin"] = OAUTH_ISSUER
            h.update(_make_trace_headers())
            sen = build_sentinel_token(
                self.session, self.device_id, flow="signup",
                user_agent=self.ua, sec_ch_ua=self.sec_ch_ua,
                impersonate=self.impersonate,
            )
            if sen:
                h["openai-sentinel-token"] = sen
            body = {"name": name, "birthdate": birthdate}
            try:
                r = self.session.post(
                    f"{OAUTH_ISSUER}/api/accounts/create_account",
                    json=body, headers=h, timeout=15
                )
                print(f"[*] Create Account: {r.status_code}")
                if r.status_code == 200:
                    print("[*] 创建账户成功!")
                    break
                if "already" in (r.text or "").lower():
                    print("[*] 账号已存在，视为成功")
                    break
                if create_retry < 2:
                    self._random_delay(1.5, 2.5)
                    continue
            except Exception as e:
                print(f"[!] Create Account 异常: {e}")
                if create_retry < 2:
                    self._random_delay(1.5, 2.5)
                    continue
                return None

        return {"email": email, "password": password, "tokens": None}


def save_account(email, password, tokens=None):
    """保存账号：Codex Token 获取成功 -> with_token/，否则 -> without_token/"""
    tokens = tokens or {}
    has_token = bool(tokens.get("access_token"))
    target_dir = ACCOUNTS_WITH_TOKEN_DIR if has_token else ACCOUNTS_WITHOUT_TOKEN_DIR
    os.makedirs(target_dir, exist_ok=True)
    ts = int(time.time())
    path = os.path.join(target_dir, f"account_{email.replace('@', '_')}_{ts}.json")

    data = {"email": email, "password": password}

    with _file_lock:
        if has_token:
            os.makedirs(TOKEN_JSON_DIR, exist_ok=True)
            token_data = {
                "type": "codex",
                "email": email,
                "access_token": tokens.get("access_token", ""),
                "refresh_token": tokens.get("refresh_token", ""),
                "id_token": tokens.get("id_token", ""),
                "last_refresh": time.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
            }
            token_file = os.path.join(TOKEN_JSON_DIR, f"{email.split('@')[0]}.json")
            with open(token_file, "w", encoding="utf-8") as f:
                json.dump(token_data, f, indent=2, ensure_ascii=False)
            print(f"[*] Token 保存: {token_file}")

            at = tokens.get("access_token", "")
            rt = tokens.get("refresh_token", "")
            if at:
                _ensure_parent_dir(AK_FILE)
                with open(AK_FILE, "a", encoding="utf-8") as f:
                    f.write(at + "\n")
                print(f"[*] AK 追加: {AK_FILE}")
            if rt:
                _ensure_parent_dir(RK_FILE)
                with open(RK_FILE, "a", encoding="utf-8") as f:
                    f.write(rt + "\n")
                print(f"[*] RK 追加: {RK_FILE}")
            data["access_token"] = at

        _ensure_parent_dir(path)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"[*] 账号保存: {path}")
    return path


def run(domain=None, proxy=None, show_header=True):
    """单账号注册（仅注册，无 Token），支持外部覆盖域名和代理"""
    global _current_proxy, _current_domain
    if domain is not None:
        _current_domain = domain
    if proxy is not None:
        _current_proxy = proxy

    if show_header:
        print("\n" + "=" * 50)
        print("[*]  注册 (仅注册版 / 无 Token)")
        print(f"[*] 域名: {_current_domain}")
        print("=" * 50)

    time.sleep(random.uniform(2.0, 6.0))

    names = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Skyler"]
    surnames = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Miller", "Davis", "Wilson"]
    name = random.choice(names) + " " + random.choice(surnames)
    birthdate = f"{random.randint(1994, 2004)}-{random.randint(1, 12):02d}-{random.randint(1, 28):02d}"
    email = generate_email()
    password = generate_password()

    reg = OpenAIRegister()
    result = reg.register(email, password, name, birthdate)

    if result:
        save_account(result["email"], result["password"], result.get("tokens"))
        if show_header:
            print(f"\n{'=' * 50}")
            print("[SUCCESS] 注册完成!")
            print(f"[*] 邮箱: {result['email']}")
            print(f"[*] 密码: {result['password']}")
            print(f"[*] Codex Token: 未获取 (仅注册)")
            print(f"{'=' * 50}")
    else:
        if show_header:
            print(f"\n{'=' * 50}")
            print("[FAIL] 注册失败")
            print(f"{'=' * 50}")

    return result


def _should_pause(no_pause: bool = False) -> bool:
    if no_pause or os.environ.get("CODEX_REGISTER_NO_PAUSE"):
        return False
    if getattr(sys, "frozen", False):
        return False
    try:
        return sys.stdin is not None and sys.stdin.isatty()
    except Exception:
        return False


def _pause_before_exit_if_needed() -> None:
    if not getattr(sys, "frozen", False):
        return
    if "--no-pause" in sys.argv:
        return
    if os.environ.get("CODEX_REGISTER_NO_PAUSE"):
        return
    try:
        input("\n按 Enter 键退出...")
    except EOFError:
        pass
    except KeyboardInterrupt:
        pass


def _is_interactive() -> bool:
    try:
        return sys.stdin is not None and sys.stdin.isatty()
    except Exception:
        return False


def _prompt_positive_int(prompt: str, default: int) -> int:
    raw = input(prompt).strip()
    return int(raw) if raw.isdigit() and int(raw) > 0 else default


def _choose_proxy_interactively(default_proxy):
    proxy = default_proxy
    if proxy:
        print(f"[Info] 检测到默认代理: {proxy}")
        use_default = input("使用此代理? (Y/n): ").strip().lower()
        if use_default == "n":
            proxy = input("输入代理地址 (留空=不使用代理): ").strip() or None
    else:
        env_proxy = (
            os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
            or os.environ.get("ALL_PROXY") or os.environ.get("all_proxy")
        )
        if env_proxy:
            print(f"[Info] 检测到环境变量代理: {env_proxy}")
            use_env = input("使用此代理? (Y/n): ").strip().lower()
            proxy = None if use_env == "n" else env_proxy
            if use_env == "n":
                proxy = input("输入代理地址 (留空=不使用代理): ").strip() or None
        else:
            proxy = input("输入代理地址 (如 http://127.0.0.1:7890，留空=不使用代理): ").strip() or None

    print(f"[Info] {'使用代理: ' + proxy if proxy else '不使用代理'}")
    return proxy


def _quick_preflight(proxy: Optional[str] = None) -> bool:
    print("\n[Preflight] 开始连通性检查...")
    sess = _new_http_session("chrome131")
    _apply_session_proxies(sess, {"http": proxy, "https": proxy} if proxy else None)

    checks = []

    def _record(name: str, ok: bool, detail: str):
        checks.append((name, ok, detail))
        mark = "✅" if ok else "❌"
        print(f"  {mark} {name}: {detail}")

    try:
        r = sess.get(f"{BASE}/", timeout=20, allow_redirects=True)
        _record("chatgpt.com", r.status_code != 403, f"status={r.status_code}")
    except Exception as e:
        _record("chatgpt.com", False, f"异常: {e}")

    try:
        r = sess.get(
            f"{BASE}/api/auth/csrf",
            headers={"Accept": "application/json", "Referer": f"{BASE}/"},
            timeout=20,
        )
        data = r.json()
        token = data.get("csrfToken", "") if isinstance(data, dict) else ""
        _record("chatgpt csrf", bool(token), f"status={r.status_code}, token={'yes' if token else 'no'}")
    except Exception as e:
        _record("chatgpt csrf", False, f"非 JSON 或异常: {e}")

    try:
        r = sess.get(f"{OAUTH_ISSUER}/", timeout=20, allow_redirects=True)
        _record("auth.openai.com", r.status_code < 500, f"status={r.status_code}")
    except Exception as e:
        _record("auth.openai.com", False, f"异常: {e}")

    try:
        r = std_requests.get(
            VERIFY_API_URL,
            timeout=15,
            headers={"Accept": "application/json", "User-Agent": _random_ua()},
        )
        _record("verify api", r.status_code < 500, f"status={r.status_code}")
    except Exception as e:
        _record("verify api", False, f"异常: {e}")

    all_ok = all(ok for _, ok, _ in checks)
    if all_ok:
        print("[Preflight] 通过，开始注册。")
    else:
        print("[Preflight] 未通过，建议先更换代理或降低并发后再试。")
    return all_ok


def _run_one(idx, total, domain=None, proxy=None):
    try:
        with _print_lock:
            print(f"\n{'=' * 60}")
            print(f"  [{idx}/{total}] 开始注册")
            print(f"  域名: {domain or _current_domain}")
            print(f"  代理: {proxy or '不使用代理'}")
            print(f"{'=' * 60}")
        result = run(domain=domain, proxy=proxy, show_header=(total == 1))
        if result:
            return True, result.get("email"), None
        return False, None, "注册流程返回空结果"
    except Exception as e:
        with _print_lock:
            print(f"\n[FAIL] [{idx}] 注册异常: {e}")
            traceback.print_exc()
        return False, None, str(e)


def run_batch(total_accounts: int = 1, max_workers: int = 1, domain=None, proxy=None):
    total_accounts = max(1, int(total_accounts or 1))
    actual_workers = max(1, min(int(max_workers or 1), total_accounts))

    print(f"\n{'#' * 60}")
    print("  OpenAI 批量注册 (仅注册版)")
    print(f"  注册数量: {total_accounts} | 并发数: {actual_workers}")
    print(f"  域名: {domain or _current_domain}")
    print(f"  代理: {proxy or '不使用代理'}")
    print(f"  验证码接口: {VERIFY_API_URL}")
    print(f"  输出目录: {ACCOUNTS_WITHOUT_TOKEN_DIR}")
    print(f"{'#' * 60}\n")

    success_count = 0
    fail_count = 0
    completed_count = 0
    start_time = time.time()
    _render_apt_like_progress(completed_count, total_accounts, success_count, fail_count, start_time)

    with ThreadPoolExecutor(max_workers=actual_workers) as executor:
        futures = {
            executor.submit(_run_one, idx, total_accounts, domain, proxy): idx
            for idx in range(1, total_accounts + 1)
        }
        for future in as_completed(futures):
            idx = futures[future]
            try:
                ok, email, err = future.result()
                if ok:
                    success_count += 1
                else:
                    fail_count += 1
                    print(f"  [账号 {idx}] 失败: {err}")
            except Exception as e:
                fail_count += 1
                print(f"[FAIL] 账号 {idx} 线程异常: {e}")
            finally:
                completed_count += 1
                _render_apt_like_progress(completed_count, total_accounts, success_count, fail_count, start_time)

    with _print_lock:
        print()

    elapsed = time.time() - start_time
    avg = elapsed / total_accounts if total_accounts else 0
    print(f"\n{'#' * 60}")
    print(f"  注册完成! 耗时 {elapsed:.1f} 秒")
    print(f"  总数: {total_accounts} | 成功: {success_count} | 失败: {fail_count}")
    print(f"  平均速度: {avg:.1f} 秒/个")
    print(f"{'#' * 60}")
    return success_count, fail_count


def _run_smoke_test() -> None:
    print("[Smoke] Starting Register Only smoke test.")
    print(f"[Smoke] Runtime dir: {APP_RUNTIME_DIR}")
    print(f"[Smoke] Accounts dir: {ACCOUNTS_DIR}")

    with tempfile.TemporaryDirectory(prefix="register-only-smoke-") as temp_dir:
        marker_path = os.path.join(temp_dir, "artifacts", "marker.txt")
        _ensure_parent_dir(marker_path)
        with open(marker_path, "w", encoding="utf-8") as handle:
            handle.write("ok\n")

    user_agent = _random_ua()
    sec_ch_ua = _random_sec_ch_ua(user_agent)
    if "Chrome/" not in user_agent or "Chromium" not in sec_ch_ua:
        raise RuntimeError("User agent generation failed.")

    sentinel = SentinelTokenGenerator(user_agent=user_agent)
    if not sentinel.chrome_version:
        raise RuntimeError("Sentinel token generator did not resolve a Chrome version.")

    print("[Smoke] Register Only smoke test passed.")


def main():
    global _current_proxy, _current_domain

    parser = argparse.ArgumentParser(description="OpenAI 注册机 - 仅注册版")
    parser.add_argument("-n", "--count", type=int, default=None, help="注册账号数量")
    parser.add_argument("-w", "--workers", type=int, default=None, help="并发数")
    parser.add_argument("--domain", type=str, default=None, help="邮箱域名")
    parser.add_argument("--proxy", type=str, default=None, help="代理地址")
    parser.add_argument("--no-proxy", action="store_true", help="禁用代理")
    parser.add_argument("--skip-preflight", action="store_true", help="跳过启动前连通性预检")
    parser.add_argument("--force", action="store_true", help="预检失败也继续执行")
    parser.add_argument("--smoke-test", action="store_true", help="运行无副作用的最小自检")
    parser.add_argument("--no-pause", action="store_true", help="完成后不等待回车")
    args = parser.parse_args()

    if args.count is not None and args.count < 1:
        parser.error("--count 必须大于 0")
    if args.workers is not None and args.workers < 1:
        parser.error("--workers 必须大于 0")
    if args.proxy is not None and args.no_proxy:
        parser.error("--proxy 和 --no-proxy 不能同时使用")
    if args.smoke_test:
        _run_smoke_test()
        return

    interactive = _is_interactive()
    if args.domain:
        _current_domain = args.domain.strip() or DOMAIN

    print("=" * 60)
    print("  OpenAI 注册机 - 仅注册版")
    print(f"  默认域名: {_current_domain}")
    print("=" * 60)

    if args.no_proxy:
        proxy = None
        print("[Info] 已通过参数禁用代理")
    elif args.proxy is not None:
        proxy = args.proxy.strip() or None
        print(f"[Info] 已通过参数指定代理: {proxy or '不使用代理'}")
    elif interactive:
        proxy = _choose_proxy_interactively(_current_proxy)
    else:
        proxy = _current_proxy
        print(f"[Info] {'使用默认代理: ' + proxy if proxy else '不使用代理'}")

    _current_proxy = proxy

    do_preflight = not args.skip_preflight
    if interactive and not args.skip_preflight:
        preflight_input = input("\n执行启动前连通性预检? (Y/n): ").strip().lower()
        do_preflight = preflight_input != "n"

    if do_preflight and not _quick_preflight(proxy=proxy):
        if args.force:
            print("[Preflight] 已通过 --force 忽略失败，继续执行。")
        elif interactive:
            print("\n⚠️  预检失败，按 Enter 退出；输入 c 可继续强制运行")
            action = input("继续? (c/Enter): ").strip().lower()
            if action != "c":
                return
        else:
            print("[Preflight] 失败，使用 --force 可忽略并继续。")
            return

    if args.count is not None:
        total_accounts = args.count
        print(f"[Info] 已通过参数指定注册数量: {total_accounts}")
    elif interactive:
        total_accounts = _prompt_positive_int("\n注册账号数量 (默认 1): ", 1)
    else:
        total_accounts = 1

    if args.workers is not None:
        max_workers = args.workers
        print(f"[Info] 已通过参数指定并发数: {max_workers}")
    elif interactive:
        max_workers = _prompt_positive_int("并发数 (默认 1): ", 1)
    else:
        max_workers = 1

    run_batch(total_accounts=total_accounts, max_workers=max_workers, domain=_current_domain, proxy=proxy)

    if total_accounts == 1 and _should_pause(args.no_pause):
        input("\n按回车键退出...")


if __name__ == "__main__":
    try:
        main()
    finally:
        _pause_before_exit_if_needed()
