# Modon School — modon-school.com

> **هذا المشروع: modon-school (مدرسة مدن) فقط. لا تخلطه مع school-iraq أو alnakheel-school.**

## Stack
- Next.js + TypeScript + Supabase + Prisma
- Domain: modon-school.com

## Supabase
- Project: منفصل — خاص بـ modon-school فقط
- لا تستخدم بيانات school-iraq أو alnakheel-school

## القواعد
1. Supabase منفصل عن باقي المشاريع
2. نفس الكود الأساسي (منسوخ من modon-school) مع تعديلات البراندنق
3. اللغة — عربي (RTL)
4. Deploy: من فرع main يدوياً عبر `deploy.sh` (PM2 على السيرفر). ماكو فرع production.
