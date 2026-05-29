import type { SecurityApprovalMode } from "../contracts/security.js";
import type { SkillAutonomy } from "../skills/skill-learning.js";

export type Locale = "en" | "ar";

export const SECURITY_MODE_LABELS = {
  strict: {
    en: {
      label: "Strict",
      description: "Asks before risky actions."
    },
    ar: {
      label: "صارم",
      description: "يطلب الموافقة قبل الإجراءات الحسّاسة أو الخطرة."
    }
  },
  adaptive: {
    en: {
      label: "Adaptive",
      description: "Allows clearly safe actions, blocks clearly unsafe actions, and asks when risk is ambiguous."
    },
    ar: {
      label: "متوازن",
      description: "يسمح بالإجراءات الآمنة الواضحة، يمنع الإجراءات الخطرة الواضحة، ويطلب الموافقة عند وجود غموض."
    }
  },
  open: {
    en: {
      label: "Open",
      description: "Minimizes approval prompts, but hard safety blocks still apply."
    },
    ar: {
      label: "مفتوح",
      description: "يقلّل طلبات الموافقة، لكن حدود الأمان الأساسية تبقى مفعّلة دائماً."
    }
  }
} as const;

export const SKILL_AUTONOMY_LABELS = {
  none: {
    en: {
      label: "None",
      description: "No Agent Evolution learning or automatic skill creation."
    },
    ar: {
      label: "متوقف",
      description: "لا يتعلّم طرق عمل جديدة ولا ينشئ مهارات تلقائياً."
    }
  },
  suggest: {
    en: {
      label: "Suggest",
      description: "Records reusable workflow candidates and suggests skill creation after repetition. Does not write skills automatically."
    },
    ar: {
      label: "اقتراح",
      description: "يسجّل طرق العمل القابلة لإعادة الاستخدام ويقترح تحويلها إلى مهارة بعد تكرارها، لكنه لا يكتب مهارات تلقائياً."
    }
  },
  proactive: {
    en: {
      label: "Proactive",
      description: "Automatically creates project skills after repeated successful bounded local workflows."
    },
    ar: {
      label: "استباقي",
      description: "ينشئ مهارات للمشروع تلقائياً بعد تكرار طريقة عمل محلية ناجحة ومحدودة المخاطر."
    }
  },
  autonomous: {
    en: {
      label: "Autonomous",
      description: "Automatically creates project skills after the first successful bounded workflow. Risky or external workflows remain candidates."
    },
    ar: {
      label: "ذاتي",
      description: "ينشئ مهارات للمشروع تلقائياً بعد أول طريقة عمل ناجحة ومحدودة المخاطر. طرق العمل الخطرة أو ذات الآثار الخارجية تبقى كاقتراحات فقط."
    }
  }
} as const;

export function formatSecurityMode(mode: SecurityApprovalMode, locale: Locale): {
  value: SecurityApprovalMode;
  label: string;
  description: string;
} {
  const entry = SECURITY_MODE_LABELS[mode][locale];
  return {
    value: mode,
    label: entry.label,
    description: entry.description
  };
}

export function formatSkillAutonomy(mode: SkillAutonomy, locale: Locale): {
  value: SkillAutonomy;
  label: string;
  description: string;
} {
  const entry = SKILL_AUTONOMY_LABELS[mode][locale];
  return {
    value: mode,
    label: entry.label,
    description: entry.description
  };
}

export function renderSecurityModeOption(index: number, mode: SecurityApprovalMode, locale: Locale): string {
  const entry = formatSecurityMode(mode, locale);
  return locale === "ar"
    ? `[${index}] ${entry.label}\n    ${entry.description}`
    : `[${index}] ${entry.label}\n    ${entry.description}`;
}

export function renderSkillAutonomyOption(index: number, mode: SkillAutonomy, locale: Locale): string {
  const entry = formatSkillAutonomy(mode, locale);
  return locale === "ar"
    ? `[${index}] ${entry.label}\n    ${entry.description}`
    : `[${index}] ${entry.label}\n    ${entry.description}`;
}
