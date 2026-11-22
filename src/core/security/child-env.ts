const BASE_ALLOWED_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
  'TEMP',
  'TMP',
  'TZ',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'COMSPEC',
  'WINDIR',
  'OS',
  'PATHEXT',
  'USERPROFILE',
  'LOCALAPPDATA',
  'APPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'PROGRAMDATA',
  'ALLUSERSPROFILE',
  'PUBLIC',
  'HOMEDRIVE',
  'HOMEPATH',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'NODE_ENV',
  'PYTHONIOENCODING',
  'PYTHONUTF8',
  'VIRTUAL_ENV',
  'CONDA_PREFIX',
  'CUDA_VISIBLE_DEVICES',
  'OMP_NUM_THREADS',
  'MKL_NUM_THREADS',
  'PYTORCH_ENABLE_MPS_FALLBACK',
  'HF_HOME',
  'HF_ENDPOINT',
  'HF_HUB_OFFLINE',
  'TRANSFORMERS_OFFLINE',
  'TORCH_HOME',
  'TEXMFHOME',
  'TEXMFCNF',
  'SSL_CERT_FILE',
  'REQUESTS_CA_BUNDLE',
  'ASTROLIB_ABP_ROOT',
  'ASTROLIB_BOOKS_DIR',
  'ASTROLIB_CONTENT_DIR',
  'ASTROLIB_DATA_DIR',
  'ASTROLIB_USER_DATA_DIR',
  'ASTROLIB_MODELS_DIR',
  'ASTROLIB_USER_ABP_DIR',
  'ASTROLIB_ANNOTATIONS_DIR',
  'ASTROLIB_INGEST_DIR',
  'ASTROLIB_PDF2ABP_DIR',
  'ASTROLIB_MODEL_IDLE_TTL_MS',
]);

const PROXY_ENV_KEYS = new Set([
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
]);

const SENSITIVE_ENV_RE =
  /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|PRIVATE|DATABASE_URL|MINERU|GEMINI|OPENAI|ANTHROPIC|DEEPSEEK|BUPT|AWS_|AZURE_|GCP_|GOOGLE_|GH_TOKEN|GITHUB_TOKEN|NPM_TOKEN)/i;

export interface SanitizedChildEnvOptions {
  keepProxy?: boolean;
  allowEnvKeys?: string[];
  sourceEnv?: NodeJS.ProcessEnv;
}

export function createSanitizedChildEnv(
  overrides: Record<string, string | undefined> = {},
  options: SanitizedChildEnvOptions = {}
): NodeJS.ProcessEnv {
  const source = options.sourceEnv ?? process.env;
  const keepProxy = options.keepProxy ?? true;
  const extraAllow = new Set((options.allowEnvKeys ?? []).map((k) => k.toUpperCase()));
  const sanitized: NodeJS.ProcessEnv = {};

  for (const [key, val] of Object.entries(source)) {
    if (val === undefined) continue;
    const upperKey = key.toUpperCase();
    const isProxyKey = PROXY_ENV_KEYS.has(upperKey);
    const inBaseAllow = BASE_ALLOWED_ENV_KEYS.has(upperKey) || (keepProxy && isProxyKey);
    const inExtraAllow = extraAllow.has(upperKey);

    if (!inBaseAllow && !inExtraAllow) {
      continue;
    }
    if (!inExtraAllow && SENSITIVE_ENV_RE.test(key)) {
      continue;
    }
    sanitized[key] = val;
  }

  for (const [key, val] of Object.entries(overrides)) {
    if (val === undefined) {
      delete sanitized[key];
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized;
}
