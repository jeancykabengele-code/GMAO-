import { Component, OnInit, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, GmaoAuthError } from '../auth/auth.service';

@Component({
  selector: 'app-connexion-page',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './connexion-page.html',
  styleUrl: './connexion-page.scss',
})
export class ConnexionPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  passwordVisible = false;
  submitted = false;
  loading = false;
  loginError = '';
  passwordChangeError = '';
  changingPassword = false;

  get mustChangePassword(): boolean { return this.auth.mustChangePassword(); }

  readonly passwordChangeForm = new FormGroup({
    newPassword: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(12)] }),
    confirmation: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  readonly loginForm = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  async ngOnInit(): Promise<void> {
    await this.auth.initialize();
    const profile = this.auth.profile();
    if (this.auth.isAuthenticated() && profile && !this.mustChangePassword) {
      await this.router.navigateByUrl(this.auth.destinationFor(profile.role));
    }
  }

  async submit(): Promise<void> {
    this.submitted = true;
    this.loginError = '';
    this.loginForm.markAllAsTouched();

    if (this.loginForm.invalid || this.loading) {
      return;
    }

    this.loading = true;
    const { email, password } = this.loginForm.getRawValue();

    try {
      const profile = await this.auth.signIn(email.trim(), password);
      if (this.mustChangePassword) return;
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      const destination = this.isSafeInternalUrl(returnUrl)
        ? returnUrl
        : this.auth.destinationFor(profile.role);
      await this.router.navigateByUrl(destination);
    } catch (error) {
      this.loginError = error instanceof GmaoAuthError
        ? error.message
        : 'La connexion a échoué. Veuillez réessayer.';
    } finally {
      this.loading = false;
    }
  }

  private isSafeInternalUrl(url: string | null): url is string {
    return Boolean(url && url.startsWith('/') && !url.startsWith('//') && url !== '/connexion');
  }

  async changePassword(): Promise<void> {
    this.passwordChangeError = '';
    const { newPassword, confirmation } = this.passwordChangeForm.getRawValue();
    if (this.passwordChangeForm.invalid || newPassword !== confirmation || this.changingPassword) {
      if (newPassword !== confirmation) this.passwordChangeError = 'Les deux mots de passe ne correspondent pas.';
      return;
    }
    this.changingPassword = true;
    try {
      const profile = this.auth.profile();
      await this.auth.changeLocalPassword(this.loginForm.controls.password.value, newPassword);
      if (profile) await this.router.navigateByUrl(this.auth.destinationFor(profile.role));
    } catch (error) {
      this.passwordChangeError = error instanceof GmaoAuthError ? error.message : 'Impossible de changer le mot de passe.';
    } finally { this.changingPassword = false; }
  }}
