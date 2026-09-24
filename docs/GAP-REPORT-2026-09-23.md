# تقرير فجوات مدن مقابل النخيل — 2026-09-23

> المصدر: مقارنة قراءة-فقط بين `~/modon-school` و `~/nakheel-workspace/nakheel-school`.
> لم يتم تعديل أي ملف في مشروع النخيل ولا الاتصال بأي سيرفر أو قاعدة بيانات تخصه.

> **حالة التنفيذ (2026-09-23، بعد التقرير):** الفجوات الثلاث **مُنفَّذة ومبنية**.
> `npx tsc --noEmit` نظيف، `npm run build` ناجح (BUILD_ID `0s9-JXgBgopjyJ5tMrm2G`)،
> و`tests/auth-rbac-comprehensive.test.ts` يمر 85/85 بعد إضافة 4 حالات لبوابة المعلّم.
> المهمة 4 (فلترة الدرجات المؤكَّدة) ما زالت معلّقة على قرارك. لم يُنشر شيء بعد.

---

## 1. ملخص تنفيذي

| المحور | النتيجة |
|---|---|
| بنية الصفحات `app/[locale]` | **متطابقة** (52 مجلد) — مدن superset |
| ملفات المكوّنات/الهوكس | مدن **زايد** 6 ملفات، النخيل زايد **صفر** |
| مسارات `app/api/web` | مدن **زايد** 4 مسارات، ناقص **صفر** |
| مسارات `app/api/student` | مدن **زايد** `exams/integrity`، ناقص **صفر** |
| `components/` | مدن **زايد** 3 ملفات، ناقص **صفر** |
| نقاط API مُستدعاة من الواجهة | ناقص **2** (مفصّلة أدناه) |
| تكوين الأدوار `types/roles.ts` | ناقص **3 عناصر حرجة** (بوابة المعلّم) |

**الخلاصة:** مدن ليست ناقصة صفحات. النقص الحقيقي = **3 فجوات مؤكدة**، أخطرها أن بوابة المعلّم مبنية بالكامل (12 صفحة + 13 مسار API) لكنها **غير قابلة للوصول**.

### ملاحظة منهجية مهمة
فرق عدد الأسطر بين المشروعين **ليس دليل نقص**. ملفات النخيل منسّقة بـ Prettier موسّع وملفات مدن مضغوطة. مثال موثّق: `dashboard/settings/page.tsx` — النخيل 4073 سطر، مدن 2997 سطر، لكن **نفس الـ 23 دالة ونفس الـ 7 تبويبات ونفس الـ 10 قوالب طباعة ونفس الـ 10 ثيمات حرفياً**. نفس النمط في `exams/page.tsx` (3245 ↔ 2264، 26 رمز متطابق) و`super-admin/page.tsx` (1503 ↔ 790، 19 تبويب متطابق) و`roles/page.tsx` (2654 ↔ 1684، 19 رمز متطابق). أي مقارنة معتمدة على الأسطر ستنتج إنذارات كاذبة.

---

## 2. الفجوات المؤكدة

### 🔴 CRITICAL — بوابة المعلّم مبنية لكن محجوبة

**الأدلة:**
- الصفحات موجودة: `app/[locale]/teacher/` → `page.tsx`, `schedule`, `classes`, `students`, `attendance`, `grades`, `assignments`, `exams`, `messages`, `notifications`, `salary`, `profile` (12 صفحة).
- الـ API موجود: `app/api/teacher/` → 13 مسار.
- المكوّن موجود: `components/TeacherShell.tsx`.

**الناقص في `types/roles.ts`:**

| # | العنصر | مدن | النخيل |
|---|--------|-----|--------|
| 1 | `ROUTE_ACCESS` مدخل `pathPrefix: "/teacher"` | **غير موجود** | موجود (سطر 442) |
| 2 | `SIDEBAR_ITEMS` عناصر المعلّم | **صفر** | 12 عنصر حيّ |
| 3 | `DEFAULT_PATH_BY_ROLE.teacher` | `"/homework"` | `"/teacher"` |

