---
title: ADR-0006 آلة حالة Workflow
description: آلة حالة Workflow الدائمة مع انتقالات صارمة واستمرارية SQLite.
sidebar_position: 6
---

# ADR-0006: Workflow State Machine and Durable Execution

**الحالة:** مقبول
**التاريخ:** 2026-05-04
**النطاق:** محرك Workflow، مستوى تحكم المشغل، تكامل Runtime

---

## السياق

لم يكن لدى جلسات الوكيل سابقًا نموذج تنفيذ متعدد الخطوات منظم. فقدان التقدم أثناء العمل بسبب تعطل أو إعادة تشغيل واحدة. لم يكن هناك طريقة لإيقاف مهمة طويلة الأمد عند حد آمن، أو الاستئناف بعد إعادة تشغيل العملية، أو مراقبة تقدم الخطوة، أو حقن توجيه المشغل وسير العمل دون تعديل الprompt مباشرة.

## القرار

1. **إدخال آلة حالة Workflow دائمة** مع دورات حياة صريحة لتشغيلات Workflow والخطوات.
2. **استمرار كل الحالة في SQLite** بجانب بيانات الجلسة، باستخدام نفس `SQLiteSessionDB`.
3. **قفل تشغيلات Workflow أثناء التنفيذ** لمنع التعديل المتزامن.
4. **جعل آلة الحالة صارمة**: الانتقالات غير القانونية تُطلق `IllegalTransitionError`.
5. **أوامر المشغل هي أحداث من الدرجة الأولى**، قابلة للتدقيق والتتبع.
6. **توجيه steer هو بادئة صريحة**، لا تعديل خفي للprompt.
7. **الضغط تراكمي وعند الحدود الآمنة فقط**؛ الأحداث الأصلية لا تُحذف أبدًا.
8. **استرداد إعادة التشغيل يعمل تلقائيًا** عند بدء تشغيل Runtime.
9. **AgentLoop يبقى غير مدرك لـ Workflow**؛ يحدث التكامل من خلال طبقة محول.

## نموذج الحالة

### حالات تشغيل Workflow

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

1. **In-memory workflow run state only** — مرفوض. التعطل يفقد كل التقدم.
2. **Loose state transitions** — مرفوض. فساد الحالة الصامت أسوأ من الأخطاء الصريحة.
3. **Hidden steer injection** — مرفوض. غير قابل للتدقيق، يكسر إمكانية التكرار.
4. **Workflow event summaries that delete events** — مرفوض. يدمر أثر التدقيق.
5. **Workflow-aware AgentLoop** — مرفوض. يربط طبقتين يجب أن تتطور بشكل مستقل.

## العواقب

- `SQLiteSessionDB` تدير الآن versioning المخطط (v1–v3) لجداول Workflow.
- `createRuntime` يربط أنظمة Workflow الفرعية فقط عندما `sessionDb instanceof SQLiteSessionDB`.
- تتطلب أوامر المشغل استمرارية SQLite؛ الجلسات في الذاكرة لا تدعم Workflow.
- انتهاء صلاحية قفل Workflow يمنع الأقفال اليتيمة؛ استرداد القفل القديم يعمل عند بدء التشغيل.
- كل إجراء مشغل ينتج `OperatorEvent` مع `previousState` / `newState`.

## الأثر التشغيلي

**الحدود التي يُنشئها:**
- توفر Workflow ضمانات تنفيذ دائمة فقط عند توفر استمرارية جلسة SQLite. الجلسات في الذاكرة لا يمكنها إيقاف أو استئناف أو استرداد تشغيلات Workflow.
- آلة الحالة صارمة بالتصميم. الانتقال غير القانوني هو خطأ، لا تحذير.

**الملفات والأوامر والأنظمة الفرعية المتأثرة:**
- `estacoda workflow` — سطح الأمر الكامل للمشغل
- `estacoda workflow status` — مراقبة تقدم الخطوة
- `estacoda workflow pause/resume/interrupt/cancel` — تحكم دورة الحياة
- `estacoda workflow steer` — حقن توجيه صريح للمشغل
- `src/workflow/` — آلة الحالة ومحرك التنفيذ
- `src/session/sqlite-session-db.ts` — versioning المخطط والاستمرارية
- `src/runtime/create-runtime.ts` — الربط الاختياري لـ Workflow

**ما يجب على المشرفين الحفاظ عليه:**
- يجب أن تبقى ترحيلات المخطط قابلة للعكس. جداول Workflow مُصدرة؛ يجب أن تكون الترقيات العكسية ممكنة.
- يجب أن يبقى انتهاء صلاحية القفل قصيرًا بما يكفي لمنع التوقف غير المحدود، وطويلًا بما يكفي لتحمل الخطوات البطيئة.
- يجب أن يبقى AgentLoop غير مدرك لـ Workflow. إضافة وعي Workflow إلى الحلقة الأساسية ينتهك حد المحول.

**ما يمنعه من الفشل أو الانحراف:**
- فقدان التقدم عند التعطل أو إعادة التشغيل.
- فساد الحالة الصامت من الانتقالات غير القانونية.
- تعديل prompt خفي يكسر إمكانية التكرار.
- أقفال يتيمة من العمليات المتعطلة.

**ما هو خارج القرار عن قصد:**
- جدولة تشغيلات Workflow التلقائية أو تكامل cron.
- منشئ سير عمل بصري.
- مشاركة تشغيل Workflow عبر الجلسات.
- خدمة قفل موزعة (SQLite أحادي العملية فقط).
- إعادة محاولة تلقائية بدون استدعاء المشغل.
- استرجاع checkpoint (checkpoints مسجلة لكنها غير قابلة للاستعادة في v0.8).

## صفحات ذات صلة

- [أوامر CLI](../reference/cli-commands.md)
- [المطور: Runtime](../developer/runtime.md)
- [ADR-0003: المهارات الاستشارية مقابل Workflow](./ADR-0003-skill-playbooks-vs-workflows.md)
