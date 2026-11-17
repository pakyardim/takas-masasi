"""One-time Yahoo login: python -m backend.auth_cli"""
import webbrowser

from dotenv import load_dotenv

load_dotenv()

from .yahoo import TOKEN_FILE, YahooAuth  # noqa: E402

auth = YahooAuth()
url = auth.authorize_url()
print("Tarayıcıda Yahoo'ya giriş yap ve izin ver:\n\n  " + url + "\n")
webbrowser.open(url)
code = input("Yahoo'nun verdiği kodu buraya yapıştır: ")
auth.exchange_code(code)
print(f"Tamam. Token kaydedildi: {TOKEN_FILE.name}")
