<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/bdcd5ae3-b97a-496c-a674-24c60effe97e

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`


## API Key mỗi người dùng

Trên giao diện có ô **Gemini API Key**. Key được lưu trong `localStorage` trình duyệt — lần sau mở lại không cần nhập lại.

Trên Render có thể không set `GEMINI_API_KEY` nếu mỗi người dùng tự nhập key.
Deploy: Build `npm install && npm run build`, Start `npm start`.