**الأثر:** المعلّم يسجّل دخول ← يُوجَّه إلى `/homework` فقط، ولا يرى ولا يصل أي من صفحاته الاثنتي عشرة. شغل كامل مدفون.

**الإصلاح:** ثلاث تعديلات في `types/roles.ts` فقط (لا حاجة لكتابة صفحات):
1. إضافة `{ pathPrefix: "/teacher", roles: ["teacher"], requiresActiveSchool: true }` إلى `ROUTE_ACCESS`.
2. إضافة 12 عنصر sidebar بـ `roles: ["teacher"]` و `group: "academic"`.
3. تغيير `DEFAULT_PATH_BY_ROLE.teacher` إلى `"/teacher"`.

**لا تنقل** روابط النخيل الميتة: `/teacher/materials`, `/parent/grades`, `/parent/attendance`, `/parent/payments`, `/parent/behavior`, `/transport-admin/drivers`, `/transport-admin/routes`, `/transport-admin/trips` — هذه 8 روابط في النخيل بلا صفحات مقابلة. حذفها من مدن كان صحيحاً.

---

### 🟠 HIGH — تكليفات الأساتذة لا تُعرض في جدول الأساتذة

| | مدن | النخيل |
|---|-----|--------|
| `app/api/web/teachers/assignments/route.ts` | ✅ موجود | ✅ موجود |
| `useTeachersData.ts` يستدعيه | ❌ **لا** (91 سطر) | ✅ نعم (161 سطر) |
| `TeachersTable.tsx` يعرض شارات المواد/الصفوف | ❌ **لا** | ✅ نعم (أسطر 249-254) |

**الأثر:** مسار API شغّال وغير مُستهلَك. المدير لا يرى أي معلّم يدرّس أي مادة/صف في جدول الأساتذة.

**الإصلاح:**
- `app/[locale]/teachers/_hooks/useTeachersData.ts`: إضافة `Promise.all` ثاني لـ `/api/web/teachers/assignments` + حالة `assignmentsMap`، وتمريرها في القيمة المُرجَعة.
- `app/[locale]/teachers/page.tsx`: تمرير `assignmentsMap` إلى `<TeachersTable>`.
- `app/[locale]/teachers/_components/TeachersTable.tsx`: prop `assignmentsMap` + عرض الشارات.
- `_types.ts`: نوع `TeacherAssignmentsMap`.

---

### 🟠 HIGH — حقل الصف في إنشاء الامتحان نص حر (رُفعت درجته بعد القراءة الدقيقة)

> **تصحيح:** وُصفت أول مرة كـ "فلتر ناقص". القراءة الفعلية لكود النخيل تقول غير ذلك:
> النخيل حوّل `class_name` من `<input>` نص حر إلى `<select>` من صفوف المدرسة الفعلية،
> وتعليقه صريح: النص الحر ينتج امتحانات **لا يستطيع أي طالب فتحها**، لأن `class_name`
> يجب أن يطابق صف الطالب حرفياً. هذه فجوة صحّة بيانات، لا تحسين واجهة.

| | مدن | النخيل |
|---|-----|--------|
| `app/api/web/exams/class-options/route.ts` | ✅ موجود | ✅ موجود |
| `exams/page.tsx` يستدعيه | ❌ **لا** (صفر إشارة لـ `classOptions`) | ✅ `fetchClassOptions` (سطر 840) |
| حقل الصف في نموذج الإنشاء | ❌ `<input>` نص حر | ✅ `<select>` من صفوف المدرسة |

**الأثر:** أي خطأ إملائي أو مسافة زائدة عند كتابة اسم الصف ينتج امتحاناً لا يظهر لأي طالب — بلا أي رسالة خطأ.

**الإصلاح المُنفَّذ:** `fetchClassOptions` + حالتا `classOptions`/`classOptionsError` داخل `ExamsListTab`، وتحويل الحقل إلى `<select>` معطَّل عند غياب الصفوف مع رسالة إرشادية، + 3 مفاتيح i18n (`allClasses`, `noClassOptions`, `classOptionsError`).

---

## 3. ملاحظة مشتركة (ليست فجوة مدن)

