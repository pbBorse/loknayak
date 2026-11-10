=====================================================
  LOKNAYAK  -  News Portal + Interactive E-Paper
=====================================================

1) ONE-TIME SETUP (on your PC)
   - Install Node.js (LTS version) from https://nodejs.org  (click Next, Next, Finish)
   - Unzip this folder anywhere.
     (node_modules is already included - you do NOT need "npm install")

2) RUN
   Windows  : double-click  START-WINDOWS.bat
   Mac/Linux: open terminal in this folder and run   node server.js

   Keep the black window open. Then open in your browser:
      Website : http://localhost:3000
      Login   : http://localhost:3000/panel.html
      E-Paper : http://localhost:3000/epaper.html
   (If port 3000 is busy it automatically uses 3001, 3002... see the black window.)

3) FIRST LOGIN (Super Admin)
      ID       : 9405941894
      Password : admin123
   -> left menu "पासवर्ड" -> change it immediately.

4) UPLOAD THE DAILY E-PAPER (same flow as your video)
   Admin Panel -> ई-पेपर -> "नवीन आवृत्ती" -> fill Title / Date / City -> "Publish Now"
   -> the Upload Pages screen opens -> choose PDF -> (DPI 150, Quality 80) -> Extract
      (pages are converted to JPG inside your browser - wait until 100%)
   -> "Area Maps" -> pick a page -> "Add Area Map" -> drag a box around each news
      -> (optional title) -> "Save All Area Maps"   (repeat for each page)
   Readers: click a news box (or press "✂ क्लिप" and drag any area) -> a clip with logo,
   date, page and website watermark opens -> WhatsApp / Facebook / X / Telegram /
   Email / Print / JPG / PDF.

5) REPORTERS
   Admin Panel -> रिपोर्टर्स -> enter name -> the system shows User ID + password (note it down).
   Reporter logs in at /panel.html and sees only the 3-field "नवी बातमी" form and own news.
   Settings -> tick "review required" if you want to approve reporter news before it goes live.

6) HOW TO CHANGE CREDENTIALS / KEYS
   - Admin password   : Panel -> पासवर्ड   (or "forgot password" OTP, only for 9405941894)
   - Reporter password: Panel -> रिपोर्टर्स -> "नवीन पासवर्ड"
   - AI Enhance (optional): copy ".env.example" to ".env" and put your key after
        ANTHROPIC_API_KEY=       (get a key at console.anthropic.com)
        Cheapest model is already the default (AI_MODEL=claude-haiku-5-5).
        Without a key the button still works with basic spacing/paragraph cleanup.
   - SMS OTP (optional): put your Fast2SMS key in .env  ->  FAST2SMS_KEY=...
        Without it, the OTP is printed in the black server window.
   - WhatsApp channel link, Facebook/YouTube links, push notifications (OneSignal App ID),
     weather city: Panel -> सेटिंग्ज
   After editing .env: close the black window and start again.

7) PUT IT LIVE ON THE INTERNET
   This is a normal Node.js app. Upload this folder to any Node host / VPS
   (Hostinger VPS, DigitalOcean, AWS Lightsail, Railway, Render with persistent disk) and run:
        node server.js        (use "pm2 start server.js" to keep it running)
   Point your domain (loknayak.in) to it, enable HTTPS (Caddy / Nginx / Cloudflare), and in .env set:
        SITE_URL=https://loknayak.in
   IMPORTANT: keep the "data" and "uploads" folders on persistent storage.

8) BACKUP
   Copy the "data" and "uploads" folders. That is everything.

Folders: server.js (backend) | public/ (website + panel) | data/ (database) | uploads/ (photos, PDFs)
