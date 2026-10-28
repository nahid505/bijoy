# বিজয় লেনদেন — cPanel / Recohost ডিপ্লয় গাইড (সংক্ষিপ্ত)

আরও বিস্তারিত তথ্য ও সমস্যা সমাধানের জন্য দেখুন `FINAL-RECOHOST-DEPLOYMENT.md`।

**যা লাগবে:**
- cPanel-এ "Setup Node.js App" (CloudLinux), **Node.js 22**।
- একটি MySQL 8 / MariaDB 10.6+ ডেটাবেজ। PostgreSQL 13+ থাকলেও চলবে।
- cPanel "Terminal" বা SSH (প্রস্তাবিত)।

---

## ১. প্যাকেজ তৈরি (নিজের কম্পিউটারে)

```bash
npm run deploy:cpanel                       # MySQL / MariaDB (cPanel-এর সাধারণ ডেটাবেজ)
npm run deploy:cpanel -- --db=postgresql    # PostgreSQL হলে
```

কমান্ডটি নিজে থেকে এই কাজগুলো করে:
- আগের বিল্ড ও ক্যাশ মুছে নতুন প্রোডাকশন বিল্ড বানায়;
- শুধু চালানোর জন্য দরকারি ফাইল নেয়: standalone সার্ভার, `.next/static`, `public`, Prisma মাইগ্রেশন, `app.js`;
- TypeScript, টাইপ ফাইল, source map ও অন্য প্ল্যাটফর্মের ইঞ্জিন বাদ দেয়;
- `.env` বা কোনো গোপন তথ্য প্যাকেজে আছে কিনা পরীক্ষা করে (থাকলে প্যাকেজই বানায় না);
- প্রতিটি ফাইলের চেকসাম (`SHA256SUMS.txt`) লিখে রাখে।

ফলাফল: **`dist/deploy.tar.gz`** (প্রায় ২৬ MB)। একই জিনিস zip হিসেবেও থাকে: `dist/bijoy-lenden-cpanel.zip`।

## ২. ডেটাবেজ তৈরি (cPanel → MySQL® Database Wizard)

১. ডেটাবেজ তৈরি করুন, যেমন `cpuser_bijoy` (cPanel নামের আগে ইউজারনেম বসিয়ে দেয়)।
২. ইউজার তৈরি করুন, যেমন `cpuser_bijoyapp`, আর একটি শক্ত পাসওয়ার্ড দিন।
৩. ইউজারটিকে ডেটাবেজে **ALL PRIVILEGES** দিন।

সংযোগের ঠিকানা (`DATABASE_URL`) হবে এরকম:

```
mysql://cpuser_bijoyapp:পাসওয়ার্ড@localhost:3306/cpuser_bijoy
```

পাসওয়ার্ডে `@ : / # ? %` থাকলে URL-encode করুন (`@` → `%40`, `#` → `%23`)।

## ৩. ফাইল আপলোড

১. cPanel → **File Manager** খুলে হোম ফোল্ডারে যান (`/home/USER/`)। **`public_html`-এর ভেতরে নয়।**
২. `deploy.tar.gz` আপলোড করুন → ফাইলটিতে ডান-ক্লিক → **Extract**। একটি `bijoy-lenden` ফোল্ডার তৈরি হবে।
৩. আলাদা করে `node_modules` আপলোড করবেন না; যা দরকার তা প্যাকেজেই আছে।

## ৪. Setup Node.js App

cPanel → **Setup Node.js App** → **Create Application**:

| ঘর | মান |
|---|---|
| Node.js version | **22.x** |
| Application mode | Production |
| Application root | `bijoy-lenden` |
| Application URL | আপনার ডোমেইন / সাবডোমেইন |
| Application startup file | **`app.js`** |

**Create** চাপুন। **"Run NPM Install" চাপার দরকার নেই।**

## ৫. `.env` সেটআপ

১. `bijoy-lenden` ফোল্ডারে `env.production.example` ফাইলটি কপি করে নাম দিন **`.env`**। পারমিশন **600** করুন।
২. অন্তত এগুলো পূরণ করুন:

```
DATABASE_URL=mysql://cpuser_bijoyapp:…@localhost:3306/cpuser_bijoy
AUTH_SECRET=<৬৪ অক্ষরের র‍্যান্ডম>      # তৈরি: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
APP_URL=https://আপনার-ডোমেইন
COOKIE_SECURE=true
CRON_SECRET=<আরেকটি র‍্যান্ডম>
```

৩. SMS বা পেমেন্ট গেটওয়ে লাগলে সেই ঘরগুলোও পূরণ করুন।

একই মান চাইলে Setup Node.js App-এর "Environment variables" ঘরেও দেওয়া যায়। দুই জায়গায় থাকলে cPanel-এরটাই প্রাধান্য পায়।

## ৬. মাইগ্রেশন ও যাচাই (cPanel → Terminal)

Setup Node.js App পেজের ওপরে যে `source …/activate` কমান্ড দেখায়, সেটি দিয়ে শুরু করুন:

