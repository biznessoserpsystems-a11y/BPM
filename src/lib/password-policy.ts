export interface PasswordPolicyResult {
  valid: boolean;
  message?: string;
}

/**
 * A single source of truth for password strength, used everywhere a
 * password is set — self-service change, admin-created users, and admin
 * password resets. Previously only length (>= 8) was checked, and only in
 * one of those three places; the other two didn't check anything at all.
 */
export function validatePasswordStrength(password: string): PasswordPolicyResult {
  if (!password || password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must include at least one lowercase letter' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must include at least one uppercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must include at least one number' };
  }
  return { valid: true };
}
