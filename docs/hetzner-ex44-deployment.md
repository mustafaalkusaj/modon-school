# نشر `modon-school` على Hetzner EX44

هذا التطبيق هو واجهة الإدارة المبنية بـ Next.js، ولذلك يجب نشره على:

- `app.modon-school.com` -> هذا المشروع
- `modon-school.com` -> الموقع الرئيسي إن كان مشروعًا آخر
- `files.modon-school.com` -> Storage Share

## 1. DNS المطلوب

أضف أو حدّث هذه السجلات في zone الخاصة بـ `modon-school.com`:

```dns
@      300 IN A      <MAIN_WEBSITE_IP>
www    300 IN CNAME  modon-school.com.
app    300 IN A      <EX44_IP>
files  300 IN CNAME  <STORAGE_SHARE_HOSTNAME>.
```

إذا كانت الدومين عند registrar خارجي، غيّر name servers إلى Hetzner أولًا.

## 2. تجهيز السيرفر

على EX44 ثبّت الحزم الأساسية:

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs build-essential
sudo npm install -g pm2
```

تحقق من النسخ:

```bash
node -v
npm -v
pm2 -v
nginx -v
```

## 3. رفع المشروع

مثال على المسار:

```bash
sudo mkdir -p /var/www/modon-school
sudo chown -R $USER:$USER /var/www/modon-school
git clone <YOUR_REPOSITORY_URL> /var/www/modon-school
cd /var/www/modon-school
```

إذا كان المشروع موجودًا أصلًا:

```bash
cd /var/www/modon-school
git pull
```

## 4. إعداد متغيرات البيئة

انسخ ملف المثال:

```bash
cp .env.production.example .env.production
```

ثم عبّئ القيم الفعلية:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `RBAC_COOKIE_SECRET`
- `HEALTHCHECK_TOKEN`
- `NEXT_PUBLIC_SENTRY_DSN` اختياري
- `UPSTASH_REDIS_REST_URL` و`UPSTASH_REDIS_REST_TOKEN` اختياريان لكن مهمان عند تعدد الـ instances

## 5. Build وتشغيل التطبيق

```bash
cd /var/www/modon-school
npm ci
npm run build
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

نفّذ أمر `sudo` الذي يطبعه `pm2 startup`.

تحقق من التشغيل:

```bash
pm2 status
curl -I http://127.0.0.1:3000/ar/login
curl http://127.0.0.1:3000/api/ping
```

## 6. إعداد Nginx

انسخ الملف الجاهز:

```bash
sudo mkdir -p /var/www/letsencrypt
sudo cp deploy/hetzner/nginx.app.modon-school.com.conf /etc/nginx/sites-available/app.modon-school.com.conf
sudo ln -sf /etc/nginx/sites-available/app.modon-school.com.conf /etc/nginx/sites-enabled/app.modon-school.com.conf
sudo nginx -t
sudo systemctl reload nginx
```

## 7. تفعيل SSL

بعد أن يصبح `app.modon-school.com` يشير إلى `<EX44_IP>`:

```bash
sudo certbot --nginx -d app.modon-school.com
```

تحقق:

```bash
curl -I https://app.modon-school.com
```

## 8. Smoke checks بعد النشر

```bash
cd /var/www/modon-school
APP_URL=https://app.modon-school.com HEALTHCHECK_TOKEN=<YOUR_TOKEN> npm run postdeploy:smoke
node scripts/uptime-check.mjs https://app.modon-school.com
```

## 9. ربط `files.modon-school.com`

هذا ليس جزءًا من تطبيق Next.js نفسه. نفّذه داخل Hetzner Storage Share:

1. أضف `files 300 IN CNAME <STORAGE_SHARE_HOSTNAME>.`
2. افتح `konsoleH`
3. اذهب إلى إعدادات Storage Share ثم `Subdomains`
4. أضف `files.modon-school.com`
5. انتظر حتى تصبح الحالة `Active`

## 10. أخطاء شائعة

- نسيان تغيير الـ name servers عند registrar الخارجي
- استخدام `CNAME` للـ root domain بدل `A`
- تشغيل `next start` مباشرة على public interface بدل `127.0.0.1`
- طلب SSL قبل اكتمال DNS propagation
- نسيان `pm2 save`
- نسيان `HEALTHCHECK_TOKEN` مما يجعل `/api/health` غير مفيد في الإنتاج
- تشغيل أكثر من instance دون إعداد Upstash
