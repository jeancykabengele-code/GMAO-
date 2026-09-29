from django.contrib.auth.password_validation import (
    CommonPasswordValidator,
    MinimumLengthValidator,
    NumericPasswordValidator,
)


class MinimumLengthValidatorFr(MinimumLengthValidator):
    def get_error_message(self):
        unit = "caractère" if self.min_length == 1 else "caractères"
        return f"Ce mot de passe est trop court. Il doit contenir au minimum {self.min_length} {unit}."


class CommonPasswordValidatorFr(CommonPasswordValidator):
    def get_error_message(self):
        return "Ce mot de passe est trop courant."


class NumericPasswordValidatorFr(NumericPasswordValidator):
    def get_error_message(self):
        return "Ce mot de passe est entièrement numérique."
