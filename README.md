# Discord AI Bot

## Cài đặt

1. Cài Node.js 22.12+.
2. Điền `config.json`:
   - DISCORD_TOKEN
   - GROQ_API_KEY
   - CLIENT_ID
3. Chạy:

```bash
npm install
npm start
```

## Chức năng

- `/help`
- `/join`
- `/log [limit]`
- Groq AI với `. nội dung`
- Reply vào tin nhắn AI để tiếp tục hội thoại
- Tự gửi `m!play` cho link YouTube/Spotify/SoundCloud
- `stop` -> `m!stop`
- `skip` -> `m!skip`
- Voice activity logger lưu tại `data/voice-logs.json`

## Discord Developer Portal

Bật:
- Message Content Intent

Bot cần quyền:
- View Channel
- Connect
- Send Messages
- Embed Links
- Read Message History
