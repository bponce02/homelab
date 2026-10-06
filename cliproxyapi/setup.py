import hashlib
import json
import os
import secrets
from pathlib import Path
from urllib.request import urlopen

root = Path(__file__).resolve().parent.parent
secret_dir = root / "config/env/cliproxyapi"
data_dir = root / "config/volumes/cliproxyapi"
os.umask(0o077)

for directory in (secret_dir, data_dir / "auth", data_dir / "static", data_dir / "logs"):
    directory.mkdir(parents=True, exist_ok=True)

config = secret_dir / "config.yaml"
credentials = secret_dir / "credentials.json"
if config.exists() != credentials.exists():
    raise SystemExit("Incomplete existing setup; recover config/credentials before continuing.")
if not config.exists():
    keys = {"management_key": secrets.token_urlsafe(48), "client_key": secrets.token_urlsafe(48)}
    template = (root / "cliproxyapi/config.example.yaml").read_text()
    config.write_text(template.replace("REPLACE_MANAGEMENT_KEY", keys["management_key"]).replace("REPLACE_CLIENT_KEY", keys["client_key"]))
    credentials.write_text(json.dumps(keys, indent=2) + "\n")

panel = data_dir / "static/management.html"
if not panel.exists():
    with urlopen("https://github.com/router-for-me/Cli-Proxy-API-Management-Center/releases/download/v1.25.3/management.html", timeout=120) as response:
        content = response.read()
    digest = hashlib.sha256(content).hexdigest()
    if digest != "866bae020785b59126a209e89389b77f673fd791beb2208ea650dcc07b3a108d":
        raise SystemExit("Management panel checksum mismatch; refusing to install.")
    panel.write_bytes(content)
    print("Management panel v1.25.3 checksum verified.")

print("Configuration ready. Credentials: config/env/cliproxyapi/credentials.json")
