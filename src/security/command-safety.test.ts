import { describe, it, expect } from "vitest";
import { assessCommandSafety } from "./command-safety.js";

describe("command-safety", () => {
  describe("rm token-aware parsing", () => {
    it("hard-blocks rm -fr /Users", () => {
      expect(assessCommandSafety("rm -fr /Users").hardBlock).toBeDefined();
    });

    it("hard-blocks rm -r -f /home", () => {
      expect(assessCommandSafety("rm -r -f /home").hardBlock).toBeDefined();
    });

    it("hard-blocks rm -f -r /etc", () => {
      expect(assessCommandSafety("rm -f -r /etc").hardBlock).toBeDefined();
    });

    it("hard-blocks rm --force --recursive /var", () => {
      expect(assessCommandSafety("rm --force --recursive /var").hardBlock).toBeDefined();
    });

    it("hard-blocks rm -rf -- /var/foo (-- terminator, broad path)", () => {
      expect(assessCommandSafety("rm -rf -- /var/foo").hardBlock).toBeDefined();
    });

    it("does not hard-block rm -ri /tmp/foo (interactive, no force)", () => {
      expect(assessCommandSafety("rm -ri /tmp/foo").hardBlock).toBeUndefined();
    });

    it("does not hard-block rm -rf ./local-dir (workspace-local target)", () => {
      expect(assessCommandSafety("rm -rf ./local-dir").hardBlock).toBeUndefined();
    });

    it("hard-blocks command rm -rf /etc (wrapper)", () => {
      expect(assessCommandSafety("command rm -rf /etc").hardBlock).toBeDefined();
    });

    it("hard-blocks sudo rm -rf /etc (wrapper)", () => {
      expect(assessCommandSafety("sudo rm -rf /etc").hardBlock).toBeDefined();
    });

    it("hard-blocks rm -Rf /root", () => {
      expect(assessCommandSafety("rm -Rf /root").hardBlock).toBeDefined();
    });

    it("hard-blocks rm -fR /opt", () => {
      expect(assessCommandSafety("rm -fR /opt").hardBlock).toBeDefined();
    });

    it("hard-blocks rm --recursive --force /bin", () => {
      expect(assessCommandSafety("rm --recursive --force /bin").hardBlock).toBeDefined();
    });

    it("hard-blocks rm -rf /", () => {
      expect(assessCommandSafety("rm -rf /").hardBlock).toBeDefined();
    });

    it("hard-blocks rm -rf .", () => {
      expect(assessCommandSafety("rm -rf .").hardBlock).toBeDefined();
    });

    it("hard-blocks rm -rf ..", () => {
      expect(assessCommandSafety("rm -rf ..").hardBlock).toBeDefined();
    });

    it("classifies rm -rf ./local-dir as destructive-local", () => {
      const assessment = assessCommandSafety("rm -rf ./local-dir");
      expect(assessment.hardBlock).toBeUndefined();
      expect(assessment.riskClass).toBe("destructive-local");
    });

    it("does not classify rm -ri ./local-dir as destructive-local", () => {
      const assessment = assessCommandSafety("rm -ri ./local-dir");
      expect(assessment.hardBlock).toBeUndefined();
      expect(assessment.riskClass).toBeUndefined();
    });
  });

  describe("regression tests for shell composition and absolute paths", () => {
    it("hard-blocks cd /tmp && rm -rf /etc", () => {
      expect(assessCommandSafety("cd /tmp && rm -rf /etc").hardBlock).toBeDefined();
    });

    it("hard-blocks echo ok; rm -rf /etc", () => {
      expect(assessCommandSafety("echo ok; rm -rf /etc").hardBlock).toBeDefined();
    });

    it("hard-blocks true || rm -rf /etc", () => {
      expect(assessCommandSafety("true || rm -rf /etc").hardBlock).toBeDefined();
    });

    it("hard-blocks /bin/rm -rf /etc", () => {
      expect(assessCommandSafety("/bin/rm -rf /etc").hardBlock).toBeDefined();
    });

    it("hard-blocks /usr/bin/rm -rf /var", () => {
      expect(assessCommandSafety("/usr/bin/rm -rf /var").hardBlock).toBeDefined();
    });

    it("hard-blocks sudo -n rm -rf /etc", () => {
      expect(assessCommandSafety("sudo -n rm -rf /etc").hardBlock).toBeDefined();
    });

    it("hard-blocks sudo --non-interactive rm -rf /etc", () => {
      expect(assessCommandSafety("sudo --non-interactive rm -rf /etc").hardBlock).toBeDefined();
    });
  });

  describe("preserved high-risk detection", () => {
    it("hard-blocks git push --force origin main", () => {
      const assessment = assessCommandSafety("git push --force origin main");
      expect(assessment.hardBlock?.code).toBe("git-force-push");
    });

    it("hard-blocks mkfs.ext4 /dev/sda1", () => {
      expect(assessCommandSafety("mkfs.ext4 /dev/sda1").hardBlock).toBeDefined();
    });

    it("hard-blocks dd if=/dev/zero of=/dev/sda", () => {
      expect(assessCommandSafety("dd if=/dev/zero of=/dev/sda").hardBlock).toBeDefined();
    });

    it("classifies shutdown -h now as destructive-local", () => {
      const assessment = assessCommandSafety("shutdown -h now");
      expect(assessment.hardBlock).toBeDefined();
      expect(assessment.hardBlock?.code).toBe("system-power");
    });

    it("classifies sudo apt update as destructive-local", () => {
      const assessment = assessCommandSafety("sudo apt update");
      expect(assessment.riskClass).toBe("destructive-local");
    });

    it("classifies chmod -R 777 . as destructive-local", () => {
      const assessment = assessCommandSafety("chmod -R 777 .");
      expect(assessment.riskClass).toBe("destructive-local");
    });
  });

  describe("edge cases and known limitations", () => {
    it("returns normalized command in assessment", () => {
      const assessment = assessCommandSafety("  rm   -rf   /etc  ");
      expect(assessment.normalized).toBe("rm -rf /etc");
    });

    it("does not hard-block plain rm without flags", () => {
      expect(assessCommandSafety("rm file.txt").hardBlock).toBeUndefined();
    });

    it("does not hard-block rm -f file.txt (no recursive)", () => {
      expect(assessCommandSafety("rm -f file.txt").hardBlock).toBeUndefined();
    });

    it("does not hard-block rm -r file.txt (no force)", () => {
      expect(assessCommandSafety("rm -r file.txt").hardBlock).toBeUndefined();
    });
  });
});

/*
Token-aware parsing may produce false positives or false negatives around
shell-tokenization edge cases, wrappers, quoting, escaped spaces, aliases,
and platform-specific rm behavior. Tests cover the supported safety boundary
explicitly.
*/
