# বিজয় লেনদেন — RecoHost (cPanel + MySQL) চূড়ান্ত Deployment নির্দেশিকা

> **অবস্থা:** অ্যাপটি এখন **MySQL 8.0.16+ / MariaDB 10.6+**-এ চলে। একই কোড আগের মতো PostgreSQL-এও চলে (Docker/VPS)।
> পুরো test suite (২৯২টি test) MySQL 8.0, MariaDB 10.11 ও PostgreSQL 17 — তিনটিতেই পাস করেছে।
> Package-টি Linux-এ (RHEL 9 + Node 22 + MySQL/MariaDB) চালিয়ে পুরো workflow পরীক্ষা করা হয়েছে।
> বিস্তারিত পরিবর্তন: [docs/MYSQL-MIGRATION-PLAN.md](docs/MYSQL-MIGRATION-PLAN.md)

নিচে যেখানে `‹…›` আছে, সেখানে আপনার নিজের তথ্য বসাবেন:
`‹CPANEL_USER›` cPanel username · `‹DOMAIN›` যেমন `erp.yourdomain.com` · `‹DB_NAME›` · `‹DB_USER›` · `‹DB_PASSWORD›` · `‹YOUR_EMAIL›`

---

## ০. শুরুর আগে cPanel-এ ৩টি জিনিস দেখুন

| কী | কোথায় | দরকার |
|---|---|---|
| Node.js | cPanel → Software → **Setup Node.js App** | Node **22.x** তালিকায় থাকতে হবে |
| ডেটাবেস version | cPanel → **phpMyAdmin** → ডান দিকে "Database server → Server version" | **MySQL 8.0.16+** অথবা **MariaDB 10.6+** |
| Terminal | cPanel → Advanced → **Terminal** (বা SSH) | চালু থাকতে হবে |

এর কোনোটি না থাকলে RecoHost সাপোর্টকে জিজ্ঞেস করুন (Node.js 22 / MariaDB 10.6+ চালু করা যায় কিনা), নয়তো VPS নিন।

---

## ১. Local PC (`D:\bijoy-lenden`)

| # | Command | আগে দেখুন | সফল হলে |
|---|---|---|---|
| L1 | `npm ci` | Node 22 ইনস্টল | error ছাড়া শেষ |
| L2 | `npm run check` | `docker compose up -d db` চালু (PostgreSQL test DB) | typecheck, lint, ২৯২ test পাস |
| L3 | `npm run package:cpanel` | L2 পাস | শেষে `✔ no .env / keys / backups / local secret values in the package`, `✔ dist\bijoy-lenden-cpanel.zip`, `Done (mysql)` |

(ঐচ্ছিক) MySQL-এ test: একটি খালি টেস্ট MySQL ডেটাবেস দিয়ে
`set TEST_MYSQL_URL=mysql://user:pass@127.0.0.1:3306/test_db` তারপর `npm run test:mysql`।

