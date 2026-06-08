---
title: ADR-0003 المهارات الاستشارية مقابل Workflow
description: المهارات الاستشارية المبنية على Markdown أولًا والتنظيم المُنفذ الدائم عبر Workflow.
sidebar_position: 3
---

# ADR-0003: Skill Playbooks vs Durable Workflows Boundary

**الحالة:** مقبول
**التاريخ:** 2026-05-03
**النطاق:** المهارات، سير العمل، Runtime

---

## السياق

تُعلّم المهارات سير العمل من خلال تعليمات Markdown. بعض سير العمل تحتاج ضمانات (الشحن، النشر، المدفوعات). أخرى تحتاج مرونة (البحث، الهندسة المعمارية، التصحيح). نموذج واحد لا يخدم كلا الاحتياجين بشكل جيد.

## القرار

تبقى المهارات **Markdown-first واستشارية** افتراضيًا:

```yaml
workflowMode: advisory
```

تُعلّم المهارة الوكيل سير عمل جيد. يقرر الوكيل كيفية تطبيقه.

توجد **سير عمل مُنفذة** للتدفقات التشغيلية عالية القيمة:

```yaml
workflowMode: enforced
```

تتطلب سير العمل المُنفذة:

- Step state
- Dependency resolution
- Failure handling
- Resume behavior
- Cancellation
- Approval gates
- Artifact recording
- Validation hooks

الانقسام:

- Skill template = authoring surface
- Workflow schema = runtime interpretation layer
- Tool planner = dependency-aware execution
- Workflow = durable enforced orchestration

## البدائل المرفوضة

1. **All skills as rigid mini-programs** — مرفوض. يقتل المرونة للمهام الثقيلة على التقدير.
2. **No enforcement at all** — مرفوض. غير آمن لسير العمل التشغيلية.
3. **Skill-level enforcement only** — مرفوض. التنفيذ ينتمي إلى Runtime، لا إلى التأليف.

## العواقب

- v0.7 يدعم سير عمل المهارات الاستشارية.
- v0.8 يُدخل Workflow للتنظيم المُنفذ الدائم.
- المهارات لا تصبح لغة برمجة.

## الأثر التشغيلي

**الحدود التي يُنشئها:**
- توفر المهارات الاستشارية توجيهًا دون ضمان ترتيب التنفيذ. قد يتخطى الوكيل أو يعيد ترتيب أو يعيد تفسير الخطوات.
- تُنفذ سير العمل المُنفذة عبر Workflow، الذي يسجل كل خطوة، ويُنفذ الانتقالات، ويحظر التغييرات غير القانونية.

**الملفات والأوامر والأنظمة الفرعية المتأثرة:**
- `estacoda skills list` — استعراض المهارات المتاحة
- `estacoda skills view <name>` — قراءة محتوى SKILL.md كامل
- `estacoda workflow` — أوامر مشغل Workflow
- `src/skills/skill-loader.ts` — تحليل وتحقق المهارات
- `src/workflow/` — محرك التنظيم الدائم
- `src/tools/tool-call-planner.ts` — التخطيط للتنفيذ مع مراعاة التبعيات

**ما يجب على المشرفين الحفاظ عليه:**
- يجب أن يبقى الحد الاستشاري/المُنفذ صريحًا. المهارة التي تدعي `advisory` لا يجب أن تُرقّى صامتًا إلى سلوك `enforced`.
- يجب أن تبقى انتقالات حالة Workflow صارمة. الانتقالات غير القانونية تُطلق `IllegalTransitionError`؛ تخفيف هذا يُفسد ضمانات التنفيذ.
- يجب أن تبقى قوالب المهارات Markdown-first. تحويل المهارات إلى DSL سينتهك القرار.

**ما يمنعه من الفشل أو الانحراف:**
- فرض ترتيب خطوات صارم على المهام الثقيلة على التقدير.
- السماح للوكيل بتخطي خطوات الأمان في سير العمل التشغيلية.
- انتفاخ المهارات حيث يحاول كل سير عمل أن يكون استشاريًا ومُنفذًا في آن واحد.

**ما هو خارج القرار عن قصد:**
- اختيار وضع سير العمل تلقائيًا. مؤلف المهارة يختار الوضع.
- منشئ سير عمل بصري. التأليف يبقى قائمًا على النص.
- تكوين سير العمل عبر المهارات. Workflow ينتمي إلى مهارة واحدة أو طبقة تكوين صريحة.

## صفحات ذات صلة

- [المهارات](../user-guide/skills.md)
- [Workflow CLI](../reference/cli-commands.md)
- [ADR-0006: آلة حالة Workflow](./ADR-0006-workflow-state-machine.md)
