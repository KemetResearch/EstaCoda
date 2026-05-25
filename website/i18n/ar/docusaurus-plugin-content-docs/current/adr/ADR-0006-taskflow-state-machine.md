---
title: ADR-0006 آلة حالة TaskFlow
description: آلة حالة TaskFlow الدائمة مع انتقالات صارمة واستمرارية SQLite.
sidebar_position: 6
---

# ADR-0006: TaskFlow State Machine and Durable Execution

**الحالة:** مقبول
**التاريخ:** 2026-05-04
**النطاق:** محرك TaskFlow، مستوى تحكم المشغل، تكامل Runtime

---

## السياق

لم يكن لدى جلسات الوكيل سابقًا نموذج تنفيذ متعدد الخطوات منظم. فقدان التقدم أثناء العمل بسبب تعطل أو إعادة تشغيل واحدة. لم يكن هناك طريقة لإيقاف مهمة طويلة الأمد عند حد آمن، أو الاستئناف بعد إعادة تشغيل العملية، أو مراقبة تقدم الخطوة، أو حقن توجيه المشغل وسير العمل دون تعديل الprompt مباشرة.

## القرار

1. **إدخال آلة حالة TaskFlow دائمة** مع دورات حياة صريحة للتدفقات والخطوات.
2. **استمرار كل الحالة في SQLite** بجانب بيانات الجلسة، باستخدام نفس `SQLiteSessionDB`.
3. **قفل التدفقات أثناء التنفيذ** لمنع التعديل المتزامن.
4. **جعل آلة الحالة صارمة**: الانتقالات غير القانونية تُطلق `IllegalTransitionError`.
5. **أوامر المشغل هي أحداث من الدرجة الأولى**، قابلة للتدقيق والتتبع.
6. **توجيه steer هو بادئة صريحة**، لا تعديل خفي للprompt.
7. **الضغط تراكمي وعند الحدود الآمنة فقط**؛ الأحداث الأصلية لا تُحذف أبدًا.
8. **استرداد إعادة التشغيل يعمل تلقائيًا** عند بدء تشغيل Runtime.
9. **AgentLoop يبقى غير مدرك لـ TaskFlow**؛ يحدث التكامل من خلال طبقة محول.

## نموذج الحالة

### حالات التدفق

- `pending` → `running` | `cancelled`
- `running` → `paused` | `waiting` | `interrupted` | `completed` | `failed` | `cancelled`
- `paused` → `running` | `interrupted` | `cancelled`
- `waiting` → `running` | `interrupted` | `cancelled`
- `interrupted` → `running` | `cancelled`
- `completed`، `failed`، `cancelled` نهائية

### حالات الخطوة

- `pending` → `running` | `skipped`
- `running` → `completed` | `waiting_for_approval` | `paused` | `failed`
- `paused` → `running`
- `waiting_for_approval` → `running` | `failed`
- `completed`، `failed`، `skipped`، `cancelled` نهائية

### قاعدة التخطي

قد تُتخطى خطوة **فقط إذا**:

- `failurePolicy.allowSkipIfSkippable` صحيح، **و**
- `startedAt` فارغ (لم يبدأ التنفيذ).

يجب مقاطعة الخطوة التي بدأت أو إلغاؤها، لا تخطيها.

### قاعدة إعادة المحاولة

قد تُعاد محاولة خطوة **فقط إذا**:

- `idempotent` صحيح أو `safeToRetry` صحيح، **و**
- `retryCount < maxRetries`.

تنشئ إعادة المحاولة سجل خطوة جديد مرتبط عبر `retryOfStepId`.

## البدائل المرفوضة

1. **In-memory flow state only** — مرفوض. التعطل يفقد كل التقدم.
2. **Loose state transitions** — مرفوض. فساد الحالة الصامت أسوأ من الأخطاء الصريحة.
3. **Hidden steer injection** — مرفوض. غير قابل للتدقيق، يكسر إمكانية التكرار.
4. **Compaction that deletes events** — مرفوض. يدمر أثر التدقيق.
5. **TaskFlow-aware AgentLoop** — مرفوض. يربط طبقتين يجب أن تتطور بشكل مستقل.

## العواقب

- `SQLiteSessionDB` تدير الآن versioning المخطط (v1–v3) لجداول TaskFlow.
- `createRuntime` يربط أنظمة TaskFlow الفرعية فقط عندما `sessionDb instanceof SQLiteSessionDB`.
- تتطلب أوامر المشغل استمرارية SQLite؛ الجلسات في الذاكرة لا تدعم TaskFlow.
- انتهاء صلاحية قفل التدفق يمنع الأقفال اليتيمة؛ استرداد القفل القديم يعمل عند بدء التشغيل.
- كل إجراء مشغل ينتج `OperatorEvent` مع `previousState` / `newState`.

## الأثر التشغيلي

**الحدود التي يُنشئها:**
- توفر TaskFlow ضمانات تنفيذ دائمة فقط عند توفر استمرارية جلسة SQLite. الجلسات في الذاكرة لا يمكنها إيقاف أو استئناف أو استرداد التدفقات.
- آلة الحالة صارمة بالتصميم. الانتقال غير القانوني هو خطأ، لا تحذير.

**الملفات والأوامر والأنظمة الفرعية المتأثرة:**
- `estacoda flow` — سطح الأمر الكامل للمشغل
- `estacoda flow status` — مراقبة تقدم الخطوة
- `estacoda flow pause/resume/interrupt/cancel` — تحكم دورة الحياة
- `estacoda flow steer` — حقن توجيه صريح للمشغل
- `src/taskflow/` — آلة الحالة ومحرك التنفيذ
- `src/session/sqlite-session-db.ts` — versioning المخطط والاستمرارية
- `src/runtime/create-runtime.ts` — الربط الاختياري لـ TaskFlow

**ما يجب على المشرفين الحفاظ عليه:**
- يجب أن تبقى ترحيلات المخطط قابلة للعكس. جداول TaskFlow مُصدرة؛ يجب أن تكون الترقيات العكسية ممكنة.
- يجب أن يبقى انتهاء صلاحية القفل قصيرًا بما يكفي لمنع التوقف غير المحدود، وطويلًا بما يكفي لتحمل الخطوات البطيئة.
- يجب أن يبقى AgentLoop غير مدرك لـ TaskFlow. إضافة وعي TaskFlow إلى الحلقة الأساسية ينتهك حد المحول.

**ما يمنعه من الفشل أو الانحراف:**
- فقدان التقدم عند التعطل أو إعادة التشغيل.
- فساد الحالة الصامت من الانتقالات غير القانونية.
- تعديل prompt خفي يكسر إمكانية التكرار.
- أقفال يتيمة من العمليات المتعطلة.

**ما هو خارج القرار عن قصد:**
- جدولة التدفقات التلقائية أو تكامل cron.
- منشئ سير عمل بصري.
- مشاركة التدفق عبر الجلسات.
- خدمة قفل موزعة (SQLite أحادي العملية فقط).
- إعادة محاولة تلقائية بدون استدعاء المشغل.
- استرجاع checkpoint (checkpoints مسجلة لكنها غير قابلة للاستعادة في v0.8).

## صفحات ذات صلة

- [أوامر CLI](../reference/cli-commands.md)
- [المطور: Runtime](../developer/runtime.md)
- [ADR-0003: المهارات الاستشارية مقابل TaskFlow](./ADR-0003-advisory-skills-vs-taskflow.md)
