/**
 * User-supplied browser launch overrides, read from the environment so they
 * apply without patching the source. Both the headless `launch()` and the
 * headed `launchHeaded()` paths consult these helpers.
 *
 *   GSTACK_CHROMIUM_ARGS    extra Chromium command-line flags appended to the
 *                           launch args. Accepts a JSON array
 *                           (e.g. '["--use-fake-ui-for-media-stream"]') or a
 *                           whitespace-separated string
 *                           (e.g. '--flag-a --flag-b'). Empty/unset → no flags.
 *
 *   GSTACK_HTTP_CREDENTIALS HTTP basic-auth credentials as "user:pass", used to
 *                           auto-answer 401 challenges (e.g. a dev environment
 *                           behind a shared gate). Empty/unset → no credentials.
 *
 *   GSTACK_HTTP_CREDENTIALS_ORIGIN
 *                           Scope the credentials to one origin (e.g.
 *                           "https://dev.example.com"). Without it, Playwright
 *                           answers a 401 from ANY origin the session reaches —
 *                           browse routinely visits untrusted pages, so an
 *                           attacker page returning 401 could harvest the
 *                           credentials. Set this whenever credentials are set.
 *
 * All default to a no-op, so the out-of-the-box launch behavior is unchanged.
 */

function stripWrappingQuotes(value: string): string {
  return value.replace(/^"(.*)"$/, '$1');
}

/**
 * Parse extra Chromium launch flags from GSTACK_CHROMIUM_ARGS.
 * JSON array of strings → used verbatim; any other non-empty string → split on
 * whitespace (the natural shape for CLI flags). Returns [] when unset/blank.
 */
export function parseExtraChromiumArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.GSTACK_CHROMIUM_ARGS;
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed.filter((v) => v.trim().length > 0);
    }
  } catch {
    // Not JSON — fall through to whitespace splitting.
  }
  return stripWrappingQuotes(raw.trim()).split(/\s+/).filter((v) => v.length > 0);
}

export interface HttpCredentials {
  username: string;
  password: string;
  /** Only send credentials to 401s from this origin (Playwright supports it). */
  origin?: string;
}

// Warn once per process, not once per launch site (three call sites).
let warnedUnscopedCredentials = false;

/**
 * Parse HTTP basic-auth credentials from GSTACK_HTTP_CREDENTIALS ("user:pass").
 * Splits on the first colon so passwords may contain colons. Returns undefined
 * when unset, blank, or missing a colon.
 *
 * SECURITY: credentials are only returned when GSTACK_HTTP_CREDENTIALS_ORIGIN is
 * ALSO set. Playwright's httpCredentials answers ANY 401 the session reaches, and
 * browse routinely visits untrusted pages, so unscoped creds are a
 * cross-origin exfiltration vector (an attacker page returning 401 harvests them).
 * Without an origin we REFUSE to apply the credentials (return undefined) and warn
 * once explaining how to scope them — warn-only is not enough.
 */
export function parseHttpCredentials(
  env: NodeJS.ProcessEnv = process.env,
): HttpCredentials | undefined {
  const raw = env.GSTACK_HTTP_CREDENTIALS || '';
  const idx = raw.indexOf(':');
  if (idx <= 0) return undefined;
  const origin = env.GSTACK_HTTP_CREDENTIALS_ORIGIN?.trim();
  if (!origin) {
    if (!warnedUnscopedCredentials) {
      warnedUnscopedCredentials = true;
      console.warn(
        '[browse] GSTACK_HTTP_CREDENTIALS is set but GSTACK_HTTP_CREDENTIALS_ORIGIN is not — ' +
        'refusing to apply the credentials, because unscoped they would be sent to ANY origin ' +
        'that answers with a 401 (credential-exfiltration risk). ' +
        'Scope them: GSTACK_HTTP_CREDENTIALS_ORIGIN=https://your-dev-host.example',
      );
    }
    return undefined;
  }
  return { username: raw.slice(0, idx), password: raw.slice(idx + 1), origin };
}