**Upload করবেন শুধু:** `dist\bijoy-lenden-cpanel.zip`। ভেতরে আছে:
`app.js` (startup), `server.js`, `.next/`, `node_modules/` (MySQL Prisma Client + Linux engine), `public/`, `prisma/` (MySQL schema + baseline migration), `migrate.sh`, `check-server.cjs`, `super-admin.cjs`, `cron.sh`, `backup-db.sh`, `env.production.example`, `DATABASE.txt`, এই নির্দেশিকা।
**কখনো নয়:** আপনার `.env`, `backups\`, `.git\`, সোর্স কোড।

---

## ২. cPanel-এ সেটআপ

### G. ডেটাবেস তৈরি (cPanel → **MySQL® Databases**)
1. **Create New Database:** `‹DB_NAME›` → পুরো নাম হবে `‹CPANEL_USER›_‹DB_NAME›`
2. **Add New User:** `‹DB_USER›` + Password Generator দিয়ে শক্ত পাসওয়ার্ড (**শুধু অক্ষর ও সংখ্যা** রাখুন) → পুরো নাম `‹CPANEL_USER›_‹DB_USER›`
3. **Add User To Database** → **ALL PRIVILEGES** → Make Changes

টেবিল নিজে বানাবেন না — `migrate.sh` বানাবে (phpMyAdmin লাগবে না; শুধু দেখার জন্য ব্যবহার করতে পারেন)।

### I. Domain যুক্ত করা
- ডোমেইন RecoHost-এ থাকলে: cPanel → **Domains** → Create A New Domain → `‹DOMAIN›` (subdomain হলে যেমন `erp.yourdomain.com`)। Document root cPanel যা দেয় তাই রাখুন — **অ্যাপের ফোল্ডার document root হবে না।**
- ডোমেইন অন্য কোম্পানিতে কেনা হলে: সেখানে DNS-এ **A record** → RecoHost সার্ভারের IP (cPanel-এর ডান দিকে "Shared IP Address"), অথবা nameserver RecoHost-এর দিন। DNS ছড়াতে কয়েক মিনিট থেকে কয়েক ঘণ্টা লাগে।

### SSL (cPanel → **SSL/TLS Status**)
`‹DOMAIN›` টিক দিয়ে **Run AutoSSL** → তারপর cPanel → **Domains** → `‹DOMAIN›`-এর **Force HTTPS Redirect: On**।

### Upload
cPanel → **File Manager** → `/home/‹CPANEL_USER›/` (public_html-এর **বাইরে**) → Upload zip → Extract → `/home/‹CPANEL_USER›/bijoy-lenden/`

### F. Node.js App (cPanel → **Setup Node.js App** → Create Application)
| ঘর | মান |
|---|---|
| Node.js version | **22.x** |
| Application mode | **Production** |
| Application root | **`bijoy-lenden`** |
| Application URL | **`‹DOMAIN›`** |
| Application startup file | **`app.js`** |
| Environment variables | ফাঁকা (সব `.env`-এ) |

**"Run NPM Install" চাপবেন না।** Create করার পর **Stop App** চাপুন; পাতার উপরে "Enter to the virtual environment" কমান্ডটি কপি করে রাখুন।

### H. `.env` (application root-এ, permission 600)
| নাম | মান |
|---|---|
| `DATABASE_URL` | `mysql://‹CPANEL_USER›_‹DB_USER›:‹DB_PASSWORD›@localhost:3306/‹CPANEL_USER›_‹DB_NAME›?connection_limit=5` |
| `AUTH_SECRET` | সার্ভারে তৈরি র‍্যান্ডম (৩২+ অক্ষর) |
| `CRON_SECRET` | সার্ভারে তৈরি র‍্যান্ডম (১৬+ অক্ষর) |
| `BILLING_WEBHOOK_SECRET` | সার্ভারে তৈরি র‍্যান্ডম (৩২+ অক্ষর) |
| `APP_URL` | `https://‹DOMAIN›` |
| `COOKIE_SECURE` | `true` |
| `TRUSTED_PROXY_HOPS` | `1` |
| `BILLING_MOCK` | `false` (production-এ কখনো true নয়) |
| `BILLING_MANUAL` | `true` |
| `BILLING_MANUAL_INSTRUCTIONS` | আপনার বিকাশ/নগদ মার্চেন্ট নম্বর ও নির্দেশনা |
| `PLATFORM_NAME`, `PLATFORM_ADDRESS`, `PLATFORM_BIN`, `PLATFORM_SUPPORT_PHONE`, `PLATFORM_SUPPORT_EMAIL` | ইনভয়েস ও ওয়েবসাইটের তথ্য |
| ঐচ্ছিক | `SMS_*`, `EMAIL_*`, `BKASH_*` (credential পেলে) |

---

## ৩. D. cPanel Terminal কমান্ড (এই ক্রমে)

| # | Command | আগে দেখুন | সফল হলে |
|---|---|---|---|
| T1 | cPanel যে "virtual environment" কমান্ড দেখায় — সাধারণত `source /home/‹CPANEL_USER›/nodevenv/bijoy-lenden/22/bin/activate && cd /home/‹CPANEL_USER›/bijoy-lenden` | Node.js App তৈরি হয়েছে | prompt-এ `(bijoy-lenden:22)`; `node -v` → `v22.x` |
| T2 | `cp env.production.example .env && chmod 600 .env` | আগে `.env` নেই (আপডেটে আবার কপি করবেন না) | — |
| T3 | `node -e "for (const k of ['AUTH_SECRET','CRON_SECRET','BILLING_WEBHOOK_SECRET']) console.log(k+'='+require('crypto').randomBytes(36).toString('base64url'))"` | স্ক্রিন কেউ দেখছে না | ৩টি লাইন — `nano .env` দিয়ে বসান, সাথে `DATABASE_URL`, `APP_URL` ইত্যাদি (H টেবিল) |
| T4 | `node check-server.cjs` | `.env` পূরণ হয়েছে | ✔ Node 22, ✔ Prisma engines (`rhel-openssl-…`), ✔ `MySQL 8…` / `MariaDB 10.…`, `! migrations not applied yet` (স্বাভাবিক)। ✖ থাকলে থামুন |
| T5 | `sh migrate.sh` | ডেটাবেস খালি; সার্ভারে internet আছে (npx Prisma CLI নামাবে) | `Applying migration 20261007000000_mysql_baseline` … `✔ database is up to date` |
| T6 | `node check-server.cjs` | — | ✔ `migrations 5/5` (baseline + production + paddy_purchase + account_group_tree + transaction_change_date), ✔ `4 active subscription plans` |
| T7 | `mkdir -p tmp && touch tmp/restart.txt` (বা cPanel → **Start App**) | — | অ্যাপ চালু |
| T8 | `curl -s https://‹DOMAIN›/api/health` | SSL হয়েছে | `{"status":"ok","database":"ok","config":"ok"}` |
| T9 | ব্রাউজারে `https://‹DOMAIN›/register` → নিজের অ্যাকাউন্ট খুলুন → `node super-admin.cjs grant ‹YOUR_EMAIL›` | রেজিস্ট্রেশন সফল | `Granted Super Admin: …`; `https://‹DOMAIN›/admin` খোলে |
| T10 | `sh cron.sh daily-check` | `.env`-এ `CRON_SECRET`, `APP_URL` | কোনো আউটপুট নেই = সফল |
| T11 | `sh backup-db.sh` | — | `backup: /home/‹CPANEL_USER›/db-backups/bijoy-lenden-….sql.gz` |

