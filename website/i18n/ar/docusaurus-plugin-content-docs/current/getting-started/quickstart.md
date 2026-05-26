---
title: البدء السريع
description: شغّل EstaCoda في دقائق.
sidebar_position: 2
---

# البدء السريع

EstaCoda هو نظام وكيل أمر سطري. تحصل هذه الصفحة بك من الصفر إلى جلسة عمل أولى. تفترض بيئة POSIX مع Node.js 22.18.0 أو أحدث.

## التثبيت الافتراضي

أسرع مسار هو نقطة الدخول العامة:

```bash
curl -fsSL https://estacoda.kemetresearch.com/install.sh | bash
```

ينشئ هذا تثبيتًا من نوع managed-source تحت `~/.estacoda/estacoda`، ويبني المشروع، ويكتب مشغّلًا إلى `~/.local/bin/estacoda`، ويشغّل `estacoda init`.

إذا كان `~/.local/bin` غير موجود على PATH، أضفه:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

ثم قم بتهيئة المزود الأول:

```bash
estacoda setup
```

يدلّك سيوم التهيئة خلال اختيار المزود، واختيار الموديل، وتهيئة البيانات الاعتمادية. يكتب حالة الملف الشخصي تحت `~/.estacoda/profiles/default/`.

بعد التهيئة، ابدأ جلسة:

```bash
estacoda
```

## التثبيت مع خيارات

تخطي البدء الافتراضي للحالة:

```bash
curl -fsSL https://estacoda.kemetresearch.com/install.sh | bash -s -- --skip-init
```

التثبيت في مجلد مخصّص:

```bash
curl -fsSL https://estacoda.kemetresearch.com/install.sh | bash -s -- --dir ~/src/estacoda
```

التثبيت من فرع محدد:

```bash
curl -fsSL https://estacoda.kemetresearch.com/install.sh | bash -s -- --branch develop
```

## مسار المساهمين

إذا كنت تخطط لتعديل المصدر، استنسخ المستودعات وشغّل سيوم التهيئة:

```bash
git clone https://github.com/KemetResearch/EstaCoda.git
cd EstaCoda
./scripts/setup-estacoda.sh
```

ينشئ هذا تثبيتًا من نوع manual-source. يتم الاحتفاظ بالمستودعات أثناء الإزالة، ويعمل التحديث في وضعية الفحص والإرشاد.

## قائمة المهام الأولى

بعد التثبيت، تحقق من الجاهزية:

```bash
estacoda verify
```

تحقق من حالة المزود:

```bash
estacoda model status
```

شغّل التشخيص:

```bash
estacoda doctor
```

## مستندات مرتبطة

- [Installation](./installation.md) — جميع مسارات التثبيت ومتطلبات النظام
- [Uninstall](./uninstall.md) — إزالة EstaCoda مع الحفاظ على البيانات أو حذفها
- [Updating](./updating.md) — سلوك التحديث لكل طريقة تثبيت
- [CLI Commands](../reference/cli-commands.md) — مرجع الأوامر الكامل
- [State and Files](../reference/state-and-files.md) — أماكن تخزين الحالة
