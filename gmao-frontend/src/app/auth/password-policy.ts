export const PASSWORD_MIN_LENGTH = 14;

export const PASSWORD_POLICY_HINT =
  '14 caractères minimum. Utilisez une phrase de passe unique ; les mots de passe courants, compromis ou récemment utilisés sont refusés.';

export function passwordLengthError(password: string, label = 'Le mot de passe'): string {
  return password.length < PASSWORD_MIN_LENGTH
    ? `${label} doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`
    : '';
}
