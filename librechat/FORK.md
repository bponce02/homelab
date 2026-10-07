# Personal LibreChat fork

The homelab runs the native fork image `local/librechat-homelab:174ee2b46` with `docker-compose.fork.yml`. Do not use the old Pi-sync image patch overlay alongside it.

```sh
cd /home/melissa/homelab/librechat
sudo docker compose -f docker-compose.yml -f docker-compose.fork.yml up -d --no-deps librechat
```

The image is built from `/home/bponce/Documents/GitHub/LibreChat`. Its source commit includes native single-owner Pi session sync, inbox/device push, codemode selected-tool dispatch and bounded opaque image forwarding. General has `codemode` and `notify_user` enabled; its existing tools and approval settings were preserved. No new approval prompts are added.

Private fork credentials live in `config/env/librechat/fork.env` (ignored by Git). `librechat.yaml` contains public push configuration and the selected Pi owner ID. Do not rotate keys casually: existing device subscriptions depend on the VAPID key pair.

The laptop gateway publishes idle history automatically. Existing Pi sessions need `/reload` once their current turn completes to load the notification tool. Device notifications require a user click on the sidebar's enable button; no browser permission prompt is triggered automatically.

Private rollback backup: `/home/melissa/.local/state/librechat-fork/rollback-174ee2b46/`. Restore config and the original base image only after active jobs finish. Remove the two added General tools before reverting to the old image. Do not automatically restore the Mongo archive or delete imported chats: that would discard later user data. Imported Pi chats should be treated as read-only while running an image without native binding guards.

The production image was preflighted against a separate database containing existing users/roles/chat history but no schedules, devices or agents; the preflight container/database were removed. The live release passed authenticated read/config/runtime checks and laptop-to-inbox delivery. Real OS push display still requires an opted-in device.