`app/api/student/grades/route.ts` **متطابق حرفياً** بين المشروعين، ويقرأ جدول `grades` **بدون فلترة على حالة التأكيد أو القفل**. يعني الطالب يشوف الدرجة لحظة إدخالها، قبل ما المدير يأكّدها عبر `/api/web/grades/confirm`.

هذا قرار تصميم مشترك، مو انحدار في مدن. لكنه يستحق قراراً: إذا `grades` فيها عمود حالة، لازم الفلترة تنضاف — في المشروعين.

---

## 4. حساب الطالب — تقرير المطابقة

بوابة الطالب في مدن: **18 صفحة، 6,274 سطر** — مطابقة للنخيل + إضافات.

| المحور | الحالة |
|---|---|
| الصفحات | 18/18 ✅ (+ `assignments/[id]` و4 مكوّنات مشتركة في مدن فقط) |
| مسارات `api/student` | 100% ✅ (+ `exams/integrity` في مدن) |
| الرموز الداخلية (دوال/ثوابت) | متطابقة ✅ — الفرق الوحيد `gradeLabel` في النخيل مقابل نفس المنطق مضمَّناً inline في مدن (`report/page.tsx:184-187`) |
| `components/student/` | مدن **زايد** `ExamCountdown.tsx` و`GradeChart.tsx` |
| `StudentBottomNav` | ✅ في المشروعين + نسخة محلية في مدن |
| `ROUTE_ACCESS` و`SIDEBAR_ITEMS` للطالب | ✅ مطابقة (13 عنصر) |

### خريطة: ميزة إدارية ← هل يراها الطالب؟

| الميزة الإدارية | جدول البيانات | صفحة الطالب | API الطالب | الحالة |
|---|---|---|---|---|
| الدرجات | `grades` | `/student/grades` | `student/grades` | ✅ (مع ملاحظة القسم 3) |
| الحضور | `attendance_records` | `/student/attendance` | `student/attendance` | ✅ |
| السلوك | `behavior_logs` | `/student/behavior` | `student/behavior` | ✅ |
| الواجبات | `assignments` | `/student/assignments` + `[id]` | `student/assignments` | ✅ (نفس الجدول لدى `web/homework` و`teacher/assignments`) |
| الامتحانات | `exams` | `/student/exams` + `take` + `results` | `student/exams` | ✅ |
| المدفوعات | `payments`, `students` | `/student/payments` | `student/payments` | ✅ |
| الجدول | `class_schedules` | `/student/schedule` | `student/schedule` | ✅ |
| الرسائل | `conversations`… | `/student/messages` + `[threadId]` | `student/messages` | ✅ |
| الإشعارات/الإعلانات | `announcements`, `app_notifications` | `/student/notifications` | `student/notifications` | ✅ |
| التقويم | `exams` + `assignments` | `/student/calendar` | مجمّع | ✅ |
| التقرير الشامل | `grades` + `attendance_records` | `/student/report` | مجمّع | ✅ |
| الملف الشخصي | `managed_user_profiles`, `students`, `schools` | `/student/profile` | `student/profile` | ✅ |
| تغيير كلمة المرور | auth | `/student/settings` | `student/change-password` | ✅ |

**لا توجد ميزة إدارية واحدة بلا منفذ للطالب.**

---

## 5. خطة التنفيذ المقترحة

| # | المهمة | الملفات | الوقت | الخطورة |
|---|--------|---------|------|---------|
| 1 | فتح بوابة المعلّم | `types/roles.ts` فقط | ~45 د | منخفضة — إضافة، لا تعديل سلوك قائم |
| 2 | تكليفات الأساتذة | `teachers/_hooks/useTeachersData.ts`, `teachers/page.tsx`, `_components/TeachersTable.tsx`, `_types.ts` | ~1.5 س | منخفضة |
| 3 | فلتر صفوف الامتحانات | `exams/page.tsx` | ~1 س | منخفضة |
| 4 | قرار فلترة الدرجات المؤكَّدة | `api/student/grades/route.ts` (+ نفس الملف في النخيل، بجلسة منفصلة) | ~30 د | **يحتاج قرارك** |

