/**
 * Action Safety Guardrail.
 *
 * Scans model-proposed remediation actions for dangerous, destructive, or unauthorized
 * operational commands before they can reach human engineers or downstream automation tools.
 *
 * ARCHITECTURAL NOTE:
 * Regex pattern matching provides a defense-in-depth barrier against accidental copy-pasting
 * of hazardous commands by human support staff. However, denylists are inherently fail-open
 * against novel syntax variations. If automated remediation execution is introduced in future
 * milestones, an ALLOWLIST-based action taxonomy with strict parameter validation and human-in-the-loop
 * authorization must be used instead.
 */

export interface SafetyAssessment {
  isSafe: boolean;
  violations: string[];
  summary?: string;
}

export interface ProhibitedPattern {
  id: string;
  regex: RegExp;
  description: string;
}

export const PROHIBITED_ACTION_PATTERNS: ProhibitedPattern[] = [
  {
    id: "DESTRUCTIVE_FILESYSTEM_COMMAND",
    regex: /\b(rm\s+(?:--recursive\s+--force|--force\s+--recursive|-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)|rmdir\s+\/[sS]\s+\/[qQ]|mkfs|dd\s+if=|format\s+[a-z]:|drop\s+database|drop\s+table|truncate\s+table)\b/i,
    description: "Destructive filesystem or database deletion command",
  },
  {
    id: "SECURITY_BYPASS",
    regex: /\b(disable\s+(?:the\s+)?firewall|turn\s+off\s+(?:the\s+)?firewall|ufw\s+disable|iptables\s+-F|setenforce\s+0|bypass\s+mfa|disable\s+mfa|disable\s+selinux|disable\s+uac)\b/i,
    description: "Bypassing authentication, MFA, or security controls",
  },
  {
    id: "PIPE_TO_SHELL",
    regex: /\b(?:curl|wget)\s+[^|]+\|\s*(?:sudo\s+)?(?:bash|sh|zsh|python|python3|perl)\b/i,
    description: "Piping unverified remote web content directly into shell execution",
  },
  {
    id: "PERMISSIVE_PRIVILEGE_GRANT",
    regex: /\b(chmod\s+(?:-[a-zA-Z]+\s+)?(?:0?777|a\+rwx)|chown\s+(?:-[a-zA-Z]+\s+)?nobody|grant\s+all\s+privileges)\b/i,
    description: "Excessively broad or insecure privilege grant",
  },
  {
    id: "CREDENTIAL_EXPOSURE",
    regex: /\b(share\s+(?:root|admin)\s+password|send\s+(?:private\s+key|credentials)\s+via\s+(?:email|slack|chat))\b/i,
    description: "Insecure transmission of administrative credentials or private keys",
  },
];

/**
 * Assesses whether a proposed remediation string is safe for operations.
 */
export function assessActionSafety(text: string): SafetyAssessment {
  const violations: string[] = [];

  for (const pattern of PROHIBITED_ACTION_PATTERNS) {
    if (pattern.regex.test(text)) {
      violations.push(pattern.description);
    }
  }

  return {
    isSafe: violations.length === 0,
    violations,
    summary: violations.length > 0 ? violations.join("; ") : undefined,
  };
}
