import { PASSWORD_MIN_LENGTH, PASSWORD_POLICY_HINT, passwordLengthError } from './password-policy';

describe('password policy', () => {
  it('refuse localement les mots de passe de moins de 14 caractères', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(14);
    expect(passwordLengthError('Court-2026!')).toContain('14 caractères');
  });

  it('laisse le backend contrôler les règles de sécurité avancées', () => {
    expect(passwordLengthError('Phrase-longue-2026!')).toBe('');
    expect(PASSWORD_POLICY_HINT).toContain('compromis');
  });
});
