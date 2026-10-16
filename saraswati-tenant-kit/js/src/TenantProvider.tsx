import { createContext, useContext, useEffect, type ReactNode } from "react";
import { SCHOOL_CSS_VARIABLES, type SchoolConfig } from "./types";

const SchoolContext = createContext<SchoolConfig | null>(null);

export function TenantProvider({
  config,
  children,
}: {
  config: SchoolConfig;
  children: ReactNode;
}) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(SCHOOL_CSS_VARIABLES.primary, config.theme.primary);
    root.style.setProperty(SCHOOL_CSS_VARIABLES.accent, config.theme.accent);
    root.style.setProperty(SCHOOL_CSS_VARIABLES.background, config.theme.background);
  }, [config]);

  return <SchoolContext.Provider value={config}>{children}</SchoolContext.Provider>;
}

export function useSchool(): SchoolConfig {
  const config = useContext(SchoolContext);
  if (config === null) {
    throw new Error("useSchool must be called inside TenantProvider.");
  }
  return config;
}