### Cron Jobs (cPanel → **Cron Jobs**)
| সময় | Command |
|---|---|
| `0 * * * *` | `/bin/sh /home/‹CPANEL_USER›/bijoy-lenden/cron.sh daily-check >/dev/null 2>&1` |
| `*/5 * * * *` (SMS ব্যবহার করলে) | `/bin/sh /home/‹CPANEL_USER›/bijoy-lenden/cron.sh sms-queue >/dev/null 2>&1` |
| `30 2 * * *` | `/bin/sh /home/‹CPANEL_USER›/bijoy-lenden/backup-db.sh >/dev/null 2>&1` |

---

## ৪. J. SSL ও নিরাপত্তা যাচাই
| পরীক্ষা | কীভাবে | ঠিক থাকলে |
|---|---|---|
| সার্টিফিকেট | ব্রাউজারে `https://‹DOMAIN›` → তালা আইকন | "Connection is secure" |
| HTTP → HTTPS | `curl -sI http://‹DOMAIN›/login \| head -3` | `301`/`302` → `https://` |
| HSTS + secure cookie | `curl -sI https://‹DOMAIN›/login \| grep -i strict-transport` | `strict-transport-security: max-age=31536000…` |
| Health | `curl -s https://‹DOMAIN›/api/health` | `"config":"ok"` (mock বন্ধ, secret ঠিক) |
| অনলাইন | ssllabs.com/ssltest-এ `‹DOMAIN›` | A/A+ |

---

## ৫. পেমেন্ট ও পুরো workflow যাচাই
- **API URL:** আলাদা নেই — ওয়েবসাইট আর API একই ডোমেইনে (`https://‹DOMAIN›/api/...`)। CORS লাগে না (অন্য সাইট থেকে পড়া যায় না)।
- **ম্যানুয়াল পেমেন্ট** এখনই চলে। bKash credential পেলে `.env`-এ `BKASH_*` দিন, Restart, আর bKash panel-এ:
  Callback `https://‹DOMAIN›/api/billing/callback/bkash` · Webhook `https://‹DOMAIN›/api/billing/webhook/bkash`
- **যাচাই:** নতুন টেস্ট কোম্পানি রেজিস্টার → ড্যাশবোর্ডে "ট্রায়াল · ১৪ দিন" → `/billing` → প্ল্যান → ম্যানুয়াল → TrxID → Super Admin `/admin/payments`-এ **অনুমোদন** → টেস্ট কোম্পানিতে "সক্রিয়", ইনভয়েস `BL-…`, প্ল্যানের ফিচার চালু।

## ৬. আপডেট
L3 → নতুন zip Extract (একই ফোল্ডারে, `.env` থাকে) → T1 → T11 (ব্যাকআপ) → T5 → T7 → T8।

## ৭. সমস্যা হলে
| লক্ষণ | সমাধান |
|---|---|
| `check-server`: MySQL/MariaDB "too old" | সাপোর্টকে MySQL 8.0.16+ / MariaDB 10.6+ চান |
| `migrate.sh`: npx নামাতে পারে না (সার্ভারে internet বন্ধ) | **Remote MySQL** দিয়ে নিজের PC থেকে: cPanel → Remote MySQL-এ নিজের IP যোগ করুন, তারপর PC-তে `set DATABASE_URL=mysql://…@‹DOMAIN›:3306/…` ও `npx prisma migrate deploy --schema prisma/mysql/schema.prisma` |
| `"config":"error"` | Node.js App-এর `stderr.log`-এ `[config] ERROR` লাইন |
| `database: unreachable` | `DATABASE_URL`-এর নাম/পাসওয়ার্ড (cPanel prefix সহ), ইউজারের ALL PRIVILEGES |
| লগইনের পর আবার লগইন পাতা | `APP_URL` = ব্রাউজারের ঠিকানা কিনা; HTTPS চালু কিনা |
| ১ MB-এর বড় ব্যাকআপ restore ব্যর্থ | cPanel/LiteSpeed-এর upload সীমা — সাপোর্টকে ৬০ MB পর্যন্ত বাড়াতে বলুন (অ্যাপ ৫০ MB পর্যন্ত নেয়) |