```bash
source ~/nodevenv/bijoy-lenden/22/bin/activate && cd ~/bijoy-lenden
node check-files.cjs        # সব ফাইল আছে ও অক্ষত কিনা (অ্যান্টিভাইরাস কিছু সরিয়েছে কিনা)
sh migrate.sh               # ডেটাবেজ টেবিল তৈরি / হালনাগাদ
node check-server.cjs       # Node, ইঞ্জিন, ডেটাবেজ ও কনফিগারেশন পরীক্ষা
```

এরপর Setup Node.js App → **Restart** চাপুন, তারপর ব্রাউজারে ডোমেইনটি খুলুন। যাচাইয়ের জন্য `https://ডোমেইন/api/health` খুললে `"status":"ok"` দেখাবে।

## ৭. প্রথম অ্যাকাউন্ট ও ক্রন

১. ওয়েবসাইটে রেজিস্টার করুন। তারপর Terminal-এ আপনাকে সুপার অ্যাডমিন করুন:

```bash
node super-admin.cjs grant you@example.com
```

২. cPanel → **Cron Jobs**-এ এগুলো যোগ করুন:

```
0 * * * *    /bin/sh /home/USER/bijoy-lenden/cron.sh daily-check
*/5 * * * *  /bin/sh /home/USER/bijoy-lenden/cron.sh sms-queue        # SMS ব্যবহার করলে
30 2 * * *   /bin/sh /home/USER/bijoy-lenden/backup-db.sh             # প্রতিদিনের ডেটাবেজ ব্যাকআপ
```

## ৮. অ্যান্টিভাইরাস (ImunifyAV / ClamAV) ফাইল আটকালে

প্যাকেজে কোনো ডেভ-ডিপেন্ডেন্সি, ক্যাশ, source map বা অপ্রয়োজনীয় বাইনারি থাকে না। তবু কোনো স্ক্যানার ভুল করে (ফলস-পজিটিভ) একটি minified JS বা Prisma ইঞ্জিন (`.so.node`) সরিয়ে দিলে:

১. `node check-files.cjs` চালান। এটি সরানো বা বদলানো ফাইলের নাম দেখাবে।
২. cPanel → **ImunifyAV** (বা Virus Scanner) থেকে ফাইলটি **Restore** বা "False positive" করুন, অথবা হোস্টের সাপোর্টকে নাম জানিয়ে whitelist করতে বলুন।
৩. প্রয়োজনে `deploy.tar.gz` আবার Extract করুন, তারপর `check-files.cjs` আবার চালান।

## ৯. পরের আপডেট

১. `sh backup-db.sh` দিয়ে ডেটাবেজের ব্যাকআপ নিন।
২. নিজের কম্পিউটারে `npm run deploy:cpanel` চালিয়ে নতুন প্যাকেজ বানান।
৩. নতুন `deploy.tar.gz` আপলোড করে একই ফোল্ডারে Extract করুন। `.env` থেকে যাবে, কারণ প্যাকেজে `.env` থাকে না।
৪. Terminal-এ চালান: `node check-files.cjs && sh migrate.sh` → তারপর **Restart**।

## বিকল্প: সার্ভারেই বিল্ড (শুধু পর্যাপ্ত RAM থাকলে, ≥ ২ GB)

Git দিয়ে সোর্স এনে সার্ভারে বিল্ড করতে চাইলে:

```bash
npm ci
npx prisma generate --schema prisma/mysql/schema.prisma
npm run build
```

তারপর Setup Node.js App-এ **Application startup file: `server.js`** দিন (রুটের ফাইল)। এটি `.next/standalone/server.js` চালু করে, আর প্রথমবার `.next/static` ও `public` সেখানে কপি করে নেয়।

সাধারণ শেয়ার্ড হোস্টিংয়ে মেমরি কম থাকায় বিল্ড ব্যর্থ হতে পারে, তাই আপলোড-প্যাকেজ পদ্ধতিটিই প্রস্তাবিত।

## দ্রুত সমস্যা সমাধান

| লক্ষণ | কী করবেন |
|---|---|
| অ্যাপ চালু হয় না, লগে "Prisma … engine not found" | `node check-files.cjs` চালান: ইঞ্জিন কি অ্যান্টিভাইরাস সরিয়েছে? সার্ভারটি Debian / Ubuntu হলে প্যাকেজ বানান `npm run deploy:cpanel -- --engines=all` দিয়ে |
| `/api/health`-এ `"database":"error"` | `DATABASE_URL`-এর ইউজার, পাসওয়ার্ড (URL-encode), ডেটাবেজের নাম আর ইউজারের privilege পরীক্ষা করুন |
| লগইনের পর আবার লগইন পেজ দেখায় | HTTPS থাকলে `COOKIE_SECURE=true` আর `APP_URL` সঠিক কিনা দেখুন |
| রেজিস্ট্রেশনে "কোড সঠিক নয়" | মোবাইলে OTP যায়। SMS সেটআপ না থাকলে আপাতত `REGISTRATION_OTP=false` দিন |
| পরিবর্তনের পর পুরনো পেজ / নতুন মেনু দেখায় না | `/api/health`-এর `"build"` মিলিয়ে দেখুন (নতুন প্যাকেজের `.next/BUILD_ID`); না মিললে পুরনো বিল্ড চলছে → Setup Node.js App → **Restart** (না হলে **Stop**, তারপর **Start**)। `"migration"`-এ সর্বশেষ মাইগ্রেশনের নাম থাকবে |
