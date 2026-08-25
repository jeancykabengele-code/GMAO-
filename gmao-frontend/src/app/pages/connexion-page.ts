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

  readonly loginForm = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    rememberMe: new FormControl(false, { nonNullable: true }),
  });

  async ngOnInit(): Promise<void> {
    await this.auth.initialize();
    const profile = this.auth.profile();
    if (this.auth.isAuthenticated() && profile) {
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
    const { email, password, rememberMe } = this.loginForm.getRawValue();

    try {
      const profile = await this.auth.signIn(email.trim(), password, rememberMe);
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
}