**تسلسل مقترح:** 1 → 2 → 3، بناء بعد كل مهمة، ثم نشر واحد. المهمة 4 معلّقة لحد ما تقرر.

---

## 6. ما نُفِّذ فعلاً

### المهمة 1 — بوابة المعلّم (`types/roles.ts`)
- قاعدة `ROUTE_ACCESS_RULES` جديدة: `{ pathPrefix: "/teacher", roles: ["teacher"], requiresActiveSchool: true }`.
- 12 عنصر `SIDEBAR_ITEMS` بـ `group: "teacher"` — كل `href` له صفحة تحت `app/[locale]/teacher/` ومسار تحت `app/api/teacher/`. `teacher-materials` **مستثنى عمداً** (لا صفحة له، حتى في النخيل).
- توسيع اتحاد `SidebarItem["group"]` بـ `"teacher"`.
- `DEFAULT_PATH_BY_ROLE.teacher`: `"/homework"` ← `"/teacher"` (وحُذف التعليق القديم الذي ينفي وجود اللوحة).
- `AppSidebar.tsx` لم يحتج تعديلاً: `GROUP_LABELS.teacher` و`groupOrder` و13 مفتاحاً في `ITEM_LABELS` كانت موجودة سلفاً.
- وصول المعلّم إلى `/homework` **بقي كما هو** — إزالته سلوك مختلف يحتاج قرارك.

### المهمة 2 — تكليفات الأساتذة
- `useTeachersData.ts`: تصدير `TeacherAssignment` و`TeacherAssignmentsMap`، حالة `assignmentsMap`، و`Promise.all` يجلب التكليفات بالتوازي مع الأساتذة. فشل التكليفات **لا يُسقط الجدول** — يفرّغ الشارات فقط.
- تنظيف `assignmentsMap` عند حذف معلّم.
- `TeachersTable.tsx`: prop اختياري `assignmentsMap` + شارات `الصف - الشعبة` مع `title` يحمل اسم المادة.
- `teachers/page.tsx`: تمرير الخريطة.

### المهمة 3 — صف الامتحان
- `exams/page.tsx`: `fetchClassOptions` + `<select>` + رسائل الحالتين (خطأ تحميل / لا صفوف) + 3 مفاتيح i18n عربي/إنجليزي.

### الاختبارات
`tests/auth-rbac-comprehensive.test.ts` — **85/85 ناجحة**. أُضيفت 4 حالات:
- المعلّم يصل `/teacher` وأبناءها ومسارات locale.
- قاعدة `/teacher` **لا** تسرّب `/teachers` و`/teacher-accounts` و`/teacher-attendance` و`/teacher-activities`.
- غير المعلّم (admin/student/employee) ممنوع من `/teacher`.
- صفحات الإدارة تبقى سليمة لأصحابها.

كما صُحِّح توكيد قديم (سطر 536) كان يتوقع `resolveKnownUserRole("teacher") === null` بينما `teacher` و`student` دوران فعليان في `ROLES` و`LEGACY_ROLE_MAP` منذ مدة. هذا الفشل **سابق** لهذه التعديلات.

### إخفاقات سابقة لم تُمَس (خارج النطاق)
`npx vitest run` الكامل: **883 ناجحة، 7 فاشلة**، كلها في مناطق لم تُلمس:

| الملف | الموضوع |
|---|---|
| `tests/auth-group-manager.test.ts` | توجيه admin محدود الفرع إلى `/branch-overview` |
| `tests/student-status-full.test.ts` | زر بطاقة اعتماد الطالب |
| `tests/regression/dashboard-dead-controls.test.ts` | `super-admin` يرسم `<AppSidebar>` مرتين |
| `tests/api/auth-login.test.ts` (3) + `auth-login-route.test.ts` | تحقّق المدخلات يرجع 500 بدل 400 |

أربعة من الخمسة لا تذكر `teacher` إطلاقاً. تستحق جلسة إصلاح مستقلة.

### ما لم يُتحقَّق منه
تسجيل دخول فعلي بحساب معلّم — يحتاج بيانات اعتماد على بيئة حيّة. التحقق المتاح (بناء + أنواع + اختبارات RBAC) تم بالكامل.
