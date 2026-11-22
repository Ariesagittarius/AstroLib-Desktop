export interface SiteTheme {
  id: string;
  label: string;
  desc: string;
  icon: string;
  disabled?: boolean;
}

export const siteThemes: SiteTheme[] = [
  {
    id: 'material-you',
    label: 'Material You',
    desc: 'Google Material 3 / Expressive 现代学术设计语言',
    icon: 'material-you',
  },
];

export const DEFAULT_SITE_THEME = 'material-you';

export function isValidSiteTheme(id: string): boolean {
  return siteThemes.some((t) => t.id === id && !t.disabled);
}
