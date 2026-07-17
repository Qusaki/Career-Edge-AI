<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/c53d0f26-0531-433e-bdd8-de6bfa899f0b

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Run on other computers

- Set `VITE_API_URL` to the backend URL that users' browsers can reach. Production must use an HTTPS URL, for example `https://api.example.com`.
- Serve the frontend over HTTPS. Chrome requires a secure context for microphone and camera access; plain HTTP works only on `localhost`.
- The Analytics, Pre-Test, Post-Test, and Drills pages do not require WebGPU. University Enrollment and Thesis Defense use the local interview model and require a supported Chrome/Edge device with WebGPU and hardware acceleration.
- When sharing the Vite development server on a local network, the frontend automatically targets port `8000` on the computer serving the frontend instead of the visitor's `localhost`. Microphone/camera features still require HTTPS on that network address.
