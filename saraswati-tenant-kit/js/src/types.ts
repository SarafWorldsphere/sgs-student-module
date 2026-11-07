export type SchoolTheme = {
  primary: string;
  accent: string;
  background: string;
};

export type SchoolConfig = {
  tenantId: string;
  slug: string;
  schoolName: string;
  shortName: string;
  place: string;
  logoUrl: string;
  faviconUrl: string;
  theme: SchoolTheme;
  smsSenderName: string;
  supportEmail: string;
};

export const SCHOOL_CSS_VARIABLES = {
  primary: "--school-primary",
  accent: "--school-accent",
  background: "--school-background",
} as const;
